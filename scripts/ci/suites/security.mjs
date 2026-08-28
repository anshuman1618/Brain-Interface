// Zero-trust regression suite, rebuilt to bootstrap its own data now that the
// platform ships empty. Same adversarial checks as before, no fixtures.
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

async function call(path, { token, wsToken, wsId, method = "GET", body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (wsToken) headers["x-workspace-token"] = wsToken;
  if (wsId !== undefined) headers["x-workspace-id"] = String(wsId);
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
const suffix = Date.now();

// --- bootstrap two independent chambers -------------------------------------
const A = await call("/workspaces", {
  token: as(`a.admin+${suffix}@a.test`, "A Admin"),
  method: "POST",
  body: { name: `Alpha ${suffix}`, role: "admin" },
});
const B = await call("/workspaces", {
  token: as(`b.admin+${suffix}@b.test`, "B Admin"),
  method: "POST",
  body: { name: `Beta ${suffix}`, role: "admin" },
});
const aTok = A.data.workspaceToken,
  bTok = B.data.workspaceToken;
const aId = A.data.activeWorkspace.id,
  bId = B.data.activeWorkspace.id;
await declareBarRegistration(call, as(`a.admin+${suffix}@a.test`));
await declareBarRegistration(call, as(`b.admin+${suffix}@b.test`));
await grantPreviewPlan(call, as(`a.admin+${suffix}@a.test`), aTok);
await grantPreviewPlan(call, as(`b.admin+${suffix}@b.test`), bTok);

await call("/invites", {
  token: as(`a.admin+${suffix}@a.test`),
  wsToken: aTok,
  method: "POST",
  body: { email: `a.senior+${suffix}@a.test`, role: "senior_advocate" },
});
await call("/invites", {
  token: as(`a.admin+${suffix}@a.test`),
  wsToken: aTok,
  method: "POST",
  body: { email: `a.clerk+${suffix}@a.test`, role: "clerk_intern" },
});
const senior = (await call("/session", { token: as(`a.senior+${suffix}@a.test`, "A Senior") }))
  .data;
await declareBarRegistration(call, as(`a.senior+${suffix}@a.test`));
const clerk = (await call("/session", { token: as(`a.clerk+${suffix}@a.test`, "A Clerk") })).data;
// A user row exists the moment anyone authenticates, whether or not they are
// admitted anywhere — so the client's id is available before they are invited,
// which is what lets the case they will be restricted to name them as its
// client before that restriction exists.
const clientPre = (await call("/session", { token: as(`a.client+${suffix}@a.test`, "A Client") }))
  .data;

const caseA = await call("/cases", {
  token: as(`a.admin+${suffix}@a.test`),
  wsToken: aTok,
  method: "POST",
  body: {
    title: `Alpha matter ${suffix}`,
    filingRef: `CV-A-${suffix}`,
    clientId: clientPre.userId,
  },
});

// A client invite must be restricted to a matter — see DECISIONS.md.
const clientInvite = await call("/invites", {
  token: as(`a.admin+${suffix}@a.test`),
  wsToken: aTok,
  method: "POST",
  body: { email: `a.client+${suffix}@a.test`, role: "client", caseId: caseA.data.id },
});
check(
  "a restricted client invite is accepted",
  clientInvite.status === 201,
  `got ${clientInvite.status} ${JSON.stringify(clientInvite.data)}`,
);
const client = (await call("/session", { token: as(`a.client+${suffix}@a.test`, "A Client") }))
  .data;
check("...and actually admits them", client.accessStatus === "active", client.accessStatus);
const caseB = await call("/cases", {
  token: as(`b.admin+${suffix}@b.test`),
  wsToken: bTok,
  method: "POST",
  body: { title: `Beta confidential ${suffix}`, filingRef: `CV-B-${suffix}` },
});
await call("/tasks", {
  token: as(`a.admin+${suffix}@a.test`),
  wsToken: aTok,
  method: "POST",
  body: {
    caseId: caseA.data.id,
    title: "Clerk work",
    assigneeId: clerk.clerkId,
    deadline: plus(4),
  },
});

section("Forged client state");
check(
  "forging X-Workspace-Id for another chamber → 403",
  (await call("/cases", { token: as(`a.admin+${suffix}@a.test`), wsId: bId })).status === 403,
);
check(
  "replaying another chamber's signed token → 403",
  (await call("/cases", { token: as(`a.admin+${suffix}@a.test`), wsToken: bTok })).status === 403,
);
const forged =
  Buffer.from(JSON.stringify({ sub: "x", wsId: bId, role: "admin", exp: 9999999999 })).toString(
    "base64url",
  ) + ".bad";
check(
  "hand-forged token → 401",
  (await call("/cases", { token: as(`a.admin+${suffix}@a.test`), wsToken: forged })).status === 401,
);
check(
  "switching into an unmapped chamber → 403",
  (
    await call("/session/workspace", {
      token: as(`a.admin+${suffix}@a.test`),
      method: "POST",
      body: { workspaceId: bId },
    })
  ).status === 403,
);

section("Tenant isolation");
const aCases = await call("/cases", { token: as(`a.admin+${suffix}@a.test`), wsToken: aTok });
check(
  "A sees only its own matters",
  aCases.data.every((c) => c.workspaceId === aId) && aCases.data.length === 1,
);
check("no cross-tenant title leak", !aCases.data.some((c) => /Beta confidential/.test(c.title)));
check(
  "fetching B's case by id from A → 404",
  (await call(`/cases/${caseB.data.id}`, { token: as(`a.admin+${suffix}@a.test`), wsToken: aTok }))
    .status === 404,
);
check(
  "search does not leak across tenants",
  (await call(`/search?q=Beta`, { token: as(`a.admin+${suffix}@a.test`), wsToken: aTok })).data
    .cases.length === 0,
);
check(
  "directory is workspace-scoped",
  (await call("/users", { token: as(`b.admin+${suffix}@b.test`), wsToken: bTok })).data.length ===
    1,
);
check(
  "B's admin cannot read A's access list",
  !(
    await call("/workspace/access-list", { token: as(`b.admin+${suffix}@b.test`), wsToken: bTok })
  ).data.some((e) => String(e.value).includes(`+${suffix}@a.test`)),
);

section("Role boundaries within a chamber");
for (const [path, label] of [
  ["/kpi/dashboard", "KPI"],
  ["/invites", "Access Control"],
  ["/workspace/members", "Team roles"],
]) {
  check(
    `senior advocate blocked from ${label} → 403`,
    (await call(path, { token: as(`a.senior+${suffix}@a.test`), wsToken: senior.workspaceToken }))
      .status === 403,
  );
}
check("senior advocate has no kpi.read", !senior.capabilities.includes("kpi.read"));
check(
  "clerk sees only matters they hold a task on",
  (await call("/cases", { token: as(`a.clerk+${suffix}@a.test`), wsToken: clerk.workspaceToken }))
    .data.length === 1,
);
check(
  "client blocked from KPI → 403",
  (
    await call("/kpi/dashboard", {
      token: as(`a.client+${suffix}@a.test`),
      wsToken: client.workspaceToken,
    })
  ).status === 403,
);
check(
  "client cannot create tasks → 403",
  (
    await call("/tasks", {
      token: as(`a.client+${suffix}@a.test`),
      wsToken: client.workspaceToken,
      method: "POST",
      body: { caseId: caseA.data.id, title: "x", deadline: plus(2) },
    })
  ).status === 403,
);

section("Assignment is Admin + Senior Advocate only");
check(
  "admin can assign",
  (
    await call("/tasks", {
      token: as(`a.admin+${suffix}@a.test`),
      wsToken: aTok,
      method: "POST",
      body: { caseId: caseA.data.id, title: "t1", deadline: plus(2) },
    })
  ).status === 201,
);
check(
  "senior advocate can assign",
  (
    await call("/tasks", {
      token: as(`a.senior+${suffix}@a.test`),
      wsToken: senior.workspaceToken,
      method: "POST",
      body: { caseId: caseA.data.id, title: "t2", deadline: plus(2) },
    })
  ).status === 201,
);
check(
  "clerk cannot assign → 403",
  (
    await call("/tasks", {
      token: as(`a.clerk+${suffix}@a.test`),
      wsToken: clerk.workspaceToken,
      method: "POST",
      body: { caseId: caseA.data.id, title: "t3", deadline: plus(2) },
    })
  ).status === 403,
);
check(
  "assigning to a non-member → 400",
  (
    await call("/tasks", {
      token: as(`a.admin+${suffix}@a.test`),
      wsToken: aTok,
      method: "POST",
      body: { caseId: caseA.data.id, title: "t4", assigneeId: B.data.clerkId, deadline: plus(2) },
    })
  ).status === 400,
);

section("Access list still gates sign-in");
check(
  "an uninvited address is refused",
  (await call("/session", { token: as(`stranger+${suffix}@nowhere.test`) })).data.accessStatus ===
    "not_recognised",
);
const dom = await call("/workspace/access-list", {
  token: as(`a.admin+${suffix}@a.test`),
  wsToken: aTok,
  method: "POST",
  body: { kind: "domain", value: `alpha${suffix}.test`, role: "junior_advocate" },
});
check("admin can admit a whole domain", dom.status === 201, `got ${dom.status}`);
const viaDomain = await call("/session", {
  token: as(`anyone@alpha${suffix}.test`, "Domain Joiner"),
});
check("an address at that domain is admitted", viaDomain.data.accessStatus === "active");
check(
  "...at the role the admin set",
  viaDomain.data.role === "junior_advocate",
  `role=${viaDomain.data.role}`,
);
check(
  "a lookalike domain is not",
  (await call("/session", { token: as(`x@alpha${suffix}.tes`) })).data.accessStatus ===
    "not_recognised",
);
check(
  "non-admin cannot write the access list → 403",
  (
    await call("/workspace/access-list", {
      token: as(`a.senior+${suffix}@a.test`),
      wsToken: senior.workspaceToken,
      method: "POST",
      body: { kind: "email", value: "f@x.test", role: "admin" },
    })
  ).status === 403,
);

section("Case restriction has teeth");
// A second matter, also naming the client — "own" scope (cases.clientId) would
// show it to them, which is exactly what the restriction has to override. If
// this leaks, the invite's caseId is decoration rather than an actual filter.
const caseC = await call("/cases", {
  token: as(`a.admin+${suffix}@a.test`),
  wsToken: aTok,
  method: "POST",
  body: {
    title: `Alpha unrelated matter ${suffix}`,
    filingRef: `CV-A2-${suffix}`,
    clientId: clientPre.userId,
  },
});
const clientList = await call("/cases", {
  token: as(`a.client+${suffix}@a.test`),
  wsToken: client.workspaceToken,
});
check(
  "the restricted client sees only the matter they were invited to",
  clientList.data.length === 1 && clientList.data[0].id === caseA.data.id,
  JSON.stringify(clientList.data.map((c) => c.id)),
);
check(
  "...and NOT the other matter naming them as client",
  !clientList.data.some((c) => c.id === caseC.data.id),
);
const directFetch = await call(`/cases/${caseC.data.id}`, {
  token: as(`a.client+${suffix}@a.test`),
  wsToken: client.workspaceToken,
});
check(
  "...fetching it directly by id is a 404, not a 403",
  directFetch.status === 404,
  `got ${directFetch.status}`,
);
check(
  "a non-client role rejects a caseId outright",
  (
    await call("/invites", {
      token: as(`a.admin+${suffix}@a.test`),
      wsToken: aTok,
      method: "POST",
      body: { email: `a.wrongscope+${suffix}@a.test`, role: "clerk_intern", caseId: caseA.data.id },
    })
  ).status === 400,
);
check(
  "a client invite with no caseId is refused, not silently unrestricted",
  (
    await call("/invites", {
      token: as(`a.admin+${suffix}@a.test`),
      wsToken: aTok,
      method: "POST",
      body: { email: `a.norestrict+${suffix}@a.test`, role: "client" },
    })
  ).status === 400,
);
check(
  "a caseId from another chamber is refused (matter not found)",
  (
    await call("/invites", {
      token: as(`a.admin+${suffix}@a.test`),
      wsToken: aTok,
      method: "POST",
      body: { email: `a.crosstenant+${suffix}@a.test`, role: "client", caseId: caseB.data.id },
    })
  ).status === 404,
);

section("Calendar audience");
await call("/calendar", {
  token: as(`a.admin+${suffix}@a.test`),
  wsToken: aTok,
  method: "POST",
  body: { title: `staff-only-${suffix}`, entryDate: plus(1), audience: "staff" },
});
await call("/calendar", {
  token: as(`a.admin+${suffix}@a.test`),
  wsToken: aTok,
  method: "POST",
  body: { title: `everyone-${suffix}`, entryDate: plus(1), audience: "all" },
});
// Clients no longer reach the calendar at all — the stronger property.
const clientCal = await call("/calendar", {
  token: as(`a.client+${suffix}@a.test`),
  wsToken: client.workspaceToken,
});
check(
  "client is refused the calendar outright (403)",
  clientCal.status === 403,
  `got ${clientCal.status}`,
);
// Audience filtering still applies between staff tiers.
const clerkCal = (
  await call("/calendar", { token: as(`a.clerk+${suffix}@a.test`), wsToken: clerk.workspaceToken })
).data.map((e) => e.title);
check(
  "clerk receives staff-only entries",
  clerkCal.includes(`staff-only-${suffix}`),
  JSON.stringify(clerkCal),
);
check("clerk receives everyone entries", clerkCal.includes(`everyone-${suffix}`));
check(
  "B's chamber sees none of A's calendar",
  (await call("/calendar", { token: as(`b.admin+${suffix}@b.test`), wsToken: bTok })).data
    .length === 0,
);

// A bad audience used to return 201 and silently create an entry nobody would
// ever see — audienceIncludes() fails closed on read, so the typo was
// invisible rather than loud. It must now be refused outright.
const badAudience = await call("/calendar", {
  token: as(`a.admin+${suffix}@a.test`),
  wsToken: aTok,
  method: "POST",
  body: { title: `typo-${suffix}`, entryDate: plus(1), audience: "firm" },
});
check(
  "an unrecognised audience is refused, not silently created (400)",
  badAudience.status === 400 && badAudience.data?.error === "invalid_audience",
  `got ${badAudience.status} ${JSON.stringify(badAudience.data)}`,
);
const badRole = await call("/calendar", {
  token: as(`a.admin+${suffix}@a.test`),
  wsToken: aTok,
  method: "POST",
  body: { title: `bad-role-${suffix}`, entryDate: plus(1), audience: "role:advocate" },
});
check("...and so is a role that does not exist", badRole.status === 400, `got ${badRole.status}`);
const badUser = await call("/calendar", {
  token: as(`a.admin+${suffix}@a.test`),
  wsToken: aTok,
  method: "POST",
  body: { title: `bad-user-${suffix}`, entryDate: plus(1), audience: "user:nobody-here" },
});
check("...and so is a user outside the workspace", badUser.status === 400, `got ${badUser.status}`);
const goodUser = await call("/calendar", {
  token: as(`a.admin+${suffix}@a.test`),
  wsToken: aTok,
  method: "POST",
  body: { title: `real-user-${suffix}`, entryDate: plus(1), audience: `user:${clerk.clerkId}` },
});
check(
  "...but a real member of the workspace is accepted",
  goodUser.status === 201,
  `got ${goodUser.status} ${JSON.stringify(goodUser.data)}`,
);

/* ── A malformed id is refused, never handed to the database ──────────────── */
section("An id that cannot exist is refused before it reaches a query");

/*
 * Found by probing rather than by reading, which is why it is pinned here.
 *
 * Two spellings got through. `drafting.ts` parsed `Number(req.params.id)` with
 * no check at all, so "abc" arrived as NaN. Everywhere else guarded with
 * `Number.isInteger`, which passes 9007199254740993 — an integer to JavaScript,
 * and eleven digits wider than the `integer` column it was about to be compared
 * against. Both ended the same way: `invalid input syntax for type integer`,
 * surfaced as a 500.
 *
 * A 500 here is worth closing for two reasons beyond tidiness. It tells a prober
 * their input reached the database, and it buries genuine faults under noise
 * that anyone can generate from a URL bar.
 *
 * The routes below are deliberately a mix: some validate with `parseId`, some
 * with the GENERATED zod params (which cannot express "integer" — orval renders
 * `type: integer` as `zod.coerce.number()`), and those are covered by the
 * `router.param` guard instead. Both mechanisms have to hold.
 */
const adminToken = as(`a.admin+${suffix}@a.test`);
const MALFORMED = [
  ["1.5", "a decimal"],
  ["9007199254740993", "past MAX_SAFE_INTEGER"],
  ["2147483648", "one past the int4 ceiling"],
  ["abc", "not a number"],
  ["-1", "negative"],
  ["0", "zero — every table's identity starts at 1"],
  ["1e3", "exponent notation"],
  ["null", "the string null"],
];
const ID_ROUTES = [
  ["GET", "/cases/ID", undefined],
  ["GET", "/cases/ID/timeline", undefined],
  ["GET", "/cases/ID/documents", undefined],
  ["GET", "/tasks/ID", undefined],
  ["POST", "/tasks/ID/complete", {}],
  ["GET", "/consultations/ID", undefined],
  ["GET", "/invoices/ID", undefined],
  ["GET", "/drafts/ID", undefined],
  ["DELETE", "/insights/ID", undefined],
  ["GET", "/documents/ID/content", undefined],
  ["GET", "/memberships/ID/case-access", undefined],
];

let idFailures = [];
for (const [method, tpl, body] of ID_ROUTES) {
  for (const [value, why] of MALFORMED) {
    const r = await call(tpl.replace("ID", value), {
      token: adminToken,
      wsToken: aTok,
      method,
      body,
    });
    if (r.status >= 500) idFailures.push(`${method} ${tpl.replace("ID", value)} (${why}) -> 500`);
  }
}
check(
  `no malformed id produces a server error (${ID_ROUTES.length} routes x ${MALFORMED.length} spellings)`,
  idFailures.length === 0,
  idFailures.slice(0, 6).join(" ; "),
);

/*
 * The same rule for the header that selects the workspace.
 *
 * A present-but-unreadable `X-Workspace-Id` used to fall through to "your only
 * membership", so the server answered 200 from a DIFFERENT workspace than the
 * one asked for. `X-Workspace-Id: undefined` is the ordinary shape of a
 * client-side bug, and it read and wrote the wrong chamber for anyone in one
 * chamber while 403ing for anyone in two — the worst combination, because the
 * people who would notice are the ones it refuses.
 */
const headerFailures = [];
for (const value of ["undefined", "null", "NaN", "1.5", "-1", "0", "1 OR 1=1", "1 2", "1e9"]) {
  const r = await call("/cases", { token: adminToken, wsId: value });
  if (r.status === 200) headerFailures.push(`${JSON.stringify(value)} -> 200`);
}
check(
  "an unreadable X-Workspace-Id is refused rather than falling back to a different workspace",
  headerFailures.length === 0,
  headerFailures.join(" ; "),
);

const goodHeader = await call("/cases", { token: adminToken, wsToken: aTok });
check(
  "...while a well-formed request still works",
  goodHeader.status === 200,
  `got ${goodHeader.status}`,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
