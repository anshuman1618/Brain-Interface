import { eq } from "drizzle-orm";
import { db, membershipCasesTable } from "@workspace/db";

/**
 * The matters a pinned membership is narrowed to, or null for "not pinned".
 *
 * ── The fallback is the security-critical part ────────────────────────────
 *
 * Reads `membership_cases` first and falls back to the legacy
 * `workspace_memberships.case_id`. Every membership written before migration
 * 0018 has the column and no rows, so without the fallback every existing
 * pinned client would silently become unpinned on the first request after the
 * deploy — a client seeing the chamber's other matters, caused by a migration
 * that "changed nothing".
 *
 * Note what it does NOT do: an empty result never means "unrestricted". Null
 * is returned only when the membership carries no pin at all, in either place.
 * The two states are distinguishable here and must stay so — conflating an
 * empty set with the absence of a restriction is the one mistake in this
 * function that would open a tenant up.
 */
export async function restrictedCaseIdsFor(
  membershipId: number | null,
  legacyCaseId: number | null,
): Promise<number[] | null> {
  if (membershipId === null) return legacyCaseId == null ? null : [legacyCaseId];

  const rows = await db
    .select({ caseId: membershipCasesTable.caseId })
    .from(membershipCasesTable)
    .where(eq(membershipCasesTable.membershipId, membershipId));

  if (rows.length > 0) return rows.map((r) => r.caseId);
  return legacyCaseId == null ? null : [legacyCaseId];
}
