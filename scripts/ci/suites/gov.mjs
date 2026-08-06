// Files, audit, quota, rate limits, privacy, conflicts.
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

async function call(path, { token, wsToken, method = "GET", body, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (wsToken) h["x-workspace-token"] = wsToken;
  if (body && !raw) h["content-type"] = "application/json";
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("json")) {
    try {
      data = await res.json();
    } catch {}
  } else data = Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, headers: res.headers };
}

const S = Date.now();
const owner = `gov.owner${S}@chambers.test`;
const clerk = `gov.clerk${S}@chambers.test`;
const client = `gov.client${S}@x.test`;

section("Setup");
const made = await call("/workspaces", {
  token: as(owner, "G Owner"),
  method: "POST",
  body: { name: `Gov Chambers ${S}`, role: "admin" },
});
check("chamber created", made.status === 201, `got ${made.status}`);
const ws = made.data.workspaceToken;

for (const [email, role] of [
  [clerk, "clerk_intern"],
  [client, "client"],
]) {
  await call("/invites", { token: as(owner), wsToken: ws, method: "POST", body: { email, role } });
}
const clerkS = (await call("/session", { token: as(clerk, "G Clerk") })).data;
const clientS = (await call("/session", { token: as(client, "G Client") })).data;

const matter = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { title: "Persistent matter", clientId: clientS.userId },
});
check("matter created", matter.status === 201, `got ${matter.status}`);
const CASE = matter.data.id;

/* ─────────────────────────────── 1. FILES ─────────────────────────────── */
section("1. Documents hold real bytes");
const pdf = Buffer.from("%PDF-1.4\nthis is a real affidavit\n%%EOF");
const up = await call(`/cases/${CASE}/documents/content`, {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  raw: true,
  body: pdf,
  headers: {
    "content-type": "application/pdf",
    "x-document-name": encodeURIComponent("Affidavit.pdf"),
  },
});
check(
  "upload accepted",
  up.status === 201,
  `got ${up.status} ${JSON.stringify(up.data)?.slice(0, 120)}`,
);
check("size recorded", up.data.fileSize === pdf.length, String(up.data?.fileSize));
check("checksum recorded", typeof up.data.checksum === "string" && up.data.checksum.length === 64);
check(
  "storage key is server-generated, not the filename",
  up.data.storagePath && !up.data.storagePath.includes("Affidavit"),
  up.data?.storagePath,
);

const dl = await call(`/documents/${up.data.id}/content`, { token: as(owner), wsToken: ws });
check(
  "download returns the same bytes",
  dl.status === 200 && Buffer.compare(dl.data, pdf) === 0,
  `got ${dl.status} ${dl.data?.length} bytes`,
);
check("served as an attachment", /attachment/.test(dl.headers.get("content-disposition") || ""));
check("with nosniff", dl.headers.get("x-content-type-options") === "nosniff");

const evil = await call(`/cases/${CASE}/documents/content`, {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  raw: true,
  body: Buffer.from("<script>alert(1)</script>"),
  headers: { "content-type": "text/html", "x-document-name": encodeURIComponent("x.html") },
});
check("an HTML upload is refused (415)", evil.status === 415, `got ${evil.status}`);

const traversal = await call(`/cases/${CASE}/documents/content`, {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  raw: true,
  body: Buffer.from("x"),
  headers: {
    "content-type": "text/plain",
    "x-document-name": encodeURIComponent("../../../etc/passwd"),
  },
});
check(
  "a traversal filename is neutralised",
  traversal.status === 201 &&
    !traversal.data.name.includes("/") &&
    !traversal.data.name.includes(".."),
  traversal.data?.name,
);

const firmOnly = await call(`/documents/${up.data.id}/content`, {
  token: as(client),
  wsToken: clientS.workspaceToken,
});
check(
  "a client cannot download firm-internal bytes (404)",
  firmOnly.status === 404,
  `got ${firmOnly.status}`,
);

/* ─────────────────────────────── 2. AUDIT ─────────────────────────────── */
section("2. Audit log records privileged actions");
const audit = await call("/workspace/audit", { token: as(owner), wsToken: ws });
check("readable by the owner", audit.status === 200, `got ${audit.status}`);
const actions = audit.data.map((a) => a.action);
for (const a of ["workspace.created", "case.created", "document.uploaded", "document.downloaded"]) {
  check(`records ${a}`, actions.includes(a), actions.join(","));
}
check(
  "entries carry a human summary",
  audit.data.every((a) => typeof a.summary === "string" && a.summary.length > 0),
);
check(
  "IP is truncated, not stored whole",
  audit.data.every((a) => a.ip === null || /x$|\/48$/.test(a.ip)),
  JSON.stringify(audit.data.map((a) => a.ip).slice(0, 3)),
);

const clerkAudit = await call("/workspace/audit", {
  token: as(clerk),
  wsToken: clerkS.workspaceToken,
});
check(
  "a clerk cannot read the audit log (403)",
  clerkAudit.status === 403,
  `got ${clerkAudit.status}`,
);
const clientAudit = await call("/workspace/audit", {
  token: as(client),
  wsToken: clientS.workspaceToken,
});
check("a client cannot either (403)", clientAudit.status === 403, `got ${clientAudit.status}`);

/* ─────────────────────────────── 3. QUOTA ─────────────────────────────── */
section("3. Plan limits are enforced, not advertised");
const usage0 = await call("/workspace/usage", { token: as(owner), wsToken: ws });
check(
  "usage readable",
  usage0.status === 200 && usage0.data.plan === "starter",
  JSON.stringify(usage0.data),
);
check("starter caps matters at 5", usage0.data.matters.limit === 5);
check("starter caps seats at 2", usage0.data.seats.limit === 2);

// One matter exists; add four more to reach the cap.
for (let i = 2; i <= 5; i++) {
  await call("/cases", {
    token: as(owner),
    wsToken: ws,
    method: "POST",
    body: { title: `Matter ${i}` },
  });
}
const sixth = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { title: "Sixth" },
});
check("the 6th matter is refused (402)", sixth.status === 402, `got ${sixth.status}`);
check(
  "...with a message naming the plan and number",
  /Starter/.test(sixth.data?.message ?? "") && /5/.test(sixth.data?.message ?? ""),
  sixth.data?.message,
);

// Closing one frees a slot.
await call(`/cases/${CASE}`, {
  token: as(owner),
  wsToken: ws,
  method: "PATCH",
  body: { status: "closed" },
});
const afterClose = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { title: "After closing" },
});
check("closing a matter frees the slot", afterClose.status === 201, `got ${afterClose.status}`);

// Seats: owner + clerk + client = 3 already, so the cap is already exceeded
// for a NEW approval. Upgrade and confirm the cap moves.
await call("/workspace/subscription", {
  token: as(owner),
  wsToken: ws,
  method: "PUT",
  body: { plan: "firm", billingPeriod: "yearly" },
});
const usage1 = await call("/workspace/usage", { token: as(owner), wsToken: ws });
check(
  "upgrading lifts the matter cap",
  usage1.data.matters.limit === null,
  JSON.stringify(usage1.data.matters),
);
check("...and the seat cap", usage1.data.seats.limit === null);
const seventh = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { title: "Now allowed" },
});
check("matters flow again on Firm", seventh.status === 201, `got ${seventh.status}`);

/* ────────────────────────────── 4. CONFLICTS ──────────────────────────── */
section("4. Conflict of interest is screened before a matter opens");
await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { title: "Kulkarni estate", opposingParty: "Mehra and Sons Pvt Ltd" },
});
const clash = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { title: "New file", opposingParty: "M/s Mehra & Sons Private Limited" },
});
check("a matching opposing party is refused (409)", clash.status === 409, `got ${clash.status}`);
check(
  "...and says who it clashes with",
  (clash.data?.hits ?? []).length > 0,
  JSON.stringify(clash.data?.hits),
);

const noNote = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: {
    title: "New file",
    opposingParty: "M/s Mehra & Sons Private Limited",
    conflictAcknowledged: true,
  },
});
check(
  "acknowledging without a reason is refused (400)",
  noNote.status === 400,
  `got ${noNote.status}`,
);

const proceed = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: {
    title: "New file",
    opposingParty: "M/s Mehra & Sons Private Limited",
    conflictAcknowledged: true,
    conflictNote: "Different entity; confirmed with the client.",
  },
});
check("proceeding with a reason is allowed", proceed.status === 201, `got ${proceed.status}`);
check(
  "the reason is stored on the matter",
  proceed.data.conflictNote?.includes("Different entity"),
);

const audit2 = await call("/workspace/audit", { token: as(owner), wsToken: ws });
check(
  "the override is in the audit log",
  audit2.data.some((a) => a.action === "case.conflict_acknowledged"),
  audit2.data.map((a) => a.action).join(","),
);

const clear = await call("/cases/conflict-check", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { opposingParty: "Zephyr Logistics" },
});
check(
  "an unrelated party screens clear",
  clear.status === 200 && clear.data.hits.length === 0,
  JSON.stringify(clear.data),
);

/* ────────────────────────────── 5. PRIVACY ────────────────────────────── */
section("5. DPDP export and erasure");
const exp = await call("/privacy/export", { token: as(client), wsToken: clientS.workspaceToken });
check("a client can export their own data", exp.status === 200, `got ${exp.status}`);
check("...naming them", exp.data.subject?.email === client, JSON.stringify(exp.data?.subject));
check("...with their matters", Array.isArray(exp.data.cases));
check(
  "...and no internal storage keys leak",
  !JSON.stringify(exp.data.documents ?? []).includes("storagePath"),
);

const er = await call("/privacy/erasure", {
  token: as(client),
  wsToken: clientS.workspaceToken,
  method: "POST",
  body: { reason: "No longer a client" },
});
check("erasure can be requested", er.status === 201, `got ${er.status}`);
const dup = await call("/privacy/erasure", {
  token: as(client),
  wsToken: clientS.workspaceToken,
  method: "POST",
  body: {},
});
check("only one request at a time (409)", dup.status === 409, `got ${dup.status}`);

const clientSees = await call("/privacy/erasure", {
  token: as(client),
  wsToken: clientS.workspaceToken,
});
check("a client sees only their own request", clientSees.data.length === 1);
const clerkDecide = await call(`/privacy/erasure/${er.data.id}`, {
  token: as(clerk),
  wsToken: clerkS.workspaceToken,
  method: "PATCH",
  body: { decision: "complete" },
});
check(
  "a clerk cannot decide an erasure (403)",
  clerkDecide.status === 403,
  `got ${clerkDecide.status}`,
);

const done = await call(`/privacy/erasure/${er.data.id}`, {
  token: as(owner),
  wsToken: ws,
  method: "PATCH",
  body: { decision: "complete", note: "Erased on request." },
});
check(
  "the owner can complete it",
  done.status === 200 && done.data.status === "completed",
  `got ${done.status}`,
);

const afterErase = await call("/session", { token: as(client) });
check(
  "the erased account reaches nothing",
  afterErase.data.accessStatus !== "active",
  afterErase.data?.accessStatus,
);
const auditAfter = await call("/workspace/audit", { token: as(owner), wsToken: ws });
check(
  "the erasure itself is logged",
  auditAfter.data.some((a) => a.action === "erasure.completed"),
);
check(
  "...and the matters survive",
  (await call("/cases", { token: as(owner), wsToken: ws })).data.length > 0,
);

/* ───────────────────────────── 6. RATE LIMIT ──────────────────────────── */
section("6. Rate limiting");
let limited = 0,
  ok = 0;
for (let i = 0; i < 45; i++) {
  const r = await call("/session", { token: as(`flood${S}.${i}@nowhere.test`) });
  if (r.status === 429) limited++;
  else ok++;
}
check("the sign-in path is throttled", limited > 0, `${ok} allowed, ${limited} limited`);
const probe = await call("/session", { token: as(`flood${S}.0@nowhere.test`) });
check("429 carries Retry-After", probe.status !== 429 || probe.headers.get("retry-after") !== null);
check("...and RateLimit headers are present", probe.headers.get("ratelimit-limit") !== null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
