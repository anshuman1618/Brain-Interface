import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  subscriptionsTable,
  paymentEventsTable,
  isSubscriptionPlan,
  isBillingPeriod,
} from "@workspace/db";
import {
  requireWorkspace,
  requireCapability,
  ctx,
  type AuthRequest,
} from "../middlewares/requireAuth";
import { activatesOnSelection, normalisePeriod, periodEnd, quote } from "../lib/plans";
import { createOrder, paymentsEnabled, razorpayConfig } from "../lib/razorpay";
import { recordAudit } from "../lib/audit";
import { logger } from "../lib/logger";

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

    if (!paymentsEnabled()) {
      res.status(503).json({
        error: "Payments unavailable",
        reason: "not_configured",
        message: "Online payment is not configured for this deployment.",
      });
      return;
    }

    const body = req.body as { plan?: unknown; billingPeriod?: unknown };
    if (!isSubscriptionPlan(body.plan) || !isBillingPeriod(body.billingPeriod)) {
      res.status(400).json({ error: "Bad request", message: "Unknown plan or billing period." });
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

/* ── Webhook ───────────────────────────────────────────────────────────── */

type RazorpayWebhook = {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; amount?: number } };
    order?: { entity?: { id?: string; amount?: number; notes?: Record<string, string> } };
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

  const base = {
    eventId,
    eventType,
    orderId,
    paymentId: paymentEntity?.id ?? null,
    amountMinor: paidMinor,
  };

  if (!isPaid) {
    await recordEvent({ ...base, workspaceId: null, outcome: "ignored", detail: "not a capture" });
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

  logger.info({ workspaceId, plan, eventId }, "Subscription activated by payment");
  res.json({ received: true });
}

export default router;
