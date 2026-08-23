/*
 * Signing in with a mobile number, and being admitted by one.
 *
 * A person used to BE a verified email address: the access list matched on it,
 * invites were addressed to it, and an account holding only a phone resolved to
 * users.email = "" and dead-ended on Access Denied for good. Phone is now a
 * standalone identity, which moves an authorization decision onto a new key —
 * so this suite exists to hold that key to the same standard as the address.
 *
 * The two failure directions are asymmetric and both are checked:
 *
 *   - Two spellings of ONE number must be one person. If "+91 98765 43210" and
 *     "09876543210" resolve differently, somebody who was admitted cannot get
 *     in, and an admin re-granting access appears to do nothing.
 *   - Two DIFFERENT numbers must never be one person. That direction is a
 *     cross-account breach, so it is checked against a near-miss neighbour
 *     rather than an obviously unrelated number.
 */
import { declareBarRegistration } from "../lib/bar-registration.mjs";

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

const asEmail = (email, name = "", provider = "google") =>
  `preview:email:${provider}:${encodeURIComponent(email)}:${encodeURIComponent(name)}`;
const asPhone = (phone, name = "", provider = "phone") =>
  `preview:phone:${provider}:${encodeURIComponent(phone)}:${encodeURIComponent(name)}`;

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
// Last four digits vary per run so repeated runs never collide on one number.
const tail = String(suffix).slice(-4);
const MOBILE = `+91987650${tail}`;
const NEIGHBOUR = `+91987651${tail}`; // one digit apart from MOBILE
const NATIONAL = `0987650${tail}`; // same subscriber, dialled domestically
const SPACED = `+91 98765 0${tail}`; // same subscriber, as a human writes it

/* ── 1. A number is an identity of its own ─────────────────────────────────── */
section("1. A number signs in and is nobody until admitted");

const stranger = await call("/session", { token: asPhone(MOBILE, "Phone Stranger") });
check(
  "a phone-only caller is authenticated",
  stranger.status === 200,
  `${stranger.status} ${JSON.stringify(stranger.data).slice(0, 160)}`,
);
check(
  "...and reaches nothing until admitted",
  stranger.data?.accessStatus === "not_recognised",
  `accessStatus ${stranger.data?.accessStatus}`,
);
check(
  "...and the session reports the number, with no address",
  stranger.data?.phone === MOBILE && stranger.data?.email === "",
  `phone ${JSON.stringify(stranger.data?.phone)} email ${JSON.stringify(stranger.data?.email)}`,
);

/* ── 2. One number, however it is written ──────────────────────────────────── */
section("2. One number is one person, however it is written");

for (const [label, spelling] of [
  ["dialled domestically (0…)", NATIONAL],
  ["written with spaces", SPACED],
]) {
  const s = await call("/session", { token: asPhone(spelling) });
  check(
    `${label} resolves to the same identity`,
    s.status === 200 && s.data?.userId === stranger.data?.userId,
    `userId ${s.data?.userId} vs ${stranger.data?.userId} (${s.status})`,
  );
}

const neighbour = await call("/session", { token: asPhone(NEIGHBOUR, "Not Them") });
check(
  "a number one digit apart is a DIFFERENT person",
  neighbour.status === 200 && neighbour.data?.userId !== stranger.data?.userId,
  `userId ${neighbour.data?.userId} vs ${stranger.data?.userId}`,
);

const rejected = await call("/session", { token: asPhone("12345") });
check(
  "a number that cannot be canonicalised is not an identity",
  rejected.status === 401,
  `${rejected.status} ${JSON.stringify(rejected.data).slice(0, 120)}`,
);

/* ── 3. A phone-only founder can get back in ───────────────────────────────── */
section("3. A phone-only founder can sign back into their own chamber");

const founderPhone = `+91987652${tail}`;
const founded = await call("/workspaces", {
  token: asPhone(founderPhone, "Phone Founder"),
  method: "POST",
  body: { name: `Phone Chambers ${suffix}`, role: "admin" },
});
check(
  "a caller with only a number can found a chamber",
  founded.status === 201,
  `${founded.status} ${JSON.stringify(founded.data).slice(0, 200)}`,
);

// Fresh call, as if they had closed the app and come back: the membership must
// come from a stored grant, not from anything left over in the founding request.
const returning = await call("/session", { token: asPhone(founderPhone) });
check(
  "...and is still an active member when they return",
  returning.data?.accessStatus === "active",
  `accessStatus ${returning.data?.accessStatus}`,
);
check(
  "...at the role they founded with",
  returning.data?.role === "admin",
  `role ${returning.data?.role}`,
);

const founderWsToken = returning.data?.workspaceToken;
const founderWsId = returning.data?.activeWorkspace?.id;
await declareBarRegistration(call, asPhone(founderPhone));

/* ── 4. A phone grant admits exactly one number ────────────────────────────── */
section("4. A phone grant admits exactly one number");

const granted = await call("/workspace/access-list", {
  token: asPhone(founderPhone),
  wsToken: founderWsToken,
  method: "POST",
  // Written in the loose form a human would type, to prove the server
  // normalises on write rather than storing what it was handed.
  body: { kind: "phone", value: NATIONAL, role: "junior_advocate" },
});
check(
  "an admin can grant access to a number",
  granted.status === 201,
  `${granted.status} ${JSON.stringify(granted.data).slice(0, 200)}`,
);
check(
  "...stored canonicalised, not as typed",
  granted.data?.value === MOBILE,
  `stored ${JSON.stringify(granted.data?.value)}, expected ${MOBILE}`,
);

const admitted = await call("/session", { token: asPhone(SPACED) });
check(
  "the granted number is admitted, written any way",
  admitted.data?.accessStatus === "active" && admitted.data?.role === "junior_advocate",
  `accessStatus ${admitted.data?.accessStatus} role ${admitted.data?.role}`,
);

const stillOut = await call("/session", { token: asPhone(NEIGHBOUR) });
check(
  "the neighbouring number is still admitted nowhere",
  stillOut.data?.accessStatus === "not_recognised",
  `accessStatus ${stillOut.data?.accessStatus}`,
);

const badGrant = await call("/workspace/access-list", {
  token: asPhone(founderPhone),
  wsToken: founderWsToken,
  method: "POST",
  body: { kind: "phone", value: "98765", role: "client", caseId: 1 },
});
check(
  "a grant for an uncanonicalisable number is refused, not stored dead",
  badGrant.status === 400,
  `${badGrant.status} ${JSON.stringify(badGrant.data).slice(0, 160)}`,
);

/* ── 5. Invites ────────────────────────────────────────────────────────────── */
section("5. An invite may be addressed to a number");

const invited = `+91987653${tail}`;
const invite = await call("/invites", {
  token: asPhone(founderPhone),
  wsToken: founderWsToken,
  method: "POST",
  body: { phone: invited, role: "clerk_intern" },
});
check(
  "an invite can name a mobile number",
  invite.status === 201,
  `${invite.status} ${JSON.stringify(invite.data).slice(0, 200)}`,
);
check(
  "...and carries no address",
  invite.data?.phone === invited && invite.data?.email === "",
  `phone ${JSON.stringify(invite.data?.phone)} email ${JSON.stringify(invite.data?.email)}`,
);

const invitee = await call("/session", { token: asPhone(invited, "Invited Clerk") });
check(
  "the invited number is admitted at the invited role on first sign-in",
  invitee.data?.accessStatus === "active" && invitee.data?.role === "clerk_intern",
  `accessStatus ${invitee.data?.accessStatus} role ${invitee.data?.role}`,
);

const both = await call("/invites", {
  token: asPhone(founderPhone),
  wsToken: founderWsToken,
  method: "POST",
  body: { email: `both+${suffix}@x.test`, phone: `+91987654${tail}`, role: "clerk_intern" },
});
check(
  "an invite naming both an address and a number is refused",
  both.status === 400,
  `${both.status} ${JSON.stringify(both.data).slice(0, 160)}`,
);

const neither = await call("/invites", {
  token: asPhone(founderPhone),
  wsToken: founderWsToken,
  method: "POST",
  body: { role: "clerk_intern" },
});
check(
  "an invite naming neither is refused",
  neither.status === 400,
  `${neither.status} ${JSON.stringify(neither.data).slice(0, 160)}`,
);

/* ── 6. Tenant isolation holds for phone identities ────────────────────────── */
section("6. A phone identity is confined to its own chamber");

const otherAdmin = `other.admin+${suffix}@other.test`;
const other = await call("/workspaces", {
  token: asEmail(otherAdmin, "Other Admin"),
  method: "POST",
  body: { name: `Other ${suffix}`, role: "admin" },
});
const otherWsId = other.data?.activeWorkspace?.id;
const otherWsToken = other.data?.workspaceToken;

const crossById = await call("/cases", {
  token: asPhone(SPACED),
  wsId: otherWsId,
});
check(
  "a phone member cannot reach another chamber by naming its id",
  crossById.status === 403,
  `${crossById.status} ${JSON.stringify(crossById.data).slice(0, 160)}`,
);

const crossByToken = await call("/cases", {
  token: asPhone(SPACED),
  wsToken: otherWsToken,
});
check(
  "...nor by replaying that chamber's workspace token",
  crossByToken.status === 403 || crossByToken.status === 401,
  `${crossByToken.status} ${JSON.stringify(crossByToken.data).slice(0, 160)}`,
);

/* ── 7. Both identifiers on one account ────────────────────────────────────── */
section("7. An address and a number are alternatives, not a pair");

// The grant above named a number. An address that was never granted anything
// must not inherit it just because the same chamber exists.
const unrelatedEmail = await call("/session", { token: asEmail(`nobody+${suffix}@x.test`) });
check(
  "an ungranted address is admitted nowhere",
  unrelatedEmail.data?.accessStatus === "not_recognised",
  `accessStatus ${unrelatedEmail.data?.accessStatus}`,
);

const emailGrant = await call("/workspace/access-list", {
  token: asPhone(founderPhone),
  wsToken: founderWsToken,
  method: "POST",
  body: { kind: "email", value: `mixed+${suffix}@x.test`, role: "junior_advocate" },
});
check(
  "an email grant still works alongside phone grants",
  emailGrant.status === 201,
  `${emailGrant.status}`,
);

const mixed = await call("/session", { token: asEmail(`mixed+${suffix}@x.test`) });
check(
  "...and admits that address",
  mixed.data?.accessStatus === "active",
  `accessStatus ${mixed.data?.accessStatus}`,
);
check(
  "...while its phone field stays empty",
  mixed.data?.phone === "",
  `phone ${JSON.stringify(mixed.data?.phone)}`,
);

void founderWsId;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
