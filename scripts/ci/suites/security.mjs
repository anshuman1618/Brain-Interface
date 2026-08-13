// Zero-trust regression suite, rebuilt to bootstrap its own data now that the
// platform ships empty. Same adversarial checks as before, no fixtures.
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
await call("/invites", {
  token: as(`a.admin+${suffix}@a.test`),
  wsToken: aTok,
  method: "POST",
  body: { email: `a.client+${suffix}@a.test`, role: "client" },
});
const senior = (await call("/session", { token: as(`a.senior+${suffix}@a.test`, "A Senior") }))
  .data;
const clerk = (await call("/session", { token: as(`a.clerk+${suffix}@a.test`, "A Clerk") })).data;
const client = (await call("/session", { token: as(`a.client+${suffix}@a.test`, "A Client") }))
  .data;

const caseA = await call("/cases", {
  token: as(`a.admin+${suffix}@a.test`),
  wsToken: aTok,
  method: "POST",
  body: { title: `Alpha matter ${suffix}`, filingRef: `CV-A-${suffix}`, clientId: client.userId },
});
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
