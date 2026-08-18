import type { BillingPeriod, SubscriptionPlan } from "@workspace/db";

/**
 * The price list.
 *
 * This is the only place a plan becomes an amount, and it is consulted
 * server-side on every write. The client posts a plan and a billing period —
 * two enums — and never an amount, so there is no request a browser can craft
 * that buys a year of the Firm plan for a rupee.
 *
 * Amounts are in minor units (paise). Money never touches a float.
 *
 * Four plans, and they are not the same shape as each other, which is why this
 * is no longer a simple plan-times-period grid:
 *
 *   trial   a fixed two-month pack at Rs 99 TOTAL. Not a monthly rate, and not
 *           renewable — you buy it once to evaluate the product.
 *   pro     Rs 1,999 a month, billed monthly, half-yearly or yearly.
 *   firm    Rs 4,999 a month, same three terms.
 *   custom  no price at all. A curated deployment is scoped and quoted by a
 *           person, so the app records an ENQUIRY and never a plan that is in
 *           force. See `activatesOnSelection` below — this is a security
 *           property, not a UI nicety.
 */

export const CURRENCY = "INR";

/** Monthly list price, in paise, for the plans that have one. */
const MONTHLY_MINOR: Partial<Record<SubscriptionPlan, number>> = {
  pro: 199_900, // Rs 1,999
  firm: 499_900, // Rs 4,999
};

/** The trial pack: a total, not a rate. Two months of service for Rs 99. */
const TRIAL_MONTHS = 2;
const TRIAL_MINOR = 9_900; // Rs 99

/**
 * How each billing period bills, for the plans that are billed per month.
 *
 * Two months free is the annual incentive: a year runs twelve months and is
 * charged for ten. Half-yearly is the same offer at half the commitment — six
 * months charged as five — so the discount scales with the term instead of
 * appearing from nowhere at twelve. Monthly carries no discount, which is what
 * makes the other two worth taking.
 *
 * `one_time` is the term the trial and custom plans use. It is not a choice a
 * pricing screen offers; it is what those plans are normalised to.
 */
const TERMS: Record<BillingPeriod, { months: number; paidMonths: number; label: string }> = {
  one_time: { months: TRIAL_MONTHS, paidMonths: TRIAL_MONTHS, label: "One-time" },
  monthly: { months: 1, paidMonths: 1, label: "Monthly" },
  half_yearly: { months: 6, paidMonths: 5, label: "Half-yearly" },
  yearly: { months: 12, paidMonths: 10, label: "Yearly" },
};

/** The periods a pricing screen actually offers, in display order. */
export const SELECTABLE_PERIODS: BillingPeriod[] = ["monthly", "half_yearly", "yearly"];

export const PLAN_NAMES: Record<SubscriptionPlan, string> = {
  trial: "Trial",
  pro: "Pro",
  firm: "Firm",
  custom: "Custom",
};

/** Plans billed at a monthly rate, so the term selector applies to them. */
function isMetered(plan: SubscriptionPlan): boolean {
  return MONTHLY_MINOR[plan] !== undefined;
}

/**
 * Whether choosing this plan puts it in force.
 *
 * `custom` is deliberately false. If selecting it made the subscription active,
 * anyone with `billing.manage` could pick the unlimited plan and grant
 * themselves unlimited matters and seats for nothing — the quota check only
 * honours an ACTIVE row, so an enquiry leaves the chamber on trial limits
 * exactly as it was. An operator moves it to active out of band, after the
 * commercial conversation that the plan exists to start.
 */
export function activatesOnSelection(plan: SubscriptionPlan): boolean {
  return plan !== "custom";
}

/**
 * Whether this plan costs money.
 *
 * `trial` returns true — the ₹99 pack is paid, even though it is not metered.
 * `custom` returns false — a quote is not a charge. It is priced by a person.
 */
export function isChargeable(plan: SubscriptionPlan): boolean {
  return plan !== "custom";
}

/**
 * The term a plan is actually billed on, whatever the client asked for.
 *
 * A trial pack is two months or it is not a trial pack, and a quote has no
 * term at all. Both are forced to `one_time` here rather than being validated
 * and rejected, because there is nothing the caller could usefully have sent.
 */
export function normalisePeriod(plan: SubscriptionPlan, requested: BillingPeriod): BillingPeriod {
  return isMetered(plan) ? requested : "one_time";
}

export type Quote = {
  plan: SubscriptionPlan;
  name: string;
  billingPeriod: BillingPeriod;
  /** Months of service the period covers. Zero on a quote-only plan. */
  months: number;
  /** Months actually charged for. */
  paidMonths: number;
  /** months - paidMonths. Two on the annual plans. */
  freeMonths: number;
  /** Total charged for the period, in paise. Zero on a quote-only plan. */
  amountMinor: number;
  /** What a month works out to across the term, in paise. Rounded down. */
  effectiveMonthlyMinor: number;
  /** What the same months would cost billed monthly, in paise. */
  listMinor: number;
  savingsMinor: number;
  currency: string;
  /** True when there is no price to show and the answer is "talk to us". */
  quoteOnly: boolean;
  /** False for the trial pack — it runs its two months and stops. */
  renews: boolean;
};

export function quote(plan: SubscriptionPlan, billingPeriod: BillingPeriod): Quote {
  const period = normalisePeriod(plan, billingPeriod);
  const base = {
    plan,
    name: PLAN_NAMES[plan],
    billingPeriod: period,
    currency: CURRENCY,
  };

  if (plan === "custom") {
    return {
      ...base,
      months: 0,
      paidMonths: 0,
      freeMonths: 0,
      amountMinor: 0,
      effectiveMonthlyMinor: 0,
      listMinor: 0,
      savingsMinor: 0,
      quoteOnly: true,
      renews: false,
    };
  }

  if (plan === "trial") {
    return {
      ...base,
      months: TRIAL_MONTHS,
      paidMonths: TRIAL_MONTHS,
      freeMonths: 0,
      amountMinor: TRIAL_MINOR,
      effectiveMonthlyMinor: Math.floor(TRIAL_MINOR / TRIAL_MONTHS),
      listMinor: TRIAL_MINOR,
      savingsMinor: 0,
      quoteOnly: false,
      renews: false,
    };
  }

  const term = TERMS[period];
  const monthly = MONTHLY_MINOR[plan]!;
  const amountMinor = monthly * term.paidMonths;
  const listMinor = monthly * term.months;

  return {
    ...base,
    months: term.months,
    paidMonths: term.paidMonths,
    freeMonths: term.months - term.paidMonths,
    amountMinor,
    effectiveMonthlyMinor: Math.floor(amountMinor / term.months),
    listMinor,
    savingsMinor: listMinor - amountMinor,
    quoteOnly: false,
    renews: true,
  };
}

/**
 * Everything the pricing screen renders: the metered plans crossed with the
 * three selectable terms, plus one entry each for the trial pack and the quote.
 */
export function catalogue(): Quote[] {
  const out: Quote[] = [quote("trial", "one_time")];
  for (const plan of ["pro", "firm"] as SubscriptionPlan[]) {
    for (const period of SELECTABLE_PERIODS) out.push(quote(plan, period));
  }
  out.push(quote("custom", "one_time"));
  return out;
}

export function periodLabel(billingPeriod: BillingPeriod): string {
  return TERMS[billingPeriod].label;
}

/**
 * What each plan actually entitles a chamber to.
 *
 * These are enforced, not advertised. The pricing screen lists "10 open
 * matters, 5 seats" on the trial, and the quota check is what makes that
 * sentence true — without it the plans would be decoration and nobody would
 * ever have a reason to move off the trial.
 *
 * The trial allowance is sized to fit a real chamber evaluating the product:
 * a senior advocate, a junior, a clerk and a couple of clients is five people,
 * and two months of work is more than five matters. Set any lower and the
 * evaluation fails for reasons that have nothing to do with the product.
 *
 * `null` means unlimited. A chamber that has not chosen a plan, or whose plan
 * lapsed, gets the trial allowance: enough to evaluate the product, not enough
 * to run a practice on indefinitely.
 *
 * `custom` carries the trial allowance on purpose. Its real limits are whatever
 * the contract says, and until an operator sets them a selected-but-unquoted
 * custom plan must not be a free upgrade to unlimited. It tracks trial rather
 * than holding its own numbers so the two cannot drift apart.
 */
export type PlanLimits = { matters: number | null; seats: number | null };

export const FALLBACK_PLAN: SubscriptionPlan = "trial";

const TRIAL_LIMITS: PlanLimits = { matters: 10, seats: 5 };

const LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  trial: TRIAL_LIMITS,
  pro: { matters: null, seats: 10 },
  firm: { matters: null, seats: null },
  custom: TRIAL_LIMITS,
};

export function limitsFor(plan: SubscriptionPlan): PlanLimits {
  return LIMITS[plan] ?? LIMITS[FALLBACK_PLAN];
}

/** Every plan's allowance, for the pricing screen and the quota display. */
export function limitsCatalogue(): Record<SubscriptionPlan, PlanLimits> {
  return { ...LIMITS };
}

/** End of the period that starts now, for the chosen term. */
export function periodEnd(billingPeriod: BillingPeriod, from = new Date()): Date {
  const end = new Date(from);
  end.setMonth(end.getMonth() + TERMS[billingPeriod].months);
  return end;
}
