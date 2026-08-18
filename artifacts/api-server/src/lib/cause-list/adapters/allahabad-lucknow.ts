import type { CourtAdapter, CauseListRow, FetchCauseListInput } from "../types";

/**
 * High Court of Judicature at Allahabad, Lucknow Bench — NOT YET IMPLEMENTED.
 *
 * This file is deliberately a stub rather than a guess. It was written in an
 * environment whose egress policy blocks `allahabadhighcourt.in`, so the
 * page this adapter has to read has never been fetched here. Writing
 * selectors against HTML nobody has looked at produces code that compiles,
 * passes review, and silently returns zero rows forever — which is the exact
 * failure `cause_list_sync_runs` exists to catch, and not one worth shipping
 * on purpose.
 *
 * It is EXPORTED but deliberately NOT in the registry (`registry.ts`).
 * A court row pointing at an unregistered adapter records `skipped` on every
 * sync — visible on the sync-health screen, no error noise, and no pretence
 * that anything was tried. Enabling it later is one line in the registry.
 *
 * ── What implementing it needs, in order ────────────────────────────────
 *
 * 1. Read the site's `robots.txt` and terms of use first, and honour them.
 *    A cause list is a public record published so that advocates know when
 *    to appear — this is the intended audience, not a loophole — but that
 *    is an argument for reading it politely, not for ignoring what the site
 *    asks. If the list sits behind a CAPTCHA, STOP: build assisted import
 *    for this court instead. Defeating an access control is where "public
 *    data" stops being the description of what you are doing.
 *
 * 2. Find the list. Establish, by looking: is it HTML or a PDF? One file per
 *    bench, or per court number? What does the URL look like for a given
 *    date, and what does it do for a date the court did not sit?
 *
 * 3. Pick `sourceKey`. It has to be stable across the several times a day a
 *    court republishes its list. The case number is usually right; a row
 *    index is usually wrong (see `types.ts`).
 *
 * 4. Parse conservatively. Return a row with `rawText` and whatever fields
 *    parsed, rather than dropping a row because the coram was formatted
 *    unusually. A row that matches on type/number/year is useful even if
 *    every other field failed; a dropped row is a missed listing.
 *
 * 5. Throw on failure — never return `[]`. An empty list is a real answer
 *    (holidays, vacations), so a swallowed parse error would be
 *    indistinguishable from a court that was closed.
 *
 * 6. Rate-limit and identify. One request per list per sync, a real
 *    User-Agent naming the product and a contact address, and a cache so a
 *    re-run inside the same day does not re-fetch. Fetching is done ONCE
 *    per court globally, not per chamber — see the note on `courts`.
 *
 * ── What is known ───────────────────────────────────────────────────────
 *
 * The court is one court with two seats: the principal seat at Prayagraj and
 * this bench at Lucknow, each publishing its own list. That is why `courts`
 * models `bench` as a field — the principal seat is another row and another
 * adapter id, not a fork of this file.
 */
export const allahabadLucknowAdapter: CourtAdapter = {
  id: "allahabad-hc-lucknow",
  label: "Allahabad High Court, Lucknow Bench",

  async fetchCauseList(_input: FetchCauseListInput): Promise<CauseListRow[]> {
    // Throwing, not returning [], for the reason in the header: an empty
    // result is a legitimate answer and must not be how "unimplemented"
    // reports itself.
    throw new Error(
      "The Allahabad High Court (Lucknow Bench) adapter is not implemented yet. " +
        "It needs to be written against the live site — see the checklist in " +
        "lib/cause-list/adapters/allahabad-lucknow.ts.",
    );
  },
};
