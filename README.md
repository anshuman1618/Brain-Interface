# LEX Practice — Chamber Management

A private, invite-only practice-management platform for a law chamber: matters,
cause list, task and SLA tracking, consultation recording, and a read-only client
portal.

Built to two compliance constraints:

- **BCI Rule 36** — invite-only, no public listing, no solicitation. There is no
  open sign-up funnel; accounts arrive through an admin-issued invite.
- **DPDP Act 2023** — role-scoped access enforced server-side, documents flagged
  encrypted at rest, and a delay/audit trail on task completion.

---

## Quick start (preview — no accounts, no database)

```bash
pnpm install
pnpm run preview
```

Then open **http://localhost:5000**.

This boots the whole platform with **no external services configured**: pick a
role on the landing screen and explore. Under the hood:

| Dependency | In preview |
| --- | --- |
| Clerk (auth) | Mocked — you choose a role instead of signing in |
| Postgres | In-memory Postgres (PGlite), seeded with sample matters |
| Speech-to-text | Mocked — stopping a recording produces a sample transcript |

Everything is real application code against a real Postgres dialect; only the
external services are substituted. Data resets when the process exits.

> **Preview mode cannot be enabled in production.** The server refuses to mock
> auth or fall back to the in-memory database when `NODE_ENV=production`, and the
> frontend only enters preview mode when `VITE_CLERK_PUBLISHABLE_KEY` is absent
> at build time. There is no environment variable that overrides either rule.

## Quick start (real services)

```bash
pnpm install
cp .env.example .env        # fill in DATABASE_URL and Clerk keys
pnpm --filter @workspace/db run push          # apply the schema
VITE_CLERK_PUBLISHABLE_KEY=pk_... pnpm --filter @workspace/practice-portal run build
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run start
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the two supported hosting topologies
(single-origin, and split static frontend + separate API).

---

## Repository layout

| Path | What it is |
| --- | --- |
| `artifacts/practice-portal` | Vite + React 19 SPA (Radix UI, Tailwind v4, wouter, TanStack Query) |
| `artifacts/api-server` | Express 5 API; also serves the built SPA in single-origin mode |
| `artifacts/mockup-sandbox` | Replit-only UI mockup sandbox, not part of the product |
| `lib/db` | Drizzle ORM schema, connection, and the preview database |
| `lib/api-spec` | OpenAPI spec — the source of truth for the API contract |
| `lib/api-zod` | Zod validators generated from the spec |
| `lib/api-client-react` | React Query hooks generated from the spec |

`lib/api-zod` and `lib/api-client-react` are **generated**. After changing
`lib/api-spec/openapi.yaml`, regenerate rather than editing them by hand:

```bash
pnpm --filter @workspace/api-spec run codegen
```

## Roles

Five stored roles map onto four access tiers. `senior_advocate` and
`junior_advocate` are both Advocate — neither has admin access.

| Tier | Stored role | Can reach | Blocked from |
| --- | --- | --- | --- |
| Admin | `admin` | Everything: firm oversight, KPI engine, billing, access control, task override | — |
| Advocate | `senior_advocate`, `junior_advocate` | Matters, calendar, drafting, consultation recorder, document requests | KPI engine, billing, access control |
| Clerk / Intern | `clerk_intern` | Dashboard, calendar, tasks assigned to them | Billing, unassigned matters |
| Client | `client` | Their own matters (read-only), document upload, consultation requests, direct complaint to admin | Everything else |

Two rules this codebase treats as load-bearing:

1. **Role lives in the app database, never in Clerk metadata.** Clerk session
   claims only refresh on token rotation, so an admin demoting a user would not
   take effect until their token happened to refresh. Authorization reads
   `users.role`; see `.agents/memory/clerk-role-source-of-truth.md`.
2. **Authorization is enforced server-side.** The UI hides what a role cannot
   reach, but every route re-checks independently — hiding a nav item is not
   access control.

## Core flows

- **Cause list & calendar** — matters listed by date with drag-to-reschedule.
- **SLA delay logging** — completing a task after its deadline is refused
  (`422`) unless a delay reason is supplied. Reasons are a fixed set:
  `client_unresponsive`, `court_delay`, `document_missing`,
  `resource_unavailable`, `other`. The UI additionally requires a proof
  attachment before enabling Confirm.
- **Consultation recorder** — recording cannot start until consent is recorded
  on-device. Stopping the recording generates the transcript **server-side**, so
  the client never invents an audio URL or transcript of its own.
- **Document requests** — an advocate requests a document; the client sees it in
  their portal and uploads against it.

## Commands

| Command | Does |
| --- | --- |
| `pnpm run preview` | Build everything and serve the full app in preview mode on :5000 |
| `pnpm run typecheck` | Typecheck every package |
| `pnpm run build` | Typecheck, then build every package |
| `pnpm --filter @workspace/api-server run dev` | Build and run the API |
| `pnpm --filter @workspace/practice-portal run dev` | Vite dev server on :5173 |
| `pnpm --filter @workspace/db run push` | Push schema changes (real database only) |

## Environment variables

See `.env.example`. In short:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | production | Absent outside production → in-memory preview database |
| `CLERK_SECRET_KEY` | production | Absent outside production → auth is mocked |
| `CLERK_PUBLISHABLE_KEY` | production | Server-side Clerk key |
| `VITE_CLERK_PUBLISHABLE_KEY` | build time | Absent → frontend builds in preview mode |
| `VITE_API_BASE_URL` | split hosting | Absolute API origin; unset means same-origin |
| `CORS_ALLOWED_ORIGINS` | split hosting | Comma-separated; production sends no CORS headers without it |
| `PORT` / `HOST` | no | Default `5000` / `0.0.0.0` |
| `CLIENT_DIST_PATH` | no | Override where the API reads the built SPA from |

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
