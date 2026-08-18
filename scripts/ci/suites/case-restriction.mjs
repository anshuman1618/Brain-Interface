// "Restrict to Case ID" via the direct access-list path (not invites.ts).
// security.mjs already covers the invite path; this covers the second door —
// POST /workspace/access-list — which reconcileAccessList also feeds into.
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
const owner = `restrict.owner+${suffix}@r.test`;
const clientEmail = `restrict.client+${suffix}@r.test`;

const founded = await call("/workspaces", {
  token: as(owner, "Owner"),
  method: "POST",
  body: { name: `Restriction Chambers ${suffix}`, role: "admin" },
});
const ws = founded.data.workspaceToken;
check("chamber founded", founded.status === 201, `got ${founded.status}`);

// User row exists from the first authenticated call regardless of admission.
const clientPre = (await call("/session", { token: as(clientEmail, "Client") })).data;

const caseA = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { title: "Matter A", filingRef: `CV-R-${suffix}-A`, clientId: clientPre.userId },
});
const caseB = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { title: "Matter B", filingRef: `CV-R-${suffix}-B`, clientId: clientPre.userId },
});

/* ─────────── The access-list path enforces the same rule as invites ─────────── */
section("POST /workspace/access-list enforces the restriction, not just invites.ts");

const nonClientWithCase = await call("/workspace/access-list", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: {
    kind: "email",
    value: `norole+${suffix}@r.test`,
    role: "clerk_intern",
    caseId: caseA.data.id,
  },
});
check(
  "a non-client entry with a caseId is refused (400)",
  nonClientWithCase.status === 400,
  `got ${nonClientWithCase.status}`,
);

const clientNoCase = await call("/workspace/access-list", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { kind: "email", value: `noCase+${suffix}@r.test`, role: "client" },
});
check(
  "a client entry with no caseId is refused (400)",
  clientNoCase.status === 400,
  `got ${clientNoCase.status}`,
);

const clientBadCase = await call("/workspace/access-list", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { kind: "email", value: `badCase+${suffix}@r.test`, role: "client", caseId: 9_999_999 },
});
check(
  "a caseId that does not exist in this workspace is refused (404)",
  clientBadCase.status === 404,
  `got ${clientBadCase.status}`,
);

const clientGood = await call("/workspace/access-list", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { kind: "email", value: clientEmail, role: "client", caseId: caseA.data.id },
});
check(
  "a valid client entry is accepted (201)",
  clientGood.status === 201,
  `got ${clientGood.status}`,
);
check("...and the response carries the caseId back", clientGood.data?.caseId === caseA.data.id);

/* ─────────── The restriction actually filters, via THIS path ─────────── */
section("The restriction actually filters visibility");

const clientSession = await call("/session", { token: as(clientEmail, "Client") });
check(
  "the client is admitted",
  clientSession.data.accessStatus === "active",
  clientSession.data.accessStatus,
);
const clientWs = clientSession.data.workspaceToken;

const clientCases = await call("/cases", { token: as(clientEmail), wsToken: clientWs });
check(
  "the client sees only Matter A",
  clientCases.data.length === 1 && clientCases.data[0].id === caseA.data.id,
  JSON.stringify(clientCases.data.map((c) => c.id)),
);
check(
  "...NOT Matter B, though cases.clientId also names them there",
  !clientCases.data.some((c) => c.id === caseB.data.id),
);

const directB = await call(`/cases/${caseB.data.id}`, {
  token: as(clientEmail),
  wsToken: clientWs,
});
check(
  "fetching Matter B directly is 404, not 403",
  directB.status === 404,
  `got ${directB.status}`,
);

const directA = await call(`/cases/${caseA.data.id}`, {
  token: as(clientEmail),
  wsToken: clientWs,
});
check("fetching Matter A directly succeeds", directA.status === 200, `got ${directA.status}`);

/* ─────────── GET /workspace/access-list surfaces the restriction ─────────── */
section("The admin can see who is restricted to what");
const list = await call("/workspace/access-list", { token: as(owner), wsToken: ws });
const entry = list.data.find((e) => e.value === clientEmail);
check("the entry round-trips its caseId", entry?.caseId === caseA.data.id, JSON.stringify(entry));

console.log(`\n${fail === 0 ? "✓" : "✗"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
