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
 * MIGRATIONS RUN IN THIS PROCESS, not by shelling out to drizzle-kit. The first
 * version of this file spawned `pnpm --filter @workspace/db run migrate`, which
 * meant a second pnpm, then drizzle-kit, then tsx compiling drizzle.config.ts —
 * three extra processes and a TypeScript compile before a single row moved. On
 * a 512 MB free instance that is a real cost in both memory and time, and the
 * time is spent in the window Render is waiting for the service to bind a port.
 * The programmatic migrator reads the same journal and the same SQL files and
 * records itself in the same `__drizzle_migrations` table; it simply does it
 * without the tooling. It also keeps drizzle-kit — a devDependency — out of the
 * production boot path, where it never belonged.
 *
 * A failure here is deliberately fatal. Render only shifts traffic to a new
 * instance once it passes its health check, so a migration that fails means the
 * deploy does not go live and the previous instance keeps serving. Starting
 * anyway would put a server in front of a schema it does not match, which is
 * strictly worse than not deploying.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// No DATABASE_URL means PGlite — an in-process Postgres that builds its schema
// from lib/db/preview.ts on boot. There is nothing to migrate, so this is a
// skip and not a failure.
if (!process.env.DATABASE_URL) {
  console.log("[migrate] DATABASE_URL is not set — preview database, nothing to apply.");
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(here, "drizzle");

console.log("[migrate] applying pending migrations from lib/db/drizzle …");

// Imported after the DATABASE_URL check so a preview boot pays nothing for
// modules it will not use.
const [{ default: pg }, { drizzle }, { migrate }] = await Promise.all([
  import("pg"),
  import("drizzle-orm/node-postgres"),
  import("drizzle-orm/node-postgres/migrator"),
]);

// A single connection, not a pool: this runs once and exits, and a pool would
// hold the event loop open afterwards.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  await migrate(drizzle(client), { migrationsFolder });
  console.log("[migrate] schema is up to date.");
} catch (error) {
  console.error("[migrate] migrations failed. Not starting the server.");
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  await client.end().catch(() => {});
  process.exit(1);
}

await client.end();
process.exit(0);
