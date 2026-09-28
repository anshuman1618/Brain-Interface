// Persistence, documents, feedback and the tightened client scope.
import { declareBarRegistration } from "../lib/bar-registration.mjs";
import { grantPreviewPlan } from "../lib/preview-plan.mjs";

const BASE = (process.env.API_BASE_URL ?? "http://localhost:5000") + "/api";
let pass = 0,
  fail = 0;
const check = (n, ok, d = "") => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${n}`);
  } else {
    fail++;
    console.log(`  FAIL  ${n} ${d}`);
  }
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
const plus = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

import { tmpdir } from "node:os";
import { join } from "node:path";
// Handoff between the setup and verify phases, which run either side of a restart.
const seedFile = join(process.env.RUNNER_TEMP ?? tmpdir(), "lex-modules-state.json");
const fs = await import("node:fs");
const phase = process.argv[2] || "setup";

if (phase === "setup") {
  section("Setup — build a chamber with real content");
  const founder = "arch.founder@chambers.test";
  const created = await call("/workspaces", {
    token: as(founder, "A Founder"),
    method: "POST",
    body: { name: `Arch Chambers ${Date.now()}`, role: "admin" },
  });
  check("chamber created", created.status === 201, `got ${created.status}`);
  const wsTok = created.data.workspaceToken;
  await declareBarRegistration(call, as(founder));
  await grantPreviewPlan(call, as(founder), wsTok);

  await call("/invites", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { email: "arch.clerk@chambers.test", role: "clerk_intern" },
  });
  const clerk = (await call("/session", { token: as("arch.clerk@chambers.test", "A Clerk") })).data;

  // A user row exists from the first authenticated call regardless of whether
  // they are admitted anywhere — so the client's id is available before the
  // matter naming them as its client, and before the invite carrying the
  // restriction to that matter, both exist.
  const clientPre = (await call("/session", { token: as("arch.client@x.test", "A Client") })).data;

  const matter = await call("/cases", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { title: "Persistent matter", filingRef: "CV-2026-020", clientId: clientPre.userId },
  });

  // A client invite must be restricted to a matter — see DECISIONS.md.
  const clientInvite = await call("/invites", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { email: "arch.client@x.test", role: "client", caseId: matter.data.id },
  });
  check(
    "client invited, restricted to the matter",
    clientInvite.status === 201,
    `got ${clientInvite.status}`,
  );
  const client = (await call("/session", { token: as("arch.client@x.test", "A Client") })).data;
  const entry = await call("/calendar", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { title: "Persisted hearing", kind: "hearing", entryDate: plus(3), audience: "all" },
  });
  check("matter + calendar entry created", matter.status === 201 && entry.status === 201);

  fs.writeFileSync(
    seedFile,
    JSON.stringify({
      founder,
      wsTok,
      caseId: matter.data.id,
      entryId: entry.data.id,
      clientTok: client.workspaceToken,
      clientUserId: client.userId,
      clerkTok: clerk.workspaceToken,
    }),
  );

  section("Client RBAC — calendar stripped, feedback added");
  check(
    "client has NO calendar.read",
    !client.capabilities.includes("calendar.read"),
    JSON.stringify(client.capabilities),
  );
  check("client HAS feedback.write", client.capabilities.includes("feedback.write"));
  check("client HAS documents.write", client.capabilities.includes("documents.write"));
  const clientCal = await call("/calendar", {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
  });
  check(
    "client blocked from the calendar API (403)",
    clientCal.status === 403,
    `got ${clientCal.status}`,
  );
  check("clerk still has calendar.read", clerk.capabilities.includes("calendar.read"));

  section("Interactive calendar — drag = PATCH");
  const moved = await call(`/calendar/${entry.data.id}`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { entryDate: plus(9), entryTime: "14:30" },
  });
  check(
    "entry can be moved",
    moved.status === 200 && moved.data.entryDate === plus(9),
    JSON.stringify(moved.data?.entryDate),
  );
  const clerkMove = await call(`/calendar/${entry.data.id}`, {
    token: as("arch.clerk@chambers.test"),
    wsToken: clerk.workspaceToken,
    method: "PATCH",
    body: { entryDate: plus(1) },
  });
  check("clerk cannot move entries (403)", clerkMove.status === 403, `got ${clerkMove.status}`);

  section("Bi-directional documents");
  const firmDoc = await call(`/cases/${matter.data.id}/documents`, {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { name: "Internal draft.pdf", visibility: "firm", url: "s3://internal" },
  });
  const sharedDoc = await call(`/cases/${matter.data.id}/documents`, {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { name: "Filed petition.pdf", visibility: "shared", url: "s3://shared" },
  });
  check("firm can upload internal + shared", firmDoc.status === 201 && sharedDoc.status === 201);
  check(
    "visibility recorded",
    firmDoc.data.visibility === "firm" && sharedDoc.data.visibility === "shared",
  );
  check(
    "uploader recorded",
    firmDoc.data.uploadedBy === "A Founder" && firmDoc.data.uploadedByRole === "admin",
    JSON.stringify([firmDoc.data.uploadedBy, firmDoc.data.uploadedByRole]),
  );

  const clientDocs = await call("/documents", {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
  });
  const names = clientDocs.data.map((d) => d.name);
  check("client sees the shared file", names.includes("Filed petition.pdf"), JSON.stringify(names));
  check(
    "client does NOT see firm-internal material",
    !names.includes("Internal draft.pdf"),
    JSON.stringify(names),
  );

  // A clerk only reaches matters they hold a task on, so give them one first.
  const noTaskYet = await call(`/cases/${matter.data.id}/documents`, {
    token: as("arch.clerk@chambers.test"),
    wsToken: clerk.workspaceToken,
    method: "POST",
    body: { name: "Too early.pdf" },
  });
  check(
    "clerk cannot upload to an unassigned matter (404)",
    noTaskYet.status === 404,
    `got ${noTaskYet.status}`,
  );
  await call("/tasks", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: {
      caseId: matter.data.id,
      title: "Prepare filing",
      assigneeId: clerk.clerkId,
      deadline: plus(4),
    },
  });
  const clerkUpload = await call(`/cases/${matter.data.id}/documents`, {
    token: as("arch.clerk@chambers.test"),
    wsToken: clerk.workspaceToken,
    method: "POST",
    body: { name: "Clerk filing copy.pdf" },
  });
  check(
    "clerk can upload once assigned to the matter",
    clerkUpload.status === 201,
    `got ${clerkUpload.status}`,
  );

  const req = await call("/document-requests", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: {
      clientId: client.userId,
      documentName: "Notarised affidavit",
      caseId: matter.data.id,
      dueDate: plus(5),
    },
  });
  check("firm raises a document request", req.status === 201, `got ${req.status}`);

  const fulfil = await call(`/cases/${matter.data.id}/documents`, {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
    method: "POST",
    body: { name: "affidavit-signed.pdf", documentRequestId: req.data.id, visibility: "firm" },
  });
  check("client uploads against the request", fulfil.status === 201, `got ${fulfil.status}`);
  check(
    "client upload is forced to 'shared'",
    fulfil.data.visibility === "shared",
    fulfil.data?.visibility,
  );
  check("upload is linked to the request", fulfil.data.documentRequestId === req.data.id);

  const after = await call("/document-requests", { token: as(founder), wsToken: wsTok });
  const closed = after.data.find((r) => r.id === req.data.id);
  check("request auto-marked fulfilled", closed.status === "fulfilled", closed?.status);
  check("...and links the fulfilling document", closed.fulfilledDocumentId === fulfil.data.id);

  /*
   * Both halves on the matter's ledger.
   *
   * The audit log already carried `document_request.created`, but that is the
   * chamber-wide accountability record. The question asked of a FILE is
   * different — "what was asked for on this matter, and did it arrive" — and
   * it needs the pair: the ask and the closure. One without the other reads as
   * a request nobody ever answered.
   */
  const reqLedger = await call(`/cases/${matter.data.id}/timeline`, {
    token: as(founder),
    wsToken: wsTok,
  });
  check(
    "raising a request is recorded on the matter",
    (reqLedger.data ?? []).some(
      (e) => e.eventType === "document_requested" && /Notarised affidavit/.test(e.description),
    ),
    JSON.stringify((reqLedger.data ?? []).map((e) => e.eventType)),
  );
  check(
    "...and so is the upload that closed it",
    (reqLedger.data ?? []).some(
      (e) =>
        e.eventType === "document_request_fulfilled" && /Notarised affidavit/.test(e.description),
    ),
    JSON.stringify((reqLedger.data ?? []).map((e) => e.eventType)),
  );

  // A request with no matter belongs to no ledger. Worth pinning: the write is
  // behind `if (created.caseId)` and a regression there would be silent.
  const looseReq = await call("/document-requests", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { clientId: client.userId, documentName: "General ID proof" },
  });
  const afterLoose = await call(`/cases/${matter.data.id}/timeline`, {
    token: as(founder),
    wsToken: wsTok,
  });
  check(
    "a request naming no matter lands on no ledger",
    looseReq.status === 201 &&
      !(afterLoose.data ?? []).some((e) => /General ID proof/.test(e.description)),
    `${looseReq.status}`,
  );

  /* ── Stages of a matter ─────────────────────────────────────────────────
     The headings the vault files under. Four things are worth proving and
     none of them is the happy path on its own:

      - the forum group is INFERRED from the case type, so matters that
        predate the feature get sensible headings without a backfill;
      - a stored group overrides the inference, so a wrong guess is
        correctable;
      - a chamber addition is workspace-and-forum wide, not per matter —
        the whole point of a controlled vocabulary;
      - free text is refused everywhere it could be smuggled in. A stage
        nothing else can ever be filed under is a heading of one. */
  section("Stages of a matter");

  const generalStages = await call(`/cases/${matter.data.id}/stages`, {
    token: as(founder),
    wsToken: wsTok,
  });
  check(
    "a matter with no case type falls to the general list",
    generalStages.status === 200 && generalStages.data.forumGroup === "general",
    `got ${generalStages.status} ${generalStages.data?.forumGroup}`,
  );
  check(
    "...and says so — the group was inferred, not set",
    generalStages.data.forumGroupInferred === true,
  );

  // The court identity goes in as a set of four or not at all — see
  // courtIdentity() — and `caseType` is the field the inference reads, so the
  // other three come along whether this test cares about them or not.
  const courts = await call("/courts", { token: as(founder), wsToken: wsTok });
  const anyCourt = courts.data?.[0];
  check("a court exists to file against", !!anyCourt, `got ${courts.status}`);
  const writMatter = await call("/cases", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: {
      title: "Writ matter",
      filingRef: "WP-2026-100",
      courtId: anyCourt?.id,
      caseType: "W.P.(C)",
      caseNumber: 100,
      caseYear: 2026,
    },
  });
  check("writ matter opened", writMatter.status === 201, JSON.stringify(writMatter.data));
  const writStages = await call(`/cases/${writMatter.data.id}/stages`, {
    token: as(founder),
    wsToken: wsTok,
  });
  check(
    'case type "W.P.(C)" is read as the writ list',
    writStages.data?.forumGroup === "writ",
    JSON.stringify(writStages.data?.forumGroup),
  );
  const writKeys = (writStages.data?.options ?? []).map((o) => o.key);
  check(
    "the writ list is the pleadings in order",
    ["petition", "counter_affidavit", "rejoinder_affidavit", "supplementary_affidavit"].every(
      (k, i) => writKeys[i] === k,
    ),
    JSON.stringify(writKeys),
  );
  check("...and ends with an order and a judgment", writKeys.includes("judgment"));

  // The override. A registry that writes "CC" for a consumer complaint would
  // otherwise get the criminal list forever.
  const overridden = await call(`/cases/${writMatter.data.id}`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { forumGroup: "criminal" },
  });
  const afterOverride = await call(`/cases/${writMatter.data.id}/stages`, {
    token: as(founder),
    wsToken: wsTok,
  });
  check(
    "a stored forum group beats the case type",
    overridden.status === 200 && afterOverride.data.forumGroup === "criminal",
    `${overridden.status} ${afterOverride.data?.forumGroup}`,
  );
  check(
    "...and is no longer reported as inferred",
    afterOverride.data.forumGroupInferred === false,
  );
  await call(`/cases/${writMatter.data.id}`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { forumGroup: "writ" },
  });

  const stagedUpload = await call(`/cases/${writMatter.data.id}/documents`, {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { name: "Counter affidavit.pdf", stage: "counter_affidavit" },
  });
  check(
    "a document files under a stage at upload",
    stagedUpload.status === 201 && stagedUpload.data.stage === "counter_affidavit",
    `${stagedUpload.status} ${stagedUpload.data?.stage}`,
  );

  const bogusUpload = await call(`/cases/${writMatter.data.id}/documents`, {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { name: "Invented.pdf", stage: "not_a_real_stage" },
  });
  check(
    "a stage off the list is refused, not stored",
    bogusUpload.status === 400 && bogusUpload.data?.error === "unknown_stage",
    `${bogusUpload.status} ${JSON.stringify(bogusUpload.data)}`,
  );

  const unstagedUpload = await call(`/cases/${writMatter.data.id}/documents`, {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { name: "No stage yet.pdf" },
  });
  check(
    "omitting the stage is allowed — the paper is unfiled, not rejected",
    unstagedUpload.status === 201 && unstagedUpload.data.stage === null,
    `${unstagedUpload.status} ${unstagedUpload.data?.stage}`,
  );

  // Chamber-defined. Added on one matter, expected on the next of the same kind.
  const added = await call(`/cases/${writMatter.data.id}/stages`, {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { label: "Caveat Petition" },
  });
  check("a chamber adds a stage of its own", added.status === 201, `got ${added.status}`);
  const caveat = (added.data?.options ?? []).find((o) => o.key === "caveat_petition");
  check(
    "...keyed from the label and marked as the chamber's",
    caveat?.label === "Caveat Petition" && caveat?.source === "chamber",
    JSON.stringify(caveat),
  );

  const againstDup = await call(`/cases/${writMatter.data.id}/stages`, {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { label: "caveat  petition" },
  });
  const caveats = (againstDup.data?.options ?? []).filter((o) => o.key === "caveat_petition");
  check(
    "adding it again is not an error and does not duplicate it",
    againstDup.status === 201 && caveats.length === 1,
    `${againstDup.status} ${caveats.length}`,
  );

  const siblingWrit = await call("/cases", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: {
      title: "Second writ",
      filingRef: "WP-2026-101",
      courtId: anyCourt?.id,
      caseType: "W.P.(C)",
      caseNumber: 101,
      caseYear: 2026,
    },
  });
  const siblingStages = await call(`/cases/${siblingWrit.data.id}/stages`, {
    token: as(founder),
    wsToken: wsTok,
  });
  check(
    "the addition is offered on the next matter of the same kind",
    (siblingStages.data?.options ?? []).some((o) => o.key === "caveat_petition"),
    JSON.stringify((siblingStages.data?.options ?? []).map((o) => o.key)),
  );
  // Re-fetched, not the copy taken before the addition: a stale response would
  // pass this whether the scoping works or not.
  const otherGroupNow = await call(`/cases/${matter.data.id}/stages`, {
    token: as(founder),
    wsToken: wsTok,
  });
  check(
    "...and NOT on a matter in a different forum group",
    !(otherGroupNow.data?.options ?? []).some((o) => o.key === "caveat_petition"),
    JSON.stringify((otherGroupNow.data?.options ?? []).map((o) => o.key)),
  );

  const clientAdds = await call(`/cases/${matter.data.id}/stages`, {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
    method: "POST",
    body: { label: "My own heading" },
  });
  check(
    "a client cannot invent a stage (403)",
    clientAdds.status === 403,
    `got ${clientAdds.status}`,
  );
  const clientReads = await call(`/cases/${matter.data.id}/stages`, {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
  });
  check(
    "...but can read the headings on their own matter",
    clientReads.status === 200 && Array.isArray(clientReads.data.options),
    `got ${clientReads.status}`,
  );

  /*
   * The matter's ledger, which is not the audit log.
   *
   * `PATCH /cases/:id` wrote a timeline row for `status` and silently none for
   * `stage` — so the one field a chamber defines its own vocabulary for was
   * the one whose changes left no trace on the matter. The audit log did not
   * cover it either: `document.restaged` is a DOCUMENT moving between stages.
   */
  /*
   * Statuses, which became a chamber vocabulary like stages.
   *
   * The interesting assertions are the negative ones. Dropping the OpenAPI
   * enum means the generated validator no longer rejects an unknown status, so
   * the server's own check against the chamber's list is the ONLY thing left
   * between a typo and a matter filed under a status no chip will ever show.
   */
  /*
   * Proceedings: the sub-branches of a matter.
   *
   * Two things are worth proving beyond the happy path. A proceeding has no
   * visibility of its own — it inherits the matter's — so the assertions that
   * matter are the ones showing a caller who cannot see the matter cannot see
   * or reach its proceedings either. And every change has to land on the
   * matter's ledger, because a proceeding nobody can trace is a note in the
   * title by another name.
   */
  section("6c. Proceedings under a matter");
  const openedProc = await call(`/cases/${matter.data.id}/proceedings`, {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: {
      title: "Application for interim stay",
      kind: "application",
      filingRef: "IA 45/2026",
      filedOn: plus(0),
    },
  });
  check(
    "a proceeding is opened under a matter",
    openedProc.status === 201,
    `got ${openedProc.status}`,
  );
  check(
    "...carrying the chamber's default status, resolved for display",
    openedProc.data?.status === "open" && openedProc.data?.statusLabel === "Open",
    JSON.stringify([openedProc.data?.status, openedProc.data?.statusLabel]),
  );

  const procLedger = await call(`/cases/${matter.data.id}/timeline`, {
    token: as(founder),
    wsToken: wsTok,
  });
  check(
    "opening it is on the matter's ledger",
    (procLedger.data ?? []).some(
      (e) => e.eventType === "proceeding_opened" && /interim stay/.test(e.description),
    ),
    JSON.stringify((procLedger.data ?? []).map((e) => e.eventType)),
  );

  const badKind = await call(`/cases/${matter.data.id}/proceedings`, {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { title: "Nonsense", kind: "not_a_kind" },
  });
  check("an unknown kind is refused", badKind.status === 400, `got ${badKind.status}`);

  const badProcStatus = await call(`/cases/${matter.data.id}/proceedings`, {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { title: "Nonsense", status: "invented_status" },
  });
  check(
    "a status off the chamber's list is refused on a proceeding too",
    badProcStatus.status === 400 && badProcStatus.data?.error === "unknown_status",
    `${badProcStatus.status} ${JSON.stringify(badProcStatus.data)}`,
  );

  // One save touching several fields is one ledger row naming all of them, not
  // one row per field and not a bare "updated".
  const editedProc = await call(`/cases/${matter.data.id}/proceedings/${openedProc.data.id}`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { title: "Application for interim stay (amended)", filingRef: "IA 46/2026" },
  });
  check("a proceeding can be edited", editedProc.status === 200, `got ${editedProc.status}`);
  const afterEdit = await call(`/cases/${matter.data.id}/timeline`, {
    token: as(founder),
    wsToken: wsTok,
  });
  const editRows = (afterEdit.data ?? []).filter((e) => e.eventType === "proceeding_updated");
  check(
    "one ledger row names everything that moved",
    editRows.length === 1 &&
      /renamed/.test(editRows[0].description) &&
      /IA 46/.test(editRows[0].description),
    JSON.stringify(editRows.map((e) => e.description)),
  );

  const noopProc = await call(`/cases/${matter.data.id}/proceedings/${openedProc.data.id}`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { title: "Application for interim stay (amended)" },
  });
  const afterNoopProc = await call(`/cases/${matter.data.id}/timeline`, {
    token: as(founder),
    wsToken: wsTok,
  });
  check(
    "a save that changes nothing records nothing",
    noopProc.status === 200 &&
      (afterNoopProc.data ?? []).filter((e) => e.eventType === "proceeding_updated").length === 1,
    `${(afterNoopProc.data ?? []).filter((e) => e.eventType === "proceeding_updated").length}`,
  );

  // A decision date is an ending, and reads as one in a filtered ledger.
  await call(`/cases/${matter.data.id}/proceedings/${openedProc.data.id}`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { decidedOn: plus(1) },
  });
  const afterDecide = await call(`/cases/${matter.data.id}/timeline`, {
    token: as(founder),
    wsToken: wsTok,
  });
  check(
    "deciding it is its own kind of ledger row, not another update",
    (afterDecide.data ?? []).some((e) => e.eventType === "proceeding_closed"),
    JSON.stringify((afterDecide.data ?? []).map((e) => e.eventType)),
  );

  // Visibility is inherited, so the client's own matter is the one to test on.
  const clientProcs = await call(`/cases/${matter.data.id}/proceedings`, {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
  });
  check(
    "a client reads the proceedings on their own matter",
    clientProcs.status === 200 && Array.isArray(clientProcs.data),
    `got ${clientProcs.status}`,
  );
  const clientOpens = await call(`/cases/${matter.data.id}/proceedings`, {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
    method: "POST",
    body: { title: "One I invented" },
  });
  check("...but cannot open one (403)", clientOpens.status === 403, `got ${clientOpens.status}`);

  // The isolation assertion: a proceeding id is never a way into a matter.
  const wrongMatter = await call(`/cases/${writMatter.data.id}/proceedings/${openedProc.data.id}`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { title: "Moved" },
  });
  check(
    "a proceeding cannot be reached through a matter it does not belong to",
    wrongMatter.status === 404,
    `got ${wrongMatter.status}`,
  );

  const goneProc = await call(`/cases/${matter.data.id}/proceedings/${openedProc.data.id}`, {
    token: as(founder),
    wsToken: wsTok,
    method: "DELETE",
  });
  check("a proceeding can be removed", goneProc.status === 204, `got ${goneProc.status}`);
  const afterDelete = await call(`/cases/${matter.data.id}/timeline`, {
    token: as(founder),
    wsToken: wsTok,
  });
  check(
    "...and the ledger keeps the record that it existed",
    (afterDelete.data ?? []).some(
      (e) => e.eventType === "proceeding_deleted" && /interim stay/.test(e.description),
    ),
    JSON.stringify((afterDelete.data ?? []).map((e) => e.eventType)),
  );

  /*
   * A client asking for a consultation.
   *
   * The assertions that matter are the boundaries: a client may ask, may not
   * schedule, and may not ask about a matter that is not theirs. A request
   * with a time on it would be a client booking an advocate's diary, so the
   * preferred time must land in the notes and `scheduledAt` must stay null
   * until the chamber confirms.
   */
  section("6d. A client requests a consultation");
  const clientAsk = await call("/consultation-requests", {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
    method: "POST",
    body: {
      caseId: matter.data.id,
      title: "The notice received on 12 March",
      notes: "I do not understand what it asks for.",
      preferredAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
  check("a client can ask for one", clientAsk.status === 201, `got ${clientAsk.status}`);
  check(
    "...and it arrives unscheduled, awaiting the chamber",
    clientAsk.data?.status === "requested" && clientAsk.data?.scheduledAt == null,
    JSON.stringify([clientAsk.data?.status, clientAsk.data?.scheduledAt]),
  );
  check(
    "...with the preferred time recorded as a preference, not as the appointment",
    /would prefer/i.test(clientAsk.data?.notes ?? ""),
    clientAsk.data?.notes,
  );
  check(
    "...and consent not assumed on the client's behalf",
    clientAsk.data?.consentGiven === false,
    `${clientAsk.data?.consentGiven}`,
  );

  // The boundary that makes this safe to expose: a client still cannot create
  // a real consultation, which is what would let them set a time.
  const clientSchedules = await call("/consultations", {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
    method: "POST",
    body: {
      caseId: matter.data.id,
      title: "One I scheduled myself",
      consentGiven: true,
      category: "legal_solution",
      scheduledAt: new Date().toISOString(),
    },
  });
  check(
    "a client still cannot schedule one (403)",
    clientSchedules.status === 403,
    `got ${clientSchedules.status}`,
  );

  // And cannot ask about somebody else's matter. `writMatter` belongs to the
  // chamber and the client is pinned to `matter`.
  const clientAsksElsewhere = await call("/consultation-requests", {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
    method: "POST",
    body: { caseId: writMatter.data.id, title: "A matter that is not mine" },
  });
  check(
    "...nor ask about a matter that is not theirs (404)",
    clientAsksElsewhere.status === 404,
    `got ${clientAsksElsewhere.status}`,
  );

  // The chamber turns it into an appointment.
  const when = new Date(Date.now() + 172_800_000).toISOString();
  const confirmed = await call(`/consultations/${clientAsk.data.id}`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { status: "scheduled", scheduledAt: when },
  });
  check(
    "the chamber confirms it with a time",
    confirmed.status === 200 &&
      confirmed.data?.status === "scheduled" &&
      confirmed.data?.scheduledAt != null,
    JSON.stringify([confirmed.status, confirmed.data?.status, confirmed.data?.scheduledAt]),
  );

  /*
   * Who hears about it, which is the part that was wrong first.
   *
   * The notification fan-out originally selected every ACTIVE MEMBERSHIP —
   * which includes other clients — so one client's request would have pushed
   * their matter's title to every other client in the chamber. Every
   * membership in a workspace is not a colleague.
   */
  // A SECOND client, and the reason there is one: the requesting client was
  // always excluded by the `clerkId !== me` filter, so checking their own
  // inbox would have passed whether or not the bug existed. It takes a
  // bystander to prove a fan-out does not reach them.
  const otherClientPre = (await call("/session", { token: as("arch.client2@x.test", "B Client") }))
    .data;
  const otherMatter = await call("/cases", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: {
      title: "The other client's matter",
      filingRef: "CV-2026-021",
      clientId: otherClientPre.userId,
    },
  });
  await call("/invites", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: {
      email: "arch.client2@x.test",
      role: "client",
      caseIds: [otherMatter.data.id],
    },
  });
  const otherClient = (await call("/session", { token: as("arch.client2@x.test", "B Client") }))
    .data;

  // The request happens AFTER the bystander exists, or the fan-out could not
  // have reached them whatever it selected.
  const secondAsk = await call("/consultation-requests", {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
    method: "POST",
    body: { caseId: matter.data.id, title: "A second question about my notice" },
  });
  check("the request goes through", secondAsk.status === 201, `got ${secondAsk.status}`);

  const bystanderInbox = await call("/notifications", {
    token: as("arch.client2@x.test"),
    wsToken: otherClient.workspaceToken,
  });
  check(
    "another client is NOT told about it, nor the matter it names",
    !(bystanderInbox.data ?? []).some(
      (n) =>
        /asked for a consultation/i.test(n.message ?? "") || /my notice/i.test(n.message ?? ""),
    ),
    JSON.stringify((bystanderInbox.data ?? []).map((n) => n.message).slice(0, 3)),
  );
  const staffInbox = await call("/notifications", { token: as(founder), wsToken: wsTok });
  check(
    "...but the chamber is",
    (staffInbox.data ?? []).some((n) => /asked for a consultation/i.test(n.message ?? "")),
    JSON.stringify((staffInbox.data ?? []).map((n) => n.message).slice(0, 3)),
  );

  const askLedger = await call(`/cases/${matter.data.id}/timeline`, {
    token: as(founder),
    wsToken: wsTok,
  });
  check(
    "the request is on the matter's ledger",
    (askLedger.data ?? []).some((e) => /Consultation requested/i.test(e.description)),
    JSON.stringify((askLedger.data ?? []).map((e) => e.description).slice(-4)),
  );

  section("6a. A chamber's own case statuses");
  const stdStatuses = await call("/case-statuses", { token: as(founder), wsToken: wsTok });
  check(
    "the four standard statuses are offered without anybody seeding them",
    stdStatuses.status === 200 &&
      ["open", "in_progress", "review", "closed"].every((k) =>
        (stdStatuses.data?.options ?? []).some((o) => o.key === k && o.source === "standard"),
      ),
    JSON.stringify((stdStatuses.data?.options ?? []).map((o) => o.key)),
  );

  const addedStatus = await call("/case-statuses", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { label: "On Hold" },
  });
  check(
    "a chamber adds a status of its own",
    addedStatus.status === 201,
    `got ${addedStatus.status}`,
  );
  const onHold = (addedStatus.data?.options ?? []).find((o) => o.key === "on_hold");
  check(
    "...keyed from the label and marked as the chamber's",
    onHold?.label === "On Hold" && onHold?.source === "chamber",
    JSON.stringify(onHold),
  );

  const dupStatus = await call("/case-statuses", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { label: "on  hold" },
  });
  check(
    "adding it again is not an error and does not duplicate it",
    dupStatus.status === 201 &&
      (dupStatus.data?.options ?? []).filter((o) => o.key === "on_hold").length === 1,
    `${dupStatus.status}`,
  );

  const usedStatus = await call(`/cases/${matter.data.id}`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { status: "on_hold" },
  });
  check(
    "a matter can be put on a chamber-defined status",
    usedStatus.status === 200 && usedStatus.data.status === "on_hold",
    `${usedStatus.status} ${usedStatus.data?.status}`,
  );
  check(
    "...and the response carries the label a reader sees",
    usedStatus.data?.statusLabel === "On Hold",
    usedStatus.data?.statusLabel,
  );

  const bogusStatus = await call(`/cases/${matter.data.id}`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { status: "not_a_real_status" },
  });
  check(
    "a status off the list is refused, not stored",
    bogusStatus.status === 400 && bogusStatus.data?.error === "unknown_status",
    `${bogusStatus.status} ${JSON.stringify(bogusStatus.data)}`,
  );

  const bogusOnCreate = await call("/cases", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { title: "Bad status", filingRef: "CV-BAD-1", status: "invented" },
  });
  check(
    "...on create as well as on update",
    bogusOnCreate.status === 400 && bogusOnCreate.data?.error === "unknown_status",
    `${bogusOnCreate.status} ${JSON.stringify(bogusOnCreate.data)}`,
  );

  const clientStatuses = await call("/case-statuses", {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
  });
  check(
    "a client can read the vocabulary — their own matter has a status",
    clientStatuses.status === 200 && Array.isArray(clientStatuses.data.options),
    `got ${clientStatuses.status}`,
  );
  const clientAddsStatus = await call("/case-statuses", {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
    method: "POST",
    body: { label: "Whatever I like" },
  });
  check(
    "...but cannot extend it (403)",
    clientAddsStatus.status === 403,
    `got ${clientAddsStatus.status}`,
  );

  // Put it back, so the sections after this one see the matter they expect.
  await call(`/cases/${matter.data.id}`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { status: "open" },
  });

  section("6b. Stage changes reach the matter's ledger");
  const beforeStage = await call(`/cases/${writMatter.data.id}/timeline`, {
    token: as(founder),
    wsToken: wsTok,
  });
  const stagedCase = await call(`/cases/${writMatter.data.id}`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { stage: "counter_affidavit" },
  });
  check("the matter's stage can be set", stagedCase.status === 200, `got ${stagedCase.status}`);
  const afterStage = await call(`/cases/${writMatter.data.id}/timeline`, {
    token: as(founder),
    wsToken: wsTok,
  });
  const stageRows = (afterStage.data ?? []).filter((e) => e.eventType === "stage_changed");
  check(
    "a stage change is recorded on the matter",
    stageRows.length ===
      (beforeStage.data ?? []).filter((e) => e.eventType === "stage_changed").length + 1,
    `${stageRows.length} stage_changed rows`,
  );
  check(
    "...naming the LABEL a chamber reads, not the stored key",
    stageRows.some((e) => /Counter affidavit/.test(e.description)),
    JSON.stringify(stageRows.map((e) => e.description)),
  );
  check(
    "...and who changed it",
    stageRows.every((e) => !!e.actorName),
    JSON.stringify(stageRows.map((e) => e.actorName)),
  );

  // Setting it to what it already is must not manufacture a row: a ledger that
  // records non-events is one nobody reads.
  const again = await call(`/cases/${writMatter.data.id}`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { stage: "counter_affidavit" },
  });
  const afterNoop = await call(`/cases/${writMatter.data.id}/timeline`, {
    token: as(founder),
    wsToken: wsTok,
  });
  check(
    "re-setting the same stage records nothing",
    again.status === 200 &&
      (afterNoop.data ?? []).filter((e) => e.eventType === "stage_changed").length ===
        stageRows.length,
    `${(afterNoop.data ?? []).filter((e) => e.eventType === "stage_changed").length}`,
  );

  // Clearing is a change, and reads as one rather than as silence.
  await call(`/cases/${writMatter.data.id}`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { stage: null },
  });
  const afterClear = await call(`/cases/${writMatter.data.id}/timeline`, {
    token: as(founder),
    wsToken: wsTok,
  });
  check(
    "clearing the stage is recorded too",
    (afterClear.data ?? []).some(
      (e) => e.eventType === "stage_changed" && /cleared/i.test(e.description),
    ),
    JSON.stringify(
      (afterClear.data ?? [])
        .filter((e) => e.eventType === "stage_changed")
        .map((e) => e.description),
    ),
  );

  /* A client holds `documents.write` — it is what lets them answer a document
     request — so the relabel route is reachable by one. Gating on the
     capability alone let a client re-file the CHAMBER's papers: verified
     against a running server, a client sent {stage: null} for a shared
     "Filed petition.pdf" and got 200. Visibility was not enough to stop it,
     because `shared` is exactly the material a client may see, and being
     allowed to read a filing is not being allowed to re-file it. The rule is
     ownership: a client labels what they sent in, and nothing else. */
  // Staff file it first, which also exercises the path that must keep working.
  const staffFiles = await call(`/documents/${sharedDoc.data.id}/stage`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { stage: "filed" },
  });
  check(
    "staff can re-file the chamber's own paper",
    staffFiles.status === 200 && staffFiles.data.stage === "filed",
    `got ${staffFiles.status} ${staffFiles.data?.stage}`,
  );
  const clientRefiles = await call(`/documents/${sharedDoc.data.id}/stage`, {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
    method: "PATCH",
    body: { stage: null },
  });
  check(
    "a client cannot re-file the chamber's own shared paper (404)",
    clientRefiles.status === 404,
    `got ${clientRefiles.status}`,
  );
  const stillFiled = await call(`/cases/${matter.data.id}/documents`, {
    token: as(founder),
    wsToken: wsTok,
  });
  check(
    "...and the refusal fired before the write, not after it",
    stillFiled.data.find((d) => d.id === sharedDoc.data.id)?.stage === "filed",
    JSON.stringify(stillFiled.data.find((d) => d.id === sharedDoc.data.id)?.stage),
  );
  const clientOwnUpload = await call(`/cases/${matter.data.id}/documents`, {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
    method: "POST",
    body: { name: "Client's own affidavit.pdf" },
  });
  const clientLabelsOwn = await call(`/documents/${clientOwnUpload.data.id}/stage`, {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
    method: "PATCH",
    body: { stage: "filed" },
  });
  check(
    "...but a client can still label what they sent in themselves",
    clientLabelsOwn.status === 200 && clientLabelsOwn.data.stage === "filed",
    `got ${clientLabelsOwn.status}`,
  );
  const restageAudit = await call("/workspace/audit", { token: as(founder), wsToken: wsTok });
  check(
    "a stage change is audited, like the upload and the download",
    (restageAudit.data?.events ?? restageAudit.data ?? []).some(
      (e) => e.action === "document.restaged",
    ),
    `audit ${restageAudit.status}`,
  );

  // Relabelling. The alternative to this route is delete-and-re-upload, which
  // loses the checksum, the uploader and any request the document closed.
  const restaged = await call(`/documents/${stagedUpload.data.id}/stage`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { stage: "rejoinder_affidavit" },
  });
  check(
    "a mislabelled paper can be moved",
    restaged.status === 200 && restaged.data.stage === "rejoinder_affidavit",
    `${restaged.status} ${restaged.data?.stage}`,
  );
  const unfiled = await call(`/documents/${stagedUpload.data.id}/stage`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { stage: null },
  });
  check(
    "...and returned to unfiled, which is the only undo",
    unfiled.status === 200 && unfiled.data.stage === null,
    `${unfiled.status} ${unfiled.data?.stage}`,
  );
  const movedBogus = await call(`/documents/${stagedUpload.data.id}/stage`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { stage: "still_not_real" },
  });
  check(
    "the relabel refuses a stage off the list too",
    movedBogus.status === 400 && movedBogus.data?.error === "unknown_stage",
    `${movedBogus.status} ${JSON.stringify(movedBogus.data)}`,
  );

  // Cross-tenant. Every chamber's documents share one table, so a document id
  // proves nothing on its own — the same class of bug this codebase keeps
  // finding. A stranger must not be able to re-file another chamber's papers,
  // and must not learn the id exists from the shape of the refusal.
  const stranger = "stage.stranger@elsewhere.test";
  const strangerWs = await call("/workspaces", {
    token: as(stranger, "A Stranger"),
    method: "POST",
    body: { name: `Stranger Chambers ${Date.now()}`, role: "admin" },
  });
  await declareBarRegistration(call, as(stranger));
  await grantPreviewPlan(call, as(stranger), strangerWs.data.workspaceToken);
  const poach = await call(`/documents/${stagedUpload.data.id}/stage`, {
    token: as(stranger),
    wsToken: strangerWs.data.workspaceToken,
    method: "PATCH",
    body: { stage: "petition" },
  });
  check(
    "another chamber cannot re-file this document (404)",
    poach.status === 404,
    `got ${poach.status}`,
  );
  const poachStages = await call(`/cases/${writMatter.data.id}/stages`, {
    token: as(stranger),
    wsToken: strangerWs.data.workspaceToken,
  });
  check(
    "...nor read its stage list (404, same as a matter that does not exist)",
    poachStages.status === 404,
    `got ${poachStages.status}`,
  );

  // The matter's own stage — the phase it has reached, which `status` does not
  // say. Set through the ordinary case PATCH, validated against the same list.
  const matterStage = await call(`/cases/${writMatter.data.id}`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { stage: "counter_affidavit" },
  });
  check(
    "a matter records the phase it has reached",
    matterStage.status === 200 && matterStage.data.stage === "counter_affidavit",
    `${matterStage.status} ${matterStage.data?.stage}`,
  );
  check(
    "...resolved to a heading for display",
    matterStage.data?.stageLabel === "Counter affidavit",
    JSON.stringify(matterStage.data?.stageLabel),
  );
  check(
    "...and is not the same field as status",
    matterStage.data?.status === "open",
    matterStage.data?.status,
  );
  const badMatterStage = await call(`/cases/${writMatter.data.id}`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { stage: "invented_phase" },
  });
  check(
    "a matter cannot reach a phase that is not on its list",
    badMatterStage.status === 400 && badMatterStage.data?.error === "unknown_stage",
    `${badMatterStage.status} ${JSON.stringify(badMatterStage.data)}`,
  );

  section("Client feedback");
  const fb = await call("/feedback", {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
    method: "POST",
    body: { caseId: matter.data.id, rating: 5, comment: "Handled promptly." },
  });
  check("client leaves feedback", fb.status === 201, `got ${fb.status}`);
  const dup = await call("/feedback", {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
    method: "POST",
    body: { caseId: matter.data.id, rating: 1 },
  });
  check("cannot rate the same matter twice (409)", dup.status === 409, `got ${dup.status}`);
  const bad = await call("/feedback", {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
    method: "POST",
    body: { caseId: matter.data.id, rating: 9 },
  });
  check("rating is bounded 1–5 (400)", bad.status === 400, `got ${bad.status}`);

  const firmFb = await call("/feedback", { token: as(founder), wsToken: wsTok });
  check("firm reads client feedback", firmFb.data.length === 1 && firmFb.data[0].rating === 5);
  const selfRate = await call("/feedback", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { caseId: matter.data.id, rating: 5 },
  });
  check("a chamber cannot rate itself (403)", selfRate.status === 403, `got ${selfRate.status}`);

  const reply = await call(`/feedback/${fb.data.id}/response`, {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { response: "Thank you." },
  });
  check("firm can reply", reply.status === 200 && reply.data.response === "Thank you.");
  check("...without altering the client's words", reply.data.comment === "Handled promptly.");
  const clerkReply = await call(`/feedback/${fb.data.id}/response`, {
    token: as("arch.clerk@chambers.test"),
    wsToken: clerk.workspaceToken,
    method: "POST",
    body: { response: "no" },
  });
  check("clerk cannot reply (403)", clerkReply.status === 403, `got ${clerkReply.status}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

if (phase === "verify") {
  section("Persistence — after a full server restart");
  const st = JSON.parse(fs.readFileSync(seedFile, "utf8"));

  const s = await call("/session", { token: as(st.founder) });
  check(
    "founder still recognised",
    s.data.accessStatus === "active",
    JSON.stringify(s.data.accessStatus),
  );
  check("chamber still exists", s.data.activeWorkspace !== null);
  const wsTok = s.data.workspaceToken;

  const cases = await call("/cases", { token: as(st.founder), wsToken: wsTok });
  check(
    "matter survived",
    cases.data.some((c) => c.title === "Persistent matter"),
    JSON.stringify(cases.data.map((c) => c.title)),
  );

  const cal = await call("/calendar", { token: as(st.founder), wsToken: wsTok });
  check(
    "calendar entry survived",
    cal.data.some((e) => e.title === "Persisted hearing"),
  );
  check(
    "...including the moved date",
    cal.data.find((e) => e.title === "Persisted hearing")?.entryDate === plus(9),
  );

  const docs = await call("/documents", { token: as(st.founder), wsToken: wsTok });
  check("documents survived", docs.data.length >= 4, `${docs.data.length} docs`);
  check(
    "visibility survived",
    docs.data.some((d) => d.visibility === "firm") &&
      docs.data.some((d) => d.visibility === "shared"),
  );

  const fb = await call("/feedback", { token: as(st.founder), wsToken: wsTok });
  check("feedback survived", fb.data.length === 1 && fb.data[0].rating === 5);
  check("...with the firm's reply", fb.data[0].response === "Thank you.");

  const reqs = await call("/document-requests", { token: as(st.founder), wsToken: wsTok });
  check(
    "fulfilled request survived",
    reqs.data.some((r) => r.status === "fulfilled" && r.fulfilledDocumentId),
  );

  const clientSession = await call("/session", { token: as("arch.client@x.test") });
  check("client membership survived", clientSession.data.role === "client");
  check("client still has no calendar", !clientSession.data.capabilities.includes("calendar.read"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
