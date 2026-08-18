import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const casesTable = pgTable("cases", {
  id: serial("id").primaryKey(),
  /** Tenant boundary. Every read of this table is filtered by the caller's verified workspace. */
  workspaceId: integer("workspace_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"), // open | in_progress | review | closed
  clientId: integer("client_id"),
  /** Who the matter is against. Free text because the other side is rarely a
   *  user of this system — and it is what the conflict check searches. */
  opposingParty: text("opposing_party"),
  /** Set when an advocate was shown a possible conflict and opened the matter
   *  anyway. The reason they gave is the record of that decision. */
  conflictAcknowledgedBy: text("conflict_acknowledged_by"),
  conflictNote: text("conflict_note"),
  /**
   * The court/registry reference for the matter. Required: a matter that
   * cannot be tied back to a filing is not findable in the place that counts,
   * and the field was optional for long enough that nobody filled it in.
   *
   * No default. A default would let an insert that forgot the reference
   * succeed with a placeholder, which is the failure this constraint exists to
   * prevent.
   */
  filingRef: text("filing_ref").notNull(),
  /**
   * Structured court identity — the four fields a cause list actually keys on.
   *
   * `filingRef` above is free text and stays that way: it is whatever the
   * chamber writes on the file, and chambers write it a dozen ways
   * ("W.P.(C) 1234/2026", "WP 1234 of 26", "CV-2026-118"). That is fine for a
   * human reading a folder and useless for matching, because a court's list
   * identifies a matter as a TYPE, a NUMBER and a YEAR at a named court, and
   * nothing else. Parsing those back out of `filingRef` after the fact is
   * guesswork; asking for them once, at filing, is not.
   *
   * All nullable. Every matter that existed before this feature has none, a
   * matter not before a court (an advisory, an unfiled brief) never will, and
   * neither is broken — they simply never match a listing. `courtId` null is
   * the switch that opts a matter out entirely.
   */
  courtId: integer("court_id"),
  /** As entered, for display: "W.P.(C)". */
  caseType: text("case_type"),
  /** Written by `normaliseCaseType` — this is the column matching compares. */
  caseTypeNorm: text("case_type_norm"),
  caseNumber: integer("case_number"),
  caseYear: integer("case_year"),
  priority: text("priority").notNull().default("medium"), // low | medium | high | urgent
  /**
   * When the matter was closed. Null while it is open.
   *
   * Cycle time needs an end point, and the only record of one was a
   * `status_changed` timeline row with the new status inside a free-text
   * sentence. Parsing prose to compute a median is a metric that breaks the day
   * somebody rewords the message. Set by the update route whenever status
   * becomes "closed", and cleared if a closed matter is reopened.
   */
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCaseSchema = createInsertSchema(casesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCase = z.infer<typeof insertCaseSchema>;
export type Case = typeof casesTable.$inferSelect;
