/**
 * Is this deployment actually up, actually configured, and actually locked down?
 *
 * Phase 5 of docs/GO-LIVE-PLAN.md as one command. It exists because the
 * hardening checks in DEPLOYMENT.md §7 are fifteen separate curls whose output
 * you have to interpret, and the failure mode is not "one of them errors" — it
 * is "you ran twelve, got bored, and never checked CORS".
 *
 *   node scripts/ci/production-smoke.mjs https://app.example.com
 *
 * Exits non-zero if anything FAILED, so it can gate a release. Warnings do not
 * fail the run: a feature you deliberately left off is not a broken deployment.
 *
 * Safe to run against production. Every request is a GET, HEAD, or an
 * unauthenticated POST that is expected to be refused — nothing is written and
 * no account is needed.
 */

const BASE = (process.argv[2] ?? process.env["BASE_URL"] ?? "").replace(/\/$/, "");

if (!BASE) {
  console.error(`
Usage: node scripts/ci/production-smoke.mjs <url>

  e.g. node scripts/ci/production-smoke.mjs https://app.lexpractice.in

Checks a deployed instance: that it is up, what it has configured, and that
the security boundary holds. Exits 1 if any check FAILS.
`);
  process.exit(2);
}

if (!BASE.startsWith("https://") && !BASE.startsWith("http://localhost")) {
  console.error(`Refusing to test ${BASE} over plain HTTP — use https://.`);
  process.exit(2);
}

/* ── result collection ──────────────────────────────────────────────────── */

const results = [];
const pass = (name, detail = "") => results.push({ state: "PASS", name, detail });
const fail = (name, detail = "") => results.push({ state: "FAIL", name, detail });
const warn = (name, detail = "") => results.push({ state: "WARN", name, detail });
const info = (name, detail = "") => results.push({ state: "INFO", name, detail });

let section = "";
const sections = [];
const heading = (t) => {
  section = t;
  sections.push({ t, from: results.length });
};

/** fetch that never throws — a connection error is a result, not a crash. */
async function req(path, init = {}) {
  const url = `${BASE}${path}`;
  try {
    const res = await fetch(url, { redirect: "manual", ...init });
    const body = await res.text().catch(() => "");
    return { ok: true, status: res.status, headers: res.headers, body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ── 1. Is it up at all? ────────────────────────────────────────────────── */

heading("1. Reachable");

const health = await req("/api/healthz");
if (!health.ok) {
  fail("the host answers", health.error);
  report();
  process.exit(1);
}
health.status === 200
  ? pass("/api/healthz answers 200")
  : fail("/api/healthz answers 200", `got ${health.status}`);

/* ── 2. What is actually configured ─────────────────────────────────────── */

heading("2. Configuration, as the server reports it");

const ready = await req("/api/readyz");
let checks = null;
try {
  // The payload is { status, checks: {...} } — everything below lives under
  // `checks`, not at the top level.
  const payload = JSON.parse(ready.body ?? "{}");
  checks = payload.checks ?? null;
  if (!checks) fail("/api/readyz returns a checks object", (ready.body ?? "").slice(0, 120));
} catch {
  fail("/api/readyz returns JSON", (ready.body ?? "").slice(0, 120));
}

if (checks) {
  // Fatal: the app cannot serve without these.
  checks.database === "ok"
    ? pass("database reachable")
    : fail("database reachable", checks.databaseError ?? `got "${checks.database}"`);

  checks.frontendBuilt
    ? pass("frontend bundle is present")
    : fail("frontend bundle is present", "the SPA was not built into the image");

  checks.filesEncrypted
    ? pass("uploaded files are encrypted at rest")
    : fail("uploaded files are encrypted at rest", "FILE_ENCRYPTION_KEY is not set");

  checks.nodeEnv === "production"
    ? pass('NODE_ENV is "production"')
    : fail('NODE_ENV is "production"', `got "${checks.nodeEnv}" — HSTS and CORS defaults are off`);

  // Warnings: a real deployment choice, not a fault. Each names what is inert.
  checks.workspaceTokenSecretSet
    ? pass("workspace token secret is set")
    : warn("workspace token secret is set", "unset — every restart signs everyone out");

  checks.emailConfigured
    ? pass("outbound email configured")
    : warn("outbound email configured", 'unset — reminders are stored "suppressed" and never sent');

  checks.paymentsConfigured
    ? pass("payments configured")
    : warn("payments configured", "unset — the plan screen charges nothing");

  checks.errorReportingConfigured
    ? pass("error reporting configured")
    : warn("error reporting configured", "unset — you find out about faults from a customer");

  if (checks.commit) info("deployed commit", checks.commit);
}

/* ── 3. The security boundary ───────────────────────────────────────────── */

heading("3. Locked down");

// Protected endpoints must refuse an unauthenticated caller. 401/403 both fine
// — what must never happen is 200.
for (const path of ["/api/cases", "/api/tasks", "/api/documents", "/api/session"]) {
  const r = await req(path);
  if (!r.ok) {
    fail(`${path} refuses an anonymous caller`, r.error);
  } else if (r.status === 401 || r.status === 403) {
    pass(`${path} refuses an anonymous caller`, String(r.status));
  } else {
    fail(`${path} refuses an anonymous caller`, `got ${r.status} — EXPECTED 401 or 403`);
  }
}

// Reflecting an arbitrary Origin with credentials lets any site issue
// authenticated requests using a signed-in user's cookie.
const cors = await req("/api/healthz", { headers: { Origin: "https://evil.example" } });
if (cors.ok) {
  const allow = cors.headers.get("access-control-allow-origin");
  if (!allow) {
    pass("CORS does not reflect an arbitrary origin", "no header (same-origin deployment)");
  } else if (allow === "https://evil.example" || allow === "*") {
    fail("CORS does not reflect an arbitrary origin", `echoed "${allow}" — ANY SITE CAN CALL THIS`);
  } else {
    pass("CORS does not reflect an arbitrary origin", `allows only ${allow}`);
  }
}

// The webhook authenticates by signature. An unsigned POST must be refused, or
// anyone can activate a subscription for free.
const hook = await req("/api/billing/webhook", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ event: "payment.captured" }),
});
if (hook.ok) {
  hook.status >= 400 && hook.status < 500
    ? pass("unsigned payment webhook is refused", String(hook.status))
    : fail("unsigned payment webhook is refused", `got ${hook.status} — EXPECTED 4xx`);
}

// A typo'd API path must not fall through to the SPA and return 200 HTML.
const missing = await req("/api/definitely-not-a-real-endpoint");
if (missing.ok) {
  missing.status === 404
    ? pass("unknown API paths 404 in JSON")
    : fail("unknown API paths 404 in JSON", `got ${missing.status}`);
}

/* ── 4. Headers ─────────────────────────────────────────────────────────── */

heading("4. Security headers");

const root = await req("/", { method: "HEAD" });
if (root.ok) {
  const required = {
    "strict-transport-security": "HSTS — set NODE_ENV=production, and check more than HSTS",
    "x-content-type-options": "MIME sniffing protection",
    "x-frame-options": "clickjacking protection",
    "referrer-policy": "referrer leakage",
  };
  for (const [header, why] of Object.entries(required)) {
    root.headers.get(header)
      ? pass(`${header} present`)
      : fail(`${header} present`, `missing — ${why}`);
  }

  // Not yet implemented; see docs/GO-LIVE-PLAN.md. Reported so it is visible
  // rather than forgotten.
  root.headers.get("content-security-policy")
    ? pass("content-security-policy present")
    : warn("content-security-policy present", "not set — needs the header at a CDN");
}

/* ── 5. What must be readable without an account ────────────────────────── */

heading("5. Public documents");

for (const [path, label] of [
  ["/legal/terms", "terms of service"],
  ["/legal/privacy", "privacy policy"],
  ["/legal/notice", "data protection notice"],
  ["/legal/dpa", "processing agreement"],
]) {
  const r = await req(path);
  if (!r.ok) {
    fail(`${label} is readable`, r.error);
  } else if (r.status !== 200) {
    fail(`${label} is readable`, `got ${r.status}`);
  } else if (/\[[A-Z][A-Z ]+\]/.test(r.body ?? "")) {
    // The drafts ship with [SQUARE BRACKET] placeholders. Serving one to a real
    // user is worse than a 404, because it looks finished.
    const found = (r.body ?? "").match(/\[[A-Z][A-Z ]+\]/g) ?? [];
    fail(`${label} has no unfilled placeholders`, [...new Set(found)].slice(0, 4).join(" "));
  } else {
    pass(`${label} is readable and complete`);
  }
}

// The SPA itself must be served to a signed-out visitor, not bounced to Clerk.
const spa = await req("/");
if (spa.ok) {
  spa.status === 200
    ? pass("the app shell is served to a signed-out visitor")
    : fail("the app shell is served to a signed-out visitor", `got ${spa.status}`);
}

/* ── report ─────────────────────────────────────────────────────────────── */

function report() {
  const C = process.stdout.isTTY
    ? { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" }
    : { g: "", r: "", y: "", d: "", b: "", x: "" };
  const paint = { PASS: C.g, FAIL: C.r, WARN: C.y, INFO: C.d };

  console.log(`\n${C.b}LEX Practice — production smoke test${C.x}`);
  console.log(`${C.d}${BASE}${C.x}`);

  for (let i = 0; i < sections.length; i++) {
    const { t, from } = sections[i];
    const to = sections[i + 1]?.from ?? results.length;
    if (to === from) continue;
    console.log(`\n${C.b}${t}${C.x}`);
    for (const r of results.slice(from, to)) {
      const detail = r.detail ? `  ${C.d}${r.detail}${C.x}` : "";
      console.log(`  ${paint[r.state]}${r.state.padEnd(4)}${C.x}  ${r.name}${detail}`);
    }
  }

  const failed = results.filter((r) => r.state === "FAIL").length;
  const warned = results.filter((r) => r.state === "WARN").length;
  const passed = results.filter((r) => r.state === "PASS").length;

  console.log(
    `\n${passed} passed, ${failed} failed, ${warned} warning${warned === 1 ? "" : "s"}\n`,
  );

  if (failed > 0) {
    console.log(`${C.r}${C.b}NOT READY.${C.x} Fix every FAIL before real client data goes in.`);
    console.log(`${C.d}docs/GO-LIVE-PLAN.md maps each failure to the phase that fixes it.${C.x}\n`);
  } else if (warned > 0) {
    console.log(
      `${C.y}Secure, with ${warned} feature${warned === 1 ? "" : "s"} switched off.${C.x} ` +
        `Confirm each WARN is a choice you made.\n`,
    );
  } else {
    console.log(`${C.g}${C.b}Ready.${C.x} Everything configured and the boundary holds.\n`);
  }
  return failed;
}

process.exit(report() > 0 ? 1 : 0);
