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
/**
 * Every kind that has ever been stored, which is not the same as every kind
 * that may still be asked for. See `OFFERED_DRAFT_KINDS`.
 *
 * Retiring a kind must never make the rows already carrying it unreadable, so
 * nothing is removed from this list. `drafts.kind` is text with no constraint;
 * the enum in the OpenAPI schema is what would reject a stored value, and a
 * chamber's own past work disappearing because a menu was shortened is not a
 * trade worth making.
 */
export const DRAFT_KINDS = [
  // ── Retired: readable, never creatable ────────────────────────────────
  // Long pleadings. A model writing an entire writ petition produces
  // something an advocate must rewrite line by line to be able to sign, which
  // is slower than drafting it — and it is the output most likely to be filed
  // with less reading than it needed. The short, structured documents below
  // are where the time actually goes.
  "petition",
  "written_statement",
  "appeal",
  "reply",
  "notice",
  "letter",

  // ── Offered ───────────────────────────────────────────────────────────
  "application",
  // Not "review": the earlier name described one section of what this now
  // produces. A brief covers the matter and a draft together, which is what an
  // advocate actually opens a file to get.
  "brief",
  /**
   * A written analysis of something already in the file: a judgment, a
   * contract, an application, an opponent's pleading.
   *
   * Distinct from a brief, which assesses THE MATTER and how to run it. An
   * analysis takes a document and reports what is in it — the obligations, the
   * holding, the defects, the dates that bite — and asserts nothing about
   * strategy it has not been given the file for.
   */
  "analysis",
] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export function isDraftKind(value: unknown): value is DraftKind {
  return typeof value === "string" && (DRAFT_KINDS as readonly string[]).includes(value);
}

/**
 * The kinds that may still be requested.
 *
 * The same shape as `OFFERED_PLANS`: the full set stays valid for reading, and
 * this is the subset the product sells today. Narrowing here rather than by
 * deleting from `DRAFT_KINDS` is what keeps a two-year-old petition draft
 * loading in a chamber's history.
 */
export const OFFERED_DRAFT_KINDS: readonly DraftKind[] = ["application", "brief", "analysis"];

export function isOfferedDraftKind(value: unknown): value is DraftKind {
  return isDraftKind(value) && OFFERED_DRAFT_KINDS.includes(value);
}

/** Kinds that get the reasoning-heavy model. See `lib/ai/models.ts`. */
export const HEAVY_KINDS: readonly DraftKind[] = [
  "petition",
  "written_statement",
  "appeal",
  "brief",
  // Reading a contract or a judgment closely is the reasoning-heavy half of
  // this feature, not the writing. An analysis on the light model summarises;
  // on the heavy one it notices the clause that contradicts the recital.
  "analysis",
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
