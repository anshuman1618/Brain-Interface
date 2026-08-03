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

export const SUBSCRIPTION_PLANS = ["starter", "pro", "firm"] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const BILLING_PERIODS = ["monthly", "half_yearly", "yearly"] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

/**
 * trialing  — a new chamber, before any plan is chosen
 * active    — a plan is selected and the period has not lapsed
 * past_due  — the period lapsed (a payment provider would set this)
 * cancelled — deliberately ended; access falls back to trial limits
 */
export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const subscriptionsTable = pgTable(
  "subscriptions",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull(),
    plan: text("plan").notNull().default("starter"),
    billingPeriod: text("billing_period").notNull().default("monthly"),
    status: text("status").notNull().default("trialing"),
    /** Months charged for in the current period. */
    paidMonths: integer("paid_months").notNull().default(1),
    /** Months granted on top — 2 on the annual plan. */
    freeMonths: integer("free_months").notNull().default(0),
    /** Minor units (paise), so no float ever touches a price. */
    amountMinor: integer("amount_minor").notNull().default(0),
    currency: text("currency").notNull().default("INR"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
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
