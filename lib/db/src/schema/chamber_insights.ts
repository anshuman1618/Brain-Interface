import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * What an advocate learned, written down while it is still fresh.
 *
 * The thing this platform holds that nothing else does. Every other table
 * records what *happened* — a matter opened, a hearing listed, an hour logged.
 * This records what somebody **concluded**: that a particular bench will not
 * hear a Section 34 application before the objections are numbered, that the
 * registry at Lucknow returns anything without a properly stamped vakalatnama,
 * that opposing counsel in insurance matters always presses limitation first.
 *
 * None of that is in any judgment, any statute or any training corpus. It is
 * the difference between a competent draft and one written by somebody who has
 * appeared before that court, and it is why AI drafting here can be better than
 * a general model with the same facts pasted in.
 *
 * WORKSPACE-SCOPED, and that is a deliberate product decision rather than an
 * accident of the schema. An insight written in one chamber is retrieved only
 * for that chamber's drafts. Pooling them across the platform would be worth
 * more to everybody and is irreversible once done, so it is not done here —
 * `sharedAt` exists so consent can be added later without moving a single row
 * between tenants.
 */
export const chamberInsightsTable = pgTable(
  "chamber_insights",
  {
    id: serial("id").primaryKey(),
    /** Tenant boundary. Every read is filtered by the caller's verified workspace. */
    workspaceId: integer("workspace_id").notNull(),

    /** A one-line summary. What the advocate would say if asked in a corridor. */
    title: text("title").notNull(),
    /** The observation itself, free text. Deliberately unstructured — a form
     *  with twelve fields is a form nobody fills in after a hearing. */
    body: text("body").notNull().default(""),
    /** Comma-separated, lowercased. Searched as text, not joined to anything. */
    tags: text("tags").notNull().default(""),

    /**
     * Optional narrowing, so retrieval can prefer an insight about THIS forum.
     *
     * Both nullable, and most insights will carry neither: "always take three
     * spare copies of the paper book" is true everywhere. When they are set,
     * ranking weights the insight up for a matter at the same court or of the
     * same type.
     */
    courtId: integer("court_id"),
    /** Written by `normaliseCaseType`, so it compares as plain equality. */
    caseTypeNorm: text("case_type_norm"),

    authorClerkId: text("author_clerk_id").notNull().default(""),
    authorName: text("author_name").notNull().default(""),
    authorRole: text("author_role").notNull().default(""),

    /**
     * When this insight was contributed to a shared, cross-chamber library.
     *
     * Always null today — there is no such library. It is here because the
     * decision NOT to pool insights is reversible only if the schema left room
     * for consent, and adding a nullable timestamp now is free while migrating
     * live rows across a tenant boundary later would not be.
     */
    sharedAt: timestamp("shared_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Retrieval always starts by narrowing to one chamber.
    index("chamber_insights_workspace_idx").on(t.workspaceId),
  ],
);

export const insertChamberInsightSchema = createInsertSchema(chamberInsightsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertChamberInsight = z.infer<typeof insertChamberInsightSchema>;
export type ChamberInsight = typeof chamberInsightsTable.$inferSelect;
