/**
 * Apply pending migrations, then let the caller start the server.
 *
 * This exists because the deployed service's Start Command lives in the Render
 * dashboard, not in `render.yaml`. The service was created by hand before the
 * blueprint existed, so Render never reads that file, and the dashboard still
 * says `drizzle-kit push` — which cannot work unattended: push diffs the schema
 * against the live database and asks for confirmation when the answer is
 * ambiguous. With no TTY to answer, it exits without applying anything and the
 * `&&` chain moves on, so the service comes up healthy while the schema quietly
 * stops tracking the code. That is how production ended up missing every table
 * added after phase 3 while looking perfectly fine.
 *
 * Putting the migration inside `pnpm run start` makes the stale dashboard
 * command harmless: whatever runs before it, the server cannot start without
 * the schema being current. Fixing the dashboard field is still worth doing —
 * see DEPLOYMENT.md — but the deployment no longer depends on someone
 * remembering to.
 *
 * A failure here is deliberately fatal. Render only shifts traffic to a new
 * instance once it passes its health check, so a migration that fails means the
 * deploy does not go live and the previous instance keeps serving. Starting
 * anyway would put a server in front of a schema it does not match, which is
 * strictly worse than not deploying.
 */
import { spawnSync } from "node:child_process";

// No DATABASE_URL means PGlite — an in-process Postgres that builds its schema
// from lib/db/preview.ts on boot. There is nothing to migrate and drizzle.config
// would throw on the missing variable, so this is a skip and not a failure.
if (!process.env.DATABASE_URL) {
  console.log("[migrate] DATABASE_URL is not set — preview database, nothing to apply.");
  process.exit(0);
}

console.log("[migrate] applying pending migrations from lib/db/drizzle …");
const result = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "migrate"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error("[migrate] could not run drizzle-kit:", result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`[migrate] migrations failed (exit ${result.status}). Not starting the server.`);
  process.exit(result.status ?? 1);
}
console.log("[migrate] schema is up to date.");
