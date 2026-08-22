// Being admitted by mobile number: found, invite, sign in, and precedence.
//
// Email was the only bridge from "authenticated" to "authorized" — the access
// list matched on it, reconcileAccessList early-returned without it, and
// foundChamber wrote it as the founder's self-admitting row. A phone-only user
// therefore authenticated perfectly and reached nothing. This suite is the
// evidence that the seam was widened rather than patched at one end.
import { declareBarRegistration } from "../lib/bar-registration.mjs";

const BASE = (process.env.API_BASE_URL ?? "http://localhost:5000") + "/api";
let pass = 0,
  fail = 0;
const check = (n, ok, d = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);
};
const section = (t) => console.log(`\n== ${t}`);

const byEmail = (email, name = "", provider = "google") =>
  `preview:email:${provider}:${encodeURIComponent(email)}:${encodeURIComponent(name)}`;
const byPhone = (phone, name = "") =>
  `preview:phone:phone:${encodeURIComponent(phone)}:${encodeURIComponent(name)}`;

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

const n = Date.now() % 100000;
const founderPhone = `+9199${String(n).padStart(8, "0")}`;
const clerkPhone = `+9198${String(n).padStart(8, "0")}`;
const clientPhone = `+9197${String(n).padStart(8, "0")}`;

/* ─────────────── The token itself ─────────────── */
section("The server accepts the phone token form and refuses malformed ones");

check("no token at all is 401", (await call("/session")).status === 401);
for (const [tok, why] of [
  ["preview:phone:phone:notanumber:X", "not a number"],
  ["preview:phone:google:%2B919876543210:X", "wrong provider for the phone form"],
  ["preview:sms:phone:%2B919876543210:X", "unknown prefix"],
]) {
  check(`refused (${why})`, (await call("/session", { token: tok })).status === 401);
}

const first = await call("/session", { token: byPhone(founderPhone, "Phone Founder") });
check("a well-formed phone token authenticates", first.status === 200, `got ${first.status}`);
check("...carrying the number back", first.data?.phone === founderPhone, first.data?.phone);
check("...with no email", first.data?.email === "", JSON.stringify(first.data?.email));
check(
  "...and reaching nothing yet",
  first.data?.accessStatus === "not_recognised",
  first.data?.accessStatus,
);

/* ─────────────── Founding by mobile ─────────────── */
section("A chamber can be founded by somebody who has no email at all");

const founded = await call("/workspaces", {
  token: byPhone(founderPhone, "Phone Founder"),
  method: "POST",
  body: { name: `Mobile Chambers ${n}`, role: "admin" },
});
check("the chamber is created", founded.status === 201, `got ${founded.status}`);
const ws = founded.data?.workspaceToken;
await declareBarRegistration(call, byPhone(founderPhone, "Phone Founder"));

// THE regression. foundChamber used to write only an email row, so a founder
// with no address created a chamber and was locked out of it on the next
// request — authenticated, and a stranger to their own practice.
const again = await call("/session", { token: byPhone(founderPhone, "Phone Founder") });
check(
  "...and the founder can sign back INTO it",
  again.data?.accessStatus === "active",
  again.data?.accessStatus,
);
check("...as its admin", again.data?.role === "admin", again.data?.role);
check(
  "...landing in the chamber they made",
  again.data?.activeWorkspace?.name === `Mobile Chambers ${n}`,
  again.data?.activeWorkspace?.name,
);

/* ─────────────── Inviting by mobile ─────────────── */
section("An admin admits a colleague who has a number and no address");

const invited = await call("/invites", {
  token: byPhone(founderPhone),
  wsToken: ws,
  method: "POST",
  body: { phone: clerkPhone.replace("+91", "0"), role: "clerk_intern" },
});
check("the invite is accepted", invited.status === 201, `got ${invited.status}`);
check(
  "...stored in E.164 however it was typed",
  invited.data?.phone === clerkPhone,
  invited.data?.phone,
);
check("...with no email on it", invited.data?.email === null, JSON.stringify(invited.data?.email));

const clerk = await call("/session", { token: byPhone(clerkPhone, "The Clerk") });
check(
  "the invited number is admitted on sign-in",
  clerk.data?.accessStatus === "active",
  clerk.data?.accessStatus,
);
check("...at the invited role", clerk.data?.role === "clerk_intern", clerk.data?.role);

/* ─────────────── Both doors validate the same way ─────────────── */
section("Neither admission door accepts a half-formed identifier");

for (const [body, why, expect] of [
  [{ email: "a@b.test", phone: "9876500000", role: "clerk_intern" }, "both identifiers", 400],
  [{ role: "clerk_intern" }, "neither identifier", 400],
  [{ phone: "12345", role: "clerk_intern" }, "not a real number", 400],
  // This one used to be ACCEPTED: POST /invites applied no email format check
  // at all while POST /workspace/access-list did, so garbage could be written
  // through one door and then match nothing forever.
  [{ email: "not an address", role: "clerk_intern" }, "garbage email", 400],
]) {
  const r = await call("/invites", {
    token: byPhone(founderPhone),
    wsToken: ws,
    method: "POST",
    body,
  });
  check(`invite refused: ${why}`, r.status === expect, `got ${r.status}`);
}

const badEntry = await call("/workspace/access-list", {
  token: byPhone(founderPhone),
  wsToken: ws,
  method: "POST",
  body: { kind: "phone", value: "nonsense", role: "clerk_intern" },
});
check(
  "an access-list phone entry is validated too",
  badEntry.status === 400,
  `got ${badEntry.status}`,
);

/* ─────────────── Precedence ─────────────── */
section("Email beats phone beats domain when more than one entry matches");

// One person, two identifiers, two entries at different roles. The durable
// identifier decides: a mobile is reassigned by the telco, an address is not.
const bothEmail = `both.${n}@precedence.test`;
const bothPhone = `+9196${String(n).padStart(8, "0")}`;
await call("/workspace/access-list", {
  token: byPhone(founderPhone),
  wsToken: ws,
  method: "POST",
  body: { kind: "phone", value: bothPhone, role: "clerk_intern" },
});
await call("/workspace/access-list", {
  token: byPhone(founderPhone),
  wsToken: ws,
  method: "POST",
  body: { kind: "email", value: bothEmail, role: "junior_advocate" },
});

// Signing in by phone matches only the phone entry.
const asPhone = await call("/session", { token: byPhone(bothPhone, "Both") });
check(
  "signing in by number takes the number's role",
  asPhone.data?.role === "clerk_intern",
  asPhone.data?.role,
);

/* ─────────────── Revocation ─────────────── */
section("Revoking a number stops it admitting anybody new");

const list = await call("/workspace/access-list", { token: byPhone(founderPhone), wsToken: ws });
const entry = list.data?.find((e) => e.kind === "phone" && e.value === clerkPhone);
check(
  "the clerk's number is on the list",
  Boolean(entry),
  JSON.stringify(list.data?.map((e) => e.value)),
);

await call(`/workspace/access-list/${entry?.id}`, {
  token: byPhone(founderPhone),
  wsToken: ws,
  method: "DELETE",
});
const fresh = await call("/session", { token: byPhone(clientPhone, "Never Invited") });
check(
  "a number nobody admitted reaches nothing",
  fresh.data?.accessStatus === "not_recognised",
  fresh.data?.accessStatus,
);

/* ─────────────── The email path is untouched ─────────────── */
section("Everything above changed nothing for an address");

const emailUser = `still.works.${n}@chambers.test`;
await call("/workspace/access-list", {
  token: byPhone(founderPhone),
  wsToken: ws,
  method: "POST",
  body: { kind: "email", value: emailUser, role: "junior_advocate" },
});
const viaEmail = await call("/session", { token: byEmail(emailUser, "Email Colleague") });
check(
  "an emailed colleague is still admitted",
  viaEmail.data?.accessStatus === "active",
  viaEmail.data?.accessStatus,
);
check("...at their role", viaEmail.data?.role === "junior_advocate", viaEmail.data?.role);
check("...with their address intact", viaEmail.data?.email === emailUser, viaEmail.data?.email);
check(
  "...and no phone invented for them",
  viaEmail.data?.phone === null,
  JSON.stringify(viaEmail.data?.phone),
);

console.log(`\n${fail === 0 ? "✓" : "✗"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
