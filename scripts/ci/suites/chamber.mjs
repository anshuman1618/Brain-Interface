// Empty platform → found a chamber → invite a team → assign work → calendar.
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
const today = new Date().toISOString().slice(0, 10);
const plus = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

section("1. The platform starts empty");
const first = await call("/session", { token: as("founder@chambers.test", "P. Founder") });
check(
  "first ever sign-in reaches nothing",
  first.data.accessStatus === "not_recognised",
  JSON.stringify(first.data.accessStatus),
);
check("no workspaces exist for them", first.data.memberships.length === 0);
check("zero capabilities", (first.data.capabilities ?? []).length === 0);

section("2. Founding a chamber (self-serve sign-up)");
const badRole = await call("/workspaces", {
  token: as("founder@chambers.test"),
  method: "POST",
  body: { name: "Sneaky", role: "client" },
});
check(
  "cannot found a chamber as Client/Clerk (400)",
  badRole.status === 400,
  `got ${badRole.status}`,
);

const created = await call("/workspaces", {
  token: as("founder@chambers.test", "P. Founder"),
  method: "POST",
  body: { name: "Founder Chambers", role: "senior_advocate" },
});
check("chamber created", created.status === 201, `got ${created.status}`);
check("founder is active in it", created.data.accessStatus === "active");
check(
  "at the role they chose",
  created.data.role === "senior_advocate",
  `role=${created.data.role}`,
);
check("and is flagged owner", created.data.isOwner === true);
const WS = created.data.activeWorkspace.id;
const founderWs = created.data.workspaceToken;

section("3. Everything reads zero");
for (const [path, label] of [
  ["/cases", "matters"],
  ["/tasks", "tasks"],
  ["/calendar", "calendar"],
  ["/document-requests", "document requests"],
]) {
  const r = await call(path, { token: as("founder@chambers.test"), wsToken: founderWs });
  check(
    `${label} is empty`,
    Array.isArray(r.data) && r.data.length === 0,
    JSON.stringify(r.data)?.slice(0, 80),
  );
}
const members = await call("/workspace/members", {
  token: as("founder@chambers.test"),
  wsToken: founderWs,
});
check(
  "the founder is the only member",
  members.data.length === 1,
  JSON.stringify(members.data?.map?.((m) => m.email)),
);

section("4. Owner can invite even as Senior Advocate");
check(
  "owner holds access_control.manage",
  created.data.capabilities.includes("access_control.manage"),
);
check("owner holds team.manage", created.data.capabilities.includes("team.manage"));
// ...but a plain Senior Advocate must not.

// A client invite must be restricted to a matter — see DECISIONS.md. This
// case exists purely to give it one; "First matter" below is the one the
// rest of the suite actually assigns work against.
const clientCase = await call("/cases", {
  token: as("founder@chambers.test"),
  wsToken: founderWs,
  method: "POST",
  body: { title: "Client onboarding matter", filingRef: "CV-2026-000" },
});
check(
  "a matter exists to restrict the client invite to",
  clientCase.status === 201,
  `got ${clientCase.status}`,
);

const invited = [];
for (const [email, role, caseId] of [
  ["junior@chambers.test", "junior_advocate", undefined],
  ["clerk@chambers.test", "clerk_intern", undefined],
  ["client@elsewhere.test", "client", clientCase.data.id],
  ["senior2@chambers.test", "senior_advocate", undefined],
]) {
  const r = await call("/invites", {
    token: as("founder@chambers.test"),
    wsToken: founderWs,
    method: "POST",
    body: caseId != null ? { email, role, caseId } : { email, role },
  });
  check(`invited ${role}`, r.status === 201, `got ${r.status}`);
  invited.push([email, role]);
}

section("5. An invited colleague simply signs in");
const sessions = {};
for (const [email, role] of invited) {
  const s = await call("/session", { token: as(email, email.split("@")[0]) });
  check(
    `${role} admitted on first sign-in`,
    s.data.accessStatus === "active",
    JSON.stringify(s.data.accessStatus),
  );
  check(`${role} gets exactly the invited role`, s.data.role === role, `role=${s.data.role}`);
  check(`${role} is not an owner`, s.data.isOwner === false);
  sessions[role] = s.data;
}
const uninvited = await call("/session", { token: as("stranger@nowhere.test") });
check("an uninvited address is still refused", uninvited.data.accessStatus === "not_recognised");

section("6. Only Admin and Senior Advocate assign work");
const caseRes = await call("/cases", {
  token: as("founder@chambers.test"),
  wsToken: founderWs,
  method: "POST",
  body: { title: "First matter", filingRef: "CV-2026-001", priority: "high" },
});
check("senior advocate can create a matter", caseRes.status === 201, `got ${caseRes.status}`);
const CASE = caseRes.data.id;

const seniorAssign = await call("/tasks", {
  token: as("founder@chambers.test"),
  wsToken: founderWs,
  method: "POST",
  body: {
    caseId: CASE,
    title: "Draft petition",
    assigneeId: sessions.junior_advocate.clerkId,
    deadline: plus(5),
  },
});
check("senior advocate CAN assign work", seniorAssign.status === 201, `got ${seniorAssign.status}`);

check(
  "junior advocate does NOT hold tasks.write",
  !sessions.junior_advocate.capabilities.includes("tasks.write"),
  JSON.stringify(sessions.junior_advocate.capabilities),
);
const juniorAssign = await call("/tasks", {
  token: as("junior@chambers.test"),
  wsToken: sessions.junior_advocate.workspaceToken,
  method: "POST",
  body: { caseId: CASE, title: "Nope", deadline: plus(3) },
});
check(
  "junior advocate CANNOT assign work (403)",
  juniorAssign.status === 403,
  `got ${juniorAssign.status}`,
);

const clerkAssign = await call("/tasks", {
  token: as("clerk@chambers.test"),
  wsToken: sessions.clerk_intern.workspaceToken,
  method: "POST",
  body: { caseId: CASE, title: "Nope", deadline: plus(3) },
});
check("clerk CANNOT assign work (403)", clerkAssign.status === 403, `got ${clerkAssign.status}`);

// Client ratings are a scorecard, and answering for one is Admin's and Senior
// Advocate's job. A junior sees the matters and the tasks, not the reviews.
check(
  "junior advocate does NOT hold feedback.read",
  !sessions.junior_advocate.capabilities.includes("feedback.read"),
  JSON.stringify(sessions.junior_advocate.capabilities),
);
const juniorFeedback = await call("/feedback", {
  token: as("junior@chambers.test"),
  wsToken: sessions.junior_advocate.workspaceToken,
});
check(
  "...and is refused the feedback list (403)",
  juniorFeedback.status === 403,
  `got ${juniorFeedback.status}`,
);
check(
  "a Senior Advocate still reads feedback",
  sessions.senior_advocate.capabilities.includes("feedback.read"),
);
check(
  "junior can still complete their own work",
  sessions.junior_advocate.capabilities.includes("tasks.complete"),
);

section("7. Master calendar, per portal");
const post = async (token, wsToken, body) =>
  call("/calendar", { token, wsToken, method: "POST", body });

const forAll = await post(as("founder@chambers.test"), founderWs, {
  title: "Listing before Bench II",
  kind: "hearing",
  entryDate: plus(2),
  entryTime: "10:30",
  audience: "all",
  caseId: CASE,
});
check("senior advocate can post an update", forAll.status === 201, `got ${forAll.status}`);

const forStaff = await post(as("founder@chambers.test"), founderWs, {
  title: "Internal fee review",
  kind: "meeting",
  entryDate: plus(3),
  audience: "staff",
});
check("posted a staff-only update", forStaff.status === 201);

const forClerks = await post(as("founder@chambers.test"), founderWs, {
  title: "Collect certified copies",
  kind: "filing",
  entryDate: plus(1),
  audience: "role:clerk_intern",
});
check("posted a clerk-only update", forClerks.status === 201);

const juniorPost = await post(as("junior@chambers.test"), sessions.junior_advocate.workspaceToken, {
  title: "Nope",
  entryDate: today,
});
check(
  "junior advocate CANNOT post updates (403)",
  juniorPost.status === 403,
  `got ${juniorPost.status}`,
);

// The client portal no longer includes the master calendar at all.
const clientCal = await call("/calendar", {
  token: as("client@elsewhere.test"),
  wsToken: sessions.client.workspaceToken,
});
check(
  "client is refused the calendar outright (403)",
  clientCal.status === 403,
  `got ${clientCal.status}`,
);
check("client holds no calendar.read", !sessions.client.capabilities.includes("calendar.read"));

const clerkCal = await call("/calendar", {
  token: as("clerk@chambers.test"),
  wsToken: sessions.clerk_intern.workspaceToken,
});
const clerkTitles = clerkCal.data.map((e) => e.title);
check(
  "clerk sees their own targeted update",
  clerkTitles.includes("Collect certified copies"),
  JSON.stringify(clerkTitles),
);
check("clerk sees the staff update", clerkTitles.includes("Internal fee review"));

const juniorCal = await call("/calendar", {
  token: as("junior@chambers.test"),
  wsToken: sessions.junior_advocate.workspaceToken,
});
const juniorTitles = juniorCal.data.map((e) => e.title);
check(
  "junior does NOT see the clerk-only update",
  !juniorTitles.includes("Collect certified copies"),
  JSON.stringify(juniorTitles),
);
check("junior sees the staff update", juniorTitles.includes("Internal fee review"));

section("8. A second chamber stays isolated");
const rival = await call("/workspaces", {
  token: as("other@rival.test", "R. Rival"),
  method: "POST",
  body: { name: "Rival Chambers", role: "admin" },
});
check("second chamber created", rival.status === 201, `got ${rival.status}`);
const rivalWs = rival.data.workspaceToken;
check("rival admin is owner of theirs", rival.data.isOwner === true);

const rivalCases = await call("/cases", { token: as("other@rival.test"), wsToken: rivalWs });
check(
  "rival sees no matters from the first chamber",
  rivalCases.data.length === 0,
  JSON.stringify(rivalCases.data),
);
const rivalCal = await call("/calendar", { token: as("other@rival.test"), wsToken: rivalWs });
check(
  "rival sees none of the first chamber's calendar",
  rivalCal.data.length === 0,
  JSON.stringify(rivalCal.data),
);
const crossSwitch = await call("/session/workspace", {
  token: as("other@rival.test"),
  method: "POST",
  body: { workspaceId: WS },
});
check(
  "rival cannot switch into the first chamber (403)",
  crossSwitch.status === 403,
  `got ${crossSwitch.status}`,
);

section("9. A non-owner Senior Advocate cannot manage access");
const senior2 = sessions.senior_advocate;
check("invited senior advocate is not owner", senior2.isOwner === false);
check(
  "...so has no access_control.manage",
  !senior2.capabilities.includes("access_control.manage"),
  JSON.stringify(senior2.capabilities),
);
const senior2Invite = await call("/invites", {
  token: as("senior2@chambers.test"),
  wsToken: senior2.workspaceToken,
  method: "POST",
  body: { email: "friend@nowhere.test", role: "admin" },
});
check(
  "...and cannot invite anyone (403)",
  senior2Invite.status === 403,
  `got ${senior2Invite.status}`,
);
check("but CAN assign work", senior2.capabilities.includes("tasks.write"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
