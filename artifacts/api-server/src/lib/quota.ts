import { and, count, eq, ne } from "drizzle-orm";
import {
  db,
  casesTable,
  subscriptionsTable,
  workspaceMembershipsTable,
  isSubscriptionPlan,
  type SubscriptionPlan,
} from "@workspace/db";
import { limitsFor, type PlanLimits } from "./plans";

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
  // No row, or a lapsed/cancelled one, falls back to the trial allowance.
  if (!row || row.status !== "active" || !isSubscriptionPlan(row.plan)) return "starter";
  return row.plan;
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
  const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
  return `Your ${planName} plan covers ${b.limit} ${noun} and you have ${b.used}. Upgrade the plan, or close a matter to free a slot.`;
}
