import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import {
  db,
  aiUsageEventsTable,
  aiTopupsTable,
  subscriptionsTable,
  isSubscriptionPlan,
} from "@workspace/db";
import { FALLBACK_PLAN, limitsFor } from "../plans";
import type { SubscriptionPlan } from "@workspace/db";

/**
 * What a chamber may still spend on drafting, and the refusal when it may not.
 *
 * Derived, never stored. The balance is `plan allowance + top-ups purchased −
 * everything spent this period`, computed from `ai_usage_events` and
 * `ai_topups` on every check — the same reasoning that makes `quota.ts` count
 * `cases` rather than keep a counter. A counter drifts the first time a write
 * fails halfway; a sum cannot.
 *
 * ── Two different clocks ────────────────────────────────────────────────
 *
 * The plan allowance RESETS each billing period. Top-ups CARRY FORWARD while
 * the subscription is live. That is deliberate — a chamber that paid extra in
 * March should not lose it on 1 April — and it means the two are summed over
 * different windows and cannot be collapsed into one query.
 *
 * The consequence, which is easy to miss: unspent top-up balance is a real
 * liability. It is drafting that has been paid for and not yet delivered.
 */

export type BudgetState = {
  plan: SubscriptionPlan;
  /** What the plan grants for this period, in paise. */
  allowanceMinor: number;
  /** Unexpired top-up grants, in paise. */
  topupMinor: number;
  /** Spent since the period began, in paise. */
  spentMinor: number;
  /** allowance + topups − spent, floored at zero. */
  remainingMinor: number;
  /** When the plan allowance next resets. Null when there is no active period. */
  resetsAt: Date | null;
  /** Which models this plan may reach. */
  tier: "full" | "economy";
};

/**
 * The start of the current billing period.
 *
 * Taken from the subscription's own dates rather than from the calendar month,
 * so a chamber that started on the 12th gets a full allowance on the 12th
 * rather than a partial one on the 1st. Falls back to a rolling 30 days when
 * there is no active subscription — a trial or lapsed chamber still needs a
 * window, and "since the beginning of time" would give them one allowance ever.
 */
function periodStart(currentPeriodEnd: Date | null, months: number): Date {
  if (currentPeriodEnd) {
    const start = new Date(currentPeriodEnd);
    start.setMonth(start.getMonth() - months);
    return start;
  }
  const fallback = new Date();
  fallback.setDate(fallback.getDate() - 30);
  return fallback;
}

export async function budgetFor(workspaceId: number): Promise<BudgetState> {
  const [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.workspaceId, workspaceId));

  const now = new Date();
  const active =
    sub &&
    sub.status === "active" &&
    isSubscriptionPlan(sub.plan) &&
    (!sub.currentPeriodEnd || sub.currentPeriodEnd > now);

  // A lapsed plan falls back to the trial allowance, exactly as quota.ts does.
  // It does not fall back to zero: the chamber can still see the feature work,
  // which is what makes renewing an obvious thing to do rather than a mystery.
  const plan: SubscriptionPlan = active ? (sub.plan as SubscriptionPlan) : FALLBACK_PLAN;
  const limits = limitsFor(plan);

  // The trial's allowance is stated for its whole two-month pack rather than
  // per month, so the window it is measured over has to match.
  const months = plan === "trial" ? 2 : 1;
  const since = periodStart(active ? (sub.currentPeriodEnd ?? null) : null, months);

  const [spend] = await db
    .select({ total: sql<number>`coalesce(sum(${aiUsageEventsTable.costMinor}), 0)::int` })
    .from(aiUsageEventsTable)
    .where(and(eq(aiUsageEventsTable.workspaceId, workspaceId), gte(aiUsageEventsTable.at, since)));

  // Top-ups are summed over ALL time, not the period — they carry forward. An
  // expiry date is honoured if one is set, so changing that policy later is a
  // value in a column rather than a change here.
  const [topups] = await db
    .select({ total: sql<number>`coalesce(sum(${aiTopupsTable.grantMinor}), 0)::int` })
    .from(aiTopupsTable)
    .where(
      and(
        eq(aiTopupsTable.workspaceId, workspaceId),
        or(isNull(aiTopupsTable.expiresAt), gte(aiTopupsTable.expiresAt, now)),
      ),
    );

  const allowanceMinor = limits.aiBudgetMinor;
  const topupMinor = topups?.total ?? 0;
  const spentMinor = spend?.total ?? 0;

  return {
    plan,
    allowanceMinor,
    topupMinor,
    spentMinor,
    remainingMinor: Math.max(0, allowanceMinor + topupMinor - spentMinor),
    resetsAt: active ? (sub.currentPeriodEnd ?? null) : null,
    tier: limits.aiTier,
  };
}

/** Why a drafting request was refused, in words a chamber can act on. */
export type BudgetRefusal = { ok: false; reason: string; state: BudgetState };
export type BudgetAllowance = { ok: true; state: BudgetState };

/**
 * May this chamber spend `estimateMinor` right now?
 *
 * Checked against a **pessimistic** estimate before the call, not against the
 * actual cost after it. There is no way to un-spend tokens, so the only place
 * a limit can be enforced is in front.
 *
 * The estimate assumes the output runs to its cap, which means the last draft
 * of a month is sometimes refused when it would in fact have fit. That is the
 * right way round to be wrong: a chamber loses a draft they could have had,
 * rather than the platform losing money it cannot recover.
 */
export async function checkBudget(
  workspaceId: number,
  estimatedMinor: number,
): Promise<BudgetRefusal | BudgetAllowance> {
  const state = await budgetFor(workspaceId);

  if (state.remainingMinor <= 0) {
    return {
      ok: false,
      state,
      reason:
        "This chamber's drafting budget for the period is used up. An admin or " +
        "senior advocate can add more from the plan screen, or it resets at the " +
        "start of the next billing period.",
    };
  }

  if (estimatedMinor > state.remainingMinor) {
    return {
      ok: false,
      state,
      reason:
        "There is not enough drafting budget left for a document this long. Try a " +
        "shorter one, include fewer documents as context, or add to the budget " +
        "from the plan screen.",
    };
  }

  return { ok: true, state };
}

/**
 * Record what a call cost.
 *
 * `dedupeKey` makes this safe to call twice for one call — a retried stream or
 * a handler that ran twice must not bill the chamber twice. The conflict is
 * ignored rather than raised, because by the time this runs the work is done
 * and failing here would lose the draft as well as the money.
 */
export async function recordSpend(input: {
  workspaceId: number;
  draftId: number | null;
  purpose: "draft" | "review" | "anonymise";
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
  costMinor: number;
  dedupeKey: string;
  actorClerkId: string;
}): Promise<void> {
  await db.insert(aiUsageEventsTable).values(input).onConflictDoNothing();
}
