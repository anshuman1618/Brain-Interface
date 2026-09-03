# LEX Practice — Chamber Management

A private, invite-only practice-management platform for a law chamber: matters,
cause list, task and SLA tracking, consultation recording, and a read-only client
portal.

Built to two compliance constraints:

- **BCI Rule 36** — invite-only, no public listing, no solicitation. There is no
  open sign-up funnel; a new account reaches nothing until an admin approves it.
- **DPDP Act 2023** — role-scoped access enforced server-side, documents flagged
  encrypted at rest, and a delay/audit trail on task completion.

---

## Quick start (preview — no accounts, no database)

```bash
pnpm install
pnpm run preview
```

Then open **http://localhost:5000** and click **Set up a chamber**.

**The platform ships empty.** No sample chambers, no sample matters, no sample
users — every counter reads zero until you enter your own work. Sign in with any
address, create your chamber, and invite your team.

Under the hood:

| Dependency     | In preview                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| Clerk (auth)   | Mocked — any address you type is treated as verified. The access-list check that follows is the real one |
| Postgres       | File-backed Postgres (PGlite) in `.preview-data`, empty on first boot. **Data persists across restarts** |
| Speech-to-text | Mocked — stopping a recording produces a sample transcript                                               |

Everything is real application code against a real Postgres dialect; only the
external services are substituted.

### Preview persistence

Preview mode runs PGlite against a data directory (`PREVIEW_DATA_DIR`, default
`.preview-data`), so what you enter survives a restart. Delete that directory to
start over.

PGlite-on-disk rather than SQLite or lowdb, deliberately: those are different
storage engines with a different SQL dialect (or none). Every query here is
Drizzle-for-Postgres — `serial`, `timestamptz`, `ilike`, `returning()` — so
swapping engines would mean rewriting the data layer and leaving preview running
different SQL from production. A data directory gets the same durability with
zero dialect drift.

Schema upgrades are handled by idempotent `ALTER TABLE … ADD COLUMN IF NOT
EXISTS` statements that run on every boot, so a persisted database survives a
column being added instead of having to be thrown away.

For a real deployment, set `DATABASE_URL` and run
`pnpm --filter @workspace/db run migrate`.

> **Preview mode cannot be enabled in production.** The server refuses to mock
> auth or fall back to the in-memory database when `NODE_ENV=production`, and the
> frontend only enters preview mode when `VITE_CLERK_PUBLISHABLE_KEY` is absent
> at build time. There is no environment variable that overrides either rule.

## Quick start (real services)

```bash
pnpm install
cp .env.example .env        # fill in DATABASE_URL and Clerk keys
pnpm --filter @workspace/db run migrate       # apply the schema
VITE_CLERK_PUBLISHABLE_KEY=pk_... pnpm --filter @workspace/practice-portal run build
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run start
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the two supported hosting topologies
(single-origin, and split static frontend + separate API).

---

## Repository layout

| Path                        | What it is                                                          |
| --------------------------- | ------------------------------------------------------------------- |
| `artifacts/practice-portal` | Vite + React 19 SPA (Radix UI, Tailwind v4, wouter, TanStack Query) |
| `artifacts/api-server`      | Express 5 API; also serves the built SPA in single-origin mode      |
| `artifacts/mockup-sandbox`  | Replit-only UI mockup sandbox, not part of the product              |
| `lib/db`                    | Drizzle ORM schema, connection, and the preview database            |
| `lib/api-spec`              | OpenAPI spec — the source of truth for the API contract             |
| `lib/api-zod`               | Zod validators generated from the spec                              |
| `lib/api-client-react`      | React Query hooks generated from the spec                           |
| `scripts/ci`                | Integration suites, browser suites, and the startup guards          |
| `docs/legal`                | Terms, privacy policy, DPDP notice, DPA — served at `/legal/<slug>` |

`lib/api-zod` and `lib/api-client-react` are **generated**. After changing
`lib/api-spec/openapi.yaml`, regenerate rather than editing them by hand:

```bash
pnpm --filter @workspace/api-spec run codegen
```

## Sign-in providers

**Passwordless only.** There is no password field anywhere in this app, no
password strategy is ever attempted, and `/sign-in` and `/sign-up` redirect to
`/portal`. (Clerk's hosted `<SignIn>`/`<SignUp>` components used to live on those
routes; they render whatever the Clerk dashboard enables, including a password
field, so they were removed rather than configured around.)

The chamber portal (`/portal`) offers three ways in:

| Provider  | Clerk strategy      | Notes                                                                                    |
| --------- | ------------------- | ---------------------------------------------------------------------------------------- |
| Google    | `oauth_google`      | Built into Clerk. Enable under **SSO connections**.                                      |
| Zoho Mail | `oauth_custom_zoho` | **Not** a Clerk built-in — add a _custom OAuth connection_ with the slug `zoho` (below). |
| Email     | one-time code       | Clerk's `emailCode` strategy — send, then verify, in the app's own UI.                   |

All three do the same job and nothing more: they establish a **verified email
address**. Which chamber that address may enter, and as what, is decided
afterwards by the access list. Adding a provider therefore cannot widen access.

### Configuring Zoho

Clerk has no built-in Zoho provider, so it is wired as a custom OIDC connection:

1. In the [Zoho API console](https://api-console.zoho.com/), create a
   **Server-based Application**. Note the Client ID and Client Secret.
2. Set the authorised redirect URI to the callback Clerk shows you when creating
   the connection in step 3.
3. In the Clerk dashboard → **SSO connections → Add connection → Custom
   provider**, set:
   - **Slug**: `zoho` — this must match, since the app requests
     `oauth_custom_zoho`.
   - **Authorization URL**: `https://accounts.zoho.com/oauth/v2/auth`
   - **Token URL**: `https://accounts.zoho.com/oauth/v2/token`
   - **User info URL**: `https://accounts.zoho.com/oauth/user/info`
   - **Scopes**: `AaaServer.profile.READ email profile openid`
   - Client ID and Secret from step 1.
4. Use the regional Zoho domain if your tenant is not on `.com`
   (`accounts.zoho.in`, `accounts.zoho.eu`, …).

If the connection is absent, the Zoho button reports that the provider is not
enabled rather than failing silently.

## Getting in

There are exactly two ways into a chamber, and no third.

**1. Found one.** Sign in, then create a chamber and choose whether you run it as
**Firm Admin** or **Senior Advocate**. This is the only place anyone picks their
own role, and it is safe because the workspace did not exist a moment ago —
becoming Admin of a chamber you just created grants nothing over anybody else's.

Whichever role you pick you are also the chamber's **owner**, which adds the
management capabilities on top of it. That is what lets a Senior Advocate who set
up their own practice invite their clerk. Ownership is set once, by the
create-chamber endpoint, for the caller creating it; it cannot be requested,
granted or edited afterwards, and it means nothing in any other chamber.

**2. Be invited.** An admin adds your address in Access Control, at a role they
choose. Sign in with that address and you are in. There is no separate "redeem"
step: the invite writes the access-list entry, so a circulating link can never
grant more than the admin intended.

Everything else — Junior Advocate, Clerk / Intern, Client — is invite-only.

## Who may sign in — the access list

Google and Zoho will authenticate **anybody with an account**. They say who you
are; they say nothing about whether you belong here. `workspace_access_list` is
what closes that gap:

```
workspace_access_list
  workspace_id   the chamber this admits you to
  kind           'email' (one address) | 'domain' (every address at a domain)
  value          normalised, e.g. "krishnan@chambers.in" or "chambers.in"
  role           the role granted on first sign-in — chosen by the admin
```

On sign-in the verified address is matched against this table. A match creates an
`active` membership at the listed role; no match means `accessStatus:
not_recognised`, an error screen naming the refused address, and `403` from every
protected endpoint.

- **Only an admin writes it.** `access_control.manage` is required, and entries
  are scoped to the admin's own workspace — an admin of one chamber cannot admit
  anyone to another.
- **An exact address beats a domain rule.** A domain rule can onboard a firm's
  Google Workspace or Zoho tenant at a default role while individuals are pinned
  to something else.
- **Only verified addresses are matched.** An unverified Clerk email is stored as
  empty and matches nothing — otherwise anyone could claim a colleague's address
  and inherit their role.
- **Revoking is not retroactive.** Removing an entry stops _future_ sign-ins.
  Someone already admitted keeps their membership until it is revoked in Team
  Roles. The UI says so on both screens.

## Zero-trust workspaces

A **workspace** is the tenant boundary. Every matter, task, document,
consultation and document request belongs to exactly one, and the only thing
that grants access to one is an `active` row in `workspace_memberships`.

```
users ──< workspace_memberships >── workspaces
              │  role      (admin | senior_advocate | junior_advocate | clerk_intern | client)
              │  status    (pending | active | revoked)   ← only 'active' grants anything
              └─ requested_role                            ← what they asked for; never read for authz
```

**Nothing else grants access.** In particular:

- **Sign-up grants nothing.** The pre-auth role picker is a preview and an
  access-request _intent_. Clerk's `publicMetadata` is not consulted at all —
  it used to seed the role, which meant anything that could write metadata could
  hand itself `admin`. A new account whose address is on no access list is
  **refused**; one that has asked for access sits in **Pending Approval**. Both
  reach nothing: every protected endpoint answers `403`.
- **An admin decides the role, not the applicant.** Approval takes the role from
  the admin's decision body; `requested_role` is stored for their information and
  read by no authorization path. The grant selector defaults to Client.
- **`admin` is not a global rank.** It means admin _of that workspace_. An admin
  of one chamber gets `403`/`404` against another's data, members and requests.
- **The client never computes permissions.** `GET /session` returns a
  server-resolved `capabilities` list; the UI renders from it and nothing else.
  Editing it, or `localStorage`, changes nothing — the guard re-derives
  capabilities from the membership row on every request.

### Request path

Every protected endpoint runs through `requireWorkspace` (see
`artifacts/api-server/src/middlewares/requireAuth.ts`):

1. Resolve the user from the Clerk session (or preview bearer token).
2. Resolve the requested workspace from `X-Workspace-Token` (HMAC-signed by us at
   switch time), else `X-Workspace-Id`, else their sole active membership. A
   token that is present but does not verify is a hard `401`, never a silent
   fallback.
3. **Re-read the membership row from the database.** No active membership of that
   workspace → `403`.
4. `requireCapability(...)` then checks the action against the matrix in
   `lib/permissions.ts`.

The signed token proves the switch was authorized; the database check is what
makes a revocation or demotion take effect on the _next request_ rather than at
token expiry. Both run, every time.

### Capability matrix

| Tier            | Role              | Reaches                                                                                                                   | Refused                                                                    |
| --------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Admin           | `admin`           | Everything in their workspace: KPI engine, billing, access control, team roles, **task assignment**, **calendar updates** | Any other workspace                                                        |
| Senior Advocate | `senior_advocate` | Matters, drafting, consultation recorder, document requests, **task assignment**, **calendar updates**                    | KPI engine, billing, access control, team roles                            |
| Junior Advocate | `junior_advocate` | Matters, drafting, consultations, document requests. Completes work                                                       | **Assigning work**, posting calendar updates, KPI, billing, access control |
| Clerk / Intern  | `clerk_intern`    | Their calendar, and only matters they hold a task on                                                                      | Assigning work, billing, unassigned matters                                |
| Client          | `client`          | Their own matters (read-only), files shared with them, fulfilling document requests, leaving feedback                     | **The master calendar**, firm-internal documents, everything else          |

**Only Admin and Senior Advocate direct work.** They alone hold `tasks.write`
and `calendar.write` — assigning a task and posting a chamber-wide update are the
same boundary. A Junior Advocate completes what they are given but cannot hand
work to anyone.

**Admin is not "everything".** `feedback.write` — leaving a rating on a matter —
is client-only and explicitly withheld from admin. Handing it over along with the
rest would let a chamber post five-star reviews of itself. Admin still reads every
rating and may reply; it cannot author one.

A chamber's **owner** additionally holds `access_control.manage`, `team.manage`
and `billing.manage` whichever of the two roles they founded it as.

Row scope is enforced separately from workspace scope: a clerk is a legitimate
member of the chamber but still sees only their assigned matters, and a client
only their own. See `artifacts/api-server/src/lib/scope.ts`.

### Frontend guards

Restricted routes are wrapped in `<RequireCapability>`, not merely hidden from
the nav — navigating straight to `/kpi` without the backend claim redirects to a
`401 Unauthorized` page. That guard is a courtesy: bypassing it renders an empty
page, because every endpoint behind it re-checks independently.

## Core flows

- **Master calendar** — an interactive month/week/day/agenda grid
  (react-big-calendar) with full CRUD and drag-to-reschedule. Two sources share
  it: chamber cause-list entries, and task deadlines drawn in for context.
  Dragging an entry moves it; dragging a deadline reschedules the task, which is
  why that needs `tasks.write` rather than `calendar.write`. An entry carries an
  audience (`all`, `staff`, a role, or one person) and the filter runs in the
  API, so a clerk never receives a notice addressed to advocates. **Staff only** —
  the client portal has no calendar.
- **Documents** — bi-directional. The chamber uploads case files marked either
  `firm` (internal working material) or `shared` (visible to the client), raises
  document requests, and sees what has come back. A client sees only `shared`
  files and the requests addressed to them, and uploading against a request marks
  it fulfilled and notifies whoever raised it. A client's upload is forced to
  `shared` server-side regardless of what the request says — a client cannot
  create firm-internal material.
- **Client feedback** — a client rates their own matters 1–5 with an optional
  comment. Staff read every rating and may reply, but the reply is a separate
  field: nobody can edit or delete what a client wrote, because a review the
  subject can silently rewrite is not feedback.
- **SLA delay logging** — completing a task after its deadline is refused
  (`422`) unless a delay reason is supplied. Reasons are a fixed set:
  `client_unresponsive`, `court_delay`, `document_missing`,
  `resource_unavailable`, `other`. The UI additionally requires a proof
  attachment before enabling Confirm.
- **Consultation recorder** — recording cannot start until consent is recorded
  on-device. Stopping the recording generates the transcript **server-side**, so
  the client never invents an audio URL or transcript of its own.
- **Document requests** — an advocate requests a document from a named client;
  both ends of the request are recorded and displayed (who it is _from_ and who
  raised it, with their role), along with an optional due date. The client sees
  it in their portal and uploads against it.
- **Task assignment** — Admin and both Advocate tiers can create a task on any
  matter in the workspace and assign it to a member. The assignee list is
  workspace-scoped, and the API re-checks the assignee's membership on submit.
- **Access requests & approval** — an applicant's request lands in the admin's
  Access Control queue, showing what they asked for alongside a separate
  grant-role selector that defaults to Client.

## Commands

| Command                                            | Does                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm run preview`                                 | Build everything and serve the full app in preview mode on :5000  |
| `pnpm run typecheck`                               | Typecheck every package                                           |
| `pnpm run build`                                   | Typecheck, then build every package                               |
| `pnpm run lint`                                    | ESLint over the whole workspace                                   |
| `pnpm run lint:fix`                                | ESLint with `--fix`                                               |
| `pnpm run format`                                  | Rewrite every file with Prettier                                  |
| `pnpm run format:check`                            | Fail if anything is unformatted (use in CI)                       |
| `pnpm run check`                                   | `format:check` + `lint` + `typecheck` — the full gate             |
| `pnpm --filter @workspace/api-server run dev`      | Build and run the API                                             |
| `pnpm --filter @workspace/practice-portal run dev` | Vite dev server on :5173                                          |
| `pnpm --filter @workspace/db run migrate`          | Apply committed migrations (this is what production runs)         |
| `pnpm --filter @workspace/db run generate`         | Write a new migration after changing the schema                   |
| `pnpm --filter @workspace/db run push`             | Diff the schema straight onto a database — local development only |

### Formatting and linting

Prettier owns formatting; ESLint owns everything else (`eslint-config-prettier`
switches off the stylistic rules so the two never disagree). The lint config is
deliberately not type-aware — `pnpm run typecheck` already runs the compiler, so
ESLint is here for what tsc cannot see: a mis-ordered hook, an unused binding, a
stray `any`.

Generated code is excluded from both. `lib/api-zod` and `lib/api-client-react`
are written by orval, so reformatting them would be undone by the next codegen
run.

The repository-wide formatting sweep is listed in `.git-blame-ignore-revs`:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## Environment variables

See `.env.example`. In short:

| Variable                     | Required      | Notes                                                                                                                                                 |
| ---------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`               | production    | Absent outside production → in-memory preview database                                                                                                |
| `CLERK_SECRET_KEY`           | production    | Absent outside production → auth is mocked                                                                                                            |
| `CLERK_PUBLISHABLE_KEY`      | production    | Server-side Clerk key                                                                                                                                 |
| `VITE_CLERK_PUBLISHABLE_KEY` | build time    | Absent → frontend builds in preview mode                                                                                                              |
| `VITE_API_BASE_URL`          | split hosting | Absolute API origin; unset means same-origin                                                                                                          |
| `CORS_ALLOWED_ORIGINS`       | split hosting | Comma-separated; production sends no CORS headers without it                                                                                          |
| `PORT` / `HOST`              | no            | Default `5000` / `0.0.0.0`                                                                                                                            |
| `CLIENT_DIST_PATH`           | no            | Override where the API reads the built SPA from                                                                                                       |
| `PREVIEW_DATA_DIR`           | no            | Where the file-backed preview database lives. Default `.preview-data`; delete it to start over                                                        |
| `WORKSPACE_TOKEN_SECRET`     | recommended   | Signs scoped workspace tokens. Unset → a random per-process secret, so tokens die on restart and clients re-switch (fine in dev, not across replicas) |

Google, Zoho and email sign-in are configured in the Clerk dashboard, not by
environment variable — see [Sign-in providers](#sign-in-providers).

## Theming

Light is the strict default. The theme provider (`next-themes`, Tailwind's
`class` strategy) runs with `enableSystem={false}` — without that, a viewer whose
OS is set to dark would get a dark portal on first load, which is not what "light
by default" means. Dark is opt-in through the header toggle and remembered per
browser.

`color-scheme` flips with the class, so the browser's own chrome — scrollbars,
date pickers, native selects — matches rather than staying light on a dark page.
react-big-calendar ships fixed light colours, so `src/styles/calendar.css`
re-points it at the app's design tokens and it follows the toggle for free.

## Conventions worth knowing

- **`/api/*` always answers JSON**, including `404` and `500`. The SPA fallback
  deliberately skips `/api`, so a typo'd endpoint can never return `index.html`
  with a `200`.
- **Caching**: `index.html` is `no-cache`; fingerprinted `/assets` are immutable.
- **`clerkMiddleware` is scoped to `/api`**, never mounted globally — applied to
  the SPA's HTML request it issues a handshake redirect and the site bounces to
  Clerk instead of rendering.
- **Health check is mounted ahead of auth**, so `/api/healthz` stays green when
  Clerk is misconfigured and deploy gates report the real problem.
