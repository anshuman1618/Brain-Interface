import { pgTable, text, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * One subscription per workspace.
 *
 * What is stored here is the *chosen* plan and the period it runs to — not a
 * payment. No card is captured anywhere in this repo, so a row in this table
 * means "this chamber selected this plan", which is exactly what the billing
 * screen shows. Wiring a payment provider means writing to `status` from that
 * provider's webhook, and nothing else in the app has to change.
 *
 * Prices are deliberately NOT columns. They live in the server-side catalogue
 * (artifacts/api-server/src/lib/plans.ts) and are recomputed on every write, so
 * a client that posts its own amount cannot buy a year for a rupee.
 */

/**
 * trial   a two-month evaluation pack, bought once
 * pro     metered monthly, three terms
 * firm    metered monthly, three terms
 * custom  quote-only; selecting it records an enquiry, never an active plan
 */
export const SUBSCRIPTION_PLANS = ["trial", "pro", "firm", "custom"] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

/** `one_time` is what the trial pack and a custom enquiry are normalised to. */
export const BILLING_PERIODS = ["one_time", "monthly", "half_yearly", "yearly"] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

/**
 * trialing      — a new chamber, before any plan is chosen
 * pending_payment — a plan selected, payment required but not yet received
 * active        — a plan is selected and the period has not lapsed
 * past_due      — the period lapsed (a payment provider would set this)
 * cancelled     — deliberately ended; access falls back to trial limits
 */
export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "pending_payment",
  "active",
  "past_due",
  "cancelled",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const subscriptionsTable = pgTable(
  "subscriptions",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull(),
    plan: text("plan").notNull().default("trial"),
    billingPeriod: text("billing_period").notNull().default("one_time"),
    status: text("status").notNull().default("trialing"),
    /** Months charged for in the current period. */
    paidMonths: integer("paid_months").notNull().default(1),
    /** Months granted on top — 2 on the annual plan. */
    freeMonths: integer("free_months").notNull().default(0),
    /** Minor units (paise), so no float ever touches a price. */
    amountMinor: integer("amount_minor").notNull().default(0),
    currency: text("currency").notNull().default("INR"),
    /**
     * Null until the plan is actually in force. A custom-plan enquiry is
     * recorded as a row with no start and no period end, because nothing has
     * started — it is a request for a quote, not a subscription.
     */
    startedAt: timestamp("started_at", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    /**
     * When this chamber took the two-month trial pack. Null means never.
     *
     * The pack is bought ONCE — it exists to evaluate the product, not to run a
     * practice on. Without this stamp nothing stops a chamber re-selecting it
     * the moment it expires, indefinitely, which would make every paid plan
     * optional. Deliberately separate from `startedAt`, which is overwritten by
     * the next plan the chamber chooses and so cannot answer "have they already
     * had their trial?".
     */
    trialUsedAt: timestamp("trial_used_at", { withTimezone: true }),
    /** The provider's order and payment ids, for reconciliation and refunds. */
    providerOrderId: text("provider_order_id"),
    providerPaymentId: text("provider_payment_id"),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("subscriptions_workspace_key").on(t.workspaceId)],
);

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;

export function isSubscriptionPlan(v: unknown): v is SubscriptionPlan {
  return typeof v === "string" && (SUBSCRIPTION_PLANS as readonly string[]).includes(v);
}
export function isBillingPeriod(v: unknown): v is BillingPeriod {
  return typeof v === "string" && (BILLING_PERIODS as readonly string[]).includes(v);
}
