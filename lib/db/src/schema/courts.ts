import { pgTable, text, serial, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * The courts this deployment knows how to read a cause list from.
 *
 * GLOBAL, not workspace-scoped — deliberately, and it is the only kind of
 * table here that is. A court is a fact about the world, not about a chamber:
 * the Lucknow Bench publishes one cause list, and every chamber appearing
 * there is looking at the same document. Scraping it per-tenant would mean N
 * chambers making N requests to one government server for one identical file,
 * which is both rude and the fastest way to get an IP blocked. Fetch once,
 * store once, match per workspace — see `cause_list_matches`, which IS
 * workspace-scoped.
 *
 * `bench` is separate from `name` because several High Courts sit at more
 * than one seat and publish a separate list per seat. The Allahabad High
 * Court is one court with a principal seat at Prayagraj and a bench at
 * Lucknow; a matter's case number belongs to one of them, not to "the court".
 * Modelling it as a field rather than as two court rows means the second seat
 * is a row, not a second adapter.
 */
export const courtsTable = pgTable(
  "courts",
  {
    id: serial("id").primaryKey(),
    /** Stable slug used in URLs and to name the adapter, e.g. "allahabad-hc-lucknow". */
    code: text("code").notNull(),
    /** The court's formal name, as it appears at the head of its own cause list. */
    name: text("name").notNull(),
    /** The seat, where the court sits at more than one. Empty for a single-seat court. */
    bench: text("bench").notNull().default(""),
    /** State or UT, for grouping in a picker. */
    jurisdiction: text("jurisdiction").notNull().default(""),
    /**
     * Which adapter reads this court, from the registry in
     * `lib/cause-list/registry.ts`. A court row whose adapter is not
     * registered is inert rather than broken: it can be selected on a matter
     * for record-keeping, and simply never syncs.
     */
    adapter: text("adapter").notNull().default(""),
    /** The court's own site. The adapter owns the deep path to the list itself. */
    website: text("website").notNull().default(""),
    /** False parks a court without deleting it — matters keep pointing at it. */
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("courts_code_key").on(t.code)],
);

export const insertCourtSchema = createInsertSchema(courtsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCourt = z.infer<typeof insertCourtSchema>;
export type Court = typeof courtsTable.$inferSelect;

/** How a court is named in one line, for a picker or a calendar entry. */
export function courtLabel(court: Pick<Court, "name" | "bench">): string {
  return court.bench ? `${court.name} (${court.bench})` : court.name;
}

/**
 * Canonical form of a case type, for matching.
 *
 * The same case type is written a dozen ways by hand and by registries:
 * "W.P.(C)", "WP(C)", "W P (C)", "wp c". Matching on the typed form would
 * miss almost everything, so both sides — the matter and the scraped row —
 * store a normalised copy written by THIS function, and matching compares
 * those. Same reasoning as `normaliseEmail` on the access list: normalise on
 * write, compare as equality, keep the original for display.
 *
 * Deliberately aggressive: everything that is not a letter or a digit goes,
 * and the result is uppercased. "W.P.(C)" and "WP(C)" both become "WPC".
 */
export function normaliseCaseType(caseType: string): string {
  return caseType.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}
