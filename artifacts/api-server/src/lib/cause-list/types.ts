/**
 * What every court adapter has to produce, and nothing more.
 *
 * The whole point of this shape is that a court adapter is the ONLY part of
 * the feature that knows what a particular court's website looks like.
 * Everything downstream — storing, matching, proposing, the calendar — works
 * on `CauseListRow` and has no idea whether it came from HTML, a PDF, a JSON
 * endpoint, or a fixture. That is what keeps "add the Bombay High Court" to
 * one new file rather than a change that reaches across the codebase.
 *
 * An adapter does NOT touch the database. It is given a date and returns
 * rows, which makes it testable on its own and makes the fixture adapter a
 * genuine substitute for a real one rather than a mock of it.
 */

/**
 * One listing, normalised.
 *
 * Almost everything is optional-ish (empty string / null) because cause list
 * formats vary enormously and a parser that demanded every field would throw
 * away rows it could mostly read. The exception is `sourceKey`: without it a
 * re-fetch cannot tell an updated row from a new one.
 */
export type CauseListRow = {
  /**
   * Stable identity of this row WITHIN one court's list for one date.
   *
   * Courts republish a list several times a day as items are added, moved
   * between benches, or struck off. Re-running the sync must update those
   * rows in place, not accumulate a fresh copy of the whole list every few
   * hours — so the adapter has to name each row in a way that survives a
   * re-fetch. The case number is usually the honest choice; a bare row index
   * is not, because inserting an item at the top would renumber everything
   * below it and orphan every proposal already made.
   */
  sourceKey: string;

  /** As printed: "W.P.(C)", "CRL.M.C.", "F.A.F.O.". */
  caseType: string;
  caseNumber: number | null;
  caseYear: number | null;

  /** As printed. Formats vary wildly; this is display and evidence, not a key. */
  parties: string;
  courtNo: string;
  itemNo: string;
  coram: string;
  purpose: string;

  /**
   * The row as it was read, before parsing. Kept for every row.
   *
   * This is what someone reads when the parsed fields and an advocate's
   * memory disagree about whether a matter was listed — and it is the only
   * way to debug a parser after the court has replaced that day's list with
   * the next one, which most of them do.
   */
  rawText: string;
};

export type FetchCauseListInput = {
  /** The day the list is wanted for, YYYY-MM-DD. */
  listDate: string;
  /** Lets a slow court be abandoned without hanging the whole sync. */
  signal?: AbortSignal;
};

export type CourtAdapter = {
  /** Matches `courts.adapter`. Also the key in the registry. */
  id: string;
  /** Human-readable, for logs and the sync-health screen. */
  label: string;
  /**
   * Read one day's list.
   *
   * Returns rows, or THROWS. There is no "return empty on error" path,
   * because an empty list is a real and common answer — courts do not sit
   * every day, and a holiday list is legitimately zero rows — so a parser
   * that swallowed its own failure would be indistinguishable from a court
   * that was closed. `sync.ts` catches, records the error against the run,
   * and moves on to the next court.
   */
  fetchCauseList(input: FetchCauseListInput): Promise<CauseListRow[]>;
};
