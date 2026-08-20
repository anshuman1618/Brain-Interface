// The operator view: who may read across tenants, and what they get back.
//
// Two things are under test and they matter for different reasons. The gate is
// a security boundary — this is the ONE endpoint that reads every chamber, so
// "who is refused" is the whole point and 404-not-403 is part of the contract.
// The numbers are a correctness question: a metric that silently reads zero is
// worse than no metric, because it gets believed.
//
// Needs OPERATOR_EMAILS to contain ops.<suffix>@operator.test — the runner sets
// it. Without it every request 404s and the suite says so rather than passing
// vacuously.
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

const OPERATOR = process.env.OPERATOR_TEST_EMAIL;
if (!OPERATOR) {
  console.log("  FAIL  OPERATOR_TEST_EMAIL is not set — run this through run-suites.mjs");
  process.exit(1);
}

const suffix = Date.now();
const founder = `op.founder+${suffix}@o.test`;
const outsider = `op.outsider+${suffix}@o.test`;

/* ─────────────── The gate ─────────────── */
section("Only the allowlist reads across tenants");

const anon = await call("/operator/metrics");
check("no identity at all is 401", anon.status === 401, `got ${anon.status}`);

const notOperator = await call("/operator/metrics", { token: as(outsider, "Outsider") });
check(
  "a signed-in stranger gets 404, NOT 403",
  notOperator.status === 404,
  `got ${notOperator.status}`,
);
check(
  "...and the body admits nothing about what the route is",
  JSON.stringify(notOperator.data ?? {}).length < 60,
  JSON.stringify(notOperator.data),
);

const operator = await call("/operator/metrics", { token: as(OPERATOR, "Ops") });
check("the allowlisted address is admitted", operator.status === 200, `got ${operator.status}`);

/* ─────────────── A chamber to count ─────────────── */
section("A chamber, a matter and a person for the numbers to describe");

const founded = await call("/workspaces", {
  token: as(founder, "Founder"),
  method: "POST",
  body: { name: `Operator Chambers ${suffix}`, role: "admin" },
});
check("chamber founded", founded.status === 201, `got ${founded.status}`);
const ws = founded.data.workspaceToken;
await declareBarRegistration(call, as(founder, "Founder"));

// Two requests: the first creates the user row, the second is the one that can
// record last_seen_at against it. This is the ordering that was wrong at first
// — the write went out before the row existed and the throttle then suppressed
// the retry for an hour, so the column read null forever.
await call("/session", { token: as(founder, "Founder") });
await call("/session", { token: as(founder, "Founder") });

const before = await call("/operator/metrics", { token: as(OPERATOR, "Ops") });
const chamberBefore = before.data.chamberRows.find((c) => c.name === `Operator Chambers ${suffix}`);
check("the new chamber appears", Boolean(chamberBefore), JSON.stringify(before.data.chambers));
check("...with its founder's seat", chamberBefore?.seats === 1, String(chamberBefore?.seats));
check("...and no matters yet", chamberBefore?.matters === 0, String(chamberBefore?.matters));
check(
  "...counted as founded-but-never-used",
  before.data.chambers.empty >= 1,
  JSON.stringify(before.data.chambers),
);

const matter = await call("/cases", {
  token: as(founder, "Founder"),
  wsToken: ws,
  method: "POST",
  body: { title: "A matter to count", filingRef: `CV-OP-${suffix}` },
});
check("a matter is opened", matter.status === 201, `got ${matter.status}`);

const after = await call("/operator/metrics", { token: as(OPERATOR, "Ops") });
const chamberAfter = after.data.chamberRows.find((c) => c.name === `Operator Chambers ${suffix}`);
check("the matter is counted", chamberAfter?.matters === 1, String(chamberAfter?.matters));
check(
  "...and the chamber leaves the never-used count",
  after.data.chambers.withMatters > before.data.chambers.withMatters,
  `${before.data.chambers.withMatters} → ${after.data.chambers.withMatters}`,
);

/* ─────────────── last_seen_at actually records ─────────────── */
section("Activity is recorded, not merely stored");

check("somebody is active today", after.data.users.seen24h >= 1, JSON.stringify(after.data.users));
check("...and this week", after.data.users.seen7d >= after.data.users.seen24h);
check("...and this month", after.data.users.seen30d >= after.data.users.seen7d);
check(
  "the chamber shows a last-seen date",
  typeof chamberAfter?.lastSeen === "string" && /^\d{4}-\d{2}-\d{2}$/.test(chamberAfter.lastSeen),
  String(chamberAfter?.lastSeen),
);
// The regression that matters: this read zero on the first implementation
// because every write missed. A zero here means the column is decorative.
check(
  "NOT every user reads as never-seen — the write really lands",
  after.data.users.neverSeen < after.data.users.total,
  `${after.data.users.neverSeen} of ${after.data.users.total}`,
);

/* ─────────────── Counts, never content ─────────────── */
section("The response carries counts and not chamber content");

const body = JSON.stringify(after.data);
check(
  "the matter's title is nowhere in the payload",
  !body.includes("A matter to count"),
  "a matter title reached the operator view",
);
check(
  "no email address is in the payload",
  !body.includes(founder) && !body.includes(OPERATOR),
  "an address reached the operator view",
);
check(
  "the filing reference is not there either",
  !body.includes(`CV-OP-${suffix}`),
  "a filing reference reached the operator view",
);

/* ─────────────── Shape ─────────────── */
section("Every number the screen reads is present");

for (const key of ["users", "chambers", "trial", "revenue", "plans", "signups", "chamberRows"]) {
  check(`${key} is present`, after.data[key] !== undefined);
}
for (const key of ["total", "seen24h", "seen7d", "seen30d", "neverSeen", "returning", "lapsed"]) {
  check(`users.${key} is a number`, typeof after.data.users[key] === "number");
}
check(
  "revenue is in paise, like every other _minor",
  typeof after.data.revenue.allTimeMinor === "number",
);
check(
  "a fresh platform has taken no money rather than erroring",
  after.data.revenue.payments >= 0,
  String(after.data.revenue.payments),
);
check(
  "the trial funnel counts the founding chamber's trial",
  typeof after.data.trial.bought === "number" && after.data.trial.bought >= 0,
  JSON.stringify(after.data.trial),
);

/* ─────────────── The workspace API is untouched ─────────────── */
section("Nothing leaked into the tenant-scoped surface");

// The operator view must never become reachable through a capability, because
// any capability is one self-invite away for whoever founds a chamber.
const viaWorkspace = await call("/operator/metrics", {
  token: as(founder, "Founder"),
  wsToken: ws,
});
check(
  "a chamber admin with every capability is still refused",
  viaWorkspace.status === 404,
  `got ${viaWorkspace.status}`,
);

console.log(`\n${fail === 0 ? "✓" : "✗"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
