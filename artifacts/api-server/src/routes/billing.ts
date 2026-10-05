import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  subscriptionsTable,
  paymentEventsTable,
  aiTopupsTable,
  usersTable,
  isSubscriptionPlan,
  isBillingPeriod,
} from "@workspace/db";
import {
  requireWorkspace,
  requireCapability,
  ctx,
  type AuthRequest,
} from "../middlewares/requireAuth";
import {
  activatesOnSelection,
  isOffered,
  normalisePeriod,
  periodEnd,
  quote,
  topupPack,
  TOPUP_PACKS,
  CUSTOM_TOPUP_MIN_MINOR,
  CUSTOM_TOPUP_MAX_MINOR,
  isValidCustomTopup,
} from "../lib/plans";

/** Paise as a plain rupee string, for a message and an audit line. */
function formatRupees(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN")}`;
}
import { createOrder, paymentsEnabled, razorpayConfig } from "../lib/razorpay";
import { recordAudit } from "../lib/audit";
import { logger } from "../lib/logger";
import { personName } from "../lib/person-name";
import { tokensForMinor } from "../lib/ai/models";
import { budgetFor } from "../lib/ai/budget";
import { ListAiTopupsResponse } from "@workspace/api-zod";

/**
 * Taking money.
 *
 * The shape is deliberately narrow: this server creates an order for an amount
 * IT computed, the browser pays Razorpay directly, and the only thing that can
 * mark a subscription paid is a signature-verified webhook. There is no path in
 * which a client tells us it paid and we believe it.
 *
 * The three properties worth defending in review:
 *
 *  1. The price is never taken from the request. `quote()` recomputes it from
 *     the plan catalogue on order creation AND again on the webhook.
 *  2. The webhook verifies an HMAC over the RAW body before parsing anything.
 *  3. Handling is idempotent on the provider's event id, because providers
 *     retry and a retry must not extend a subscription twice.
 */

const router: IRouter = Router();

/** What the browser needs to open the provider's checkout. */
router.get("/billing/config", requireWorkspace, (_req: AuthRequest, res) => {
  const cfg = razorpayConfig();
  res.json({
    enabled: cfg !== null,
    // The key id is public by design — it identifies the merchant to the
    // checkout script. The secret never leaves this process.
    keyId: cfg?.keyId ?? null,
    provider: cfg ? "razorpay" : null,
  });
});

/**
 * Create an order for a plan the caller has chosen.
 *
 * Does not change the subscription. Nothing is in force until the money
 * arrives and the webhook says so.
 */
router.post(
  "/billing/checkout",
  requireWorkspace,
  requireCapability("billing.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const body = req.body as { plan?: unknown; billingPeriod?: unknown };
    if (!isSubscriptionPlan(body.plan) || !isBillingPeriod(body.billingPeriod)) {
      res.status(400).json({ error: "Bad request", message: "Unknown plan or billing period." });
      return;
    }

    /*
     * What is asked for is checked before whether this deployment can charge.
     *
     * Whether a provider is configured is a deployment fact; whether a plan is
     * for sale is a product one. Answering 503 "payments unavailable" for a
     * plan nobody can buy would send an operator to look at Razorpay for
     * something that has nothing to do with Razorpay.
     *
     * This is also the gate that matters. The selection guard on
     * PUT /workspace/subscription can be skipped by a crafted request; a
     * captured payment cannot be undone.
     */
    if (!isOffered(body.plan)) {
      res.status(400).json({
        error: "plan_not_offered",
        message: "That plan is not currently on offer, so it cannot be paid for.",
      });
      return;
    }

    if (!paymentsEnabled()) {
      res.status(503).json({
        error: "Payments unavailable",
        reason: "not_configured",
        message: "Online payment is not configured for this deployment.",
      });
      return;
    }

    // One trial per person, ever. Checked against the buyer rather than the
    // chamber, because founding a second chamber is the obvious way to try for
    // a second trial and it costs nothing to do.
    if (body.plan === "trial" && c.user.trialClaimedAt) {
      res.status(409).json({
        error: "trial_already_used",
        message:
          "The two-month trial pack can be taken once. Choose Pro or Firm to continue, " +
          "or talk to us about a custom plan.",
      });
      return;
    }

    // A quote-only plan has nothing to charge for, and charging for it would be
    // charging a price nobody has agreed.
    if (!activatesOnSelection(body.plan)) {
      res.status(400).json({
        error: "Bad request",
        reason: "quote_only",
        message: "This plan is priced by quotation. Selecting it records an enquiry instead.",
      });
      return;
    }

    const period = normalisePeriod(body.plan, body.billingPeriod);
    const q = quote(body.plan, period);

    try {
      const order = await createOrder({
        amountMinor: q.amountMinor,
        currency: q.currency,
        receipt: `ws${c.workspaceId}-${Date.now()}`,
        notes: {
          workspaceId: String(c.workspaceId),
          plan: body.plan,
          billingPeriod: period,
          // Who bought it, so the webhook can record a trial against the person
          // rather than only against the chamber.
          boughtBy: c.user.clerkId,
        },
      });

      await db
        .update(subscriptionsTable)
        .set({ providerOrderId: order.id, updatedAt: new Date() })
        .where(eq(subscriptionsTable.workspaceId, c.workspaceId));

      await recordAudit(req, c, {
        action: "billing.checkout_started",
        summary: `Started payment for ${q.name}, ${period.replace("_", "-")}`,
      });

      res.json({
        orderId: order.id,
        amountMinor: order.amountMinor,
        currency: order.currency,
        plan: body.plan,
        billingPeriod: period,
      });
    } catch (err) {
      logger.error({ err, workspaceId: c.workspaceId }, "Could not create payment order");
      res.status(502).json({
        error: "Payment provider error",
        message: "The payment provider could not be reached. Nothing has been charged.",
      });
    }
  },
);

/* ── Drafting top-ups ──────────────────────────────────────────────────── */

/**
 * Buy more drafting budget when the month's allowance is gone.
 *
 * Held to `ai_topup.purchase` rather than `billing.manage`, which is admin
 * only. A senior advocate running the practice's work should be able to keep
 * the chamber drafting on a Friday afternoon without also being handed the
 * plan, the payment methods and the subscription — see the note on the
 * capability in `lib/permissions.ts`.
 *
 * Nothing is granted here. The order is created; the GRANT is written by the
 * webhook, from Razorpay's own confirmation, because a browser saying a payment
 * succeeded is not evidence that it did.
 */
router.get(
  "/ai/topups",
  requireWorkspace,
  requireCapability("ai_topup.purchase"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    /*
     * The tier decides what a rupee buys, so the token figure has to be read
     * from THIS chamber's budget rather than assumed. A trial chamber is on
     * the lighter model and gets roughly 2.5x the tokens for the same money —
     * quoting the full-tier number to them would understate the pack by more
     * than half.
     */
    const { tier } = await budgetFor(c.workspaceId);
    res.json(
      ListAiTopupsResponse.parse({
        packs: TOPUP_PACKS.map((p) => ({
          code: p.code,
          label: p.label,
          priceMinor: p.priceMinor,
          grantMinor: p.grantMinor,
          grantTokens: tokensForMinor(p.grantMinor, tier),
        })),
        currency: "INR",
        paymentsEnabled: paymentsEnabled(),
        customMinMinor: CUSTOM_TOPUP_MIN_MINOR,
        customMaxMinor: CUSTOM_TOPUP_MAX_MINOR,
      }),
    );
  },
);

router.post(
  "/ai/topups",
  requireWorkspace,
  requireCapability("ai_topup.purchase"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const body = (req.body ?? {}) as { pack?: string; amountMinor?: unknown };

    /*
     * Either one of the three packs, or an amount the buyer chose.
     *
     * A custom amount is validated HERE and again in the webhook, against the
     * same `isValidCustomTopup`. Twice, because the two checks answer
     * different questions: this one refuses to create an order nobody should
     * be able to pay, and the webhook's refuses to grant on one that somehow
     * was. Neither makes the other redundant — an order can be created by
     * this server and paid days later, and the webhook is where the money
     * actually becomes drafting budget.
     */
    const custom =
      body.pack === "custom" || (body.pack === undefined && body.amountMinor !== undefined);
    const pack = custom ? null : topupPack(String(body.pack ?? ""));

    let amountMinor: number;
    let label: string;
    if (custom) {
      const raw = typeof body.amountMinor === "number" ? body.amountMinor : NaN;
      if (!isValidCustomTopup(raw)) {
        res.status(400).json({
          error: "invalid_request",
          message: `Choose a whole-rupee amount between ${formatRupees(CUSTOM_TOPUP_MIN_MINOR)} and ${formatRupees(CUSTOM_TOPUP_MAX_MINOR)}.`,
        });
        return;
      }
      amountMinor = raw;
      label = `${formatRupees(raw)} drafting top-up`;
    } else if (pack) {
      amountMinor = pack.priceMinor;
      label = pack.label;
    } else {
      res.status(400).json({ error: "invalid_request", message: "Unknown top-up pack." });
      return;
    }
    if (!paymentsEnabled()) {
      res.status(503).json({
        error: "payments_unavailable",
        message: "Payments are not configured on this deployment.",
      });
      return;
    }

    try {
      const order = await createOrder({
        amountMinor,
        currency: "INR",
        receipt: `ws${c.workspaceId}-ai-${Date.now()}`,
        // `aiTopup` is what the webhook forks on. The name and clerk id are
        // carried so the grant records who bought it; neither is trusted for
        // anything but display. No amount is carried for a custom top-up —
        // the webhook uses what was CAPTURED, which cannot be edited here.
        notes: {
          workspaceId: String(c.workspaceId),
          aiTopup: pack ? pack.code : "custom",
          boughtBy: c.user.clerkId,
          boughtByName: personName(c.user),
        },
      });

      await recordAudit(req, c, {
        action: "billing.checkout_started",
        summary: `Started payment for a drafting top-up (${label})`,
      });

      res.json({
        orderId: order.id,
        amountMinor: order.amountMinor,
        currency: order.currency,
        pack: pack ? pack.code : "custom",
      });
    } catch (err) {
      logger.error({ err, workspaceId: c.workspaceId }, "Could not create a top-up order");
      res.status(502).json({
        error: "Payment provider error",
        message: "The payment provider could not be reached. Nothing has been charged.",
      });
    }
  },
);

/* ── Webhook ───────────────────────────────────────────────────────────── */

type RazorpayWebhook = {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; amount?: number } };
    order?: { entity?: { id?: string; amount?: number; notes?: Record<string, string> } };
    refund?: { entity?: { id?: string; payment_id?: string; amount?: number } };
  };
};

/** Applied outcomes are informational; the row exists to make retries no-ops. */
async function recordEvent(input: {
  eventId: string;
  eventType: string;
  workspaceId: number | null;
  orderId: string | null;
  paymentId: string | null;
  amountMinor: number | null;
  outcome: string;
  detail?: string;
}): Promise<boolean> {
  try {
    await db.insert(paymentEventsTable).values(input);
    return true;
  } catch {
    // Unique violation on event_id: some other delivery of this same event got
    // here first. That is the mechanism working, not an error.
    return false;
  }
}

/**
 * The events that are not a payment arriving.
 *
 * Three of them mean something and the rest are noise. Each is deliberately
 * conservative about what it will move, because these fire on money that has
 * already been taken:
 *
 *   payment.failed       an attempt did not go through. A chamber sitting at
 *                        `pending_payment` STAYS there — the attempt failing is
 *                        the expected first outcome of a retry loop, and
 *                        knocking them to `past_due` would make a second try
 *                        look like a lapse. Recorded, nothing moved.
 *   subscription.halted  recorded and NOT acted on, deliberately. This
 *                        integration creates one-time orders per period, never
 *                        a Razorpay Subscription, so the event carries no
 *                        entity this table can be joined to. It is enumerated
 *                        rather than left to the default so the next reader
 *                        knows the omission was considered. Expiry is already
 *                        handled without it: `planStateFor` derives lapse from
 *                        `currentPeriodEnd` on every request.
 *   refund.processed     the money went back. The plan is `cancelled`.
 *
 * A refund carries no order notes, so the workspace is found by the payment id
 * stored when the plan activated. No match means a refund for something this
 * table never activated, which is recorded and left alone rather than guessed at.
 */
async function handleNonPayment(
  eventType: string,
  base: { eventId: string },
  refundedPaymentId: string | null,
): Promise<{ workspaceId: number | null; outcome: string; detail: string }> {
  if (eventType === "payment.failed") {
    return {
      workspaceId: null,
      outcome: "ignored",
      detail: "payment failed; the chamber keeps its current status and may retry",
    };
  }

  if (eventType === "subscription.halted") {
    return {
      workspaceId: null,
      outcome: "ignored",
      detail: "halted: this integration bills by one-time order, not a provider subscription",
    };
  }

  if (eventType === "refund.processed" && refundedPaymentId) {
    const [row] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.providerPaymentId, refundedPaymentId));

    if (!row) {
      return {
        workspaceId: null,
        outcome: "ignored",
        detail: `refund for payment ${refundedPaymentId}, which activated no subscription here`,
      };
    }

    await db
      .update(subscriptionsTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(subscriptionsTable.workspaceId, row.workspaceId));

    logger.info(
      { workspaceId: row.workspaceId, eventId: base.eventId, paymentId: refundedPaymentId },
      "Subscription cancelled by refund",
    );
    return {
      workspaceId: row.workspaceId,
      outcome: "applied",
      detail: "refund processed; subscription cancelled",
    };
  }

  return { workspaceId: null, outcome: "ignored", detail: "not a capture" };
}

/**
 * The webhook handler.
 *
 * Mounted in app.ts with `express.raw()` BEFORE `express.json()`, because the
 * signature covers the exact bytes sent. Re-serialising parsed JSON changes key
 * order and whitespace and the digest stops matching — which is the usual way
 * an integration ends up verifying nothing at all.
 *
 * Exported rather than registered here so the raw-body requirement is visible
 * at the mount site instead of hidden in a router.
 */
export async function handleRazorpayWebhook(req: AuthRequest, res: import("express").Response) {
  const raw = req.body;
  if (!Buffer.isBuffer(raw)) {
    logger.error("Razorpay webhook did not receive a raw body — check the mount order in app.ts");
    res.status(500).json({ error: "Misconfigured" });
    return;
  }

  const { verifyWebhook } = await import("../lib/razorpay");
  if (!verifyWebhook(raw, req.header("x-razorpay-signature"))) {
    // Deliberately terse. An attacker probing this endpoint learns only that
    // it exists, and every legitimate caller can produce a valid signature.
    logger.warn({ ip: req.ip }, "Rejected a payment webhook with an invalid signature");
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  let event: RazorpayWebhook;
  try {
    event = JSON.parse(raw.toString("utf8")) as RazorpayWebhook;
  } catch {
    res.status(400).json({ error: "Malformed payload" });
    return;
  }

  // Razorpay sends a per-delivery id; fall back to the payment id so a missing
  // header cannot turn every retry into a fresh application.
  const paymentEntity = event.payload?.payment?.entity;
  const orderEntity = event.payload?.order?.entity;
  const eventId =
    req.header("x-razorpay-event-id") ??
    `${event.event ?? "unknown"}:${paymentEntity?.id ?? orderEntity?.id ?? "none"}`;
  const eventType = event.event ?? "unknown";

  // Anything other than a successful capture is recorded and ignored. Acting on
  // "authorized" would activate a plan whose money can still fail to arrive.
  const isPaid = eventType === "payment.captured" || eventType === "order.paid";
  const notes = orderEntity?.notes ?? {};
  const workspaceId = Number(notes["workspaceId"]);
  const orderId = orderEntity?.id ?? paymentEntity?.order_id ?? null;
  const paidMinor = paymentEntity?.amount ?? orderEntity?.amount ?? null;
  const refundEntity = event.payload?.refund?.entity;

  const base = {
    eventId,
    eventType,
    orderId,
    paymentId: paymentEntity?.id ?? refundEntity?.payment_id ?? null,
    amountMinor: paidMinor ?? refundEntity?.amount ?? null,
  };

  if (!isPaid) {
    const handled = await handleNonPayment(eventType, base, refundEntity?.payment_id ?? null);
    await recordEvent({
      ...base,
      workspaceId: handled.workspaceId,
      outcome: handled.outcome,
      detail: handled.detail,
    });
    res.json({ received: true });
    return;
  }

  /*
   * A top-up is a different kind of paid order, so it forks before the plan
   * checks below — it has no plan and no billing period, and running it through
   * `isSubscriptionPlan` would reject it as malformed.
   *
   * The same discipline applies: the pack is trusted only as a LABEL, and the
   * amount is recomputed from `TOPUP_PACKS` and compared. An order paid for less
   * than the pack costs grants nothing.
   */
  const packCode = notes["aiTopup"];
  if (packCode) {
    /*
     * Two shapes of top-up, and they are validated differently on purpose.
     *
     * A PACK is checked the way a plan is: the code is a label, the price is
     * recomputed from `TOPUP_PACKS`, and an order paid for less than the pack
     * costs grants nothing.
     *
     * A CUSTOM amount has no catalogue row to recompute from. So the grant is
     * taken from `paidMinor` — the amount the PROVIDER says it captured —
     * rather than from anything this server put in the notes. That is the
     * stronger of the two, not a relaxation: notes travel with the order and
     * could in principle be edited at the provider, whereas the captured
     * amount is the money that actually moved. The bounds are re-checked here
     * so a captured amount outside them grants nothing either.
     */
    const isCustom = packCode === "custom";
    const pack = isCustom ? null : topupPack(packCode);

    if (!Number.isInteger(workspaceId) || (!pack && !isCustom)) {
      await recordEvent({
        ...base,
        workspaceId: null,
        outcome: "rejected",
        detail: "top-up order notes did not identify a workspace and a pack",
      });
      res.json({ received: true });
      return;
    }

    if (pack && paidMinor !== pack.priceMinor) {
      await recordEvent({
        ...base,
        workspaceId,
        outcome: "rejected",
        detail: `paid ${paidMinor} but the ${pack.code} top-up costs ${pack.priceMinor}`,
      });
      res.json({ received: true });
      return;
    }

    if (isCustom && !isValidCustomTopup(paidMinor)) {
      await recordEvent({
        ...base,
        workspaceId,
        outcome: "rejected",
        detail: `custom top-up captured ${paidMinor}, outside ${CUSTOM_TOPUP_MIN_MINOR}-${CUSTOM_TOPUP_MAX_MINOR}`,
      });
      res.json({ received: true });
      return;
    }

    // Sold at cost either way, so the grant equals what was paid.
    const grantMinor = pack ? pack.grantMinor : (paidMinor as number);
    const priceMinor = pack ? pack.priceMinor : (paidMinor as number);
    const label = pack
      ? pack.label
      : `₹${(priceMinor / 100).toLocaleString("en-IN")} drafting top-up`;

    await db.insert(aiTopupsTable).values({
      workspaceId,
      pack: pack ? pack.code : "custom",
      priceMinor,
      grantMinor,
      orderId,
      paymentId: base.paymentId,
      boughtByClerkId: notes["boughtBy"] ?? "",
      boughtByName: notes["boughtByName"] ?? "",
    });

    await recordEvent({
      ...base,
      workspaceId,
      outcome: "applied",
      detail: `drafting top-up: ${label}`,
    });
    logger.info(
      { workspaceId, pack: pack ? pack.code : "custom", grantMinor },
      "Drafting budget topped up",
    );
    res.json({ received: true });
    return;
  }

  const plan = notes["plan"];
  const period = notes["billingPeriod"];
  if (!Number.isInteger(workspaceId) || !isSubscriptionPlan(plan) || !isBillingPeriod(period)) {
    await recordEvent({
      ...base,
      workspaceId: null,
      outcome: "rejected",
      detail: "order notes did not identify a workspace and plan",
    });
    logger.error({ eventId, notes }, "Paid order could not be matched to a workspace");
    // 200 on purpose: a retry cannot fix an order whose notes are unusable, and
    // a non-2xx would have the provider redeliver it forever.
    res.json({ received: true });
    return;
  }

  // THE price check. `notes` came back from the provider, but it originated
  // here — so the plan is trusted only as a label, and the amount is recomputed
  // and compared. An order paid for less than the plan costs does not activate.
  const q = quote(plan, normalisePeriod(plan, period));
  if (paidMinor !== q.amountMinor) {
    await recordEvent({
      ...base,
      workspaceId,
      outcome: "rejected",
      detail: `paid ${paidMinor} but ${plan}/${period} costs ${q.amountMinor}`,
    });
    logger.error(
      { eventId, workspaceId, paidMinor, expected: q.amountMinor },
      "Payment amount does not match the plan price",
    );
    res.json({ received: true });
    return;
  }

  // Claim the event before doing the work. A duplicate delivery loses the race
  // here and returns without touching the subscription.
  const claimed = await recordEvent({ ...base, workspaceId, outcome: "applied" });
  if (!claimed) {
    logger.info({ eventId }, "Payment webhook already handled");
    res.json({ received: true, duplicate: true });
    return;
  }

  const now = new Date();
  await db
    .update(subscriptionsTable)
    .set({
      plan,
      billingPeriod: q.billingPeriod,
      status: "active",
      paidMonths: q.paidMonths,
      freeMonths: q.freeMonths,
      amountMinor: q.amountMinor,
      currency: q.currency,
      startedAt: now,
      currentPeriodEnd: periodEnd(q.billingPeriod, now),
      providerOrderId: orderId,
      providerPaymentId: paymentEntity?.id ?? null,
      updatedAt: now,
    })
    .where(eq(subscriptionsTable.workspaceId, workspaceId));

  /*
   * The trial is one per person, ever — recorded here rather than at checkout.
   *
   * On the USER, not the subscription: a founder who used the trial and then
   * creates a second chamber must not get another, and a per-workspace record
   * resets every time somebody founds one. `subscriptions.trialUsedAt` still
   * marks the chamber; this marks the human.
   *
   * Written from the webhook so it records a payment that actually completed.
   * Recording it at checkout would burn somebody's one trial on an order they
   * abandoned at the card form.
   */
  if (plan === "trial") {
    const claimant = notes["boughtBy"];
    if (claimant) {
      await db
        .update(usersTable)
        .set({ trialClaimedAt: now })
        .where(eq(usersTable.clerkId, claimant));
    } else {
      // The order predates the note, or was created by hand. Worth knowing:
      // the chamber gets its trial and the person's one-per-lifetime record
      // was not written, so they could take another elsewhere.
      logger.warn(
        { workspaceId, eventId },
        "A trial payment carried no buyer note; the per-person trial claim was not recorded",
      );
    }
  }

  logger.info({ workspaceId, plan, eventId }, "Subscription activated by payment");
  res.json({ received: true });
}

export default router;
