import { and, eq } from "drizzle-orm";
import {
  db,
  casesTable,
  courtsTable,
  calendarEntriesTable,
  causeListEntriesTable,
  causeListMatchesTable,
  courtLabel,
  type CauseListMatch,
} from "@workspace/db";

/**
 * Accepting or dismissing a proposed listing.
 *
 * Accepting is the ONLY thing in this feature that writes to the calendar.
 * The scheduler proposes; a person decides. That split is the whole safety
 * argument: a parser that misreads a court number produces a proposal
 * somebody looks at, not a hearing date an advocate plans their week around.
 *
 * Both paths are scoped to the caller's workspace on the WHERE clause, so a
 * proposal id from another chamber matches nothing rather than being decided.
 */

export type DecideResult =
  { ok: true; match: CauseListMatch } | { ok: false; reason: "not_found" | "already_decided" };

/** The proposal, only if it belongs to this workspace and is still open. */
async function loadPending(
  workspaceId: number,
  matchId: number,
): Promise<CauseListMatch | "not_found" | "already_decided"> {
  const [row] = await db
    .select()
    .from(causeListMatchesTable)
    .where(
      and(
        eq(causeListMatchesTable.id, matchId),
        eq(causeListMatchesTable.workspaceId, workspaceId),
      ),
    );
  if (!row) return "not_found";
  // Deciding twice is a double-click or a stale screen, not an error worth a
  // 500 — but it must not create a second calendar entry.
  if (row.status !== "pending") return "already_decided";
  return row;
}

/**
 * Accept: create the calendar entry this listing describes, and record which
 * entry it was.
 *
 * The entry is marked `source: "court_sync"` and carries the id of the
 * scraped row, so the calendar can say where the date came from and somebody
 * can later read the raw listing it was taken from. It is written as a
 * `hearing` addressed to `staff` — the same audience a hand-entered listing
 * gets, and the reason clients (who hold no `calendar.read`) never see it.
 */
export async function acceptMatch(
  workspaceId: number,
  matchId: number,
  decidedBy: string,
): Promise<DecideResult> {
  const loaded = await loadPending(workspaceId, matchId);
  if (typeof loaded === "string") return { ok: false, reason: loaded };

  const [entry] = await db
    .select()
    .from(causeListEntriesTable)
    .where(eq(causeListEntriesTable.id, loaded.causeListEntryId));
  const [matter] = await db.select().from(casesTable).where(eq(casesTable.id, loaded.caseId));
  if (!entry || !matter) return { ok: false, reason: "not_found" };

  const [court] = await db.select().from(courtsTable).where(eq(courtsTable.id, entry.courtId));

  // Everything a person needs to act on, in the one line the calendar shows.
  const caseRef =
    entry.caseNumber !== null && entry.caseYear !== null
      ? `${entry.caseType} ${entry.caseNumber}/${entry.caseYear}`
      : entry.caseType;
  const title = `${caseRef} — ${matter.title}`.slice(0, 300);

  const notes = [
    court ? courtLabel(court) : null,
    entry.courtNo ? `Court No. ${entry.courtNo}` : null,
    entry.itemNo ? `Item ${entry.itemNo}` : null,
    entry.purpose || null,
    entry.coram || null,
    // The raw row travels onto the calendar entry too. When an advocate is
    // deciding whether to trust this date at 9pm the night before, the thing
    // that settles it is what the list actually said.
    entry.rawText ? `\nFrom the cause list:\n${entry.rawText}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const [created] = await db
    .insert(calendarEntriesTable)
    .values({
      workspaceId,
      title,
      notes,
      kind: "hearing",
      entryDate: entry.listDate,
      caseId: matter.id,
      audience: "staff",
      source: "court_sync",
      causeListEntryId: entry.id,
      createdBy: decidedBy,
      createdByRole: "",
      createdByClerkId: "",
    })
    .returning();

  const [updated] = await db
    .update(causeListMatchesTable)
    .set({
      status: "accepted",
      calendarEntryId: created.id,
      decidedBy,
      decidedAt: new Date(),
    })
    .where(eq(causeListMatchesTable.id, matchId))
    .returning();

  return { ok: true, match: updated };
}

/**
 * Dismiss: this listing is not our matter, or is not worth a calendar entry.
 *
 * Recorded rather than deleted, and the unique key on (workspace, entry,
 * case) means the next sync cannot propose it again. A court republishing its
 * list six times a day must not re-ask a question that has been answered.
 */
export async function dismissMatch(
  workspaceId: number,
  matchId: number,
  decidedBy: string,
): Promise<DecideResult> {
  const loaded = await loadPending(workspaceId, matchId);
  if (typeof loaded === "string") return { ok: false, reason: loaded };

  const [updated] = await db
    .update(causeListMatchesTable)
    .set({ status: "dismissed", decidedBy, decidedAt: new Date() })
    .where(eq(causeListMatchesTable.id, matchId))
    .returning();

  return { ok: true, match: updated };
}
