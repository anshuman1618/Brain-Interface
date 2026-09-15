// Uploaded case files, end to end: the bytes, the encryption at rest, and the
// isolation between chambers.
//
// This path had no integration coverage at all before the per-tenant key work,
// which is why the two findings in docs/CRYPTO-POLICY.md §0.1 and §0.2 survived
// as long as they did. The unit tests in blob-crypto.test.ts prove the format;
// this proves the server actually uses it, which is a different claim.
//
//   PORT=5000 DATA_ROOT_KEY=$(openssl rand -hex 32) \
//     node artifacts/api-server/dist/index.mjs &
//   node scripts/ci/suites/documents.mjs
//
// With DATA_ROOT_KEY unset the encryption assertions are skipped and say so:
// preview mode deliberately writes plaintext.

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { declareBarRegistration } from "../lib/bar-registration.mjs";
import { grantPreviewPlan } from "../lib/preview-plan.mjs";

const BASE = (process.env.API_BASE_URL ?? "http://localhost:5000") + "/api";
const STORAGE_DIR = process.env.FILE_STORAGE_DIR ?? "./.file-storage";
const ENCRYPTION_ON = Boolean(
  process.env.DATA_ROOT_KEY?.trim() || process.env.FILE_ENCRYPTION_KEY?.trim(),
);

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
const skip = (n, why) => console.log(`  SKIP  ${n} — ${why}`);
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

/** A chamber with one matter, ready to hold a document. */
async function chamber(email, firm) {
  const token = as(email, firm);
  const ws = await call("/workspaces", {
    token,
    method: "POST",
    body: { name: `${firm} ${Date.now()}`, role: "admin" },
  });
  if (ws.status !== 200 && ws.status !== 201) {
    throw new Error(`could not create ${firm}: ${ws.status} ${JSON.stringify(ws.data)}`);
  }
  const wsToken = ws.data.workspaceToken;
  await declareBarRegistration(call, token);
  await grantPreviewPlan(call, token, wsToken);
  const matter = await call("/cases", {
    token,
    wsToken,
    method: "POST",
    body: {
      title: `${firm} v. Union of India`,
      clientName: "A Client",
      filingRef: `WP/${Math.floor(Math.random() * 100000)}/2026`,
    },
  });
  if (matter.status !== 200 && matter.status !== 201) {
    throw new Error(`could not file a matter: ${matter.status} ${JSON.stringify(matter.data)}`);
  }
  return { token, wsToken, caseId: matter.data.id };
}

async function upload(c, bytes, name) {
  const res = await fetch(`${BASE}/cases/${c.caseId}/documents/content`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${c.token}`,
      "x-workspace-token": c.wsToken,
      "content-type": "text/plain",
      "x-document-name": encodeURIComponent(name),
    },
    body: bytes,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

async function download(c, documentId) {
  const res = await fetch(`${BASE}/documents/${documentId}/content`, {
    headers: { authorization: `Bearer ${c.token}`, "x-workspace-token": c.wsToken },
  });
  const body = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  return { status: res.status, body };
}

/** Every blob on disk, newest first. Used to read what was actually written. */
async function storedBlobs() {
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else out.push({ path: full, mtime: (await stat(full)).mtimeMs });
    }
  }
  await walk(STORAGE_DIR);
  return out.sort((a, b) => b.mtime - a.mtime);
}

/* -------------------------------------------------------------------------- */

const CONTENT = Buffer.from(
  "PRIVILEGED AND CONFIDENTIAL\nEngagement letter, Mehta.\n" + "x".repeat(4096),
  "utf8",
);

section("1. A file survives a round trip");
const firm = await chamber(`docs-a-${Date.now()}@example.com`, "Sharma & Associates");
const up = await upload(firm, CONTENT, "engagement-letter.txt");
check("upload accepted", up.status === 200 || up.status === 201, `${up.status}`);
const docId = up.data?.id;
check("...and returns a document id", Number.isFinite(docId), JSON.stringify(up.data));

const down = await download(firm, docId);
check("download succeeds", down.status === 200, `${down.status}`);
check("...returning the exact bytes uploaded", Boolean(down.body?.equals(CONTENT)));

section("2. What is actually on disk");
const blobs = await storedBlobs();
check("a blob was written", blobs.length > 0, STORAGE_DIR);

if (!ENCRYPTION_ON) {
  skip("blob is encrypted", "no DATA_ROOT_KEY/FILE_ENCRYPTION_KEY — preview writes plaintext");
  skip("blob carries the v2 header", "same");
} else if (blobs.length > 0) {
  const raw = await readFile(blobs[0].path);
  check(
    "blob carries the v2 header",
    raw.subarray(0, 5).toString("utf8") === "LEXP2",
    raw.subarray(0, 5).toString("hex"),
  );
  // The real assertion: the privileged text must not be sitting on the volume.
  check("plaintext is NOT present on disk", !raw.includes(Buffer.from("PRIVILEGED AND", "utf8")));
  check("ciphertext is longer than the plaintext by the header", raw.length > CONTENT.length);
}

section("3. Another chamber cannot reach the file");
const rival = await chamber(`docs-b-${Date.now()}@example.com`, "Mehta & Co");
const stolen = await download(rival, docId);
check(
  "rival download is refused",
  stolen.status === 404 || stolen.status === 403,
  `${stolen.status}`,
);
check("...and returns no bytes", stolen.body === null);

section("4. The document is listed to its own chamber");
const listed = await call(`/cases/${firm.caseId}/documents`, {
  token: firm.token,
  wsToken: firm.wsToken,
});
check("listing succeeds", listed.status === 200, `${listed.status}`);
check(
  "...and includes the upload",
  Array.isArray(listed.data) && listed.data.some((d) => d.id === docId),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
