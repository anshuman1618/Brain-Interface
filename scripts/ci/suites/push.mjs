/*
 * Push notifications: registration, and the boundary that matters.
 *
 * A device token is an address a matter can be delivered to, so the interesting
 * question is not "does it send" — nothing can send in CI, there is no Firebase
 * project — but "who can it reach". Every check below is about that:
 *
 *   - a registration names no workspace; the server takes it from the session,
 *     so a device cannot be attached to a chamber the caller is not in;
 *   - a member cannot revoke a colleague's device by guessing its id;
 *   - re-registering the same token updates one row rather than accumulating
 *     duplicates, which is what would otherwise send every reminder N times;
 *   - with no transport configured, messages are RECORDED as suppressed rather
 *     than silently dropped — the same rule mail already follows, and the one
 *     that keeps a chamber from believing a reminder went out when it did not.
 */
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

const suffix = Date.now();
const token16 = (label) => `${label}-token-${suffix}`.padEnd(24, "x");

/* ── Bootstrap two chambers ────────────────────────────────────────────────── */
const adminA = as(`push.a+${suffix}@a.test`, "A Admin");
const adminB = as(`push.b+${suffix}@b.test`, "B Admin");

const A = await call("/workspaces", {
  token: adminA,
  method: "POST",
  body: { name: `PushAlpha ${suffix}`, role: "admin" },
});
const B = await call("/workspaces", {
  token: adminB,
  method: "POST",
  body: { name: `PushBeta ${suffix}`, role: "admin" },
});
const aTok = A.data?.workspaceToken;
const bTok = B.data?.workspaceToken;
const bId = B.data?.activeWorkspace?.id;
await declareBarRegistration(call, adminA);
await declareBarRegistration(call, adminB);
// Both chambers need a plan in force: without one the calendar is 402 and an
// invite admits nobody, so §5 below would be measuring the subscription gate
// rather than whether a hearing reaches the people it is addressed to.
// Registering a device (§1–4) is deliberately NOT gated — a member who can
// sign in can be reached.
await grantPreviewPlan(call, adminA, aTok);
await grantPreviewPlan(call, adminB, bTok);

/* ── 1. Registration ───────────────────────────────────────────────────────── */
section("1. A device registers against the caller's own chamber");

const reg = await call("/devices", {
  token: adminA,
  wsToken: aTok,
  method: "POST",
  body: { token: token16("a"), platform: "android" },
});
check(
  "a member can register a device",
  reg.status === 201,
  `${reg.status} ${JSON.stringify(reg.data).slice(0, 160)}`,
);

const again = await call("/devices", {
  token: adminA,
  wsToken: aTok,
  method: "POST",
  body: { token: token16("a"), platform: "android" },
});
check(
  "re-registering the same token updates the same row, it does not accumulate",
  again.status === 201 && again.data?.id === reg.data?.id,
  `first ${reg.data?.id} second ${again.data?.id}`,
);

const noToken = await call("/devices", {
  token: adminA,
  wsToken: aTok,
  method: "POST",
  body: { platform: "android" },
});
check("a registration with no token is refused", noToken.status === 400, `${noToken.status}`);

const shortToken = await call("/devices", {
  token: adminA,
  wsToken: aTok,
  method: "POST",
  body: { token: "abc", platform: "android" },
});
check("an implausibly short token is refused", shortToken.status === 400, `${shortToken.status}`);

const badPlatform = await call("/devices", {
  token: adminA,
  wsToken: aTok,
  method: "POST",
  body: { token: token16("bad"), platform: "windows" },
});
check("an unknown platform is refused", badPlatform.status === 400, `${badPlatform.status}`);

/* ── 2. The tenant boundary ────────────────────────────────────────────────── */
section("2. A device cannot be attached to somebody else's chamber");

const crossById = await call("/devices", {
  token: adminA,
  wsId: bId,
  method: "POST",
  body: { token: token16("cross"), platform: "ios" },
});
check(
  "A cannot register a device against B by naming B's workspace id",
  crossById.status === 403,
  `${crossById.status} ${JSON.stringify(crossById.data).slice(0, 160)}`,
);

const crossByToken = await call("/devices", {
  token: adminA,
  wsToken: bTok,
  method: "POST",
  body: { token: token16("cross2"), platform: "ios" },
});
check(
  "...nor by replaying B's workspace token",
  crossByToken.status === 403 || crossByToken.status === 401,
  `${crossByToken.status} ${JSON.stringify(crossByToken.data).slice(0, 160)}`,
);

/* ── 3. Revocation is per owner ────────────────────────────────────────────── */
section("3. One member cannot silence another's device");

const bReg = await call("/devices", {
  token: adminB,
  wsToken: bTok,
  method: "POST",
  body: { token: token16("b"), platform: "ios" },
});
check("B registers their own device", bReg.status === 201, `${bReg.status}`);

const steal = await call(`/devices/${bReg.data?.id}`, {
  token: adminA,
  wsToken: aTok,
  method: "DELETE",
});
check(
  "A revoking B's device id is a 404, not a silent success",
  steal.status === 404,
  `${steal.status} ${JSON.stringify(steal.data).slice(0, 160)}`,
);

const ownRevoke = await call(`/devices/${reg.data?.id}`, {
  token: adminA,
  wsToken: aTok,
  method: "DELETE",
});
check("...but A can revoke their own", ownRevoke.status === 204, `${ownRevoke.status}`);

const reRevoke = await call(`/devices/${reg.data?.id}`, {
  token: adminA,
  wsToken: aTok,
  method: "DELETE",
});
check(
  "revoking twice is still a 204 — the row is set, not deleted",
  reRevoke.status === 204,
  `${reRevoke.status}`,
);

/* ── 4. Unconfigured is a recorded state, not a crash ──────────────────────── */
section("4. With no transport configured, nothing pretends to have been sent");

const ready = await call("/readyz");
check(
  "readyz reports whether push is configured",
  ready.data?.checks && "pushConfigured" in ready.data.checks,
  JSON.stringify(ready.data?.checks ?? {}).slice(0, 200),
);
check(
  "...and it is false here, since CI has no Firebase project",
  ready.data?.checks?.pushConfigured === false,
  `pushConfigured ${ready.data?.checks?.pushConfigured}`,
);
check(
  "...without that stopping the service being ready",
  ready.status === 200 || ready.data?.checks?.database === "ok",
  `${ready.status} ${JSON.stringify(ready.data?.checks ?? {}).slice(0, 160)}`,
);

/* ── 5. Hearings actually produce a reminder ───────────────────────────────── */
section("5. A hearing tomorrow reaches the people it is addressed to");

/*
 * The calendar was not read by the reminder sweep at all, so the single most
 * important thing in an advocate's week was the one event nobody was reminded
 * about. This proves it now is — and that the entry's own `audience` decides
 * who hears, rather than everybody in the chamber.
 */
const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

// Someone to exclude: a clerk, while the hearing is addressed to admins only.
const clerkEmail = `push.clerk+${suffix}@a.test`;
await call("/invites", {
  token: adminA,
  wsToken: aTok,
  method: "POST",
  body: { email: clerkEmail, role: "clerk_intern" },
});
const clerkSession = await call("/session", { token: as(clerkEmail, "A Clerk") });
check(
  "a clerk joins chamber A",
  clerkSession.data?.accessStatus === "active",
  `accessStatus ${clerkSession.data?.accessStatus}`,
);

const hearing = await call("/calendar", {
  token: adminA,
  wsToken: aTok,
  method: "POST",
  body: {
    title: `Kesavananda v State ${suffix}`,
    kind: "hearing",
    entryDate: tomorrow,
    entryTime: "10:30",
    audience: "role:admin",
  },
});
check(
  "an admin can put a hearing on the calendar for tomorrow",
  hearing.status === 201,
  `${hearing.status} ${JSON.stringify(hearing.data).slice(0, 200)}`,
);

const ran = await call("/preview/run-reminders", {
  token: adminA,
  wsToken: aTok,
  method: "POST",
});
check("the reminder sweep runs on demand", ran.status === 200, `${ran.status}`);

const adminNotifications = await call("/notifications", { token: adminA });
const hearingLine = (adminNotifications.data ?? []).find((n) =>
  String(n.message).includes(`Kesavananda v State ${suffix}`),
);
check(
  "the hearing produces a reminder for the admin it is addressed to",
  Boolean(hearingLine),
  JSON.stringify(adminNotifications.data ?? []).slice(0, 300),
);
check(
  "...saying when it is, and linking to the calendar",
  Boolean(hearingLine) && /tomorrow/.test(hearingLine.message) && hearingLine.link === "/calendar",
  JSON.stringify(hearingLine ?? {}).slice(0, 200),
);

const clerkNotifications = await call("/notifications", { token: as(clerkEmail) });
check(
  "...and NOT for the clerk, who is outside its audience",
  !(clerkNotifications.data ?? []).some((n) =>
    String(n.message).includes(`Kesavananda v State ${suffix}`),
  ),
  JSON.stringify(clerkNotifications.data ?? []).slice(0, 300),
);

// Idempotence: the sweep runs every half hour and must not re-notify.
await call("/preview/run-reminders", { token: adminA, wsToken: aTok, method: "POST" });
const afterSecondRun = await call("/notifications", { token: adminA });
const occurrences = (afterSecondRun.data ?? []).filter((n) =>
  String(n.message).includes(`Kesavananda v State ${suffix}`),
).length;
check(
  "running the sweep twice does not send the reminder twice",
  occurrences === 1,
  `${occurrences} copies`,
);

// The other chamber must see none of it.
const bNotifications = await call("/notifications", { token: adminB });
check(
  "chamber B is told nothing about chamber A's hearing",
  !(bNotifications.data ?? []).some((n) =>
    String(n.message).includes(`Kesavananda v State ${suffix}`),
  ),
  JSON.stringify(bNotifications.data ?? []).slice(0, 300),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
