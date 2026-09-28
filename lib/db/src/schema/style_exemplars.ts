import { pgTable, text, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * A past filing kept as an example of how this chamber writes.
 *
 * Chambers do not have blank template petitions. They have twenty years of
 * good filings, and "draft it the way we draft" means "look at these three".
 * So an exemplar is either an existing matter document promoted to this role,
 * or a file uploaded for the purpose.
 *
 * ── Why the anonymised copy is a separate column ────────────────────────
 *
 * An exemplar rides in the **cached prefix of every draft of its kind**, which
 * means a petition written for one client becomes context for a draft written
 * for another. Inside one chamber that crosses no privilege boundary — the same
 * advocates already see both matters — but it puts one client's name and facts
 * into the prompt, the audit record and the model's context for unrelated work,
 * indefinitely, for no benefit: what is wanted from an exemplar is its
 * STRUCTURE and its VOICE, never its facts.
 *
 * So `sourceText` (as extracted) and `body` (as anonymised) are kept apart, and
 * only `body` is ever sent. `anonymisedAt` records that the pass ran and
 * `reviewedAt` that a person then read the result — because an automatic
 * redaction nobody checked is a redaction you cannot rely on, and the person
 * who knows whether "the Kanpur consignment" identifies the client is the
 * advocate, not the model.
 *
 * An exemplar is unusable until `reviewedAt` is set. That is enforced at the
 * point of assembly, not merely encouraged here.
 */
/**
 * Every kind an exemplar has ever been stored under. Read-only history for the
 * retired ones — see `OFFERED_EXEMPLAR_KINDS`.
 */
export const EXEMPLAR_KINDS = [
  "petition",
  "written_statement",
  "appeal",
  "application",
  "reply",
  "notice",
  "letter",
] as const;
export type ExemplarKind = (typeof EXEMPLAR_KINDS)[number];

/**
 * The kinds an exemplar may still be uploaded for.
 *
 * An exemplar rides in the cached prefix of every draft OF ITS KIND. Once the
 * long pleadings were retired from `OFFERED_DRAFT_KINDS`, an exemplar of a
 * petition became something a chamber could spend an afternoon curating and
 * have applied to nothing, ever. Offering it would be offering a feature that
 * does not work.
 *
 * Only `application`, because those are the only documents still drafted. A
 * brief and an analysis are assessments in the product's own voice, not
 * filings in the chamber's, and never took an exemplar.
 *
 * The rows already stored under the retired kinds stay readable, and the
 * chamber-knowledge screen still lists them — deleting a chamber's curated
 * work because a menu was shortened is not a trade worth making.
 */
export const OFFERED_EXEMPLAR_KINDS: readonly ExemplarKind[] = ["application"];

export function isOfferedExemplarKind(value: unknown): value is ExemplarKind {
  return typeof value === "string" && (OFFERED_EXEMPLAR_KINDS as readonly string[]).includes(value);
}

export function isExemplarKind(value: unknown): value is ExemplarKind {
  return typeof value === "string" && (EXEMPLAR_KINDS as readonly string[]).includes(value);
}

export const styleExemplarsTable = pgTable(
  "style_exemplars",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull(),

    /** What sort of document this is an example of. Exemplars are selected by kind. */
    kind: text("kind").notNull().default("petition"),
    /** The chamber's own label: "Sharma — writ, the good one". */
    title: text("title").notNull(),

    /**
     * The document this was promoted from, when it came from a matter.
     *
     * Null for a file uploaded directly as an exemplar. Kept so an advocate can
     * see where the example came from — and so deleting the matter document can
     * be made to prompt about the exemplar rather than silently orphan it.
     */
    sourceDocumentId: integer("source_document_id"),

    /** Text as extracted from the source, before redaction. Never sent to a model. */
    sourceText: text("source_text").notNull().default(""),
    /** The redacted text. This, and only this, is what reaches the prompt. */
    body: text("body").notNull().default(""),

    /** When the automatic redaction pass ran. Null means it has not. */
    anonymisedAt: timestamp("anonymised_at", { withTimezone: true }),
    /**
     * When a person read the redacted copy and accepted it.
     *
     * The gate. An exemplar with this unset is never assembled into a prompt,
     * however good the automatic pass looked.
     */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),

    /** False parks an exemplar without deleting it. */
    active: boolean("active").notNull().default(true),

    addedByClerkId: text("added_by_clerk_id").notNull().default(""),
    addedByName: text("added_by_name").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("style_exemplars_workspace_kind_idx").on(t.workspaceId, t.kind)],
);

export const insertStyleExemplarSchema = createInsertSchema(styleExemplarsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertStyleExemplar = z.infer<typeof insertStyleExemplarSchema>;
export type StyleExemplar = typeof styleExemplarsTable.$inferSelect;
