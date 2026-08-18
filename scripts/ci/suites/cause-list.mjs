// Cause-list ingestion: fetch → store → propose → a person decides.
//
// Runs entirely on the fixture adapter, which implements the same interface a
// real court adapter does — so everything except HTML/PDF parsing is
// exercised for real: upsert idempotency, exact matching, tenant isolation of
// proposals, the accept path that creates a calendar entry, and the failure
// path that records a broken court without taking the others down.
import { declareBarRegistration } from "../lib/bar-registration.mjs";

const BASE = (process.env.API_BASE_URL ?? "http://localhost:5000") + "/api";
let pass = 0,
  fail = 0;
const check = (n, ok, d = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);
};
const section = (t) => console.log(`\n== ${t}`);
const as = (email, name = "", provider = "google") =>
  `preview:email:${provider}:${encodeURIComponent(email)}:${encodeURIComponent(name)}`;

async function call(path, { token, wsToken, method = "GET", body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (wsToken) headers["x-workspace-token"] = wsToken;
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

const suffix = Date.now();
const owner = `cl.owner+${suffix}@cl.test`;
const rival = `cl.rival+${suffix}@rival.test`;
const LIST_DATE = "2099-03-04";

section("Setup");
const founded = await call("/workspaces", {
  token: as(owner, "CL Owner"),
  method: "POST",
  body: { name: `Cause List Chambers ${suffix}`, role: "admin" },
});
const ws = founded.data.workspaceToken;
check("chamber founded", founded.status === 201, `got ${founded.status}`);
await declareBarRegistration(call, as(owner));

const courts = await call("/courts", { token: as(owner), wsToken: ws });
check("the courts registry is readable", courts.status === 200, `got ${courts.status}`);

const lucknow = courts.data.find((c) => c.code === "allahabad-hc-lucknow");
check(
  "the Lucknow Bench is seeded",
  Boolean(lucknow),
  JSON.stringify(courts.data?.map((c) => c.code)),
);
check(
  "...named as a bench of the Allahabad High Court, not as its own court",
  lucknow?.name === "High Court of Judicature at Allahabad" && lucknow?.bench === "Lucknow",
  `${lucknow?.name} / ${lucknow?.bench}`,
);
check(
  "...and reports itself as not syncable, because its adapter is unwritten",
  lucknow?.syncable === false,
  String(lucknow?.syncable),
);

const fixtureCourt = courts.data.find((c) => c.code === "fixture-court");
check("the fixture court is available in preview", Boolean(fixtureCourt));
check("...and IS syncable", fixtureCourt?.syncable === true);

/* ─────────────── Court identity on a matter ─────────────── */
section("A matter needs all four court fields, or none");

const partial = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: {
    title: "Partial identity",
    filingRef: `CV-P-${suffix}`,
    courtId: fixtureCourt.id,
    caseType: "W.P.(C)",
    // no number, no year
  },
});
check(
  "a partial court reference is refused (400)",
  partial.status === 400,
  `got ${partial.status}`,
);

const badYear = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: {
    title: "Bad year",
    filingRef: `CV-Y-${suffix}`,
    courtId: fixtureCourt.id,
    caseType: "W.P.(C)",
    caseNumber: 9001,
    caseYear: 1234,
  },
});
check(
  "an implausible filing year is refused (400)",
  badYear.status === 400,
  `got ${badYear.status}`,
);

const noCourt = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { title: "Unfiled advisory", filingRef: `CV-N-${suffix}` },
});
check(
  "a matter with no court at all is still fine — it just never matches",
  noCourt.status === 201,
  `got ${noCourt.status}`,
);

// The matter the fixture list will match. Note the deliberately DIFFERENT
// punctuation from the fixture's "W.P.(C)" — normalisation is what has to
// bridge them, and a test that used the identical string would prove nothing.
const matched = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: {
    title: "The matter that is listed",
    filingRef: `CV-M-${suffix}`,
    courtId: fixtureCourt.id,
    caseType: "WP(C)",
    caseNumber: 9001,
    caseYear: 2024,
  },
});
check("a fully-identified matter is accepted", matched.status === 201, `got ${matched.status}`);
check(
  "...and reports its court back for display",
  matched.data?.courtName === "Fixture Court",
  matched.data?.courtName,
);

/* ─────────────── The sync itself ─────────────── */
section("Syncing a court reads its list and proposes matches");

const noProposalsYet = await call("/cause-list/proposals", { token: as(owner), wsToken: ws });
check("no proposals before the first sync", noProposalsYet.data.length === 0);

const run1 = await call("/cause-list/sync", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { courtCode: "fixture-court", listDate: LIST_DATE },
});
check("the sync runs", run1.status === 200, `got ${run1.status} ${JSON.stringify(run1.data)}`);
check("...reporting ok", run1.data?.status === "ok", run1.data?.status);
check("...having fetched the fixture rows", run1.data?.fetched === 3, String(run1.data?.fetched));
check(
  "...and proposed exactly the one matter that matches",
  run1.data?.proposed === 1,
  String(run1.data?.proposed),
);

const proposals = await call("/cause-list/proposals", { token: as(owner), wsToken: ws });
check("the proposal is listed", proposals.data.length === 1, JSON.stringify(proposals.data));
const p = proposals.data[0];
check("...against the right matter", p?.caseId === matched.data.id);
check("...for the right date", p?.listDate === LIST_DATE, p?.listDate);
check("...carrying the court's own reference", p?.caseRef === "W.P.(C) 9001/2024", p?.caseRef);
check(
  "...and the raw listing as evidence",
  (p?.rawText ?? "").includes("Fixture One vs State"),
  p?.rawText,
);
check("...still pending, not accepted", p?.status === "pending", p?.status);

// The whole safety property of this feature.
const calBefore = await call("/calendar", { token: as(owner), wsToken: ws });
check(
  "NOTHING has reached the calendar — a proposal is not an entry",
  calBefore.data.length === 0,
  JSON.stringify(calBefore.data),
);

/* ─────────────── Idempotency ─────────────── */
section("Re-syncing updates in place and does not re-propose");

const run2 = await call("/cause-list/sync", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { courtCode: "fixture-court", listDate: LIST_DATE },
});
check("the second run also succeeds", run2.data?.status === "ok");
check("...fetching the same rows", run2.data?.fetched === 3, String(run2.data?.fetched));
check(
  "...but proposing nothing new — the chamber has already been told",
  run2.data?.proposed === 0,
  String(run2.data?.proposed),
);

const afterResync = await call("/cause-list/proposals", { token: as(owner), wsToken: ws });
check(
  "still exactly one proposal, not two",
  afterResync.data.length === 1,
  String(afterResync.data.length),
);

/* ─────────────── Tenant isolation ─────────────── */
section("A second chamber sees none of the first chamber's proposals");

const rivalWs = await call("/workspaces", {
  token: as(rival, "Rival"),
  method: "POST",
  body: { name: `Rival Chambers ${suffix}`, role: "admin" },
});
const rTok = rivalWs.data.workspaceToken;
await declareBarRegistration(call, as(rival));

const rivalProposals = await call("/cause-list/proposals", { token: as(rival), wsToken: rTok });
check(
  "the rival's proposal list is empty",
  rivalProposals.data.length === 0,
  JSON.stringify(rivalProposals.data),
);

const rivalSteal = await call(`/cause-list/proposals/${p.id}/decision`, {
  token: as(rival),
  wsToken: rTok,
  method: "POST",
  body: { decision: "accept" },
});
check(
  "...and deciding the first chamber's proposal is a 404, not a 403",
  rivalSteal.status === 404,
  `got ${rivalSteal.status}`,
);

// The same listing matched against the rival's OWN matter proposes normally —
// the global entry is shared, the proposals are not.
const rivalMatter = await call("/cases", {
  token: as(rival),
  wsToken: rTok,
  method: "POST",
  body: {
    title: "Rival's matter, same number",
    filingRef: `CV-R-${suffix}`,
    courtId: fixtureCourt.id,
    caseType: "W.P.(C)",
    caseNumber: 9001,
    caseYear: 2024,
  },
});
check("the rival files a matter with the same court reference", rivalMatter.status === 201);
const run3 = await call("/cause-list/sync", {
  token: as(rival),
  wsToken: rTok,
  method: "POST",
  body: { courtCode: "fixture-court", listDate: LIST_DATE },
});
check(
  "a re-sync now proposes it to the rival too, from the same shared listing",
  run3.data?.proposed === 1,
  String(run3.data?.proposed),
);
const rivalNow = await call("/cause-list/proposals", { token: as(rival), wsToken: rTok });
check("the rival sees exactly their own one", rivalNow.data.length === 1);
check(
  "...naming their matter, not the other chamber's",
  rivalNow.data[0]?.caseId === rivalMatter.data.id,
);

/* ─────────────── Accepting ─────────────── */
section("Accepting is what creates the calendar entry");

const accepted = await call(`/cause-list/proposals/${p.id}/decision`, {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { decision: "accept" },
});
check("accepting succeeds", accepted.status === 200, `got ${accepted.status}`);
check(
  "...marking the proposal accepted",
  accepted.data?.status === "accepted",
  accepted.data?.status,
);
check("...and naming the entry it created", typeof accepted.data?.calendarEntryId === "number");

const calAfter = await call("/calendar", { token: as(owner), wsToken: ws });
check(
  "the calendar now has exactly one entry",
  calAfter.data.length === 1,
  String(calAfter.data.length),
);
const entry = calAfter.data[0];
check("...on the listed date", entry?.entryDate === LIST_DATE, entry?.entryDate);
check("...as a hearing", entry?.kind === "hearing", entry?.kind);
check("...tied to the matter", entry?.caseId === matched.data.id);
check(
  "...titled with the court's reference and the matter",
  (entry?.title ?? "").includes("W.P.(C) 9001/2024"),
  entry?.title,
);
check(
  "...carrying the raw listing, so the date can be checked against what the court published",
  (entry?.notes ?? "").includes("Fixture One vs State"),
  entry?.notes,
);

const twice = await call(`/cause-list/proposals/${p.id}/decision`, {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { decision: "accept" },
});
check(
  "accepting the same proposal twice is refused (409)",
  twice.status === 409,
  `got ${twice.status}`,
);
const calStill = await call("/calendar", { token: as(owner), wsToken: ws });
check("...and did not create a second calendar entry", calStill.data.length === 1);

/* ─────────────── Dismissing ─────────────── */
section("Dismissing is remembered, so a re-sync cannot nag");

const dismissTarget = rivalNow.data[0];
const dismissed = await call(`/cause-list/proposals/${dismissTarget.id}/decision`, {
  token: as(rival),
  wsToken: rTok,
  method: "POST",
  body: { decision: "dismiss" },
});
check("dismissing succeeds", dismissed.status === 200, `got ${dismissed.status}`);
check("...recorded as dismissed", dismissed.data?.status === "dismissed");
check("...creating no calendar entry", dismissed.data?.calendarEntryId === null);

await call("/cause-list/sync", {
  token: as(rival),
  wsToken: rTok,
  method: "POST",
  body: { courtCode: "fixture-court", listDate: LIST_DATE },
});
const stillDismissed = await call("/cause-list/proposals", { token: as(rival), wsToken: rTok });
check(
  "a later sync does not re-propose what was dismissed",
  stillDismissed.data.length === 0,
  JSON.stringify(stillDismissed.data),
);
const dismissedList = await call("/cause-list/proposals?status=dismissed", {
  token: as(rival),
  wsToken: rTok,
});
check("...but it is still on the record", dismissedList.data.length === 1);

/* ─────────────── Failure is recorded, not swallowed ─────────────── */
section("A broken court is recorded and does not take the others down");

const broken = await call("/cause-list/sync", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { courtCode: "fixture-court-failing", listDate: LIST_DATE },
});
check(
  "the failing court reports failed, not ok",
  broken.data?.status === "failed",
  broken.data?.status,
);
check(
  "...with the reason",
  (broken.data?.error ?? "").includes("could not be parsed"),
  broken.data?.error,
);

const unwritten = await call("/cause-list/sync", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { courtCode: "allahabad-hc-lucknow", listDate: LIST_DATE },
});
check(
  "a court whose adapter is unwritten reports skipped, not failed",
  unwritten.data?.status === "skipped",
  unwritten.data?.status,
);

const runs = await call("/cause-list/runs", { token: as(owner), wsToken: ws });
check("sync health is readable by an admin", runs.status === 200, `got ${runs.status}`);
check(
  "...and shows all three outcomes",
  ["ok", "failed", "skipped"].every((s) => runs.data.some((r) => r.status === s)),
  JSON.stringify(runs.data.map((r) => r.status)),
);

const unknownCourt = await call("/cause-list/sync", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { courtCode: "no-such-court", listDate: LIST_DATE },
});
check("an unknown court code is a 404", unknownCourt.status === 404, `got ${unknownCourt.status}`);

console.log(`\n${fail === 0 ? "✓" : "✗"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
