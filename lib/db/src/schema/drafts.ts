import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Something the model wrote, and the record of what it was given to write it.
 *
 * Two kinds of output live in one table because they share every field that
 * matters — the matter, the sources, the cost, the audit trail — and differ
 * only in what was asked for:
 *
 *   draft   a document: a petition, an application, a notice, a letter.
 *   brief   an assessment of the matter and, where one is given, of a draft:
 *           the facts on the record, the chronology, the merits, how the other
 *           side will run it, the objections to anticipate, the defects to cure
 *           before filing, and the authorities to consider.
 *
 * ── Nothing here is a filing ────────────────────────────────────────────
 *
 * A draft is a starting point an advocate edits and signs. The platform will
 * not file it, will not serve it, and will not put it in front of a client. The
 * same discipline as cause-list proposals, which never reach the calendar until
 * a person accepts them: the machine proposes, a person decides, and the person
 * is the one on the record.
 */
export const DRAFT_KINDS = [
  "petition",
  "written_statement",
  "appeal",
  "application",
  "reply",
  "notice",
  "letter",
  // Not "review": the earlier name described one section of what this now
  // produces. A brief covers the matter and a draft together, which is what an
  // advocate actually opens a file to get.
  "brief",
] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export function isDraftKind(value: unknown): value is DraftKind {
  return typeof value === "string" && (DRAFT_KINDS as readonly string[]).includes(value);
}

/** Kinds that get the reasoning-heavy model. See `lib/ai/models.ts`. */
export const HEAVY_KINDS: readonly DraftKind[] = [
  "petition",
  "written_statement",
  "appeal",
  "brief",
] as const;

export const DRAFT_STATUSES = ["generating", "ready", "failed", "kept"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const draftsTable = pgTable(
  "drafts",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull(),
    /** The matter this was written for. Always set — nothing is drafted in the abstract. */
    caseId: integer("case_id").notNull(),

    kind: text("kind").notNull().default("petition"),
    title: text("title").notNull().default(""),
    /** What the advocate asked for, in their words. Kept so a draft can be explained. */
    instruction: text("instruction").notNull().default(""),
    /** The generated text. Markdown. */
    body: text("body").notNull().default(""),

    /**
     * `generating` while the stream is open.
     *
     * A row is written BEFORE the model is called, not after, so a request that
     * dies mid-stream leaves a visible failed draft rather than nothing at all —
     * the tokens were spent either way and the chamber is entitled to see where
     * they went.
     */
    status: text("status").notNull().default("generating"),
    error: text("error"),

    /** Which model actually served it, as reported by the API. */
    model: text("model").notNull().default(""),

    /**
     * The draft this one revises.
     *
     * Revisions chain rather than overwrite. An advocate who takes a draft in
     * the wrong direction can go back, and "what did the second pass change"
     * is answerable.
     */
    parentDraftId: integer("parent_draft_id"),

    createdByClerkId: text("created_by_clerk_id").notNull().default(""),
    createdByName: text("created_by_name").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("drafts_workspace_case_idx").on(t.workspaceId, t.caseId)],
);

export const insertDraftSchema = createInsertSchema(draftsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDraft = z.infer<typeof insertDraftSchema>;
export type Draft = typeof draftsTable.$inferSelect;

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Exactly what was sent to the model for one draft.
 *
 * Not decoration and not debugging. This platform sends privileged client
 * material to a third party, and the whole basis on which that is defensible is
 * that the advocate chose each item. A choice with no record of what was chosen
 * is not a control — so when a client asks "what of mine did you send", this
 * table is the answer, and it is why the answer can be given at all.
 *
 * Written in the same transaction as the draft row, before the API call.
 */
export const DRAFT_SOURCE_KINDS = ["document", "insight", "exemplar", "matter"] as const;
export type DraftSourceKind = (typeof DRAFT_SOURCE_KINDS)[number];

export const draftSourcesTable = pgTable(
  "draft_sources",
  {
    id: serial("id").primaryKey(),
    draftId: integer("draft_id").notNull(),
    /** Denormalised so a source row can be checked without joining the draft. */
    workspaceId: integer("workspace_id").notNull(),

    kind: text("kind").notNull(),
    /** The document, insight or exemplar id. Null for `matter`, which is the case itself. */
    sourceId: integer("source_id"),
    /** What it was, in words, so the record survives the row being deleted. */
    label: text("label").notNull().default(""),
    /** How much of the prompt this source accounted for. */
    tokens: integer("tokens").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("draft_sources_draft_idx").on(t.draftId)],
);

export const insertDraftSourceSchema = createInsertSchema(draftSourcesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDraftSource = z.infer<typeof insertDraftSourceSchema>;
export type DraftSource = typeof draftSourcesTable.$inferSelect;
