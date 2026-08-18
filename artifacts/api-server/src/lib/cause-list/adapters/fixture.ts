import type { CourtAdapter, CauseListRow, FetchCauseListInput } from "../types";

/**
 * A court that always answers, and always the same way.
 *
 * This is what CI and preview mode run on, and it is not a mock — it
 * implements the same interface a real adapter does, so everything downstream
 * (upsert, matching, proposal, accept, calendar) is exercised for real. The
 * only thing it does not exercise is HTML/PDF parsing, which is precisely the
 * part that differs per court and cannot be tested against a fixture anyway.
 *
 * Deterministic on purpose: the rows are derived from `listDate` alone, so a
 * suite can seed a matter that it KNOWS will match, and re-running the sync
 * produces byte-identical rows — which is what makes the idempotency test
 * meaningful rather than accidental.
 *
 * The years below are ordinary on purpose. An earlier version used 2099 to
 * make fixture data obviously fake, which the case route then correctly
 * refused as an implausible filing year — a matter filed in 2099 is a typo,
 * and that check is worth more than the readability trick. What actually
 * keeps this data out of production is the preview-only guard in
 * `registry.ts` and the matching one in `seed.ts`; "looks fake" was never the
 * control, and it is better not to imply that it was.
 */

/** Numbers a suite can rely on. Exported so tests assert against one source. */
export const FIXTURE_CASES = [
  { caseType: "W.P.(C)", caseNumber: 9001, caseYear: 2024, parties: "Fixture One vs State" },
  { caseType: "CRL.M.C.", caseNumber: 9002, caseYear: 2024, parties: "Fixture Two vs State" },
  { caseType: "F.A.F.O.", caseNumber: 9003, caseYear: 2024, parties: "Fixture Three vs Union" },
] as const;

export const fixtureAdapter: CourtAdapter = {
  id: "fixture",
  label: "Fixture court (test data)",

  async fetchCauseList({ listDate }: FetchCauseListInput): Promise<CauseListRow[]> {
    return FIXTURE_CASES.map((c, i) => ({
      // Stable across re-fetches of the same date, and unique within it —
      // exactly the property a real adapter has to find in its own source.
      sourceKey: `${c.caseType}/${c.caseNumber}/${c.caseYear}`,
      caseType: c.caseType,
      caseNumber: c.caseNumber,
      caseYear: c.caseYear,
      parties: c.parties,
      courtNo: String(i + 1),
      itemNo: String(i + 1),
      coram: "Hon'ble Fixture J.",
      purpose: i === 0 ? "For Admission" : "For Hearing",
      rawText: `${i + 1}. ${c.caseType} ${c.caseNumber}/${c.caseYear} — ${c.parties} [${listDate}]`,
    }));
  },
};

/**
 * A court that is reachable but broken.
 *
 * Registered alongside the working fixture so the failure path has something
 * to exercise: a `failed` sync run with an error recorded, no rows written,
 * and — the part that actually matters — the rest of the courts in the same
 * sync still processed. A scraper suite that only ever tests the happy path
 * is testing the half that was never going to be the problem.
 */
export const failingFixtureAdapter: CourtAdapter = {
  id: "fixture-failing",
  label: "Fixture court that always fails (test data)",
  async fetchCauseList(): Promise<CauseListRow[]> {
    throw new Error("Fixture failure: the court's page could not be parsed.");
  },
};
