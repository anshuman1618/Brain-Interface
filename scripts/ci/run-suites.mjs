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
  ["case-access", "Narrowing a junior or a clerk to named matters"],
  ["bar-registration", "Bar enrolment gate for practice roles"],
  ["cause-list", "Court cause lists: fetch, match, propose, accept"],
  ["ai-untrusted", "AI: a party's document cannot escape its envelope"],
  ["drafting", "AI drafting: the gates, the budget, and what leaves the server"],
  ["operator", "Operator metrics: the allowlist, and the numbers"],
  ["blob-storage", "File storage: the R2 signer and the backend choice"],
  ["phone-identity", "Mobile numbers: normalisation to E.164"],
  ["phone-admission", "Mobile numbers: founding, inviting and being admitted"],
  ["gov", "Files, audit, quota, privacy, conflicts"],
];

/**
 * The suite scripts hardcode localhost:5000; let CI point them elsewhere.
 *
 * OPERATOR_TEST_EMAIL has to match the address the SERVER was started with in
 * OPERATOR_EMAILS — the allowlist is read from the server's environment, not
 * the suite's. The operator suite fails loudly rather than passing vacuously
 * when it is missing, because "every request 404s" is indistinguishable from
 * "the gate works" if nobody checks the admitted case too.
 */
const env = {
  ...process.env,
  API_BASE_URL: BASE,
  OPERATOR_TEST_EMAIL: process.env.OPERATOR_TEST_EMAIL ?? "ops@operator.test",
};

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
