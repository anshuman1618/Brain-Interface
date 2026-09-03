// Narrowing a junior advocate or a clerk to named matters.
//
// Distinct from `case-restriction.mjs`, which covers the CLIENT restriction
// carried on an access-list entry. This is the admin's control over the
// chamber's own staff: a junior whose role would otherwise see everything, and
// a clerk who would otherwise see everything they hold a task on.
//
// The property worth proving is that the restriction REPLACES the role's row
// scope rather than filtering it. A restricted junior's role says `all`, so a
// version that intersected the two would let every matter through and look
// like it worked.
import { declareBarRegistration } from "../lib/bar-registration.mjs";
import { grantPreviewPlan } from "../lib/preview-plan.mjs";

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
const owner = `ca.owner+${suffix}@ca.test`;
const junior = `ca.junior+${suffix}@ca.test`;
const clerk = `ca.clerk+${suffix}@ca.test`;
const senior = `ca.senior+${suffix}@ca.test`;
const rivalOwner = `ca.rival+${suffix}@rival.test`;

/* ─────────────── Setup ─────────────── */
section("Setup");

const founded = await call("/workspaces", {
  token: as(owner, "CA Owner"),
  method: "POST",
  body: { name: `Access Chambers ${suffix}`, role: "admin" },
});
check("chamber founded", founded.status === 201, `got ${founded.status}`);
const ws = founded.data?.workspaceToken;
await declareBarRegistration(call, as(owner));
await grantPreviewPlan(call, as(owner), ws);

const mk = async (title, ref) =>
  call("/cases", {
    token: as(owner),
    wsToken: ws,
    method: "POST",
    body: { title, filingRef: `CV-CA-${suffix}-${ref}` },
  });
const alpha = await mk("Alpha matter", "A");
const beta = await mk("Beta matter", "B");
const gamma = await mk("Gamma matter", "C");
check(
  "three matters exist",
  [alpha, beta, gamma].every((m) => m.status === 201),
  [alpha, beta, gamma].map((m) => m.status).join(","),
);

for (const [email, role, name] of [
  [junior, "junior_advocate", "Junior"],
  [clerk, "clerk_intern", "Clerk"],
  [senior, "senior_advocate", "Senior"],
]) {
  await call("/workspace/access-list", {
    token: as(owner),
    wsToken: ws,
    method: "POST",
    body: { kind: "email", value: email, role },
  });
  await call("/session", { token: as(email, name) });
  if (role !== "clerk_intern") await declareBarRegistration(call, as(email));
}

const juniorS = (await call("/session", { token: as(junior, "Junior") })).data;
const clerkS = (await call("/session", { token: as(clerk, "Clerk") })).data;
const seniorS = (await call("/session", { token: as(senior, "Senior") })).data;

const members = await call("/workspace/members", { token: as(owner), wsToken: ws });
// `id` on the members list IS the membership id — the row is a membership, and
// the route path names it `:id` for the same reason.
const idOf = (email) => members.data?.find((m) => m.email === email)?.id;
const juniorM = idOf(junior);
const clerkM = idOf(clerk);
const seniorM = idOf(senior);
check(
  "every member has a membership id to address",
  Boolean(juniorM && clerkM && seniorM),
  JSON.stringify({ juniorM, clerkM, seniorM }),
);

/* ─────────────── The default ─────────────── */
section("Nobody is restricted until an admin says so");

const beforeJunior = await call(`/memberships/${juniorM}/case-access`, {
  token: as(owner),
  wsToken: ws,
});
check("the junior's access is readable", beforeJunior.status === 200, `got ${beforeJunior.status}`);
check("...and unrestricted", beforeJunior.data?.restricted === false);
check("...with no grants", (beforeJunior.data?.grantedCaseIds ?? []).length === 0);

const juniorSeesAll = await call("/cases", { token: as(junior), wsToken: juniorS.workspaceToken });
check(
  "an unrestricted junior sees the whole chamber",
  juniorSeesAll.data?.length === 3,
  String(juniorSeesAll.data?.length),
);

/* ─────────────── Restricting the junior ─────────────── */
section("A restricted junior sees only what was granted");

const set = await call(`/memberships/${juniorM}/case-access`, {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { restricted: true, caseIds: [alpha.data.id] },
});
check("the restriction is accepted", set.status === 200, `got ${set.status}`);
check("...and reads back restricted", set.data?.restricted === true);
check(
  "...naming exactly the one matter",
  JSON.stringify(set.data?.grantedCaseIds) === JSON.stringify([alpha.data.id]),
  JSON.stringify(set.data?.grantedCaseIds),
);
check(
  "...with the matter's title, so the admin screen need not join it back",
  set.data?.grants?.[0]?.caseTitle === "Alpha matter",
  JSON.stringify(set.data?.grants),
);

const narrowed = await call("/cases", { token: as(junior), wsToken: juniorS.workspaceToken });
check(
  "the junior's list is now one matter",
  narrowed.data?.length === 1 && narrowed.data[0].id === alpha.data.id,
  JSON.stringify(narrowed.data?.map((c) => c.id)),
);
check(
  "...and Beta is gone, though the junior's ROLE scope is `all`",
  !narrowed.data?.some((c) => c.id === beta.data.id),
);

const directBeta = await call(`/cases/${beta.data.id}`, {
  token: as(junior),
  wsToken: juniorS.workspaceToken,
});
check(
  "fetching an ungranted matter by id is 404, not 403",
  directBeta.status === 404,
  `got ${directBeta.status}`,
);
const directAlpha = await call(`/cases/${alpha.data.id}`, {
  token: as(junior),
  wsToken: juniorS.workspaceToken,
});
check("the granted matter still opens", directAlpha.status === 200, `got ${directAlpha.status}`);

/* ─────────────── Assigned work still counts ─────────────── */
section("An assigned matter is visible without a grant");
// "Assigned by default, plus explicit additions" — a junior handed a task must
// be able to open the file it is on, or the task is unworkable.

const task = await call("/tasks", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: {
    caseId: gamma.data.id,
    title: "Settle the rejoinder",
    assigneeId: juniorS.clerkId,
    deadline: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
  },
});
check("the junior is given a task on Gamma", task.status === 201, `got ${task.status}`);

const withTask = await call("/cases", { token: as(junior), wsToken: juniorS.workspaceToken });
check(
  "Gamma appears without anyone granting it",
  withTask.data?.some((c) => c.id === gamma.data.id),
  JSON.stringify(withTask.data?.map((c) => c.id)),
);
check(
  "...alongside the granted Alpha, and still not Beta",
  withTask.data?.length === 2 && !withTask.data.some((c) => c.id === beta.data.id),
  JSON.stringify(withTask.data?.map((c) => c.id)),
);

/* ─────────────── Clerks too ─────────────── */
section("The same control applies to a clerk");

const clerkSet = await call(`/memberships/${clerkM}/case-access`, {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { restricted: true, caseIds: [beta.data.id] },
});
check("a clerk can be restricted", clerkSet.status === 200, `got ${clerkSet.status}`);

const clerkCases = await call("/cases", { token: as(clerk), wsToken: clerkS.workspaceToken });
check(
  "the clerk sees the granted matter although they hold no task on it",
  clerkCases.data?.length === 1 && clerkCases.data[0].id === beta.data.id,
  JSON.stringify(clerkCases.data?.map((c) => c.id)),
);

/* ─────────────── The restriction has to hold on EVERY path ─────────────── */
section("The narrowing holds on every route that reaches a matter, not just /cases");
/*
 * A pen-test of fe8c902 found four routes that reached case-scoped data
 * without going through `visibleCaseIds` / `getVisibleCase`. Every one of them
 * was correct before case-access grants existed — a junior could see every
 * matter anyway, so "is it in this chamber" and "may I see it" were the same
 * question. They stopped being the same question, and these are the paths that
 * did not notice:
 *
 *   GET  /tasks/:id        — the LIST was scoped, the single fetch was not
 *   GET  /calendar         — filtered by audience only, so hearings leaked
 *   GET  /cases/:id/drafts — a draft body is the matter's facts in full
 *   GET/PATCH/DELETE /drafts/:id
 *   POST /cases/:id/drafts — could commission a brief on a hidden matter
 *
 * Asserted here rather than left to the routes' own suites because what is
 * being tested is the restriction, not the route.
 */

// Give the ungranted matter something on every surface worth leaking.
const hiddenTask = await call("/tasks", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: {
    caseId: beta.data.id,
    title: "Confidential: brief the silk",
    deadline: new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10),
  },
});
// Three entries, so the filter has to DISCRIMINATE rather than just return
// nothing: one on the hidden matter, one on the granted matter, and one
// chamber-wide. A version that dropped everything would pass a test that only
// checked the hidden one was absent.
for (const [title, caseId] of [
  ["Confidential hearing", beta.data.id],
  ["Granted matter hearing", alpha.data.id],
  ["Chamber holiday", null],
]) {
  await call("/calendar", {
    token: as(owner),
    wsToken: ws,
    method: "POST",
    body: {
      ...(caseId === null ? {} : { caseId }),
      title,
      entryDate: new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10),
      kind: caseId === null ? "note" : "hearing",
    },
  });
}
await call("/workspace/drafting", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { enabled: true, acknowledgement: "Read and accepted." },
});
const hiddenDraft = await call(`/cases/${beta.data.id}/drafts`, {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { kind: "letter", instruction: "A letter on the matter the junior cannot see." },
});

// Narrow the junior again — the section above lifted the restriction.
await call(`/memberships/${juniorM}/case-access`, {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { restricted: true, caseIds: [alpha.data.id] },
});
const jTok = juniorS.workspaceToken;

check(
  "GET /tasks/:id on an ungranted matter is 404, not the task",
  (await call(`/tasks/${hiddenTask.data.id}`, { token: as(junior), wsToken: jTok })).status === 404,
  "the list was scoped and the single fetch was not",
);
const calRows = (await call("/calendar", { token: as(junior), wsToken: jTok })).data ?? [];
check(
  "GET /calendar drops entries pinned to an ungranted matter",
  !calRows.some((e) => e.caseId === beta.data.id),
  JSON.stringify(calRows.map((e) => e.title)),
);
check(
  "...while the granted matter's hearing is still served",
  calRows.some((e) => e.caseId === alpha.data.id),
  JSON.stringify(calRows.map((e) => e.title)),
);
check(
  "...and so is the chamber-wide entry, which belongs to no matter",
  calRows.some((e) => e.caseId === null && e.title === "Chamber holiday"),
  JSON.stringify(calRows.map((e) => [e.title, e.caseId])),
);
check(
  "GET /cases/:id/drafts on an ungranted matter is 404",
  (await call(`/cases/${beta.data.id}/drafts`, { token: as(junior), wsToken: jTok })).status ===
    404,
  "a draft body is the matter's facts written out in full",
);
check(
  "POST /cases/:id/drafts on an ungranted matter is refused",
  (
    await call(`/cases/${beta.data.id}/drafts`, {
      token: as(junior),
      wsToken: jTok,
      method: "POST",
      body: { kind: "brief", instruction: "Brief me on a matter I cannot open." },
    })
  ).status === 404,
  "otherwise the model reads the matter and the chamber pays for it",
);
for (const [label, method] of [
  ["GET", "GET"],
  ["PATCH", "PATCH"],
  ["DELETE", "DELETE"],
]) {
  check(
    `${label} /drafts/:id of a draft on an ungranted matter is 404`,
    (
      await call(`/drafts/${hiddenDraft.data.id}`, {
        token: as(junior),
        wsToken: jTok,
        method,
        ...(method === "PATCH" ? { body: { title: "x" } } : {}),
      })
    ).status === 404,
  );
}
check(
  "...and the draft survived the refused PATCH and DELETE",
  (await call(`/drafts/${hiddenDraft.data.id}`, { token: as(owner), wsToken: ws })).status === 200,
  "a refusal that fires after the row is gone is not a refusal",
);

/* ─────────────── Who cannot be restricted ─────────────── */
section("A senior advocate cannot be narrowed, and a client is already narrow");

const seniorSet = await call(`/memberships/${seniorM}/case-access`, {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { restricted: true, caseIds: [alpha.data.id] },
});
check(
  "restricting a senior advocate is refused (400)",
  seniorSet.status === 400,
  `got ${seniorSet.status}`,
);
const seniorCases = await call("/cases", { token: as(senior), wsToken: seniorS.workspaceToken });
check(
  "...and they still see the whole chamber",
  seniorCases.data?.length === 3,
  String(seniorCases.data?.length),
);

/* ─────────────── The write is a replace ─────────────── */
section("A grant list is sent whole, so a stale client cannot re-grant");

const replaced = await call(`/memberships/${juniorM}/case-access`, {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { restricted: true, caseIds: [beta.data.id] },
});
check(
  "the new list replaces the old one entirely",
  JSON.stringify(replaced.data?.grantedCaseIds) === JSON.stringify([beta.data.id]),
  JSON.stringify(replaced.data?.grantedCaseIds),
);

const lifted = await call(`/memberships/${juniorM}/case-access`, {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { restricted: false, caseIds: [] },
});
check("the restriction can be lifted", lifted.data?.restricted === false, `got ${lifted.status}`);
const liftedCases = await call("/cases", { token: as(junior), wsToken: juniorS.workspaceToken });
check(
  "...and the junior sees everything again",
  liftedCases.data?.length === 3,
  String(liftedCases.data?.length),
);

/* ─────────────── Only an admin ─────────────── */
section("Only access_control.manage may change it");

check(
  "a senior advocate cannot read another member's access (403)",
  (
    await call(`/memberships/${juniorM}/case-access`, {
      token: as(senior),
      wsToken: seniorS.workspaceToken,
    })
  ).status === 403,
);
check(
  "...nor set it (403)",
  (
    await call(`/memberships/${juniorM}/case-access`, {
      token: as(senior),
      wsToken: seniorS.workspaceToken,
      method: "PUT",
      body: { restricted: true, caseIds: [] },
    })
  ).status === 403,
);
check(
  "a restricted junior cannot widen their own access (403)",
  (
    await call(`/memberships/${juniorM}/case-access`, {
      token: as(junior),
      wsToken: juniorS.workspaceToken,
      method: "PUT",
      body: { restricted: false, caseIds: [] },
    })
  ).status === 403,
);

/* ─────────────── Tenant isolation ─────────────── */
section("A grant cannot reach across chambers");

const rivalWs = await call("/workspaces", {
  token: as(rivalOwner, "Rival"),
  method: "POST",
  body: { name: `Rival Chambers ${suffix}`, role: "admin" },
});
const rTok = rivalWs.data?.workspaceToken;
await declareBarRegistration(call, as(rivalOwner));
await grantPreviewPlan(call, as(rivalOwner), rTok);
const rivalCase = await call("/cases", {
  token: as(rivalOwner),
  wsToken: rTok,
  method: "POST",
  body: { title: "Rival matter", filingRef: `CV-CA-R-${suffix}` },
});

const foreign = await call(`/memberships/${juniorM}/case-access`, {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { restricted: true, caseIds: [rivalCase.data.id] },
});
check(
  "naming another chamber's matter writes no grant at all",
  foreign.status === 200 && (foreign.data?.grantedCaseIds ?? []).length === 0,
  JSON.stringify(foreign.data?.grantedCaseIds),
);
check(
  "...leaving the junior with nothing but what they are assigned",
  (await call("/cases", { token: as(junior), wsToken: juniorS.workspaceToken })).data?.length === 1,
);

check(
  "the rival's admin cannot address this chamber's membership (404)",
  (await call(`/memberships/${juniorM}/case-access`, { token: as(rivalOwner), wsToken: rTok }))
    .status === 404,
);

/* ─────────────── Reaching a hidden matter sideways ─────────────── */
section("A document request is not a way round the restriction");

// The restriction is enforced in visibleCaseIds / getVisibleCase. Anything that
// reached case-scoped data another way was outside it, and POST
// /document-requests did: it validated caseId with `caseInWorkspace`, which
// asks only "is this matter in my chamber". Both roles that CAN be narrowed
// hold document_requests.create, so both could attach a request to a matter
// they were kept out of — and tell a real hidden id from a nonexistent one by
// the status code.
//
// A client is needed to address a request to, and a client access-list entry
// must be pinned to a matter, so this one is pinned to the matter the junior
// legitimately holds.
// Sections above left the junior restricted with NO grants (the foreign-matter
// case), so re-establish a known state: granted Alpha, assigned Gamma, kept out
// of Beta. Asserted rather than assumed — the whole section is meaningless if
// Beta turns out to be visible.
await call(`/memberships/${juniorM}/case-access`, {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { restricted: true, caseIds: [alpha.data.id] },
});
const drJ = (await call("/session", { token: as(junior, "Junior") })).data;
check(
  "the junior is back to Alpha granted and Beta hidden",
  (await call(`/cases/${alpha.data.id}`, { token: as(junior), wsToken: drJ.workspaceToken }))
    .status === 200 &&
    (await call(`/cases/${beta.data.id}`, { token: as(junior), wsToken: drJ.workspaceToken }))
      .status === 404,
);

const drClient = `ca.client+${suffix}@ca.test`;
await call("/workspace/access-list", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { kind: "email", value: drClient, role: "client", caseId: alpha.data.id },
});
await call("/session", { token: as(drClient, "Client") });
const clientRow = (await call("/workspace/members", { token: as(owner), wsToken: ws })).data?.find(
  (m) => m.email === drClient,
);
check("a client exists to address a request to", Boolean(clientRow?.userId));

// The junior is restricted to alpha at this point; beta and gamma are hidden.
const drBody = (caseId) => ({
  clientId: clientRow?.userId,
  documentName: "Bank statements",
  caseId,
});

const juniorHidden = await call("/document-requests", {
  token: as(junior),
  wsToken: drJ.workspaceToken,
  method: "POST",
  body: drBody(beta.data.id),
});
check(
  "a restricted junior cannot raise one against a matter they cannot see",
  juniorHidden.status === 404,
  `got ${juniorHidden.status}`,
);

const juniorOwn = await call("/document-requests", {
  token: as(junior),
  wsToken: drJ.workspaceToken,
  method: "POST",
  body: drBody(alpha.data.id),
});
check(
  "...but can against the one they were granted",
  juniorOwn.status === 201,
  `got ${juniorOwn.status} ${JSON.stringify(juniorOwn.data)}`,
);

// The oracle is the point: a hidden id and an id that does not exist must be
// indistinguishable. Comparing the two statuses is what makes this a real
// assertion rather than "404 was returned", which a broken route also does.
const juniorBogus = await call("/document-requests", {
  token: as(junior),
  wsToken: drJ.workspaceToken,
  method: "POST",
  body: drBody(999_999),
});
check(
  "...and a hidden matter is indistinguishable from one that does not exist",
  juniorHidden.status === juniorBogus.status,
  `hidden ${juniorHidden.status} vs absent ${juniorBogus.status}`,
);

// The clerk was restricted to BETA above, so Gamma is their hidden matter —
// not Beta. Getting this wrong is how the assertion passes for the wrong
// reason: a clerk refused on a matter they were granted would prove the route
// is broken, not that it is safe.
const clerkHidden = await call("/document-requests", {
  token: as(clerk),
  wsToken: clerkS.workspaceToken,
  method: "POST",
  body: drBody(gamma.data.id),
});
check(
  "a clerk is refused against the matter they were kept out of",
  clerkHidden.status === 404,
  `got ${clerkHidden.status}`,
);
const clerkGranted = await call("/document-requests", {
  token: as(clerk),
  wsToken: clerkS.workspaceToken,
  method: "POST",
  body: drBody(beta.data.id),
});
check(
  "...and allowed against the one they were granted",
  clerkGranted.status === 201,
  `got ${clerkGranted.status}`,
);

// And the list. `enrich` resolves caseTitle, so an unfiltered staff list handed
// a narrowed junior the titles of matters they had been kept out of. The
// admin's own list is checked alongside it, because a filter that returned
// nothing to anybody would pass the junior assertion on its own.
const adminList = await call("/document-requests", { token: as(owner), wsToken: ws });
const juniorList = await call("/document-requests", {
  token: as(junior),
  wsToken: drJ.workspaceToken,
});
const adminOnBeta = (adminList.data ?? []).filter((r) => r.caseId === beta.data.id);
const juniorOnBeta = (juniorList.data ?? []).filter((r) => r.caseId === beta.data.id);
check(
  "the admin sees the requests raised against the hidden matter",
  adminOnBeta.length > 0,
  `admin saw ${adminOnBeta.length}`,
);
check(
  "...and the restricted junior sees none of them",
  juniorOnBeta.length === 0,
  JSON.stringify(juniorOnBeta.map((r) => r.caseTitle)),
);
check(
  "...but still sees the one on their own matter",
  (juniorList.data ?? []).some((r) => r.caseId === alpha.data.id),
  JSON.stringify((juniorList.data ?? []).map((r) => r.caseId)),
);

console.log(`\n${fail === 0 ? "✓" : "✗"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
