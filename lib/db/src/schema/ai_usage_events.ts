import { pgTable, text, serial, integer, timestamp, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * What one AI call actually cost, in paise.
 *
 * The billing record, kept separate from `drafts` on purpose: a chamber may
 * delete a draft it does not like, and the tokens were still spent. Deriving
 * the month's usage from a table somebody can delete rows from would make the
 * budget optional, which is the one thing it must not be.
 *
 * The remaining budget is DERIVED by summing this table over the period, the
 * same way `quota.ts` derives open matters by counting `cases` rather than
 * keeping a counter column. A counter drifts; a sum cannot.
 *
 * ── Why the cost is stored and not recomputed ───────────────────────────
 *
 * `costMinor` is written at the time of the call, from the prices in force at
 * the time of the call. Model prices change. Recomputing an old month's spend
 * at today's prices would silently rewrite what a chamber was charged against
 * their budget — the same reasoning that makes invoice line amounts stored
 * rather than recomputed on read.
 *
 * Integer paise, rounded UP. A fractional paisa rounded down, a few thousand
 * times, is a budget that never quite empties.
 */
export const aiUsageEventsTable = pgTable(
  "ai_usage_events",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull(),
    /** Null when the call was not for a draft — an exemplar redaction, say. */
    draftId: integer("draft_id"),
    /** `draft` | `brief` | `anonymise`. What the spend was for, for the meter's breakdown. */
    purpose: text("purpose").notNull().default("draft"),

    model: text("model").notNull().default(""),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    /** Server-side web searches performed, billed per search on top of tokens. */
    webSearches: integer("web_searches").notNull().default(0),

    /** The whole cost of this call, in paise. What the budget is spent against. */
    costMinor: integer("cost_minor").notNull().default(0),

    /**
     * Idempotency key for the write.
     *
     * A stream that is retried, or a handler that runs twice, must not bill the
     * chamber twice for one call. Unique, and derived from the draft and the
     * attempt rather than from a timestamp.
     */
    dedupeKey: text("dedupe_key").notNull(),

    actorClerkId: text("actor_clerk_id").notNull().default(""),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The budget query: everything this chamber spent since the period began.
    index("ai_usage_events_workspace_at_idx").on(t.workspaceId, t.at),
    unique("ai_usage_events_dedupe_key").on(t.dedupeKey),
  ],
);

export const insertAiUsageEventSchema = createInsertSchema(aiUsageEventsTable).omit({
  id: true,
  at: true,
});
export type InsertAiUsageEvent = z.infer<typeof insertAiUsageEventSchema>;
export type AiUsageEvent = typeof aiUsageEventsTable.$inferSelect;

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Drafting budget bought on top of the plan allowance.
 *
 * Bought by an admin or a senior advocate when the month runs out, and — unlike
 * the plan allowance, which resets each period — **carried forward while the
 * subscription stays live**. That is a deliberate customer-friendly choice, and
 * it creates a real liability: unspent balance is drafting owed. It is visible
 * here rather than implied, which is the only way anyone will notice it.
 *
 * A row is written only when Razorpay confirms payment, from the webhook, never
 * from the browser saying it succeeded.
 */
export const aiTopupsTable = pgTable(
  "ai_topups",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull(),

    /** `small` | `medium` | `large`, from `TOPUP_PACKS` in plans.ts. */
    pack: text("pack").notNull(),
    /** What they paid, in paise. */
    priceMinor: integer("price_minor").notNull().default(0),
    /** What it granted, in paise of drafting. Equal to `priceMinor` today. */
    grantMinor: integer("grant_minor").notNull().default(0),

    /** Razorpay's ids, so a grant can be traced back to a payment. */
    orderId: text("order_id"),
    paymentId: text("payment_id"),

    /**
     * When this grant stops counting.
     *
     * Null means it lasts as long as the subscription does, which is the
     * current behaviour. A dated value is what an expiring pack would use, and
     * the balance query already honours it — so changing the policy later is a
     * value, not a migration.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    boughtByClerkId: text("bought_by_clerk_id").notNull().default(""),
    boughtByName: text("bought_by_name").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_topups_workspace_idx").on(t.workspaceId)],
);

export const insertAiTopupSchema = createInsertSchema(aiTopupsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAiTopup = z.infer<typeof insertAiTopupSchema>;
export type AiTopup = typeof aiTopupsTable.$inferSelect;
