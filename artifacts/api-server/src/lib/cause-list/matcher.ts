import { and, eq, isNotNull } from "drizzle-orm";
import { db, casesTable, causeListEntriesTable, causeListMatchesTable } from "@workspace/db";

/**
 * Turning a public listing into "your matter is listed tomorrow".
 *
 * This is the tenant crossing-point of the whole feature. Everything above it
 * is one global public document; everything below it is scoped to a chamber.
 * The scoping is structural rather than a filter that could be forgotten: a
 * proposal's workspace is read from the MATTER it matched
 * (`cases.workspaceId`), so a chamber can only ever be told about a listing
 * that hit a matter it already holds. There is no query here that a caller
 * could widen.
 *
 * Matching is exact and nothing else, deliberately. Four fields have to
 * agree — court, normalised case type, number, year — and any of them
 * missing on the matter means no match at all. The alternative (fuzzy party
 * names, a number that matches with a different type) produces proposals
 * that are wrong often enough to train an advocate to click "accept"
 * without reading, which is worse than proposing nothing: the value of this
 * feature is entirely in whether the person still trusts it on the day it
 * matters.
 */

/**
 * Propose every matter that matches the given court's listings for a date.
 *
 * Returns the number of NEW proposals. Re-running is a no-op: the unique key
 * on (workspace, entry, case) means an already-proposed pair is skipped,
 * which is what stops a court republishing its list six times a day from
 * re-offering something the advocate already dismissed.
 */
export async function proposeMatches(courtId: number, listDate: string): Promise<number> {
  const entries = await db
    .select()
    .from(causeListEntriesTable)
    .where(
      and(eq(causeListEntriesTable.courtId, courtId), eq(causeListEntriesTable.listDate, listDate)),
    );
  if (entries.length === 0) return 0;

  let created = 0;

  for (const entry of entries) {
    // A listing the parser could not pin to a type, number and year cannot be
    // matched to anything. It is still stored — `rawText` may be the only
    // record that the court listed something — but it proposes nothing.
    if (!entry.caseTypeNorm || entry.caseNumber === null || entry.caseYear === null) continue;

    // Across every workspace at once: this runs from the scheduler, which has
    // no tenant. The workspace of each proposal comes from the matter below,
    // never from a caller.
    const matters = await db
      .select()
      .from(casesTable)
      .where(
        and(
          eq(casesTable.courtId, courtId),
          eq(casesTable.caseTypeNorm, entry.caseTypeNorm),
          eq(casesTable.caseNumber, entry.caseNumber),
          eq(casesTable.caseYear, entry.caseYear),
          // Belt and braces with the courtId check above: a matter that opted
          // out by leaving the court unset must never be reachable here.
          isNotNull(casesTable.courtId),
        ),
      );

    for (const matter of matters) {
      const inserted = await db
        .insert(causeListMatchesTable)
        .values({
          workspaceId: matter.workspaceId,
          causeListEntryId: entry.id,
          caseId: matter.id,
          status: "pending",
          confidence: "exact",
        })
        // Already proposed — accepted, dismissed, or still pending. Any of
        // those means the chamber has seen it, and re-offering it would be
        // the feature nagging rather than informing.
        .onConflictDoNothing({
          target: [
            causeListMatchesTable.workspaceId,
            causeListMatchesTable.causeListEntryId,
            causeListMatchesTable.caseId,
          ],
        })
        .returning();

      if (inserted.length > 0) created += 1;
    }
  }

  return created;
}
