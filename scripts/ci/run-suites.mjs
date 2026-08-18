#!/usr/bin/env node
/**
 * Runs the API suites against a server that is already listening.
 *
 * Each suite is a standalone script that exits non-zero on failure, so this
 * runner only sequences them and aggregates the result. They run in series
 * on purpose: several assert on plan quotas and rate limits, which are
 * per-workspace and per-address counters that concurrent runs would perturb.
 *
 * Usage:  node scripts/ci/run-suites.mjs [baseUrl]
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? process.env.API_BASE_URL ?? "http://localhost:5000";

const SUITES = [
  ["security", "Zero-trust isolation"],
  ["chamber", "Chamber lifecycle"],
  ["modules", "Documents, feedback and calendar"],
  ["subs", "Subscription and billing RBAC"],
  ["plan", "Plan enforcement: payment, seats, expiry"],
  ["case-restriction", "Restrict to Case ID, via both grant paths"],
  ["bar-registration", "Bar enrolment gate for practice roles"],
  ["cause-list", "Court cause lists: fetch, match, propose, accept"],
  ["gov", "Files, audit, quota, privacy, conflicts"],
];

/** The suite scripts hardcode localhost:5000; let CI point them elsewhere. */
const env = { ...process.env, API_BASE_URL: BASE };

function run(file, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, "suites", `${file}.mjs`), ...args], {
      stdio: "inherit",
      env,
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

let failed = 0;
for (const [file, label] of SUITES) {
  console.log(`\n[1m━━ ${label} (${file}.mjs)[0m`);
  // The modules suite is split: it seeds, then re-reads to prove persistence.
  const code = file === "modules" ? await run(file, ["setup"]) : await run(file);
  if (code !== 0) {
    failed++;
    console.log(`[31m✗ ${label} failed[0m`);
  }
}

console.log(
  failed === 0
    ? `\n[32m✓ All ${SUITES.length} suites passed[0m`
    : `\n[31m✗ ${failed} of ${SUITES.length} suites failed[0m`,
);
process.exit(failed === 0 ? 0 : 1);
