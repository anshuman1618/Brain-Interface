# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

LEX Practice — an invite-only chamber-management platform for a law practice.
Matters, cause list, tasks and SLAs, time capture, invoicing, and a read-only
client portal.

**Companion documents, all current and worth reading before large changes:**
`README.md` (product and access model), `FLOW.md` (how execution travels — the
request pipeline, boot order, and what each recent change touched),
`DECISIONS.md` (why choices were made), `DEPLOYMENT.md` (the deploy runbook).
`.agents/memory/` holds two hard-won gotchas that are still live.

---

## Commands

```bash
pnpm install
pnpm run preview       # build both, serve on :5000 — no Clerk, no Postgres needed
pnpm run check         # format:check + lint + typecheck (what CI gates on)
pnpm run build         # typecheck, then build every package
```

`pnpm run preview` is the fastest way to see a change. It builds the SPA and the
API and serves both from one origin with mocked auth and an on-disk PGlite
database in `.preview-data` — delete that directory to start clean.

Individual steps:

```bash
pnpm run typecheck                                   # all packages
pnpm run lint                                        # eslint .
pnpm run format                                      # prettier --write .
pnpm --filter @workspace/practice-portal run dev     # Vite dev server
pnpm --filter @workspace/api-server run dev          # build + start the API
pnpm --filter @workspace/api-spec run codegen        # REQUIRED after editing openapi.yaml
pnpm --filter @workspace/db run migrate              # apply migrations (needs DATABASE_URL)
pnpm --filter @workspace/db run generate             # write a new migration from schema changes
```

### Tests

There is no unit-test framework. Everything is an integration suite that runs
against a **live server** and exits non-zero on failure. Start the server first:

```bash
PORT=5000 node artifacts/api-server/dist/index.mjs &     # preview mode: no DATABASE_URL
node scripts/ci/run-suites.mjs                            # all five API suites, in series
node scripts/ci/suites/security.mjs                       # ONE suite — this is how you run a single test
node scripts/ci/browser/portal.mjs                        # Playwright, needs BASE_URL
node scripts/ci/startup-guards.mjs                        # asserts the server REFUSES to start when misconfigured
```

Suites are `security` (zero-trust isolation), `chamber`, `modules`, `subs`,
`gov`. They run in series deliberately — several assert on plan quotas and rate
limits, which concurrent runs would perturb.

**Restart the server between suites.** The `auth` limiters on `/api/session` and
`/api/workspaces` are keyed by address at 30/min and the counters live in process
memory, and the security suite deliberately exhausts them. Anything run next from
the same machine starts with an empty budget and fails at setup with a `429` that
looks like a broken feature. CI is unaffected — it runs the API and browser
suites as separate jobs on separate runners.

Write new verification the same way: a standalone `.mjs` that hits the running
server and prints PASS/FAIL. **Keep scratch check scripts out of the repo root**
— eslint lints them and they will fail `pnpm run check`.

Authenticate to a preview server with a bearer token, no Clerk involved:

```
Authorization: Bearer preview:email:<provider>:<url-encoded-email>:<display name>
X-Workspace-Token: <the workspaceToken returned by POST /api/workspaces>
```

---

## Architecture

A pnpm workspace. **Not Next.js** — a Vite 7 SPA and an Express 5 API, built
separately, served from one origin in production.

```
artifacts/api-server        Express 5 API. ALSO serves the built SPA.
artifacts/practice-portal   React 19 + Vite SPA. The product UI.
artifacts/mockup-sandbox    Design sandbox. Not part of the product.

lib/db                      Drizzle schema + client. The only place SQL lives.
lib/api-spec                OpenAPI 3.1 — the API contract, source of truth.
lib/api-zod                 GENERATED. Request/response validators.
lib/api-client-react        GENERATED. React Query hooks.

scripts/ci                  Integration suites and startup guards.
```

### The contract is the OpenAPI file

`lib/api-zod` and `lib/api-client-react` are **generated and must never be
hand-edited**. Change `lib/api-spec/openapi.yaml`, run the codegen, and both
sides move together. CI regenerates and diffs, so a spec edit without codegen
fails the build.

When adding a request-body schema, **do not name it `<OperationId>Body`** —
orval auto-generates a zod const under that exact name and the barrel fails with
TS2308. See `.agents/memory/orval-body-schema-naming.md`.

`format: date` in the spec generates `zod.date()`, which rejects query strings.
Use a patterned string (`^\d{4}-\d{2}-\d{2}$`) so dates stay strings end to end.

### Authorization is the app's database, never Clerk

Clerk (`@clerk/express` on the server, `@clerk/react` in the browser) is an
**identity provider only**. It establishes a verified email address and nothing
more. Clerk `publicMetadata` is never read — anything that can write it could
otherwise grant itself a role. See `.agents/memory/clerk-role-source-of-truth.md`.

Every protected endpoint is declared:

```ts
router.post(
  "/cases",
  requireWorkspace, // identity + membership, re-read from the DB every request
  requireCapability("cases.write"), // the capability matrix
  async (req: AuthRequest, res) => {
    const c = ctx(req); // throws if requireWorkspace is missing
  },
);
```

The capability matrix lives in `artifacts/api-server/src/lib/permissions.ts` and
is the authoritative list of who may do what. Two things it is easy to get wrong:

- `senior_advocate` is **explicitly not** an admin — it lacks `kpi.read`,
  `billing.manage` and `access_control.manage`. Advocate is a practice tier, not
  a management one.
- Roles also carry a **row scope** (`all` / `assigned` / `own`), separate from
  capabilities. A capability check alone does not scope the rows returned.

**A user id proves nothing on its own** — every chamber's users share one table.
Anywhere a request names another user, verify they hold an active membership of
the _caller's_ workspace first. `billableClient()` in `routes/invoices.ts` is the
pattern.

Clerk is **passwordless by design**: OAuth (Google, custom Zoho OIDC) and email
one-time codes. There is no password field anywhere and `/sign-in` and
`/sign-up` redirect to `/portal`.

### Request pipeline order is the security model

`artifacts/api-server/src/app.ts` runs top to bottom and the order is
deliberate — the Razorpay webhook takes `express.raw()` **before**
`express.json()` (parsing and re-serialising breaks the HMAC); health and
preview routes mount **before** `clerkMiddleware`; the static SPA mounts
**last** so it can never shadow an `/api` route. `FLOW.md` §3 has the full
diagram. Routers are added in `routes/index.ts`.

Express matches routes in declaration order. A literal path must be declared
**before** a `/:id` on the same prefix, or it is read as an id — see
`/invoices/unbilled` and `/time-entries/timer`.

### Preview mode

Engages when `VITE_CLERK_PUBLISHABLE_KEY` is absent at build time (frontend) or
`DATABASE_URL` is absent (server). Auth is mocked and the database is PGlite —
Postgres compiled to WASM, so it is the same SQL dialect, not SQLite.

**Neither can be forced on in production.** The server refuses to mock auth or
fall back to PGlite when `NODE_ENV=production`, and there is no override.

PGlite builds its schema from `lib/db/src/preview.ts`, which is a list of
idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` statements run on every
boot. **A new column must be added there as well as to the schema file**, or it
will exist in production and not in preview.

PGlite is single-connection, so anything about concurrency cannot be proven
against it.

### Database

One table per file under `lib/db/src/schema/`. Drizzle + drizzle-zod.

Migrations live in `lib/db/drizzle/` and are applied by
`lib/db/migrate-on-boot.mjs`, which the root `start` script runs before the
server. It skips when `DATABASE_URL` is unset and is **fatal on failure** — a
server in front of a schema it disagrees with is worse than a deploy that did
not happen.

**Never write a destructive migration.** If a change needs a column dropped or
retyped with data in it, stop and describe the strategy first. Every migration
so far is additive and guarded with `IF NOT EXISTS`, which is what lets it
survive a database that `drizzle-kit push` touched first. Keep that.

`drizzle-kit push` is for local use only. It prompts, and in a non-interactive
environment it will either die or apply something nobody reviewed — it has
already asked to truncate `workspace_memberships` in production.

### Money and quantities

Every column ending `_minor` is **integer paise**. Money never touches a float.
Quantities ending `_milli` are thousandths, so 1.5 hours is `1500`.

Line amounts are **stored, never recomputed on read**, so a later change to the
rounding rule cannot make the stored row, the API response and the printed PDF
disagree. `artifacts/practice-portal/src/lib/format.ts` is the only place either
unit becomes text, and the only place text becomes either unit.

Invoice numbers come from a locked counter row (`SELECT … FOR UPDATE` in
`lib/invoice-number.ts`), not a Postgres sequence — sequences are documented as
non-gapless. Numbers are assigned at **issue**, never at draft.

### Frontend

React 19, wouter (not React Router), TanStack Query, Radix/shadcn, Tailwind 4.

Tailwind 4 is **CSS-first — there is no `tailwind.config`**. Everything lives in
`artifacts/practice-portal/src/index.css`. The design system is neumorphic:
`--lift` / `--sink` define the light and shadow, and every relief primitive
(`--raise*`, `--press*`) is written in terms of them, so the dark theme redefines
two values rather than twenty. Those primitives are wired into Tailwind's
`shadow-*` scale, so ordinary `Card` and `Button` pick them up. There is one
`--radius`.

Routes and nav both live in
`components/layout/dashboard-layout.tsx`; pages are lazy-loaded and guarded with
`<RequireCapability>`. Nav items are inside a dropdown, not visible links —
browser tests must open **"Open navigation menu"** first.

Use `userMessage()` from `lib/errors.ts` for anything shown to a user.
`ApiError.message` is written for a console and leads with the status code.

---

## Working practice

Branches are `beta/<phase-name>`; commits are small and explain _why_.

**`DECISIONS.md` and `FLOW.md` are updated in the same commit as the code they
describe** — DECISIONS for a non-obvious choice and its reasoning, FLOW for what
moved and where it sits in the request path. Letting them lag is a real failure
mode here.

After any change, `pnpm run typecheck`, `pnpm run lint` and `pnpm run build`
must all pass. `pnpm run check` covers the first two plus formatting.

### Deployment

Render service `lex-practice`, auto-deploying from `main`. It was created by
hand before `render.yaml` existed, **so Render does not read that file** — the
dashboard's Start Command is the one in effect, and it is out of step. This is
why migrations run from `pnpm run start` rather than from the start command.
`DEPLOYMENT.md` and `FLOW.md` §6 have the current state and what is still
outstanding.
