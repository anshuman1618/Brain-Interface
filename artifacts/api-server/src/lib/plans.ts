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
 */

export const CURRENCY = "INR";

/** Monthly list price per plan, in paise. */
const MONTHLY_MINOR: Record<SubscriptionPlan, number> = {
  starter: 99_900, // Rs 999
  pro: 249_900, // Rs 2,499
  firm: 599_900, // Rs 5,999
};

/**
 * How each billing period bills.
 *
 * The brief specifies two months free. Those two months are the annual
 * incentive: a year runs twelve months and is charged for ten. Half-yearly is
 * the same offer at half the commitment — six months charged as five — so the
 * discount scales with the term instead of appearing from nowhere at twelve.
 * Monthly carries no discount, which is what makes the other two worth taking.
 */
const TERMS: Record<BillingPeriod, { months: number; paidMonths: number; label: string }> = {
  monthly: { months: 1, paidMonths: 1, label: "Monthly" },
  half_yearly: { months: 6, paidMonths: 5, label: "Half-yearly" },
  yearly: { months: 12, paidMonths: 10, label: "Yearly" },
};

export type Quote = {
  plan: SubscriptionPlan;
  billingPeriod: BillingPeriod;
  /** Months of service the period covers. */
  months: number;
  /** Months actually charged for. */
  paidMonths: number;
  /** months - paidMonths. Two on the annual plan. */
  freeMonths: number;
  /** Total charged for the period, in paise. */
  amountMinor: number;
  /** What a month works out to across the term, in paise. Rounded down. */
  effectiveMonthlyMinor: number;
  /** What the same months would cost billed monthly, in paise. */
  listMinor: number;
  savingsMinor: number;
  currency: string;
};

export function quote(plan: SubscriptionPlan, billingPeriod: BillingPeriod): Quote {
  const term = TERMS[billingPeriod];
  const monthly = MONTHLY_MINOR[plan];
  const amountMinor = monthly * term.paidMonths;
  const listMinor = monthly * term.months;

  return {
    plan,
    billingPeriod,
    months: term.months,
    paidMonths: term.paidMonths,
    freeMonths: term.months - term.paidMonths,
    amountMinor,
    effectiveMonthlyMinor: Math.floor(amountMinor / term.months),
    listMinor,
    savingsMinor: listMinor - amountMinor,
    currency: CURRENCY,
  };
}

/** Every plan crossed with every period — what the pricing screen renders. */
export function catalogue(): Quote[] {
  const out: Quote[] = [];
  for (const plan of Object.keys(MONTHLY_MINOR) as SubscriptionPlan[]) {
    for (const period of Object.keys(TERMS) as BillingPeriod[]) {
      out.push(quote(plan, period));
    }
  }
  return out;
}

export function periodLabel(billingPeriod: BillingPeriod): string {
  return TERMS[billingPeriod].label;
}

/** End of the period that starts now, for the chosen term. */
export function periodEnd(billingPeriod: BillingPeriod, from = new Date()): Date {
  const end = new Date(from);
  end.setMonth(end.getMonth() + TERMS[billingPeriod].months);
  return end;
}
