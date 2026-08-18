// Bar registration: required for admin/senior/junior, exempt for clerk/client,
// enforced server-side (not just a client-side gate), self-declared not verified.
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
const owner = `bar.owner+${suffix}@b.test`;
const junior = `bar.junior+${suffix}@b.test`;
const clerk = `bar.clerk+${suffix}@b.test`;
const client = `bar.client+${suffix}@b.test`;

section("A founder is blocked from the workspace until declared");
const founded = await call("/workspaces", {
  token: as(owner, "Owner"),
  method: "POST",
  body: { name: `Bar Chambers ${suffix}`, role: "admin" },
});
const ws = founded.data.workspaceToken;
check("chamber founded", founded.status === 201, `got ${founded.status}`);

const session0 = await call("/session", { token: as(owner) });
check(
  "the session says the profile is incomplete",
  session0.data.profileComplete === false,
  JSON.stringify(session0.data.profileComplete),
);

const blocked = await call("/cases", { token: as(owner), wsToken: ws });
check(
  "a workspace-scoped call is refused (403 profile_incomplete)",
  blocked.status === 403 && blocked.data?.reason === "profile_incomplete",
  `got ${blocked.status} ${JSON.stringify(blocked.data)}`,
);

section("Declaring it unblocks the workspace");
const empty = await call("/users/me/bar-registration", {
  token: as(owner),
  method: "PUT",
  body: { barCouncilState: "", barEnrolmentNo: "" },
});
check("an empty declaration is refused (400)", empty.status === 400, `got ${empty.status}`);

const declared = await call("/users/me/bar-registration", {
  token: as(owner),
  method: "PUT",
  body: { barCouncilState: "Bar Council of Maharashtra & Goa", barEnrolmentNo: "MAH/1234/2010" },
});
check("declaring it succeeds (200)", declared.status === 200, `got ${declared.status}`);
check(
  "the response carries what was declared",
  declared.data?.barCouncilState === "Bar Council of Maharashtra & Goa" &&
    declared.data?.barEnrolmentNo === "MAH/1234/2010",
  JSON.stringify(declared.data),
);
check("aorNo is null when not supplied", declared.data?.aorNo === null);
check("barDeclaredAt is stamped", typeof declared.data?.barDeclaredAt === "string");

const session1 = await call("/session", { token: as(owner) });
check(
  "the session now says the profile is complete",
  session1.data.profileComplete === true,
  JSON.stringify(session1.data.profileComplete),
);

const unblocked = await call("/cases", { token: as(owner), wsToken: ws });
check(
  "the workspace-scoped call now succeeds",
  unblocked.status === 200,
  `got ${unblocked.status}`,
);

section("An AOR number is accepted and round-trips when supplied");
const withAor = await call("/users/me/bar-registration", {
  token: as(owner),
  method: "PUT",
  body: {
    barCouncilState: "Bar Council of Maharashtra & Goa",
    barEnrolmentNo: "MAH/1234/2010",
    aorNo: "AOR-4567",
  },
});
check("accepted", withAor.status === 200, `got ${withAor.status}`);
check("aorNo round-trips", withAor.data?.aorNo === "AOR-4567", withAor.data?.aorNo);

const me = await call("/users/me", { token: as(owner) });
check(
  "GET /users/me also reflects it, for pre-filling an edit",
  me.data?.barCouncilState === "Bar Council of Maharashtra & Goa" && me.data?.aorNo === "AOR-4567",
  JSON.stringify({ state: me.data?.barCouncilState, aor: me.data?.aorNo }),
);

section("clerk_intern and client are exempt");
await call("/invites", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { email: clerk, role: "clerk_intern" },
});
const clerkSession = await call("/session", { token: as(clerk, "Clerk") });
check(
  "a clerk's profile is complete without declaring anything",
  clerkSession.data.profileComplete === true,
  JSON.stringify(clerkSession.data.profileComplete),
);
const clerkCases = await call("/cases", {
  token: as(clerk),
  wsToken: clerkSession.data.workspaceToken,
});
check(
  "...and they can use the workspace immediately",
  clerkCases.status === 200,
  `got ${clerkCases.status}`,
);

const clientCase = await call("/cases", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { title: "Client's matter", filingRef: `CV-BAR-${suffix}` },
});
await call("/invites", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { email: client, role: "client", caseId: clientCase.data.id },
});
const clientSession = await call("/session", { token: as(client, "Client") });
check(
  "a client's profile is complete without declaring anything",
  clientSession.data.profileComplete === true,
);

section("junior_advocate needs it too, but not a clerk invited alongside them");
await call("/invites", {
  token: as(owner),
  wsToken: ws,
  method: "POST",
  body: { email: junior, role: "junior_advocate" },
});
const juniorSession = await call("/session", { token: as(junior, "Junior") });
check("the junior's profile is incomplete", juniorSession.data.profileComplete === false);
const juniorBlocked = await call("/cases", {
  token: as(junior),
  wsToken: juniorSession.data.workspaceToken,
});
check(
  "...and they are blocked exactly the same way",
  juniorBlocked.status === 403 && juniorBlocked.data?.reason === "profile_incomplete",
  `got ${juniorBlocked.status}`,
);

section("Declaring it does not require an active workspace");
// PUT /users/me/bar-registration sits behind requireAuth, not requireWorkspace
// — otherwise nobody blocked by it could ever escape the block.
const freshAdvocate = `bar.fresh+${suffix}@nowhere.test`;
const freshDeclare = await call("/users/me/bar-registration", {
  token: as(freshAdvocate),
  method: "PUT",
  body: { barCouncilState: "Bar Council of Delhi", barEnrolmentNo: "D/9999/2021" },
});
check(
  "a user with no workspace at all can still declare it",
  freshDeclare.status === 200,
  `got ${freshDeclare.status}`,
);

console.log(`\n${fail === 0 ? "✓" : "✗"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
