/**
 * Startup guards: what must stop a deploy rather than serve traffic.
 *
 * These run the built server directly with a deliberately broken environment
 * and assert on the EXIT CODE, not the log line. That is the point — a host
 * decides whether a release succeeded from the exit code, so a fatal startup
 * error that exits 0 is read as a clean shutdown and the deploy is marked good.
 *
 * That exact bug shipped once: an uncaughtException handler suppressed Node's
 * non-zero exit and its exit timer was unref'd, so the event loop drained and
 * the process left with 0.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

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

if (!existsSync(SERVER)) {
  console.error(`${SERVER} not found — build the API server first.`);
  process.exit(1);
}

/** Start the server with `env`, wait for it to die, return its exit code. */
function run(env, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: "timeout", out });
    }, timeoutMs);

    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

// A throwaway database URL: these must all fail before anything connects.
const base = { NODE_ENV: "production", DATABASE_URL: "postgres://unused/unused" };

console.log("\n== Production refuses to start without encryption configured");
{
  const { code, out } = await run({ ...base, FILE_ENCRYPTION_KEY: "" });
  check("exits non-zero", code === 1, `exit ${code}`);
  // The preflight now reaches this before the encryption guard does, so match
  // the variable name rather than either message's exact wording.
  check("...saying which variable", /FILE_ENCRYPTION_KEY/.test(out));
  check("...and why", /privileged|in the clear/.test(out));
}

console.log("\n== A malformed key is refused, not silently truncated");
{
  const { code, out } = await run({ ...base, FILE_ENCRYPTION_KEY: "nowhere near 32 bytes" });
  check("exits non-zero", code === 1, `exit ${code}`);
  check("...naming the expected format", /32 bytes|64 hex/.test(out));
}

console.log("\n== Every missing production setting is reported in one go");
{
  // The failure this guards against is procedural: fixing one variable, waiting
  // for a build, discovering the next. On a managed host that is an afternoon.
  const { code, out } = await run({ NODE_ENV: "production" });
  check("exits non-zero", code === 1, `exit ${code}`);
  check(
    "counts them",
    /Refusing to start: 4 required production settings/.test(out),
    out.slice(0, 200),
  );
  for (const key of [
    "FILE_ENCRYPTION_KEY",
    "DATABASE_URL",
    "CLERK_SECRET_KEY",
    "CLERK_PUBLISHABLE_KEY",
  ]) {
    check(`...names ${key}`, out.includes(key));
  }
  check(
    "warns about WORKSPACE_TOKEN_SECRET without making it fatal",
    /WORKSPACE_TOKEN_SECRET/.test(out) && !/\d\. WORKSPACE_TOKEN_SECRET/.test(out),
  );
  // Same shape, and for the same reason: a service with no alerting runs
  // perfectly, so nothing else will ever tell you it is unset. The numbered-
  // list check is what distinguishes "warned about" from "refused to start" —
  // fatal problems are printed as "1. KEY", warnings are not.
  check(
    "warns about ERROR_WEBHOOK_URL without making it fatal",
    /ERROR_WEBHOOK_URL/.test(out) && !/\d\. ERROR_WEBHOOK_URL/.test(out),
  );
  check("points at the blueprint", /render\.yaml blueprint/.test(out));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
