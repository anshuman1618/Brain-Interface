import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  subscriptionsTable,
  isSubscriptionPlan,
  isBillingPeriod,
  type Subscription,
} from "@workspace/db";
import { SetSubscriptionBody } from "@workspace/api-zod";
import {
  requireWorkspace,
  requireCapability,
  ctx,
  type AuthRequest,
} from "../middlewares/requireAuth";
import {
  CURRENCY,
  activatesOnSelection,
  catalogue,
  isChargeable,
  isOffered,
  normalisePeriod,
  periodEnd,
  quote,
} from "../lib/plans";
import { paymentsEnabled } from "../lib/razorpay";
import { planStateFor, type PlanState } from "../lib/quota";

const router: IRouter = Router();

/**
 * A chamber that has never chosen a plan is on trial. That state is implied
 * rather than written on creation, so founding a chamber stays a single insert
 * and there is no half-created workspace if this table is added later.
 */
function trialDefault(workspaceId: number) {
  return {
    workspaceId,
    plan: "trial" as const,
    billingPeriod: "one_time" as const,
    status: "trialing" as const,
    paidMonths: 0,
    freeMonths: 0,
    amountMinor: 0,
    currency: CURRENCY,
    startedAt: null,
    currentPeriodEnd: null,
    // A chamber with no row has nothing to lapse. This must stay false rather
    // than being derived from a null period, or every new signup would be told
    // its plan had expired before it chose one.
    lapsed: false,
    daysLeft: null,
    // No row is the strongest form of never having paid.
    neverPaid: true,
    updatedBy: null,
  };
}

/**
 * `lapsed` and `daysLeft` are computed here rather than sent as a raw date for
 * the browser to subtract from `Date.now()`. Enforcement runs off the server's
 * clock, so a browser with a skewed clock would otherwise show a chamber a
 * countdown that disagrees with the 402 it is about to receive.
 */
function view(row: Subscription, state: PlanState) {
  return {
    workspaceId: row.workspaceId,
    plan: row.plan,
    billingPeriod: row.billingPeriod,
    status: row.status,
    paidMonths: row.paidMonths,
    freeMonths: row.freeMonths,
    amountMinor: row.amountMinor,
    currency: row.currency,
    startedAt: row.startedAt?.toISOString() ?? null,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    lapsed: state.lapsed,
    daysLeft: state.daysLeft,
    // Taken from the same computation enforcement uses, not recomputed from the
    // fields above — the client gates its subscription screen on this, and a
    // second derivation is a second thing to get out of step.
    neverPaid: state.neverPaid,
    updatedBy: row.updatedBy ?? null,
  };
}

/**
 * Anyone in the workspace may see which plan the chamber is on — it governs
 * their limits. Only `billing.manage` may change it, and `canManage` tells the
 * UI which of the two it is rather than leaving the client to guess from a role
 * string it should not be interpreting.
 */
router.get(
  "/workspace/subscription",
  requireWorkspace,
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const [row] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.workspaceId, c.workspaceId));

    res.json({
      // requireWorkspace already resolved the plan state for this request, so
      // reading it off the context costs nothing rather than a second query.
      subscription: row ? view(row, c.planState) : trialDefault(c.workspaceId),
      catalogue: catalogue(),
      canManage: c.capabilities.includes("billing.manage"),
    });
  },
);

/**
 * Select a plan.
 *
 * The body carries two enums and nothing else. Every number written below is
 * recomputed from the server-side catalogue, so a request that tries to name
 * its own price has nowhere to put it.
 *
 * This records a selection. No payment provider is connected in this repo, so
 * nothing is charged — wiring one means setting `status` from its webhook.
 */
router.put(
  "/workspace/subscription",
  requireWorkspace,
  requireCapability("billing.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const body = SetSubscriptionBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid_subscription", details: body.error.issues });
      return;
    }

    const { plan, billingPeriod } = body.data;
    // Re-checked against the runtime enums as well: the zod schema is generated
    // from the spec, and a spec that drifts should fail closed here rather than
    // write an unknown plan into the table.
    if (!isSubscriptionPlan(plan) || !isBillingPeriod(billingPeriod)) {
      res.status(400).json({ error: "unknown_plan" });
      return;
    }

    // Built and priced is not the same as for sale. Pro, Firm and Custom exist
    // and are enforced for any chamber already on one; they cannot be newly
    // selected while they are off the storefront. See OFFERED_PLANS.
    if (!isOffered(plan)) {
      res.status(400).json({
        error: "plan_not_offered",
        message: "That plan is not currently on offer. The two-month pack is what is available.",
      });
      return;
    }

    // The term is normalised, not validated: a trial pack is two months or it
    // is not a trial pack, and a quote has no term at all, so there is nothing
    // the caller could usefully have sent for those two.
    const period = normalisePeriod(plan, billingPeriod);
    const q = quote(plan, period);
    const now = new Date();

    const [current] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.workspaceId, c.workspaceId));

    // The trial pack is bought once. Without this a chamber could re-select it
    // every two months forever and never pay for a real plan, which would make
    // the whole catalogue optional. Checked before anything is written so a
    // refused second trial cannot disturb the plan already in force.
    if (plan === "trial" && current?.trialUsedAt) {
      res.status(409).json({
        error: "trial_already_used",
        message:
          "Your chamber has already taken its two-month trial. Choose Pro or Firm to carry on.",
      });
      return;
    }

    // A custom plan is an ENQUIRY. Marking it active here would let anyone with
    // billing.manage grant themselves the unlimited plan for nothing, because
    // the quota check honours any active row. It stays `trialing`, so the
    // chamber keeps the allowance it already had until an operator prices it.
    const activates = activatesOnSelection(plan);

    // A plan that costs money becomes pending_payment if payments are configured
    // and required; otherwise it activates immediately (preview mode and
    // self-hosted, where no payment is possible).
    let status: "trialing" | "active" | "pending_payment" = "trialing";
    if (activates) {
      if (isChargeable(plan) && paymentsEnabled()) {
        status = "pending_payment";
      } else {
        status = "active";
      }
    }

    const values = {
      workspaceId: c.workspaceId,
      plan,
      billingPeriod: period,
      status,
      paidMonths: q.paidMonths,
      freeMonths: q.freeMonths,
      amountMinor: q.amountMinor,
      currency: q.currency,
      startedAt: activates ? now : null,
      currentPeriodEnd: activates ? periodEnd(period, now) : null,
      // Stamped on selection rather than on payment: selecting it is what
      // consumes the one-per-chamber offer, and a chamber that could abandon
      // checkout and start again would have an unlimited supply of trials.
      // Once set it is never cleared — carried forward here so choosing Pro
      // afterwards does not wipe the record and re-open the trial.
      trialUsedAt: plan === "trial" ? now : (current?.trialUsedAt ?? null),
      updatedBy: c.user.clerkId,
      updatedAt: now,
    };

    const [row] = await db
      .insert(subscriptionsTable)
      .values(values)
      .onConflictDoUpdate({ target: subscriptionsTable.workspaceId, set: values })
      .returning();

    // Re-read rather than reusing `c.planState`: that was resolved by
    // requireWorkspace BEFORE this write, so it still describes the period the
    // chamber was on a moment ago. One extra query on a rare write path is
    // cheaper than a response that contradicts the row it just created.
    res.json({
      subscription: view(row!, await planStateFor(c.workspaceId)),
      catalogue: catalogue(),
      canManage: true,
    });
  },
);

export default router;
