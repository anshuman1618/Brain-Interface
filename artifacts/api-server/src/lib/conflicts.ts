import { and, eq, ne } from "drizzle-orm";
import { db, casesTable, usersTable, workspaceMembershipsTable } from "@workspace/db";

/**
 * Conflict-of-interest screening.
 *
 * Before a chamber opens a file against someone, it needs to know whether that
 * someone is already a client, or already appears on the other side of another
 * matter. Missing this is a professional-conduct problem, not a UX one, which
 * is why the check runs server-side on creation rather than as a UI hint.
 *
 * What it deliberately is NOT: a decision. Names are ambiguous, and only the
 * advocate can judge whether "R. Mehra" is the same R. Mehra. The API surfaces
 * matches, refuses to proceed until they are acknowledged, and records the
 * acknowledgement with the reason given. The judgement stays with the person
 * qualified to make it; the record of it is what the chamber can later show.
 */

export type ConflictHit = {
  kind: "existing_client" | "opposing_party" | "matter_title";
  detail: string;
  caseId?: number;
};

/**
 * Fold to a comparable form: case, punctuation and honorifics vary constantly
 * in how parties are written down, and an exact-match check would find nothing.
 */
export function normaliseParty(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\b(m\/s|mr|mrs|ms|dr|shri|smt|sri|late)\.?\s+/g, "")
    .replace(/\b(pvt|private|ltd|limited|llp|inc|co|company|and|&|sons)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Significant word overlap in either direction, ignoring initials. */
function looksLikeSameParty(a: string, b: string): boolean {
  const na = normaliseParty(a);
  const nb = normaliseParty(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const wa = new Set(na.split(" ").filter((w) => w.length > 2));
  const wb = new Set(nb.split(" ").filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared >= Math.min(wa.size, wb.size);
}

/**
 * Screen a proposed opposing party against everyone this workspace already
 * acts for, and against every other matter's parties.
 */
export async function screenForConflicts(
  workspaceId: number,
  opposingParty: string,
  opts: { excludeCaseId?: number } = {},
): Promise<ConflictHit[]> {
  const party = opposingParty.trim();
  if (party.length < 2) return [];

  const hits: ConflictHit[] = [];

  // 1. Is the other side already a client of this chamber?
  const clients = await db
    .select({ name: usersTable.displayName, email: usersTable.email })
    .from(workspaceMembershipsTable)
    .innerJoin(usersTable, eq(usersTable.id, workspaceMembershipsTable.userId))
    .where(
      and(
        eq(workspaceMembershipsTable.workspaceId, workspaceId),
        eq(workspaceMembershipsTable.status, "active"),
      ),
    );

  for (const c of clients) {
    if (c.name && looksLikeSameParty(party, c.name)) {
      hits.push({
        kind: "existing_client",
        detail: `${c.name}${c.email ? ` (${c.email})` : ""} is already in this chamber`,
      });
    }
  }

  // 2. Do they already appear on another matter, on either side?
  const matters = await db
    .select({ id: casesTable.id, title: casesTable.title, opposing: casesTable.opposingParty })
    .from(casesTable)
    .where(
      opts.excludeCaseId
        ? and(eq(casesTable.workspaceId, workspaceId), ne(casesTable.id, opts.excludeCaseId))
        : eq(casesTable.workspaceId, workspaceId),
    );

  for (const m of matters) {
    if (m.opposing && looksLikeSameParty(party, m.opposing)) {
      hits.push({
        kind: "opposing_party",
        detail: `Already the opposing party on "${m.title}"`,
        caseId: m.id,
      });
    } else if (looksLikeSameParty(party, m.title)) {
      hits.push({
        kind: "matter_title",
        detail: `Named in the existing matter "${m.title}"`,
        caseId: m.id,
      });
    }
  }

  // One line per distinct concern; the same detail twice helps nobody.
  const seen = new Set<string>();
  return hits.filter((h) => (seen.has(h.detail) ? false : (seen.add(h.detail), true)));
}
