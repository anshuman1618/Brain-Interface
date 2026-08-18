// Persistence, documents, feedback and the tightened client scope.
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
const plus = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

import { tmpdir } from "node:os";
import { join } from "node:path";
// Handoff between the setup and verify phases, which run either side of a restart.
const seedFile = join(process.env.RUNNER_TEMP ?? tmpdir(), "lex-modules-state.json");
const fs = await import("node:fs");
const phase = process.argv[2] || "setup";

if (phase === "setup") {
  section("Setup — build a chamber with real content");
  const founder = "arch.founder@chambers.test";
  const created = await call("/workspaces", {
    token: as(founder, "A Founder"),
    method: "POST",
    body: { name: `Arch Chambers ${Date.now()}`, role: "admin" },
  });
  check("chamber created", created.status === 201, `got ${created.status}`);
  const wsTok = created.data.workspaceToken;
  await declareBarRegistration(call, as(founder));

  await call("/invites", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { email: "arch.clerk@chambers.test", role: "clerk_intern" },
  });
  const clerk = (await call("/session", { token: as("arch.clerk@chambers.test", "A Clerk") })).data;

  // A user row exists from the first authenticated call regardless of whether
  // they are admitted anywhere — so the client's id is available before the
  // matter naming them as its client, and before the invite carrying the
  // restriction to that matter, both exist.
  const clientPre = (await call("/session", { token: as("arch.client@x.test", "A Client") })).data;

  const matter = await call("/cases", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { title: "Persistent matter", filingRef: "CV-2026-020", clientId: clientPre.userId },
  });

  // A client invite must be restricted to a matter — see DECISIONS.md.
  const clientInvite = await call("/invites", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { email: "arch.client@x.test", role: "client", caseId: matter.data.id },
  });
  check(
    "client invited, restricted to the matter",
    clientInvite.status === 201,
    `got ${clientInvite.status}`,
  );
  const client = (await call("/session", { token: as("arch.client@x.test", "A Client") })).data;
  const entry = await call("/calendar", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { title: "Persisted hearing", kind: "hearing", entryDate: plus(3), audience: "all" },
  });
  check("matter + calendar entry created", matter.status === 201 && entry.status === 201);

  fs.writeFileSync(
    seedFile,
    JSON.stringify({
      founder,
      wsTok,
      caseId: matter.data.id,
      entryId: entry.data.id,
      clientTok: client.workspaceToken,
      clientUserId: client.userId,
      clerkTok: clerk.workspaceToken,
    }),
  );

  section("Client RBAC — calendar stripped, feedback added");
  check(
    "client has NO calendar.read",
    !client.capabilities.includes("calendar.read"),
    JSON.stringify(client.capabilities),
  );
  check("client HAS feedback.write", client.capabilities.includes("feedback.write"));
  check("client HAS documents.write", client.capabilities.includes("documents.write"));
  const clientCal = await call("/calendar", {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
  });
  check(
    "client blocked from the calendar API (403)",
    clientCal.status === 403,
    `got ${clientCal.status}`,
  );
  check("clerk still has calendar.read", clerk.capabilities.includes("calendar.read"));

  section("Interactive calendar — drag = PATCH");
  const moved = await call(`/calendar/${entry.data.id}`, {
    token: as(founder),
    wsToken: wsTok,
    method: "PATCH",
    body: { entryDate: plus(9), entryTime: "14:30" },
  });
  check(
    "entry can be moved",
    moved.status === 200 && moved.data.entryDate === plus(9),
    JSON.stringify(moved.data?.entryDate),
  );
  const clerkMove = await call(`/calendar/${entry.data.id}`, {
    token: as("arch.clerk@chambers.test"),
    wsToken: clerk.workspaceToken,
    method: "PATCH",
    body: { entryDate: plus(1) },
  });
  check("clerk cannot move entries (403)", clerkMove.status === 403, `got ${clerkMove.status}`);

  section("Bi-directional documents");
  const firmDoc = await call(`/cases/${matter.data.id}/documents`, {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { name: "Internal draft.pdf", visibility: "firm", url: "s3://internal" },
  });
  const sharedDoc = await call(`/cases/${matter.data.id}/documents`, {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { name: "Filed petition.pdf", visibility: "shared", url: "s3://shared" },
  });
  check("firm can upload internal + shared", firmDoc.status === 201 && sharedDoc.status === 201);
  check(
    "visibility recorded",
    firmDoc.data.visibility === "firm" && sharedDoc.data.visibility === "shared",
  );
  check(
    "uploader recorded",
    firmDoc.data.uploadedBy === "A Founder" && firmDoc.data.uploadedByRole === "admin",
    JSON.stringify([firmDoc.data.uploadedBy, firmDoc.data.uploadedByRole]),
  );

  const clientDocs = await call("/documents", {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
  });
  const names = clientDocs.data.map((d) => d.name);
  check("client sees the shared file", names.includes("Filed petition.pdf"), JSON.stringify(names));
  check(
    "client does NOT see firm-internal material",
    !names.includes("Internal draft.pdf"),
    JSON.stringify(names),
  );

  // A clerk only reaches matters they hold a task on, so give them one first.
  const noTaskYet = await call(`/cases/${matter.data.id}/documents`, {
    token: as("arch.clerk@chambers.test"),
    wsToken: clerk.workspaceToken,
    method: "POST",
    body: { name: "Too early.pdf" },
  });
  check(
    "clerk cannot upload to an unassigned matter (404)",
    noTaskYet.status === 404,
    `got ${noTaskYet.status}`,
  );
  await call("/tasks", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: {
      caseId: matter.data.id,
      title: "Prepare filing",
      assigneeId: clerk.clerkId,
      deadline: plus(4),
    },
  });
  const clerkUpload = await call(`/cases/${matter.data.id}/documents`, {
    token: as("arch.clerk@chambers.test"),
    wsToken: clerk.workspaceToken,
    method: "POST",
    body: { name: "Clerk filing copy.pdf" },
  });
  check(
    "clerk can upload once assigned to the matter",
    clerkUpload.status === 201,
    `got ${clerkUpload.status}`,
  );

  const req = await call("/document-requests", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: {
      clientId: client.userId,
      documentName: "Notarised affidavit",
      caseId: matter.data.id,
      dueDate: plus(5),
    },
  });
  check("firm raises a document request", req.status === 201, `got ${req.status}`);

  const fulfil = await call(`/cases/${matter.data.id}/documents`, {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
    method: "POST",
    body: { name: "affidavit-signed.pdf", documentRequestId: req.data.id, visibility: "firm" },
  });
  check("client uploads against the request", fulfil.status === 201, `got ${fulfil.status}`);
  check(
    "client upload is forced to 'shared'",
    fulfil.data.visibility === "shared",
    fulfil.data?.visibility,
  );
  check("upload is linked to the request", fulfil.data.documentRequestId === req.data.id);

  const after = await call("/document-requests", { token: as(founder), wsToken: wsTok });
  const closed = after.data.find((r) => r.id === req.data.id);
  check("request auto-marked fulfilled", closed.status === "fulfilled", closed?.status);
  check("...and links the fulfilling document", closed.fulfilledDocumentId === fulfil.data.id);

  section("Client feedback");
  const fb = await call("/feedback", {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
    method: "POST",
    body: { caseId: matter.data.id, rating: 5, comment: "Handled promptly." },
  });
  check("client leaves feedback", fb.status === 201, `got ${fb.status}`);
  const dup = await call("/feedback", {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
    method: "POST",
    body: { caseId: matter.data.id, rating: 1 },
  });
  check("cannot rate the same matter twice (409)", dup.status === 409, `got ${dup.status}`);
  const bad = await call("/feedback", {
    token: as("arch.client@x.test"),
    wsToken: client.workspaceToken,
    method: "POST",
    body: { caseId: matter.data.id, rating: 9 },
  });
  check("rating is bounded 1–5 (400)", bad.status === 400, `got ${bad.status}`);

  const firmFb = await call("/feedback", { token: as(founder), wsToken: wsTok });
  check("firm reads client feedback", firmFb.data.length === 1 && firmFb.data[0].rating === 5);
  const selfRate = await call("/feedback", {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { caseId: matter.data.id, rating: 5 },
  });
  check("a chamber cannot rate itself (403)", selfRate.status === 403, `got ${selfRate.status}`);

  const reply = await call(`/feedback/${fb.data.id}/response`, {
    token: as(founder),
    wsToken: wsTok,
    method: "POST",
    body: { response: "Thank you." },
  });
  check("firm can reply", reply.status === 200 && reply.data.response === "Thank you.");
  check("...without altering the client's words", reply.data.comment === "Handled promptly.");
  const clerkReply = await call(`/feedback/${fb.data.id}/response`, {
    token: as("arch.clerk@chambers.test"),
    wsToken: clerk.workspaceToken,
    method: "POST",
    body: { response: "no" },
  });
  check("clerk cannot reply (403)", clerkReply.status === 403, `got ${clerkReply.status}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

if (phase === "verify") {
  section("Persistence — after a full server restart");
  const st = JSON.parse(fs.readFileSync(seedFile, "utf8"));

  const s = await call("/session", { token: as(st.founder) });
  check(
    "founder still recognised",
    s.data.accessStatus === "active",
    JSON.stringify(s.data.accessStatus),
  );
  check("chamber still exists", s.data.activeWorkspace !== null);
  const wsTok = s.data.workspaceToken;

  const cases = await call("/cases", { token: as(st.founder), wsToken: wsTok });
  check(
    "matter survived",
    cases.data.some((c) => c.title === "Persistent matter"),
    JSON.stringify(cases.data.map((c) => c.title)),
  );

  const cal = await call("/calendar", { token: as(st.founder), wsToken: wsTok });
  check(
    "calendar entry survived",
    cal.data.some((e) => e.title === "Persisted hearing"),
  );
  check(
    "...including the moved date",
    cal.data.find((e) => e.title === "Persisted hearing")?.entryDate === plus(9),
  );

  const docs = await call("/documents", { token: as(st.founder), wsToken: wsTok });
  check("documents survived", docs.data.length >= 4, `${docs.data.length} docs`);
  check(
    "visibility survived",
    docs.data.some((d) => d.visibility === "firm") &&
      docs.data.some((d) => d.visibility === "shared"),
  );

  const fb = await call("/feedback", { token: as(st.founder), wsToken: wsTok });
  check("feedback survived", fb.data.length === 1 && fb.data[0].rating === 5);
  check("...with the firm's reply", fb.data[0].response === "Thank you.");

  const reqs = await call("/document-requests", { token: as(st.founder), wsToken: wsTok });
  check(
    "fulfilled request survived",
    reqs.data.some((r) => r.status === "fulfilled" && r.fulfilledDocumentId),
  );

  const clientSession = await call("/session", { token: as("arch.client@x.test") });
  check("client membership survived", clientSession.data.role === "client");
  check("client still has no calendar", !clientSession.data.capabilities.includes("calendar.read"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
