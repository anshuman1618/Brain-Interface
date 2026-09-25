/**
 * What the error reporter is allowed to put on the wire.
 *
 * This module had no tests at all, and for a long time three separate places
 * claimed it redacted while it forwarded `req.path` verbatim and `err.message`
 * untruncated. A claim nothing tests is how that drifted, so the assertions
 * here are deliberately the NEGATIVE ones: given an error whose message holds a
 * client's address and a path holding a matter id, neither appears in the
 * delivered payload.
 *
 * ── Why this suite runs its own server ────────────────────────────────────
 *
 * Unlike every other suite here, this one does not talk to the server started
 * by CI. `ERROR_WEBHOOK_URL` is read from the SERVER's environment, so the only
 * way to observe a real delivery is to start a server pointed at a listener
 * this process controls. It gets its own port and its own `PREVIEW_DATA_DIR`,
 * so it neither collides with the shared server nor touches `.preview-data`.
 *
 * The listener speaks HTTPS, which is more setup than a test wants, but the
 * reporter refuses any URL that is not `https://` and that refusal is worth
 * keeping absolute — a plaintext exception "just for tests" is how a
 * production guard eventually acquires one. So: a throwaway self-signed
 * certificate, and `NODE_EXTRA_CA_CERTS` on the child so it trusts that one
 * certificate and no others. Nothing disables verification.
 */

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:https";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SERVER = "artifacts/api-server/dist/index.mjs";

let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
};
const section = (t) => console.log(`\n== ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(SERVER)) {
  console.error(`${SERVER} not found — build the API server first.`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "lex-error-reporting-"));
const certFile = join(work, "cert.pem");
const keyFile = join(work, "key.pem");

// --- a certificate the child will trust, and nothing else -------------------
{
  const gen = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyFile,
      "-out",
      certFile,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { encoding: "utf8" },
  );
  if (gen.status !== 0) {
    console.error("Could not generate a test certificate with openssl:");
    console.error(gen.stderr || gen.stdout);
    rmSync(work, { recursive: true, force: true });
    process.exit(1);
  }
}

// --- the listener standing in for Slack -------------------------------------
/** Every body that arrived, raw and parsed. */
const delivered = [];
/** Statuses to answer with, in order; the last entry repeats. */
let replies = [200];
let replyIndex = 0;

const receiver = createServer(
  { key: readFileSync(keyFile), cert: readFileSync(certFile) },
  (req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Recorded as null. An unparseable body fails the last section.
      }
      delivered.push({ raw, body: parsed });
      const status = replies[Math.min(replyIndex, replies.length - 1)] ?? 200;
      replyIndex++;
      res.writeHead(status, { "content-type": "application/json" });
      res.end("{}");
    });
  },
);
await new Promise((r) => receiver.listen(0, "127.0.0.1", r));
const hookUrl = `https://127.0.0.1:${receiver.address().port}/hook`;

// --- the server under test --------------------------------------------------
const PORT = 5100 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;

const child = spawn(process.execPath, [SERVER], {
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: "development",
    // Both cleared: /preview/throw is gated on preview auth AND a preview
    // database, so an inherited DATABASE_URL or Clerk key would 404 it.
    DATABASE_URL: "",
    CLERK_SECRET_KEY: "",
    PREVIEW_DATA_DIR: join(work, "data"),
    ERROR_WEBHOOK_URL: hookUrl,
    SERVICE_NAME: "lex-practice",
    NODE_EXTRA_CA_CERTS: certFile,
    // The reporter's fetch has to reach loopback directly. A proxy in the
    // environment would swallow it and every negative assertion here would
    // then pass vacuously — which the last section also guards against.
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOut = "";
child.stdout.on("data", (d) => (serverOut += d));
child.stderr.on("data", (d) => (serverOut += d));

function stop() {
  child.kill("SIGKILL");
  receiver.close();
  rmSync(work, { recursive: true, force: true });
}

// PGlite builds its schema on first boot, so allow a generous window.
let up = false;
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${BASE}/api/healthz`)).ok) {
      up = true;
      break;
    }
  } catch {
    // Not listening yet.
  }
  await sleep(500);
}
if (!up) {
  console.error(`The test server did not come up on ${PORT}. Output:\n${serverOut}`);
  stop();
  process.exit(1);
}

/**
 * Trigger one 500 and wait for the delivery it should produce.
 *
 * The reporter is fire-and-forget, so the POST leaves after the response has
 * already been written. Waiting on `delivered.length` rather than on a fixed
 * sleep keeps this fast when it passes; `expectDelivery: false` is the one case
 * that has to spend the whole window, because proving a report was NOT sent
 * means waiting for one that never comes.
 */
async function trigger(pathAndQuery, { expectDelivery = true } = {}) {
  const before = delivered.length;
  const res = await fetch(BASE + pathAndQuery);
  const body = await res.text();
  const deadline = Date.now() + (expectDelivery ? 10_000 : 3_000);
  while (Date.now() < deadline && delivered.length === before) await sleep(50);
  return { status: res.status, body, report: delivered[before] ?? null };
}

// The identifiers the payload must never contain.
const MATTER_ID = "8842";
const QUERY_SECRET = "a-client-name-in-the-query";
const MAIN = `/api/preview/throw/${MATTER_ID}?variant=email&q=${QUERY_SECRET}`;

// The first delivery is refused on purpose; see "A refused delivery" below.
replies = [500, 200];

section("The route throws, and the caller learns nothing from it");
const first = await trigger(MAIN);
{
  check("the request 500s", first.status === 500, `got ${first.status}`);
  check("a report was delivered", first.report !== null);
  check(
    "the 500 response body carries no error detail",
    !first.body.includes("partner@chamber.in") && !first.body.includes("users_email_unique"),
  );
}

section("The delivered payload: what must NOT be in it");
{
  const raw = first.report?.raw ?? "";
  check("the client's address is absent", !raw.includes("partner@chamber.in"), raw.slice(0, 200));
  check("...including its domain on its own", !raw.includes("chamber.in"));
  check("the matter id is absent from the path", !raw.includes(`/throw/${MATTER_ID}`));
  check("the query string is absent entirely", !raw.includes(QUERY_SECRET));
  check("...and so is the '?' that would carry one", !raw.includes("?variant="));
  // The one that got away the first time. `err.stack` opens with
  // `Error: <message>`, so scrubbing the message and forwarding the stack
  // verbatim ships the address anyway, one field further down.
  check(
    "the stack's header line is scrubbed too",
    !(first.report?.body?.error?.stack ?? "").includes("partner@chamber.in"),
    (first.report?.body?.error?.stack ?? "").split("\n")[0],
  );
}

section("The delivered payload: what must still be in it");
{
  const b = first.report?.body ?? {};
  check("the route shape survives", b.request?.path === "/api/preview/throw/:id", b.request?.path);
  check("...in the human line too", (b.text ?? "").includes("GET /api/preview/throw/:id"));
  check("the method is there", b.request?.method === "GET");
  check("the status code is there", b.request?.statusCode === 500);
  check("the error keeps its name", b.error?.name === "Error", b.error?.name);
  check(
    "the message keeps its shape",
    (b.error?.message ?? "").includes("users_email_unique"),
    b.error?.message,
  );
  check(
    "...with Postgres' quoted value replaced rather than the line dropped",
    (b.error?.message ?? "").includes("Key (email)=([redacted])"),
    b.error?.message,
  );
  check("stack frames are present", (b.error?.stack ?? "").includes("\n    at "));
  check(
    "...and the stack still names the error it belongs to",
    (b.error?.stack ?? "").startsWith("Error: duplicate key"),
    (b.error?.stack ?? "").split("\n")[0],
  );
  check(
    "the service and environment are labelled",
    b.service === "lex-practice" && b.environment === "development",
  );
  check(
    "no workspace id field exists at all",
    !("workspaceId" in b) && !("workspaceId" in (b.request ?? {})),
  );
}

section("A refused delivery does not consume the dedupe slot");
{
  // The receiver answered the first POST with a 500. Had `lastSeen` been
  // written before the send — as it was — this identical error would have been
  // swallowed for the next five minutes, and the one fault you most need to
  // hear about would be the one you never do.
  const retry = await trigger(MAIN);
  check("the same error is reported again after a refusal", retry.report !== null);
  check(
    "...and it is the same error",
    retry.report?.body?.error?.message === first.report?.body?.error?.message,
  );

  // That one was answered 200, so the slot is taken now and dedupe applies.
  const third = await trigger(MAIN, { expectDelivery: false });
  check("a third identical error is de-duplicated", third.report === null);
}

section("Every id shape in a path is reduced");
{
  // A different variant per case: the reporter de-duplicates on the message, so
  // reusing one would suppress the second and third deliveries.
  const cases = [
    ["a UUID", "3f6b1c2e-9a41-4d7e-b0f2-6c5d8e1a4b93", "blobkey"],
    ["a Clerk id", "user_2xQr7TmKpLdVn3Hs", "credentials"],
    ["a long opaque token", "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA", "long"],
  ];
  for (const [label, seg, variant] of cases) {
    const { report } = await trigger(`/api/preview/throw/${seg}?variant=${variant}`);
    check(
      `${label} becomes :id`,
      report?.body?.request?.path === "/api/preview/throw/:id",
      report?.body?.request?.path,
    );
    check(`...and ${label} itself never appears`, !!report && !report.raw.includes(seg));
  }
}

section("Each message pattern is scrubbed");
{
  const messageContaining = (needle) =>
    delivered.find((d) => (d.body?.error?.message ?? "").includes(needle))?.body?.error?.message ??
    "";

  const blob = messageContaining("R2 putObject");
  check("a blob key is replaced", blob.includes("[redacted:key]"), blob);
  check(
    "...and the key itself is gone",
    !!blob && !blob.includes("a3f5c9e1b7d24068af13c5e29b74d0116c8ea52f93b7d4c081fa6e2537b9c40d"),
  );

  const creds = messageContaining("ETIMEDOUT");
  check(
    "a connection string's password is replaced",
    creds.includes("[redacted:credentials]"),
    creds,
  );
  check("...and the password itself is gone", !!creds && !creds.includes("s3cr3t-pw"));
  check(
    "...labelled as credentials rather than mislabelled as an email",
    !!creds && !creds.includes("[redacted:email]"),
    creds,
  );

  const long = messageContaining("insert or update on table");
  check("a long message is capped at 300 characters", long.length === 300, `${long.length}`);
  check("...so its tail is dropped", !!long && !long.includes("END-OF-A-VERY-LONG-MESSAGE"));
}

section("Nothing above was vacuous");
{
  // Every negative assertion passes trivially if no report was ever delivered.
  // Five is the whole expected traffic: two for the main error (a refusal and
  // its retry), none for the de-duplicated third, and one per id shape.
  check("five reports were delivered in total", delivered.length === 5, `${delivered.length}`);
  check(
    "each one had a parseable JSON body",
    delivered.every((d) => d.body && typeof d.body === "object"),
  );
}

stop();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
