# How execution travels through this codebase

Read this to find out where things happen. It follows real code paths — file
and function names are as they appear in the repository, so you can jump
straight to them.

Companion document: `DECISIONS.md` explains _why_ these choices were made.
Deployment reference: `DEPLOYMENT.md` is the full runbook; §"Going live" at the
bottom of this file is the short path through it.

---

## 1. The shape of the repository

A pnpm workspace. Four kinds of package:

```
artifacts/api-server        Express 5 API. ALSO serves the built frontend.
artifacts/practice-portal   React 19 + Vite SPA. The actual product UI.
artifacts/mockup-sandbox    Standalone design sandbox. Not part of the product.

lib/db                      Drizzle schema + client. The only place SQL lives.
lib/api-spec                OpenAPI 3.1 document — the API contract.
lib/api-zod                 GENERATED from api-spec. Request/response schemas.
lib/api-client-react        GENERATED from api-spec. React Query hooks.

scripts/                    CI checks, browser tests, startup guards.
```

**`lib/api-zod` and `lib/api-client-react` are generated. Do not hand-edit them.**
Change `lib/api-spec`, re-run codegen, and both sides update together.

---

## 2. There are two entry points

The product is one deployed process but two programs: a Node server and a
browser application. They are built separately and meet over HTTP.

### 2a. Server entry — `artifacts/api-server/src/index.ts`

This file runs top to bottom at startup. **Order matters and is deliberate:**

```
1. installProcessHandlers()            lib/error-reporter.ts
      Registers uncaughtException / unhandledRejection FIRST, so a crash
      during the rest of startup is still reported.

2. assertProductionConfig(warn)        lib/preflight.ts
      Checks FILE_ENCRYPTION_KEY, DATABASE_URL, CLERK_SECRET_KEY,
      CLERK_PUBLISHABLE_KEY together. Throws ONCE listing everything
      missing. Only active when NODE_ENV=production.

3. assertEncryptionConfigured(warn)    lib/blob-store.ts
      Kept as its own guard behind the preflight, because writing
      privileged client files in the clear is worse than not starting.

4. await initDatabase()                lib/db/src/index.ts
      MUST be awaited before anything queries. `db` is a Proxy that
      throws until this resolves. Connects to Postgres, or boots PGlite
      (Postgres-in-WebAssembly) when DATABASE_URL is absent — and refuses
      that fallback when NODE_ENV=production.

5. startReminderScheduler()            lib/reminder-scheduler.ts
      Background timer for hearing/task reminders. Needs the db from 4.

6. app.listen(port, host)              app comes from ./app
      PORT from the host (Render/Railway/Fly inject it), else 5000.
      Binds 0.0.0.0 — a 127.0.0.1 bind is unreachable from outside a
      container.
```

Then `SIGTERM`/`SIGINT` install a graceful shutdown that drains in-flight
requests before closing, with a 10-second forced exit.

### 2b. Browser entry — `artifacts/practice-portal/src/main.tsx`

Three lines:

```tsx
createRoot(document.getElementById("root")!).render(<App />);
```

`index.css` is imported here — that is where the whole design token layer lives.

---

## 3. The server: how one request travels

Every request walks `artifacts/api-server/src/app.ts` **from top to bottom**.
This is the single most important file to understand. The order is the security
model.

```
  incoming request
        │
  ①  pinoHttp                      structured request logging
        │
  ②  securityHeaders()             middlewares/securityHeaders.ts
        │                          HSTS, X-Frame-Options, nosniff, …
        │
  ③  /__clerk/* → clerkProxyMiddleware
        │
  ④  CORS                          only if CORS_ALLOWED_ORIGINS is set.
        │                          In production with it unset: NO CORS
        │                          headers at all (same-origin deployment).
        │
  ⑤  POST /api/billing/webhook  ◄── express.raw(), BEFORE express.json()
        │                          The provider signs the exact bytes. Parsing
        │                          and re-serialising breaks the HMAC.
        │                          → handleRazorpayWebhook()  routes/billing.ts
        │
  ⑥  express.json() / urlencoded   body parsing for everything else
        │
  ⑦  /api → healthRouter           routes/health.ts   ── BEFORE auth, on purpose
        │  /api → previewRouter       routes/preview.ts
        │
  ⑧  /api → clerkMiddleware        scoped to /api, NOT global.
        │                          (skipped entirely in preview mode)
        │
  ⑨  rate limits, strictest first  middlewares/rateLimit.ts
        │    /api/session          30/min   ← sign-in path, tightest
        │    /api/workspaces       30/min
        │    /api/access-requests  20/min
        │    /api/privacy          20/min per user
        │    /api  non-GET        120/min per user
        │    /api  GET            unlimited
        │
  ⑩  /api → billingRouter          routes/billing.ts
        │  /api → router              routes/index.ts  ← all feature routes
        │
  ⑪  /api → 404 JSON               unmatched API paths answer in JSON, never
        │                          HTML and never the SPA shell
        │
  ⑫  legalRouter                   routes/legal.ts — /legal/{terms,privacy,
        │                          notice,dpa}. Outside /api because someone
        │                          who never signs in must be able to read them.
        │
  ⑬  mountStaticClient(app)        middlewares/staticClient.ts
        │                          Serves the built SPA + history fallback.
        │                          LAST, so it can never shadow an /api route.
        │
  ⑭  terminal error handler        logs, reports, and answers JSON for /api
                                   or text/plain otherwise — never an HTML
                                   stack trace.
```

### The feature routes

`routes/index.ts` mounts fifteen routers on `/api`. `sessionRouter` is first
because it owns `/session` and `/workspaces` — the only endpoints a user with no
active membership may reach.

```
session  users  cases  documents  tasks  consultations  kpi  invites
notifications  document-requests  search  calendar  feedback
subscription  governance
```

### The authorisation gate — `middlewares/requireAuth.ts`

Every protected endpoint is declared like this:

```ts
router.post("/cases",
  requireWorkspace,                 // ← identity + membership, from the DB
  requireCapability("cases.write"), // ← may this role do this action?
  async (req: AuthRequest, res) => {
    const c = ctx(req);             // ← throws if requireWorkspace is missing
    …
  });
```

**`requireWorkspace`** runs on every request and does this, in order:

1. `getOrCreateUser(req)` → resolves the Clerk ID (or, in preview mode only, the
   preview bearer token). No user → **401**.
2. `listActiveMemberships(user.id)` → **queries the database**. This is the
   decision that makes revocation immediate; see `DECISIONS.md`. Zero
   memberships → **403 `no_active_membership`** (the Pending Approval screen).
3. `requestedWorkspaceId(req)` → reads the `x-workspace-token` header, an
   HMAC-signed token (`lib/workspace-token.ts`). Invalid → **401
   `invalid_workspace_token`**.
4. Matches the requested workspace against the memberships just read.
   No match → **403 `not_a_member`** or **`workspace_not_selected`**.
5. Builds `req.ctx` — user, workspace, role, capabilities, and the case/task
   **scopes** used to filter every subsequent query.

**`requireCapability(...)`** then checks `req.ctx.capabilities`, which came from
the database in step 5 — never from anything the client sent. Missing → **403
`missing_capability`**, naming what was required.

`ctx(req)` throws if `requireWorkspace` was not mounted. That turns "somebody
forgot the guard" from a silent security hole into a crash on first call.

**Row-level scoping** is separate and additional: `lib/scope.ts`
(`getVisibleCase`, `visibleCaseIds`) narrows _which rows_ a role may see, on top
of the workspace boundary.

Supporting libraries a route typically reaches for:

```
lib/permissions.ts   role → capability mapping (one place)
lib/scope.ts         which rows this role can see
lib/quota.ts         subscription plan limits
lib/audit.ts         recordAudit() — append-only privileged-action log
lib/timeline.ts      addTimelineEvent() — per-matter history
lib/conflicts.ts     screenForConflicts() — conflict-of-interest check
lib/blob-store.ts    encrypted file read/write
lib/mailer.ts        outbound email with retry
lib/plans.ts         plan catalogue; prices recomputed server-side
```

---

## 4. The browser: how the app boots and routes

### `App.tsx` — the fork at the top

```
<ThemeProvider>
   │
   └─ isPreviewMode ? <PreviewApp/> : <ClerkApp/>
```

Two entirely separate trees. **Preview mode renders no `ClerkProvider` at all** —
Clerk hooks throw outside one, so a mocked session has to _replace_ it rather
than sit alongside it.

### The production tree

```
<WouterRouter base={basePath}>
  <ClerkProvider appearance={clerkAppearance}>   ← the sign-in widget's styling
    <QueryClientProvider>                        ← TanStack Query cache
      <ClerkSessionProvider>                     ← lib/session.tsx
        <TooltipProvider>
          <ClerkQueryClientCacheInvalidator/>    ← clears cache on user change
          <Switch>
            /                → HomeRedirect       (signed in → /dashboard,
            /portal          → PortalSignInPage    signed out → LandingPage)
            /portal/callback → AuthenticateWithRedirectCallback
            /sign-in, /sign-up → Redirect to /portal   ← passwordless only
            /:rest*          → DashboardLayout    ← everything else
```

Routing is **wouter**, not Next.js and not React Router. There is no `app/`
directory and no file-based routing — routes are the `<Route>` elements above.

### Where authorisation surfaces in the UI

`lib/session.tsx` exposes `useSession()`, giving `can(capability)`,
`activeWorkspace`, `isSignedIn`, and the identity. **`can()` reads capabilities
the server issued.** It decides what to _render_. It is never the check that
matters — every capability gated in the UI is checked again by
`requireCapability` on the server.

### How a screen fetches data

Components call generated hooks from `@workspace/api-client-react`:

```tsx
const { data: kpi, isLoading } = useGetKpiDashboard();
const { data: tasks } = useListTasks(undefined, {
  query: { refetchInterval: 30000, queryKey: getListTasksQueryKey() },
});
```

These are generated from `lib/api-spec`. The full round trip:

```
component
  → useListTasks()                      lib/api-client-react (generated)
  → HTTP GET /api/tasks                 same origin; cookie carries the session
  → app.ts middleware chain (§3)
  → routes/tasks.ts
  → requireWorkspace → requireCapability
  → lib/scope.ts narrows the rows
  → drizzle query via `db`              lib/db
  → response validated against lib/api-zod
  → TanStack Query caches it
  → component re-renders
```

### The design token layer — `src/index.css`

One file drives the entire visual system. Four blocks, in order:

1. **`@theme inline`** — maps CSS variables onto Tailwind utilities.
   `--color-*` for colours, `--radius-*` for geometry, and `--shadow-*` for the
   relief scale. The `inline` keyword is load-bearing: it makes the utility emit
   `var(--raise-sm)` rather than freezing a value, so relief resolves per
   element and per theme.
2. **`:root`** — the light palette as HSL triples, plus `--lift` / `--sink` (the
   two colours all relief is built from) and the `--raise*` / `--press*`
   definitions written in terms of them.
3. **`.dark`** — redefines the palette and, crucially, just `--lift` and
   `--sink`. That inverts every raised and recessed surface in the app.
4. **`@layer base`** — the discipline rule: `input`, `textarea` and
   `[data-slot="select-trigger"]` get `box-shadow: var(--press-sm)`. Applied at
   the element level so Clerk's hosted fields get it too.

To change the look of the whole application, edit block 2 and 3. Almost nothing
else needs touching.

---

## 5. What changed in this session

Six branches, each stacked on the last, **none merged to `main`** — so none of
it is deployed. `beta/phase-8-beta-readiness` is the tip and contains all nine
commits.

```
main (282959e)
 └─ beta/phase-1-signup            3 commits   sign-up flow defects
     └─ beta/phase-2-dashboard-filing  +1      file a case from the dashboard
         └─ beta/phase-3-filing-reference +1   filing reference made mandatory
             └─ beta/phase-4-notes-labels  +1  "(optional)" removed from Notes
                 └─ beta/phase-5-design    +2  design pass, all pages
                     └─ beta/phase-8-beta-readiness +1  migrations, health, feedback
```

### Phase 1 — sign-up (`91cec6d`, `ff1e2fb`, `8711fc3`)

| File                                                                  | Change                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-server/src/lib/jit.ts`                                           | `getOrCreateUser` now absorbs a concurrent insert (`onConflictDoNothing` → re-select) and re-reads Clerk when the stored email is empty. Two 500s on a new user's first request.                                                                  |
| `api-server/src/routes/session.ts`                                    | Chamber founding moved into `foundChamber()`: one transaction, retries the next slug on a unique violation. Zod failures return a sentence.                                                                                                       |
| `api-server/src/lib/validation.ts`                                    | **New.** `zodMessage()` — first issue, field-prefixed.                                                                                                                                                                                            |
| `practice-portal/src/lib/errors.ts`                                   | **New.** `userMessage()` — prefers the server's `message`, falls back per status.                                                                                                                                                                 |
| `practice-portal/src/lib/session.tsx`                                 | One-time code state (`pendingCode`) persists in `sessionStorage`; `resendCode()` re-sends on the leg that issued the code.                                                                                                                        |
| `practice-portal/src/pages/portal-sign-in.tsx`                        | Inline field errors, email pattern matched to the API, 6-digit code gate.                                                                                                                                                                         |
| `practice-portal/src/pages/access-denied.tsx`, `pending-approval.tsx` | Request-access form removed (it posted to a hardcoded slug that 404'd). Pending Approval now offers a chamber picker when the user has several active memberships — that state used to claim their access was awaiting approval, with no way out. |

### Phase 2 — dashboard filing (`002a1f6`)

| File                                                 | Change                                                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `practice-portal/src/components/case-form-modal.tsx` | **New.** The filing dialog, lifted whole out of `cases.tsx` — conflict screening and plan-limit handling included. |
| `practice-portal/src/pages/dashboard.tsx`            | "File New Case" in the header block; zero-case state offers it; mounts the modal.                                  |
| `practice-portal/src/pages/cases.tsx`                | 472 → 259 lines, now consumes the shared modal. Two distinct empty states.                                         |

### Phase 3 — mandatory filing reference (`7bcc7ed`)

Four layers, in order. `lib/db/src/schema/cases.ts` (`NOT NULL`, no default) →
`lib/api-spec/openapi.yaml` (required, `minLength: 3`; regenerated into
`lib/api-zod` and `lib/api-client-react`) → `api-server/src/routes/cases.ts`
(readable 400, trims and re-checks) → `case-form-modal.tsx` (`*` marker, submit
gated, inline error). Twelve fixtures across four CI suites updated.

### Phase 4 — Notes labels (`136a840`)

Seven one-line changes: `task-form-modal`, `tasks`, `case-detail`, `calendar`,
`documents`, `document-request-modal`, `access-list-manager`. Label text only —
no validator moved. There is no i18n layer; every label is inline.

### Phase 5 — design (`43e9ae8`, `bfa6a04`)

| File                                         | Change                                                                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `practice-portal/src/index.css`              | `--text-3xs` / `--text-2xs` added. Two comments claiming `.dark` was dormant corrected — `lib/theme.tsx` mounts next-themes with `attribute="class"`, so dark mode ships. |
| 21 files                                     | 55 one-off `text-[9/10/11px]` → the two tokens.                                                                                                                           |
| `styles/calendar.css`                        | Off-range day numbers lost their `/0.6` alpha: 2.38:1 light, 2.72:1 dark, against a 4.5 requirement.                                                                      |
| `pages/cases.tsx`                            | "medium"/"low" priority badges were 3.86:1 in dark at 10px.                                                                                                               |
| `pages/dashboard.tsx`                        | Stat cards and tiles go two-column at 375px (2713px → 2349px). Tiles take a focus ring. Empty states rewritten.                                                           |
| `pages/team.tsx`, `invites.tsx`, `cases.tsx` | Secondary table columns hidden below `sm`/`md` — headers, cells and skeleton cells together. `/team` 867px → 499px.                                                       |
| six pages                                    | Empty states that named an absence now say what the space is for.                                                                                                         |

### Phase 8 — beta readiness (`b932278`)

| File                                                                                                                                      | Change                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/db/drizzle/`                                                                                                                         | **New.** `0000_baseline.sql` (guarded with `IF NOT EXISTS`), `0001_filing_ref_not_null.sql`, `0002_beta_feedback.sql`, plus drizzle's `meta/`.                               |
| `lib/db/package.json`, `render.yaml`                                                                                                      | `drizzle-kit push` → `drizzle-kit migrate` in the start command. `push` had been dying on every boot with a TTY error, so the deployed schema had stopped tracking the code. |
| `api-server/src/routes/health.ts`                                                                                                         | **`/api/health`** — one query, 503 when the database is unreachable.                                                                                                         |
| `api-server/src/app.ts`                                                                                                                   | The non-API 500 is now a self-contained HTML page: no stylesheet, no script, no detail.                                                                                      |
| `practice-portal/src/components/error-boundary.tsx`                                                                                       | `RootErrorBoundary` added, wrapping the whole app outside the theme and Clerk providers.                                                                                     |
| `lib/db/src/schema/beta_feedback.ts`, `api-server/src/routes/beta-feedback.ts`, `practice-portal/src/components/beta-feedback-widget.tsx` | **New.** Feedback widget: message + page path + user id, behind `requireAuth` only, so it works on the access-denied screen.                                                 |
| `practice-portal/public/robots.txt`                                                                                                       | `Allow: /` → `Disallow: /`.                                                                                                                                                  |

### Phase 6 — time capture and performance (`5b1ffcb`)

| File                                                     | Change                                                                                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/db/src/schema/time_entries.ts`                      | **New.** The first time capture in the product. Minutes as integers, three indexes, a nullable `started_at` that marks a running timer.                                     |
| `lib/db/src/schema/cases.ts`                             | `closed_at` added — the end of the cycle-time clock.                                                                                                                        |
| `lib/db/drizzle/0003_*.sql`                              | Both, plus a backfill of `closed_at` from existing `status_changed` timeline rows.                                                                                          |
| `api-server/src/routes/time-entries.ts`                  | **New.** List, create, delete, and timer start/stop. Timer routes are declared **before** `/:id` — Express matches in order, and `/timer` would otherwise be read as an id. |
| `api-server/src/lib/performance.ts`                      | **New.** Every KPI figure as a SQL aggregate. `percentile_cont` medians, `FILTER` windows, previous-period comparison in the same query.                                    |
| `api-server/src/routes/kpi.ts`                           | `GET /kpi/performance`, admin-only via the existing `kpi.read`.                                                                                                             |
| `api-server/src/routes/cases.ts`                         | Status change now maintains `closed_at` both ways.                                                                                                                          |
| `api-server/src/lib/permissions.ts`                      | `time.write` / `time.read` added to all staff roles. Not to clients.                                                                                                        |
| `practice-portal/src/components/time-log-panel.tsx`      | **New.** Timer plus a four-field form, mounted as a Time tab on the case page.                                                                                              |
| `practice-portal/src/components/chamber-performance.tsx` | **New.** Range selector, period comparison, per-metric definitions, low-data states, per-member table.                                                                      |

### Phase 7 — invoicing foundation (`ba7ff33`)

**Data model and numbering only. No routes, no UI** — the brief required both to
be reviewed before anything was built on top.

| File                                   | Change                                                                                                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/db/src/schema/invoices.ts`        | **New.** `invoice_series` (the gapless counter), `invoices` (with client and firm snapshots, configurable tax fields, integer-paise totals), `invoice_line_items`.                                              |
| `api-server/src/lib/invoice-number.ts` | **New.** Financial-year derivation, `reserveInvoiceNumber` (takes a transaction — that parameter is the correctness condition, not a convenience), status transitions, derived overdue, and the rounding rules. |
| `lib/db/drizzle/0004_invoicing.sql`    | All three tables.                                                                                                                                                                                               |

### Where the new code sits in the request path

Two additions to §3's picture:

- `GET /api/health` is mounted with the other health routes **before**
  `clerkMiddleware`, for the same reason: a monitor must not need a session.
- `POST /api/beta-feedback` runs `requireAuth` and then stops. It is the only
  write endpoint that does **not** run `requireWorkspace`, deliberately — see
  DECISIONS.md.
- `/api/time-entries*` runs `requireWorkspace` then `requireCapability("time.*")`,
  held by every staff role and no client.
- `GET /api/kpi/performance` runs `requireCapability("kpi.read")`, held by admin
  alone. Per-member hours ride in that payload; if `kpi.read` is ever widened,
  `byMember` needs its own gate first.

### Verification

Each phase was driven in a real browser (Playwright, Chromium) against the app
in preview mode: PGlite for the database, no Clerk tenant, no external service.
Phase 2 — 13 assertions; Phase 3 — 18; Phase 5 — twelve pages × two themes for
contrast and overflow; Phase 8 — 19.

**These checks are not in the repository.** They were written per phase and kept
in the session scratchpad. The repo still has **no test files**; `pnpm run check`
(format, lint, typecheck) and `pnpm run build` are the only gates CI enforces.

### Known, unfixed

- **The Clerk tenant is a development instance.** Production logs
  `Clerk collects telemetry data … development instances` on every boot. ~100
  user cap, Clerk's shared Google OAuth credentials. Nothing in code fixes this.
- **Nine Quick Action tiles on the dashboard mostly navigate nowhere useful** —
  four promise filtered views that do not exist. Information architecture, left
  alone deliberately.
- **`scripts/ci/browser/portal.mjs` §8** still measures the Access Denied screen
  while claiming to measure the signed-in app (carried over from last session).
- **`/invites` still renders a 529px table at 375px.** It scrolls in place.

---

## 6. Going live

`DEPLOYMENT.md` is the full runbook. This is the short path, in order, with the
things that actually block you.

### Step 0 — merge to `main`

Render deploys from `main` (`render.yaml`, `branch: main`). The two commits
above are on the feature branch, so **nothing above is live**. Merge first, or
you will deploy the old design and wonder why.

### Step 1 — get accounts and keys

| What                                        | Where                  | Notes                                                                                                        |
| ------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| Clerk application                           | clerk.com              | Enable Google, Zoho and email-code. **Disable password.**                                                    |
| `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` | Clerk → API keys       | Use **production** keys, not `pk_test_`.                                                                     |
| `FILE_ENCRYPTION_KEY`                       | `openssl rand -hex 32` | 64 hex characters exactly.                                                                                   |
| Razorpay keys                               | razorpay.com           | Optional. Leave unset and the plan screen records selections and charges nothing — a fine state for a pilot. |
| SMTP credentials                            | any provider           | Optional. Unset, reminders are recorded as `suppressed` and never sent.                                      |

**Back up `FILE_ENCRYPTION_KEY` somewhere other than the disk it protects.**
Lose it and every uploaded document is unrecoverable. There is no recovery path.

### Step 2 — deploy via the Blueprint, not by hand

Render dashboard → **New → Blueprint** → pick this repository.

It reads `render.yaml` and creates the web service _and_ the Postgres instance,
wired together, with `DATABASE_URL` and `WORKSPACE_TOKEN_SECRET` filled in for
you.

> **If you already have a hand-made `brain-interface-lex` service, delete it and
> re-apply the Blueprint.** That service predates the blueprint, so it has none
> of this — which is exactly what caused the earlier deploy failures. Fixing it
> field by field is slower and you will miss one.

Then paste the `sync: false` values from Step 1 into the dashboard. There are
three required: `FILE_ENCRYPTION_KEY`, `CLERK_SECRET_KEY`,
`CLERK_PUBLISHABLE_KEY` — plus `VITE_CLERK_PUBLISHABLE_KEY`, which is the same
value as the publishable key and is inlined into the bundle **at build time**,
so changing it needs a redeploy rather than a restart.

Cost as configured: roughly **$47/month** (standard service, `basic-1gb`
Postgres, 10 GB disk). DEPLOYMENT.md §10 has a free-tier variant for trying it
out, on which uploaded files do not survive a restart.

### Step 3 — point Clerk at the deployed domain

In Clerk, add your Render URL as an allowed origin and set the redirect URL to
`https://<your-domain>/portal/callback`. Sign-in will fail with an opaque error
if you skip this.

### Step 4 — verify it is actually up and locked down

```bash
# What is deployed and how it is configured — the fastest single check.
curl -s https://<your-domain>/api/readyz | jq

# Expect: database "ok", filesEncrypted true, nodeEnv "production",
#         and a `commit` matching what you merged.

# Legal documents must be readable with no account.
curl -s -o /dev/null -w '%{http_code}\n' https://<your-domain>/legal/terms   # 200

# A protected endpoint must refuse an unauthenticated caller.
curl -s -o /dev/null -w '%{http_code}\n' https://<your-domain>/api/cases     # 401

# CORS must not reflect an arbitrary origin.
curl -sI -H 'Origin: https://evil.example' https://<your-domain>/api/healthz \
  | grep -i access-control-allow-origin
# Expect: nothing at all. If it echoes evil.example, STOP.
```

DEPLOYMENT.md §7 has the complete hardening check, including HSTS and the
workspace-token test.

### Step 5 — admit the first user

The platform starts empty. The **first** person to sign in is offered "Create a
chamber" on the Access Denied screen and becomes its Firm Admin. Everyone after
that must be invited by an admin — a second uninvited address is correctly
turned away.

So: sign in yourself first, found the chamber, then invite from within the app.

### Before real client data goes in

These are honest blockers, not polish:

1. **Have counsel review `docs/legal/*`.** They are drafts with
   `[SQUARE BRACKET]` placeholders and are surfaced to users at `/legal/*`. They
   describe what the software actually does — but they are not signed off, and
   they name your entity.
2. **Take one real payment end to end** if you are charging. Signature
   verification and idempotency are tested; a live transaction is not.
3. **Set `ERROR_WEBHOOK_URL`.** Unset, you find out about faults from a customer.
4. **Decide the file-storage story.** A Render disk pins the service to one
   instance, because Render disks cannot be shared. Moving to Cloudflare R2 is
   roughly 16× cheaper at volume and unblocks a second replica.
