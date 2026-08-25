// AI drafting: the gates, the budget, and what leaves the server.
//
// Runs against the preview STUB model, which is selected by the same
// `isPreviewDatabase()` guard that keeps fixture courts out of production. That
// is what makes this suite runnable at all — thirteen suites in a loop against
// a real API would be a bill, and a CI job that spends money is a CI job
// somebody switches off.
//
// The stub is not a mock of the API. Everything around it is real: the budget
// check, the spend record, the draft row, the source record, the capability
// matrix and the tenant scoping. Only the text is invented.
import { declareBarRegistration } from "../lib/bar-registration.mjs";

const BASE = (process.env.API_BASE_URL ?? "http://localhost:5000") + "/api";
let pass = 0,
  fail = 0;
const check = (n, ok, d = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);
};
const section = (t) => console.log(`\n== ${t}`);
const as = (email, name = "") =>
  `preview:email:google:${encodeURIComponent(email)}:${encodeURIComponent(name)}`;

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
const owner = `dr.owner+${suffix}@dr.test`;
const junior = `dr.junior+${suffix}@dr.test`;
const clerk = `dr.clerk+${suffix}@dr.test`;
const rival = `dr.rival+${suffix}@rival.test`;

/* ─────────────── Setup ─────────────── */
section("Setup");

const founded = await call("/workspaces", {
  token: as(owner, "Drafting Owner"),
  method: "POST",
  body: { name: `Drafting Chambers ${suffix}`, role: "admin" },
});
const ws = founded.data?.workspaceToken;
check("chamber founded", founded.status === 201, `got ${founded.status}`);
await declareBarRegistration(call, as(owner));

const matter = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: {
    title: "Sharma v State of U.P.",
    filingRef: `WP-${suffix}`,
    opposingParty: "State of U.P.",
  },
});
check("a matter exists", matter.status === 201, `got ${matter.status}`);

/* ─────────────── The chamber's opt-in ─────────────── */
section("Nothing reaches a model until the chamber has said yes");

const beforeOptIn = await call(`/cases/${matter.data.id}/drafts`, {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { kind: "petition", instruction: "Draft a writ petition against the demand notice." },
});
// The property that makes this feature defensible. Hiding the button would not
// be a control; refusing the request is.
check(
  "drafting is refused before an admin switches it on",
  beforeOptIn.status === 403 && beforeOptIn.data?.error === "drafting_not_enabled",
  `${beforeOptIn.status} ${JSON.stringify(beforeOptIn.data)}`,
);

const budgetBefore = await call("/ai/budget", { token: as(owner), wsToken: ws });
check(
  "...and the meter says so",
  budgetBefore.data?.draftingEnabled === false,
  JSON.stringify(budgetBefore.data),
);

const enabled = await call("/workspace/drafting", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { enabled: true, acknowledgement: "Read and accepted." },
});
check("an admin can switch it on", enabled.status === 200, `got ${enabled.status}`);
check(
  "...and who did it is recorded, not just that it happened",
  Boolean(enabled.data?.draftingEnabledBy) && Boolean(enabled.data?.draftingEnabledAt),
  JSON.stringify(enabled.data),
);

/* ─────────────── The budget ─────────────── */
section("The budget is a real limit, visible before it bites");

const budget = await call("/ai/budget", { token: as(owner), wsToken: ws });
check("the meter is readable", budget.status === 200, `got ${budget.status}`);
check(
  "a fresh trial chamber has its whole allowance",
  budget.data?.spentMinor === 0 && budget.data?.remainingMinor === budget.data?.allowanceMinor,
  JSON.stringify(budget.data),
);
check(
  "the trial is capped at Rs 40 for the pack",
  budget.data?.allowanceMinor === 4000,
  String(budget.data?.allowanceMinor),
);
// A ninety-nine rupee evaluation must not be able to spend thirty of them on
// one petition, so every trial draft goes to the lighter model.
check(
  "...and routes everything to the economy tier",
  budget.data?.tier === "economy",
  budget.data?.tier,
);
check(
  "the meter says plainly that no provider is configured",
  budget.data?.configured === false,
  String(budget.data?.configured),
);

/* ─────────────── Insights ─────────────── */
section("The chamber's own observations are recorded and retrieved");

const insight = await call("/insights", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: {
    title: "Lucknow registry returns an unstamped vakalatnama",
    body: "Get the vakalatnama stamped before filing at Lucknow or it comes back the same day.",
    tags: "lucknow,registry",
  },
});
check("an insight is recorded", insight.status === 201, `got ${insight.status}`);

const found = await call("/insights?q=vakalatnama", { token: as(owner), wsToken: ws });
check(
  "...and is found by full-text search",
  found.data?.length === 1,
  JSON.stringify(found.data?.map((i) => i.title)),
);

const missing = await call("/insights?q=zzzznotpresent", { token: as(owner), wsToken: ws });
check("a term nobody wrote returns nothing", missing.data?.length === 0);

/* ─────────────── Style exemplars ─────────────── */
section("An example is inert until a person has checked the redaction");

const filing = `IN THE HIGH COURT OF JUDICATURE AT ALLAHABAD, LUCKNOW BENCH
W.P.(C) No. 1234 of 2026
Ram Prasad Sharma ... Petitioner
Versus
State of Uttar Pradesh and others ... Respondents

1. That the petitioner is aggrieved by the demand notice dated 12.03.2026.
2. That the notice was issued without any opportunity of hearing.
3. That a representation dated 20.03.2026 remains undecided.

PRAYER: quash the impugned demand notice dated 12.03.2026.
VERIFICATION: I verify that paragraphs 1 to 3 are true to my knowledge.`;

const exemplar = await call("/exemplars", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { kind: "petition", title: "The good writ", text: filing },
});
check("an example is accepted", exemplar.status === 201, `got ${exemplar.status}`);
check(
  "...the redaction pass has run",
  Boolean(exemplar.data?.anonymisedAt),
  JSON.stringify(exemplar.data?.anonymisedAt),
);
check(
  "...but it is NOT yet approved",
  exemplar.data?.reviewedAt === null,
  String(exemplar.data?.reviewedAt),
);
check(
  "the un-redacted original is never returned to a client",
  !JSON.stringify(exemplar.data).includes("Ram Prasad Sharma"),
  "the source text leaked into the response",
);

const tooShort = await call("/exemplars", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { kind: "petition", title: "Too short", text: "Not really a filing." },
});
check("a scrap is refused as an example", tooShort.status === 400, `got ${tooShort.status}`);

/* ─────────────── Drafting ─────────────── */
section("Drafting, and exactly what was sent to produce it");

const draft = await call(`/cases/${matter.data.id}/drafts`, {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: {
    kind: "petition",
    instruction: "Draft a writ petition challenging the demand notice dated 12.03.2026.",
  },
});
check("a draft is produced", draft.status === 202, `got ${draft.status}`);
check("...and is ready", draft.data?.status === "ready", draft.data?.status);
// The one line that must be on every draft. Prepended by the server rather than
// trusted to the model — an instruction usually followed is not a guarantee.
check(
  "...carrying the verify-before-filing banner",
  (draft.data?.body ?? "").includes("must be verified"),
  (draft.data?.body ?? "").slice(0, 80),
);
check(
  "...on the economy model, because this chamber is on trial",
  (draft.data?.model ?? "").includes("sonnet"),
  draft.data?.model,
);

const kinds = (draft.data?.sources ?? []).map((s) => s.kind);
check("the matter itself is recorded as a source", kinds.includes("matter"), JSON.stringify(kinds));
check(
  "the chamber's insight was retrieved into it",
  kinds.includes("insight"),
  JSON.stringify(kinds),
);
// The gate: an example nobody has checked must not reach a prompt, because an
// exemplar rides in the prefix of every draft of its kind.
check("the UNAPPROVED example was NOT used", !kinds.includes("exemplar"), JSON.stringify(kinds));

const approved = await call(`/exemplars/${exemplar.data.id}`, {
  token: as(owner),
  wsToken: ws,
  method: "PATCH",
  body: { approve: true },
});
check(
  "approving records who checked it",
  Boolean(approved.data?.reviewedBy),
  approved.data?.reviewedBy,
);

const draft2 = await call(`/cases/${matter.data.id}/drafts`, {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { kind: "petition", instruction: "Draft the petition again, now with our house style." },
});
check(
  "...and the approved example IS used from then on",
  (draft2.data?.sources ?? []).map((s) => s.kind).includes("exemplar"),
  JSON.stringify((draft2.data?.sources ?? []).map((s) => s.kind)),
);

const review = await call(`/cases/${matter.data.id}/drafts`, {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { kind: "review", instruction: "Check this for defects before we file." },
});
check("a review runs", review.status === 202 && review.data?.kind === "review", review.data?.kind);

/* ─────────────── Spend ─────────────── */
section("Every call is charged, and the meter moves");

const after = await call("/ai/budget", { token: as(owner), wsToken: ws });
check("the budget has been spent against", after.data?.spentMinor > 0, JSON.stringify(after.data));
check(
  "...and remaining is allowance minus spend",
  after.data?.remainingMinor === after.data?.allowanceMinor - after.data?.spentMinor,
  JSON.stringify(after.data),
);
// A draft a chamber deletes still cost money. A budget derived from rows the
// chamber can delete would not be a budget.
const spendBeforeDelete = after.data.spentMinor;
await call(`/drafts/${draft2.data.id}`, { token: as(owner), wsToken: ws, method: "DELETE" });
const afterDelete = await call("/ai/budget", { token: as(owner), wsToken: ws });
check(
  "deleting a draft does NOT refund its spend",
  afterDelete.data?.spentMinor === spendBeforeDelete,
  `${spendBeforeDelete} then ${afterDelete.data?.spentMinor}`,
);

/* ─────────────── Who may do it ─────────────── */
section("Practice roles draft; a clerk and a client do not");

for (const [email, role, name] of [
  [junior, "junior_advocate", "Junior"],
  [clerk, "clerk_intern", "Clerk"],
]) {
  await call("/workspace/access-list", {
    token: as(owner),
    wsToken: ws,
    method: "POST",
    body: { kind: "email", value: email, role },
  });
  const session = await call("/session", { token: as(email, name) });
  const token = session.data?.workspaceToken;
  if (role !== "clerk_intern") await declareBarRegistration(call, as(email));

  const attempt = await call(`/cases/${matter.data.id}/drafts`, {
    token: as(email),
    wsToken: token,
    method: "POST",
    body: { kind: "application", instruction: "Draft a short adjournment application." },
  });

  if (role === "junior_advocate") {
    check("a junior advocate may draft", attempt.status === 202, `got ${attempt.status}`);
  } else {
    // A clerk keeps the diary; settling a pleading is not clerical work, and a
    // drafting request spends the chamber's money.
    check(
      "a clerk may not draft",
      attempt.status === 403,
      `got ${attempt.status} ${JSON.stringify(attempt.data)}`,
    );
  }
}

const clientEmail = `dr.client+${suffix}@client.test`;
await call("/workspace/access-list", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { kind: "email", value: clientEmail, role: "client", caseId: matter.data.id },
});
const clientSession = await call("/session", { token: as(clientEmail, "Client") });
const clientDraft = await call(`/cases/${matter.data.id}/drafts`, {
  token: as(clientEmail),
  wsToken: clientSession.data?.workspaceToken,
  method: "POST",
  body: { kind: "letter", instruction: "Write a letter about my case." },
});
check(
  "a client may not draft, and not because they are not a member",
  clientDraft.status === 403 && clientDraft.data?.reason !== "no_active_membership",
  `${clientDraft.status} ${JSON.stringify(clientDraft.data)}`,
);

/* ─────────────── Tenant isolation ─────────────── */
section("A second chamber shares none of it");

const rivalWs = await call("/workspaces", {
  token: as(rival, "Rival"),
  method: "POST",
  body: { name: `Rival Chambers ${suffix}`, role: "admin" },
});
const rTok = rivalWs.data?.workspaceToken;
await declareBarRegistration(call, as(rival));
await call("/workspace/drafting", {
  token: as(rival),
  wsToken: rTok,
  method: "POST",
  body: { enabled: true },
});

check(
  "the rival sees none of our insights",
  (await call("/insights", { token: as(rival), wsToken: rTok })).data?.length === 0,
);
check(
  "...none of our examples",
  (await call("/exemplars", { token: as(rival), wsToken: rTok })).data?.length === 0,
);
check(
  "...and cannot read our draft (404, not 403)",
  (await call(`/drafts/${draft.data.id}`, { token: as(rival), wsToken: rTok })).status === 404,
);
check(
  "...nor edit it",
  (
    await call(`/drafts/${draft.data.id}`, {
      token: as(rival),
      wsToken: rTok,
      method: "PATCH",
      body: { body: "replaced" },
    })
  ).status === 404,
);

const rivalMatter = await call("/cases", {
  token: as(rival),
  wsToken: rTok,
  method: "POST",
  body: { title: "Rival's matter", filingRef: `RV-${suffix}` },
});
const crossDraft = await call(`/cases/${matter.data.id}/drafts`, {
  token: as(rival),
  wsToken: rTok,
  method: "POST",
  body: { kind: "petition", instruction: "Draft from the other chamber's matter." },
});
check(
  "drafting from OUR matter is a 404 for them",
  crossDraft.status === 404,
  `got ${crossDraft.status}`,
);

// The security property of the document picker: an id is not proof. A document
// from another matter — even one in your own chamber — is simply not read.
const foreignDoc = await call(`/cases/${rivalMatter.data.id}/drafts`, {
  token: as(rival),
  wsToken: rTok,
  method: "POST",
  body: {
    kind: "petition",
    instruction: "Draft using a document that is not on this matter.",
    documentIds: [999999],
  },
});
check(
  "an unknown document id is ignored rather than obeyed",
  foreignDoc.status === 202 && !(foreignDoc.data?.sources ?? []).some((s) => s.kind === "document"),
  JSON.stringify(foreignDoc.data?.sources),
);

/* ─────────────── Validation ─────────────── */
section("The guards");

const noInstruction = await call(`/cases/${matter.data.id}/drafts`, {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { kind: "petition", instruction: "x" },
});
check(
  "a one-character instruction is refused",
  noInstruction.status === 400,
  `got ${noInstruction.status}`,
);

const badKind = await call(`/cases/${matter.data.id}/drafts`, {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { kind: "affidavit_of_doom", instruction: "Draft something unknown." },
});
check("an unknown document kind is refused", badKind.status === 400, `got ${badKind.status}`);

const anon = await call(`/cases/${matter.data.id}/drafts`, {
  method: "POST",
  body: { kind: "petition", instruction: "Draft without signing in." },
});
check("no token, no drafting", anon.status === 401 || anon.status === 403, `got ${anon.status}`);

console.log(`\n${fail === 0 ? "✓" : "✗"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
