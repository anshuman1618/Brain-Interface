/**
 * The four fields that let a court's own list find a matter, and the one rule
 * that governs them.
 *
 * Kept apart from the component that renders them so both the create form and
 * the matter screen can validate without importing a form, and so the rule
 * lives in exactly one place on this side of the wire — the other being
 * `courtIdentity()` in `routes/cases.ts`, which is the one that actually binds.
 */

export interface CourtIdentity {
  courtId?: number;
  caseType?: string;
  caseNumber?: number;
  caseYear?: number;
}

/** Empty is valid — the matter simply opts out of cause-list matching. */
export function courtIdentityProblem(v: CourtIdentity): string | null {
  const filled = [v.courtId, v.caseType?.trim() || undefined, v.caseNumber, v.caseYear].filter(
    (f) => f !== undefined && f !== null && f !== "",
  ).length;
  if (filled === 0) return null;
  if (filled < 4) return "Give all four, or leave them all blank.";
  if (!v.caseNumber || v.caseNumber < 1) return "The case number must be a positive number.";
  // Mirrors `courtIdentity()` in routes/cases.ts, next year included: a registry
  // numbering into January while it is still December is not a typo.
  const maxYear = new Date().getFullYear() + 1;
  const year = v.caseYear ?? 0;
  if (year < 1900 || year > maxYear) return `The filing year must be between 1900 and ${maxYear}.`;
  return null;
}

/** Strips the group to `undefined` when it is blank, so a partial never ships. */
export function courtIdentityPayload(v: CourtIdentity): CourtIdentity {
  if (courtIdentityProblem(v) !== null || !v.courtId) return {};
  return {
    courtId: v.courtId,
    caseType: v.caseType?.trim(),
    caseNumber: v.caseNumber,
    caseYear: v.caseYear,
  };
}

/**
 * The same thing for a patch, where blank has to mean *clear it* rather than
 * *leave it alone*. Sending `{}` from a form the user has just emptied would
 * silently keep the matter matching, which is the opposite of what they did.
 */
export function courtIdentityPatch(v: CourtIdentity): Omit<CourtIdentity, "courtId"> & {
  courtId?: number | null;
} {
  if (courtIdentityProblem(v) !== null) return {};
  if (!v.courtId) return { courtId: null };
  return courtIdentityPayload(v);
}
