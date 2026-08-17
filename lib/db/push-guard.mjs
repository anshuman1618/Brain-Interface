/**
 * `drizzle-kit push`, refused in production.
 *
 * This exists because of a specific thing that is happening on every deploy.
 * The live Render service was created by hand before `render.yaml`, so Render
 * never reads that file and the dashboard's Start Command is the one in effect:
 *
 *   pnpm --filter @workspace/db run push && pnpm run start
 *
 * `push` diffs the schema against the live database and applies what it infers.
 * On the last deploy it asked, out loud, in the production log:
 *
 *   "You're about to add workspace_memberships_workspace_user_key unique
 *    constraint to the table, which contains 2 items. Do you want to truncate
 *    workspace_memberships table?"
 *
 * It could not read an answer — there is no TTY — so it gave up and the deploy
 * carried on. That was luck, not design. The same prompt with a different
 * drizzle-kit version, or a `--force` anywhere, drops every membership row in
 * the chamber, which is every user's access.
 *
 * Migrations are applied by `migrate-on-boot.mjs` from `pnpm run start`, so
 * push has no job to do on a deployed instance. This makes that explicit
 * instead of leaving it to a prompt nobody can answer.
 *
 * EXIT ZERO IS LOAD-BEARING. The Start Command chains with `&&`, so a non-zero
 * exit here means `pnpm run start` never runs and the service never comes up.
 * Refusing to push must not become refusing to deploy.
 *
 * The right fix is still to change that dashboard field to `migrate`. This is
 * the belt to its braces, and it is the half that can be fixed from the
 * repository.
 */
import { spawnSync } from "node:child_process";

// RENDER is set on every Render instance, build and runtime alike. Checked as
// well as NODE_ENV because a deployed service with NODE_ENV unset is exactly
// the misconfiguration that would make this guard silently not apply.
const onRender = Boolean(process.env.RENDER);
const inProduction = process.env.NODE_ENV === "production";

if (inProduction || onRender) {
  console.warn(
    [
      "",
      "[push] REFUSED — drizzle-kit push does not run on a deployed instance.",
      "[push] It applies inferred schema changes and prompts when the answer is",
      "[push] ambiguous; there is no terminal here to answer it. Migrations are",
      "[push] applied from `pnpm run start` by lib/db/migrate-on-boot.mjs.",
      "[push]",
      "[push] Exiting 0 so the start command's `&&` chain continues.",
      "[push] Fix the dashboard Start Command to use `migrate`, not `push`.",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

// Anything after the script name goes through, so `push-force` keeps its
// --force locally. Dropping it silently would turn a destructive command the
// caller asked for into a different, quieter one.
const extra = process.argv.slice(2);
const result = spawnSync("drizzle-kit", ["push", "--config", "./drizzle.config.ts", ...extra], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error("[push] could not run drizzle-kit:", result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
