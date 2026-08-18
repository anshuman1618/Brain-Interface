import { and, count, eq, ne } from "drizzle-orm";
import {
  db,
  casesTable,
  subscriptionsTable,
  workspaceMembershipsTable,
  isSubscriptionPlan,
  type SubscriptionPlan,
} from "@workspace/db";
import { FALLBACK_PLAN, PLAN_NAMES, limitsFor, type PlanLimits } from "./plans";

/**
 * Plan enforcement.
 *
 * The plan a chamber is on is read from the database on every check rather
 * than trusted from a token, for the same reason membership is: a plan that
 * lapsed thirty seconds ago should stop working now, not at token expiry.
 *
 * Only *open* matters and *active* seats count. Closing a matter or revoking a
 * member frees the allowance — a limit that counted deleted rows would be a
 * trap rather than a plan.
 */

export type PlanState = {
  plan: SubscriptionPlan;
  storedPlan: SubscriptionPlan | null;
  status: string | null;
  effectiveStatus: "active" | "lapsed";
  lapsed: boolean;
  periodEnd: Date | null;
  daysLeft: number | null;
};

export type Usage = {
  plan: SubscriptionPlan;
  matters: { used: number; limit: number | null };
  seats: { used: number; limit: number | null };
};

async function planFor(workspaceId: number): Promise<SubscriptionPlan> {
  const [row] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.workspaceId, workspaceId));
  // No row, or a non-active one, falls back to the trial allowance.
  if (!row || row.status !== "active" || !isSubscriptionPlan(row.plan)) return FALLBACK_PLAN;

  // If the period has lapsed, effective plan falls back to trial.
  const now = new Date();
  if (row.currentPeriodEnd && row.currentPeriodEnd <= now) return FALLBACK_PLAN;

  return row.plan;
}

/**
 * Evaluate the subscription's state including expiry.
 *
 * A plan is lapsed when status is "active" and currentPeriodEnd is in the past.
 * The effective plan falls back to trial when lapsed. The state is derived on
 * every request — written only by webhooks — so no scheduler is needed.
 */
export async function planStateFor(workspaceId: number): Promise<PlanState> {
  const [row] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.workspaceId, workspaceId));

  const plan: SubscriptionPlan = row && isSubscriptionPlan(row.plan) ? row.plan : FALLBACK_PLAN;
  const storedPlan = row && isSubscriptionPlan(row.plan) ? row.plan : null;
  const status = row?.status ?? null;
  const periodEnd = row?.currentPeriodEnd ?? null;
  const now = new Date();

  // A plan is lapsed when the row exists, status is active, but currentPeriodEnd has passed.
  const lapsed = status === "active" && periodEnd !== null && periodEnd <= now;
  const effectiveStatus = lapsed ? ("lapsed" as const) : ("active" as const);
  const effectivePlan = lapsed ? FALLBACK_PLAN : plan;

  // Days remaining until the period end. Null if no period is set, negative
  // once it has passed.
  //
  // Rounded UP, not down. A period ending in twenty hours has 0.83 days left,
  // and flooring that to "renews in 0 days" is wrong on the one day it matters
  // most; a person counting sleeps would say one. Rounding up also absorbs the
  // fraction of a second between a period being set N days out and this being
  // read back, which otherwise reports N-1 for the entire first day.
  //
  // `lapsed` above is decided by comparing the dates directly, never from this
  // number, so the rounding cannot affect what is enforced — only what is said.
  const daysLeft = periodEnd
    ? Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return {
    plan: effectivePlan,
    storedPlan,
    status,
    effectiveStatus,
    lapsed,
    periodEnd,
    daysLeft,
  };
}

async function openMatters(workspaceId: number): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(casesTable)
    .where(and(eq(casesTable.workspaceId, workspaceId), ne(casesTable.status, "closed")));
  return Number(r?.n ?? 0);
}

async function activeSeats(workspaceId: number): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(workspaceMembershipsTable)
    .where(
      and(
        eq(workspaceMembershipsTable.workspaceId, workspaceId),
        eq(workspaceMembershipsTable.status, "active"),
      ),
    );
  return Number(r?.n ?? 0);
}

export async function usageFor(workspaceId: number): Promise<Usage> {
  const plan = await planFor(workspaceId);
  const limits: PlanLimits = limitsFor(plan);
  const [matters, seats] = await Promise.all([openMatters(workspaceId), activeSeats(workspaceId)]);
  return {
    plan,
    matters: { used: matters, limit: limits.matters },
    seats: { used: seats, limit: limits.seats },
  };
}

export type QuotaBreach = { resource: "matters" | "seats"; used: number; limit: number };

/**
 * Returns the breach if adding one more would exceed the plan, else null.
 * Callers turn this into a 402 with a message naming the plan and the number.
 */
export async function checkQuota(
  workspaceId: number,
  resource: "matters" | "seats",
): Promise<QuotaBreach | null> {
  const usage = await usageFor(workspaceId);
  const { used, limit } = usage[resource];
  if (limit === null || used < limit) return null;
  return { resource, used, limit };
}

export function quotaMessage(b: QuotaBreach, plan: SubscriptionPlan): string {
  const noun = b.resource === "matters" ? "open matters" : "team members";
  const planName = PLAN_NAMES[plan] ?? plan;
  return `Your ${planName} plan covers ${b.limit} ${noun} and you have ${b.used}. Upgrade the plan, or close a matter to free a slot.`;
}

/**
 * Check if a seat is available before adding one.
 *
 * Returns null if the seat can be added, or the breach details if it would exceed the limit.
 */
export async function assertSeatAvailable(workspaceId: number): Promise<QuotaBreach | null> {
  return checkQuota(workspaceId, "seats");
}
