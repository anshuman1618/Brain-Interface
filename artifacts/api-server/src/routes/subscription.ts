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
  normalisePeriod,
  periodEnd,
  quote,
} from "../lib/plans";

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
    updatedBy: null,
  };
}

function view(row: Subscription) {
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
      subscription: row ? view(row) : trialDefault(c.workspaceId),
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

    // The term is normalised, not validated: a trial pack is two months or it
    // is not a trial pack, and a quote has no term at all, so there is nothing
    // the caller could usefully have sent for those two.
    const period = normalisePeriod(plan, billingPeriod);
    const q = quote(plan, period);
    const now = new Date();

    // A custom plan is an ENQUIRY. Marking it active here would let anyone with
    // billing.manage grant themselves the unlimited plan for nothing, because
    // the quota check honours any active row. It stays `trialing`, so the
    // chamber keeps the allowance it already had until an operator prices it.
    const activates = activatesOnSelection(plan);
    const values = {
      workspaceId: c.workspaceId,
      plan,
      billingPeriod: period,
      status: (activates ? "active" : "trialing") as "active" | "trialing",
      paidMonths: q.paidMonths,
      freeMonths: q.freeMonths,
      amountMinor: q.amountMinor,
      currency: q.currency,
      startedAt: activates ? now : null,
      currentPeriodEnd: activates ? periodEnd(period, now) : null,
      updatedBy: c.user.clerkId,
      updatedAt: now,
    };

    const [row] = await db
      .insert(subscriptionsTable)
      .values(values)
      .onConflictDoUpdate({ target: subscriptionsTable.workspaceId, set: values })
      .returning();

    res.json({
      subscription: view(row!),
      catalogue: catalogue(),
      canManage: true,
    });
  },
);

export default router;
