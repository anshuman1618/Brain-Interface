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
        │    /api/kpi/performance  20/min per user  ← 8 SQL aggregates
        │    /api/invoices/:id/pdf 20/min per user  ← renders a PDF
        │    /api  non-GET        120/min per user
        │    /api  GET            300/min per user
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

`routes/index.ts` mounts twenty routers on `/api`. `sessionRouter` is first
because it owns `/session` and `/workspaces` — the only endpoints a user with no
active membership may reach.

```
session  users  cases  documents  tasks  consultations  kpi  invites
notifications  document-requests  search  calendar  feedback  beta-feedback
time-entries  invoices  subscription  service-enquiries  cause-list  governance
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
   `invalid_workspace_token`**. Failing that, `x-workspace-id`, through
   `parseId` — present but unreadable → **400 `invalid_workspace_id`**, never a
   fall-through to the caller's only membership. Absent entirely is the one case
   that still falls back, and only when there is exactly one membership to fall
   back to.
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
            /*               → DashboardLayout    ← everything else
```

Routing is **wouter**, not Next.js and not React Router. There is no `app/`
directory and no file-based routing — routes are the `<Route>` elements above.

**The catch-all must be `/*`, never `/:rest*`.** In wouter 3, `/:rest*`
compiles to `/^\/([^/]+?)\/?$/` — one segment. It was the catch-all in both
trees until 2026-08-19, and every route two levels deep (`/cases/:id`, the
matter detail page) matched nothing and rendered an empty document — no error,
no failed request, nothing to notice. `/*` compiles to `/^\/(.*)\/?$/` and
matches any depth, including `/`, which is why the explicit `/` route is
declared above it: a `Switch` takes the first match.

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

### Phase 7 — invoicing routes, PDF and billing details

Built after the numbering above was reviewed.

| File                                      | Change                                                                                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/db/src/schema/workspaces.ts`         | Firm billing identity and tax defaults — address, GSTIN, place of supply, SAC, three rate columns in basis points, hourly rate in paise, payment terms and days.                                  |
| `lib/db/src/schema/users.ts`              | Client billing address, GSTIN and place of supply. Current values; an invoice snapshots them.                                                                                                     |
| `lib/db/src/schema/audit_events.ts`       | Seven new actions: `invoice.created`, `draft_deleted`, `issued`, `sent`, `paid`, `void`, and `billing.settings_updated`.                                                                          |
| `lib/db/drizzle/0005_billing_details.sql` | Additive only — every column nullable or defaulted, so no rewrite of a populated table.                                                                                                           |
| `api-server/src/routes/invoices.ts`       | **New.** Eight endpoints, all behind `requireBilling` = `requireWorkspace` + `requireCapability("billing.manage")`. Issue is one transaction: reserve number, snapshot both parties, flip status. |
| `api-server/src/lib/invoice-pdf.ts`       | **New.** Server-side render. Prints stored amounts only — it never multiplies quantity by rate.                                                                                                   |
| `api-server/build.mjs`                    | Copies pdfkit's `.afm` font metrics into `dist/data`. esbuild bundles JS and nothing else, so without this the built server throws `ENOENT: Helvetica.afm` on the first PDF.                      |
| `lib/api-spec/openapi.yaml`               | 8 paths, 9 schemas. `lib/api-zod` and `lib/api-client-react` regenerated from it — never hand-edited.                                                                                             |

### Phase 7 — the invoicing screen

| File                                                        | Change                                                                                                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `practice-portal/src/pages/invoices.tsx`                    | **New.** Period totals, status filter, the table, the read-only record, and voiding. The row menu offers only what the invoice's state permits, so a 409 is never the way a user learns the rule. |
| `practice-portal/src/components/invoice-form-modal.tsx`     | **New.** Draft composer: client picker, line editor with a live per-line amount, tax fields prefilled from chamber settings, and unbilled time pulled in at the chamber's hourly rate.            |
| `practice-portal/src/components/billing-settings-modal.tsx` | **New.** The chamber's own details and its defaults.                                                                                                                                              |
| `practice-portal/src/lib/format.ts`                         | `formatMinor` / `parseRupeesToMinor` / `formatMilli` / `parseQuantityToMilli` — the only place paise and thousandths are turned into text, and the only place text is turned back.                |
| `practice-portal/.../layout/dashboard-layout.tsx`           | Lazy route and nav item, both behind `billing.manage`.                                                                                                                                            |
| `api-server/src/routes/invoices.ts`                         | `billableClient()` — the client must hold an active membership of the caller's workspace. Without it any user id was accepted and the invoice snapshotted a stranger's name, email and address.   |

### Cause lists — the one part of the system that is not workspace-scoped

```
  cron (every 6h, only when CAUSE_LIST_SYNC=on)
        │  lib/cause-list/scheduler.ts
        ▼
  syncAllCourts(date)                        lib/cause-list/sync.ts
        │  in SERIES — these are other people's servers
        ▼
  syncCourt(court, date)
        │
        ├─ adapterFor(court.adapter)         lib/cause-list/registry.ts
        │     └─ none → run recorded `skipped`, nothing tried
        │
        ├─ adapter.fetchCauseList({ date })  ── the ONLY court-specific code
        │     └─ throws → run recorded `failed` + error, other courts continue
        │
        ├─ upsert cause_list_entries         ◄── GLOBAL. Idempotent on
        │                                        (court, date, sourceKey)
        │
        └─ proposeMatches(court, date)       lib/cause-list/matcher.ts
              │  exact only: court + caseTypeNorm + number + year
              ▼
           cause_list_matches (status: pending)   ◄── WORKSPACE-SCOPED.
              │                                       Workspace comes from the
              │                                       MATTER, never a caller.
              ▼
         ── nothing further happens automatically ──
              │
              ▼
   a person accepts                          lib/cause-list/decide.ts
              │  POST /cause-list/proposals/:id/decision  (calendar.write)
              ▼
        calendar_entries (source: "court_sync", causeListEntryId)
```

| File                                              | Role                                                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/cause-list/types.ts`                         | `CourtAdapter` — `(court, date) → CauseListRow[]`. The only interface a new court has to satisfy.                                                                                    |
| `lib/cause-list/adapters/fixture.ts`              | Deterministic rows, preview only. What CI runs on — a real implementation of the interface, not a mock of it.                                                                        |
| `lib/cause-list/adapters/allahabad-lucknow.ts`    | **Stub.** Documented checklist for writing it against the live site. Deliberately not registered → `skipped`, not `failed`.                                                          |
| `lib/cause-list/registry.ts`                      | id → adapter. Fixtures registered only against a preview database.                                                                                                                   |
| `lib/cause-list/matcher.ts`                       | The tenant crossing-point. Global listing → per-chamber proposal, scoped by the matter's own `workspaceId`.                                                                          |
| `lib/cause-list/sync.ts`                          | Orchestration + `cause_list_sync_runs`. Catches per court so one broken site cannot stop the rest.                                                                                   |
| `lib/cause-list/decide.ts`                        | Accept (creates the calendar entry) / dismiss (remembered, never re-proposed).                                                                                                       |
| `lib/cause-list/seed.ts`                          | Courts registry. The one exception to "the platform ships empty" — a High Court is not somebody's data.                                                                              |
| `routes/cause-list.ts`                            | `/courts`, `/cause-list/proposals`, `…/:id/decision`, `/cause-list/runs`, `/cause-list/sync`.                                                                                        |
| `routes/cases.ts`                                 | `courtIdentity()` — the four court fields, validated as a unit and normalised on write. An explicit `courtId: null` clears all five columns.                                         |
| `practice-portal/src/pages/cause-list.tsx`        | **New.** The review queue: pending / accepted / dismissed, the listing as published, Accept and "Not ours". Plus the admin run log and manual "check now", both behind `audit.read`. |
| `practice-portal/src/lib/court-identity.ts`       | **New.** The all-or-none rule and the two payload shapes — create (omit) and patch (`courtId: null` clears). No React.                                                               |
| `practice-portal/.../court-identity-fields.tsx`   | **New.** The four fields, shared by the create form and the matter. Choosing "not filed" empties the other three with it.                                                            |
| `practice-portal/.../case-court-identity.tsx`     | **New.** The identity on the matter itself — the only route to one for a matter opened before this shipped.                                                                          |
| `practice-portal/.../case-form-modal.tsx`         | The same field group at filing time. Submit is blocked on a partial set before the server has to refuse it.                                                                          |
| `practice-portal/.../layout/dashboard-layout.tsx` | Lazy route and nav item for Court Listings, behind `calendar.read`.                                                                                                                  |

**Capabilities.** Viewing proposals is `calendar.read` (so the clerk who keeps
the diary sees them, and clients — who hold neither — never do). Accepting is
`calendar.write`, the same boundary as posting any other calendar entry, which
also means a lapsed plan can see its proposals and cannot act on them, for
free. The ops surface (`/runs`, manual `/sync`) is `audit.read` — admin only,
because it reaches out to third-party servers on demand.

### Two identifiers, one seam

```
  sign-in                     Clerk (OAuth · email code · SMS code)
        │                     preview: preview:email:… | preview:phone:…
        ▼
  identityFromClerk           lib/jit.ts
        │  VERIFIED email and/or VERIFIED phone, or "" / null
        ▼
  users.email / users.phone   normalised on write
        │
        ▼
  reconcileAccessList(user)   lib/access-list.ts
        │  returns 0 only when BOTH are absent
        ▼
  findAccessListMatches({email, phone})
        │  kind='email' = address   ┐
        │  kind='phone' = E.164     ├─ exact
        │  kind='domain' = @host    ┘  blanket
        │  precedence: email > phone > domain, per workspace
        ▼
  workspace_memberships       email and phone disappear here;
                              (workspace_id, user_id) takes over
```

| File                                         | Role                                                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `lib/db/src/schema/workspace_access_list.ts` | `ACCESS_LIST_KINDS` gains `phone`; `normalisePhone()` lives beside `normaliseEmail()`.                                       |
| `lib/db/drizzle/0012_phone_identity.sql`     | `users.phone`, `invites.phone`, and `invites.email` relaxed to nullable. Both `preview.ts` blocks too.                       |
| `api-server/src/lib/jit.ts`                  | `identityFromClerk` reads a verified number; `resyncIdentity` fills either blank and overwrites neither.                     |
| `api-server/src/lib/access-list.ts`          | The matcher takes `{email, phone}` and only ORs the arms it has an identifier for.                                           |
| `api-server/src/routes/session.ts`           | `foundChamber` self-admits every identifier the founder holds — the fix that stops a phone founder losing their own chamber. |
| `api-server/src/routes/invites.ts`           | Exactly one identifier, shape-checked. Previously this door checked nothing.                                                 |
| `api-server/src/lib/preview-mode.ts`         | `preview:phone:…` beside the byte-identical `preview:email:…`.                                                               |
| `practice-portal/.../portal-sign-in.tsx`     | "Continue with mobile number", via Clerk `phoneCode.sendCode` / `verifyCode`.                                                |
| `practice-portal/.../access-denied.tsx`      | Names the identifier the caller actually holds.                                                                              |

**The operator allowlist stays email-only.** It is an environment variable, not
an access-list row, and a reassigned number must not reach a cross-tenant view.

### Where case files go

```
  POST /api/documents (multipart)
        │  size cap while streaming, MIME allowlist,
        │  content signature checked against the declared type
        ▼
  put(buf)                                   lib/blob-store.ts
        │  key = YYYY/MM/<uuid>   ← generated here, never client-supplied
        │  encrypt(AES-256-GCM)   ← ABOVE the backend, always
        ▼
  blobBackend().put(key, ciphertext)         lib/blob-backends.ts
        │
        ├─ no R2_* set        → filesystem, under FILE_STORAGE_DIR
        ├─ all four R2_* set  → Cloudflare R2 over its S3 API   lib/r2.ts
        └─ SOME R2_* set      → throws at boot. No fallback.
```

| File                                 | Role                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/blob-store.ts`                  | Everything that makes a file safe: key generation, encryption, size cap, MIME allowlist, signature check. Backend-agnostic.                         |
| `lib/blob-backends.ts`               | The `BlobBackend` interface, the filesystem implementation, and the choice. `describeBlobBackend()` feeds the boot log and readyz.                  |
| `lib/r2.ts`                          | SigV4 and four HTTP calls. No SDK — see DECISIONS.md. `R2_ENDPOINT` + `R2_REGION` point it at any S3-compatible store.                              |
| `scripts/check-storage.mjs`          | `pnpm --filter @workspace/api-server run check-storage` — a real put/get/compare/delete against whatever is configured, before a chamber finds out. |
| `scripts/ci/suites/blob-storage.mjs` | 21 checks, entirely offline: the signature against an independent computation, and the refusal on a partial configuration.                          |

**The bytes Cloudflare holds are ciphertext.** Encryption happens before the
backend is called, so `FILE_ENCRYPTION_KEY` never leaves the server and R2
stores blobs it cannot read. That is the whole reason object storage is
acceptable for privileged client files.

**A container filesystem is not storage.** Render's free plan cannot mount a
disk, so the local backend there loses every file on each deploy. The server
warns about it at every boot in production and `/api/readyz` reports
`fileStorage`.

### The operator view — the one router that reads across tenants

```
  any authenticated request
        │  middlewares/requireAuth.ts
        ├─ touchLastSeen(clerkId)          lib/last-seen.ts
        │     fire-and-forget · ≤1 write per person per hour
        │     no row updated → drop the throttle entry so the
        │     next request retries (the row may not exist yet)
        ▼
  users.last_seen_at

  GET /api/operator/metrics
        │  requireAuth            ← identity, or 401
        │  requireOperator        ← lib/operator.ts
        │     OPERATOR_EMAILS unset      → 404
        │     address not on the list    → 404   (never 403)
        ▼
  one SQL round trip, counts only          routes/operator.ts
        │
        ▼
  /operator in the SPA — reachable by URL, absent from the nav
```

| File                                        | Role                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `lib/db/src/schema/users.ts`                | `lastSeenAt` — nullable, no backfill. NULL means "not seen since this shipped", which is not "never signed in".                 |
| `lib/db/drizzle/0011_last_seen_at.sql`      | Guarded `ALTER TABLE` plus an index; the metrics query filters on it on every load. Also in both `preview.ts` blocks.           |
| `api-server/src/lib/last-seen.ts`           | The throttle. Never awaited, never throws, at most one write an hour per person.                                                |
| `api-server/src/middlewares/requireAuth.ts` | Calls it from `requireAuth`, not `requireWorkspace` — someone never admitted to a chamber is a cohort worth counting.           |
| `api-server/src/lib/operator.ts`            | `OPERATOR_EMAILS` allowlist and `requireOperator`. **Not a capability** — any capability is one self-invite away for a founder. |
| `api-server/src/routes/operator.ts`         | One query, seven CTEs. Counts only: no matter titles, no filing references, no addresses.                                       |
| `practice-portal/src/pages/operator.tsx`    | The screen. Renders "Not available" on the 404, which is the ordinary answer rather than an error.                              |

**Capabilities.** None, on purpose. This is the only surface in the server that
is not reachable through `requireWorkspace`, and it must stay that way: the nav
and every route guard project the capability list, and a chamber admin holds
`access_control.manage` in their own chamber. See DECISIONS.md.

### Bar registration — a gate that sits inside `requireWorkspace` itself

| File                                             | Change                                                                                                                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/db/src/schema/users.ts`                     | New `barCouncilState`, `barEnrolmentNo`, `aorNo`, `barDeclaredAt` — all nullable, additive.                                                                                                    |
| `lib/db/drizzle/0009_bar_registration.sql`       | Guarded `ALTER TABLE`. Also in `preview.ts`'s base `users` table and its `ALTER … ADD COLUMN IF NOT EXISTS` block.                                                                             |
| `api-server/src/lib/jit.ts`                      | `AppUser` carries `barCouncilState` / `barEnrolmentNo` — the two fields `requireWorkspace` needs to compute completeness.                                                                      |
| `api-server/src/lib/permissions.ts`              | `needsBarRegistration(role)` — admin, senior_advocate, junior_advocate only.                                                                                                                   |
| `api-server/src/middlewares/requireAuth.ts`      | `requireWorkspace` refuses with **403 `profile_incomplete`** before a `WorkspaceContext` is ever built, for a role that needs it and hasn't declared.                                          |
| `api-server/src/routes/session.ts`               | `buildSessionClaims` computes `profileComplete` per the ACTIVE workspace's role, not stored — the same person can be gated in one chamber and not another.                                     |
| `api-server/src/routes/users.ts`                 | `PUT /users/me/bar-registration` — `requireAuth`, not `requireWorkspace`, since this is exactly the route that has to stay reachable while blocked.                                            |
| `practice-portal/src/pages/complete-profile.tsx` | **New.** Renders both as the hard gate (`dashboard-layout.tsx`, no `onDone`) and as a deliberate revisit (`onDone` returns to Team Roles), pre-filled from `GET /users/me` in the second case. |
| `practice-portal/.../dashboard-layout.tsx`       | Third full-screen gate, checked after `isPendingApproval` and before the nav renders.                                                                                                          |
| `practice-portal/src/pages/team.tsx`             | "Edit bar registration" link on a person's own row only — self-declared, so never editable on someone else's.                                                                                  |

**Where it sits in the request path.** Checked inside `requireWorkspace`
itself, immediately after the active-membership lookup and before
`WorkspaceContext` is constructed — so every route behind `requireWorkspace`
is covered by construction, the same guarantee `no_active_membership` already
had. No allowlist to maintain: unlike the lapsed-plan gate
(`CAPABILITIES_WHEN_LAPSED`), nothing needs to stay reachable through this one
except `PUT /users/me/bar-registration`, which sits behind `requireAuth` and
was never inside the blocked surface.

### "Restrict to Case ID" — from decoration to an actual filter

| File                                          | Change                                                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/db/src/schema/workspace_access_list.ts`  | New `caseId`. Written by both `invites.ts` and the direct access-list POST.                                                            |
| `lib/db/src/schema/workspace_memberships.ts`  | New `caseId`, copied from the access-list entry at reconcile — this is the column `scope.ts` actually reads.                           |
| `lib/db/drizzle/0008_case_restriction.sql`    | Additive, guarded. Both columns also in `preview.ts`'s base tables and its `ALTER … ADD COLUMN IF NOT EXISTS` block.                   |
| `api-server/src/lib/access-list.ts`           | `AccessListMatch` carries `caseId`; `reconcileAccessList` copies it onto the new membership.                                           |
| `api-server/src/middlewares/requireAuth.ts`   | `MembershipLookup` and `WorkspaceContext` both carry it, as `restrictedCaseId` on the context — set once per request, read everywhere. |
| `api-server/src/lib/scope.ts`                 | `visibleCaseIds` and `getVisibleCase` intersect with `restrictedCaseId` when set. **This is the step that gives the label teeth.**     |
| `api-server/src/routes/invites.ts`            | Rejects a `caseId` on a non-client role; requires one for `client`; validates it with `caseInWorkspace()` before accepting.            |
| `api-server/src/routes/session.ts`            | `POST /workspace/access-list` enforces the identical rule — the other of the two paths that can create a client membership.            |
| `practice-portal/src/pages/invites.tsx`       | Case-id field only shows for `client`; submit is disabled until filled.                                                                |
| `practice-portal/.../access-list-manager.tsx` | Same field, same rule, in the direct-grant form; the table now shows the restriction badge there too.                                  |

`invites.case_id` (the pre-existing column on the `invites` table itself) is
unchanged — it was always just the audit record of what was asked for. The new
columns are what the runtime actually reads.

### Migration service add-on

| File                                         | Change                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/db/src/schema/service_enquiries.ts`     | **New.** `workspaceId`, submitter identity, `serviceKind` (enum of one: `migration`), `message`, `contactPreference` + `contactPhone`, `status`.              |
| `lib/db/drizzle/0007_service_enquiries.sql`  | **New.** Additive, guarded `CREATE TABLE IF NOT EXISTS`. Also in `preview.ts`'s base table list.                                                              |
| `api-server/src/routes/service-enquiries.ts` | **New.** `POST /service-enquiries`, `requireWorkspace` + `requireCapability("billing.manage")`. Rejects `phone` preference with no number.                    |
| `api-server/src/app.ts`                      | New `service-enquiries` rate bucket, 10/min per user — alongside `access-requests` and `privacy`.                                                             |
| `practice-portal/.../pricing-modal.tsx`      | New dashed-border card below the plan grid (not a fifth tier), opening a nested form dialog. Gated on `canManage`, same as every other control on the screen. |

No admin listing yet — the table is read straight from the database until one
is worth building. `status` is already on the row for when it is.

### Calendar audience — validated on write

| File                                | Change                                                                                                                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-server/src/routes/calendar.ts` | New `audienceError()`, called from `POST /calendar` and `PATCH /calendar/:id`. Checks shape, checks `role:` against real roles, checks `user:` against an active membership. 400 `invalid_audience` on failure. |

`audienceIncludes()` (`lib/db/src/schema/calendar_entries.ts`) is unchanged — it
still fails closed on read, which is correct there. The gap was that nothing
stopped the same bad value being written in the first place, so a 201 could
create an entry that no read path would ever surface.

### Plan enforcement — payment, seats, matters, expiry

Five limits that were recorded and never enforced. Each is now closed at the
specific transition that used to walk past it.

| File                                              | Change                                                                                                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-server/src/lib/plans.ts`                     | `TRIAL_LIMITS` — one constant at 10 matters / 5 seats, shared by `trial` and `custom`. New `isChargeable()`.                                                            |
| `api-server/src/lib/quota.ts`                     | New `planStateFor()` → `{plan, storedPlan, status, effectiveStatus, lapsed, periodEnd, daysLeft}`. `planFor()` now falls back to trial once the period has passed.      |
| `api-server/src/lib/permissions.ts`               | `CAPABILITIES_WHEN_LAPSED` — an **allowlist**, not a `.write` suffix test, so a new capability fails closed.                                                            |
| `api-server/src/middlewares/requireAuth.ts`       | `requireWorkspace` puts `planState` on the context; `requireCapability` answers **402 `plan_lapsed`** outside the allowlist.                                            |
| `api-server/src/routes/subscription.ts`           | Chargeable + `paymentsEnabled()` → `pending_payment` instead of `active`. Trial refused a second time (409). `lapsed`/`daysLeft` on the response.                       |
| `api-server/src/routes/session.ts`                | Seat check on the revoked → active transition.                                                                                                                          |
| `api-server/src/lib/access-list.ts`               | Seat check at reconcile; over cap creates **`pending`**, routing into the existing approval queue rather than locking a colleague out.                                  |
| `api-server/src/routes/cases.ts`                  | Matters check on the closed → open transition, so a PATCH on an already-open matter never 402s.                                                                         |
| `api-server/src/routes/billing.ts`                | `refund.processed` → `cancelled`, matched by `provider_payment_id`. `payment.failed` and `subscription.halted` recorded and deliberately not acted on.                  |
| `api-server/src/routes/preview.ts`                | **Preview-only** `POST /preview/set-period-end`, signed `daysFromNow`. 404s outside preview.                                                                            |
| `practice-portal/.../plan-banner.tsx`             | **New.** Replaces a hardcoded banner that read no data and was wrong twice over. Renders **nothing** when healthy; renders for everyone, CTA gated on `billing.manage`. |
| `lib/db/drizzle/0006_subscription_trial_used.sql` | Additive, guarded `trial_used_at`. Also in the schema file and **both** blocks of `preview.ts`.                                                                         |

**Where it sits in the request path.** `requireWorkspace` resolves `planState`
once per request and hangs it on the context, so `requireCapability` can refuse a
write without a second query, and any route wanting the plan reads it off `ctx`
rather than asking again. Expiry is therefore evaluated on **every** request with
no scheduler — and nothing is written back on a read path, so the stored status
stays the last real transition.

### Status Overview drill-down

| File                                                    | Change                                                                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `practice-portal/src/components/stat-detail-dialog.tsx` | **New.** `StatDetailDialog` (rows + empty state + see-all), `StatCardButton` (card relief, keyboard-reachable), `MaybeStatButton` (plain card at zero). |
| `practice-portal/src/pages/dashboard.tsx`               | The four cards become buttons; four dialogs; `useListCases` added — the only new query, since tasks and calendar were already loaded.                   |

No API change. The lists are the same rows the counts are computed from, which is
what keeps the popup and the number in agreement.

### Layout stacking — the sticky header and the feedback button

| File                                                      | Change                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `practice-portal/.../layout/dashboard-layout.tsx`         | Header `z-10` → `z-30`; the scroll container gains `isolate`. Page content used to paint over the header on every scroll. |
| `practice-portal/src/components/beta-feedback-widget.tsx` | `left-4` → `left-4 sm:left-20` (clears the rail), `z-40` → `z-20`, label revealed on hover/focus instead of always shown. |

The stacking ladder is now deliberate rather than accidental:

```
Radix portals (dialogs, dropdowns)   above everything, portalled to <body>
header                        z-30   sticky, owns the search dropdown's context
sidebar rail                  z-20
feedback widget               z-20   fixed, must never outrank the chrome
page content                  —      isolated inside the scroll container
```

### Security hardening — reads, uploads, dependencies

| File                                      | Change                                                                                                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-server/src/app.ts`                   | GET now has a 300/min per-user ceiling; `/kpi/performance` and `/invoices/:id/pdf` get their own 20/min bucket above it. Reads were previously exempt entirely.        |
| `api-server/src/middlewares/rateLimit.ts` | `subjectFor()` — resolves identity via `resolveClerkId` rather than `req.userId`, which is not set yet at the mount point. `perUser` silently keyed on IP before this. |
| `api-server/src/lib/blob-store.ts`        | `contentMatchesMime()` — file-signature check for every allowed type; text is checked by rejecting NUL bytes instead.                                                  |
| `api-server/src/routes/documents.ts`      | Upload refuses a signature mismatch with `415 content_type_mismatch`, kept distinct from the allowlist's `unsupported_type`.                                           |
| `api-server/src/routes/search.ts`         | `MAX_QUERY` (200, refused not truncated) and `likePattern()`, which escapes `%` `_` `\` so ILIKE reads the query as text. A bare `%` used to match every row.          |
| `.github/dependabot.yml`                  | **New.** Weekly, grouped; security updates grouped separately so they arrive alone.                                                                                    |
| `.github/workflows/ci.yml`                | `pnpm audit --audit-level=high`, reporting only — every open advisory is transitive dev tooling, outside the request path.                                             |

The rate-limit block in §3 ⑨ now reads:

```
/api/session          30/min   per address
/api/workspaces       30/min   per address
/api/access-requests  20/min   per address
/api/privacy          20/min   per user
/api/kpi/performance  20/min   per user   ← eight SQL aggregates
/api/invoices/:id/pdf 20/min   per user   ← renders a PDF, uncached
/api  non-GET        120/min   per user
/api  GET            300/min   per user   ← was unlimited
```

### Migrations, and where they now run

| File                         | Change                                                                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/db/migrate-on-boot.mjs` | **New.** Applies pending migrations **in-process** via drizzle-orm's migrator, then exits so `start` can hand off. Skips when `DATABASE_URL` is unset (PGlite builds its own schema). A failure is fatal — see below. |
| `lib/db/push-guard.mjs`      | **New.** `push` / `push-force` refuse on Render or under `NODE_ENV=production`, **exiting 0** so the Start Command's `&&` chain still reaches `start`. Local use unchanged, `--force` forwarded.                      |
| `package.json`               | Root `start` is now `node ./lib/db/migrate-on-boot.mjs && pnpm --filter @workspace/api-server run start`.                                                                                                             |
| `lib/db/drizzle.config.ts`   | `out` is explicit and absolute. It defaulted to `./drizzle` relative to the working directory, which was right only while the command happened to be run from `lib/db`.                                               |

The deployed service was created by hand in the dashboard, so Render never reads
`render.yaml` and the live Start Command still says `push`. `push` exits 0
whether or not it applied anything, which is how production came up healthy for
weeks while missing every table added after phase 3. Running the migration from
`start` makes the stale field harmless — the server cannot boot against a schema
it does not match.

Boot order is therefore: **migrate → the §2a startup sequence → listen.** The
migration finishes before `initDatabase()` is even called, in a separate
process, so nothing queries a half-migrated schema.

Speed matters here more than it looks. Render gives a new instance a limited
window to bind a port, and on the free plan most of that window is already spent
scheduling the container — one failed deploy logged eight and a half minutes
between `Deploying…` and the start command running. Everything this chain does
comes out of what is left, which is why the migration runs in-process rather
than through `pnpm → drizzle-kit → tsx`: **4.1 s** to a bound port, down from
**38 s**.

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
- `/api/invoices*` and `/api/billing-settings` run `requireWorkspace` then
  `requireCapability("billing.manage")` — admin alone. The PDF route is on the
  same gate, so a link to it leaks nothing to a non-member.

### AI drafting: the path a draft actually takes

`/api/insights*`, `/api/exemplars*`, `/api/drafts*`, `/api/cases/:id/drafts` and
`/api/ai/budget` all run `requireWorkspace` → `requireCapability("drafting.use")`.
Anything that can reach a model then passes a **third** gate that is not a
middleware: `workspaces.drafting_enabled`, the chamber's own opt-in, checked
inside the handler. `/api/workspace/drafting` (which sets it) is
`access_control.manage` — admin alone. `/api/ai/topups` is `ai_topup.purchase`,
held by admin and senior advocate and deliberately **not** `billing.manage`.

`app.ts` rate-limits `/api/cases/:id/drafts` at 6/min and `/api/exemplars` at
10/min, on top of the budget. The budget bounds the monthly spend; the limiter
bounds the rate, which is a different failure.

Inside `lib/ai/drafting.ts` the order is load-bearing:

```
assemble context  →  estimate cost  →  check budget  →  write draft row
      ↓                                                       ↓
  404 if the matter                                    write draft_sources
  is not the caller's            402 if over budget    (what left the server)
                                                              ↓
                                                        call the model
                                                              ↓
                                              record spend  →  update draft row
```

The draft row is written **before** the call so a request that dies mid-stream
leaves visible evidence that tokens were spent; spend is recorded on the failure
path too, so a failing loop is not free to run.

Two controls added by the 2026-08-25 security review sit on this path:
`POST /exemplars` runs the same `checkBudget` as drafting before its redaction
call, and every ticked document is wrapped by `wrapUntrusted()`
(`lib/ai/untrusted.ts`) before it reaches the prompt, with `web_search` bounded
by `allowed_domains`. The full readiness object moved from the public
`/api/readyz` to `/api/operator/readiness`.

`lib/ai/` is the only place the Anthropic SDK is imported, and it is server-side
only. `usingStubModel()` — true whenever `isPreviewDatabase()` or no
`ANTHROPIC_API_KEY` — swaps in a deterministic stand-in, which is what lets all
fifteen suites run without spending anything.

### Verification

Each phase was driven in a real browser (Playwright, Chromium) against the app
in preview mode: PGlite for the database, no Clerk tenant, no external service.
Phase 2 — 13 assertions; Phase 3 — 18; Phase 5 — twelve pages × two themes for
contrast and overflow; Phase 8 — 19.

**Most of these checks are not in the repository.** They were written per phase
and kept in the session scratchpad. `pnpm run check` (format, lint, typecheck)
and `pnpm run build` remain the gates CI enforces alongside the API suites.

`scripts/ci/browser/portal.mjs` §8 is committed, and now measures what it says
it does. It also asserts the operator view fails closed: with no
`OPERATOR_EMAILS` configured, a chamber admin typing `/operator` is told
nothing and shown none of the numbers. It had been founding no chamber and sizing the Access Denied screen as
"the dashboard" — fixed by walking the real founding flow (including the bar
registration gate) and asserting a positive signal. It now also opens a matter,
which is the check that would have caught `/cases/:id` rendering blank.

**Plan enforcement is the exception — it has a committed suite.**
`scripts/ci/suites/plan.mjs` (registered in `run-suites.mjs` after `subs`) is 38
checks covering: a fresh chamber with no subscription row is not lapsed (the
regression guard — `currentPeriodEnd IS NULL` must never read as expired, or a
refactor bricks every new signup) · the trial allowance · the matters cap on
reopen, and that an already-open matter is still editable at cap · the trial
refused twice · expiry, lapsed reads-but-cannot-write, and recovery on renewal ·
seats not bypassable through the domain path.

It runs against **both** payment modes. `scripts/ci/lib/billing.mjs` mints a
locally-signed `payment.captured` webhook — `verifyWebhook` is plain HMAC-SHA256
over the raw body, so no Razorpay account is needed — and `gov` and `subs` use
the same helper, because a chargeable plan does not activate on selection once a
provider is configured and their setup would otherwise silently stop working.

**"Restrict to Case ID" has a committed suite too.**
`scripts/ci/suites/case-restriction.mjs` is 12 checks against the direct
access-list path specifically (`security.mjs` covers the invite path in its
own "Case restriction has teeth" section, 8 checks): a non-client role with a
`caseId` is refused, a client with none is refused, a `caseId` naming no real
matter is refused, a valid grant round-trips its restriction, and — the actual
proof — a client sees the one matter they were restricted to and gets a 404
(not a 403) reaching a second matter that also names them as `clientId`. A
15-assertion browser check covers both forms: the field's visibility follows
the role selector, the submit button is disabled until a case id is entered,
and the restriction badge renders once granted.

**Bar registration has a committed suite too.**
`scripts/ci/suites/bar-registration.mjs` is 19 checks: a founder is blocked
from every workspace-scoped call until they declare, an empty declaration is
refused, declaring it unblocks the same call immediately, the AOR field
round-trips when supplied and is null when not, `clerk_intern` and `client`
are exempt without declaring anything, a `junior_advocate` is gated exactly
like an `admin`, and the declaration endpoint itself works with **no** active
workspace — the one call that has to stay reachable while everything else is
blocked. A 12-assertion browser check drives the real flow end to end:
founding a chamber, hitting the gate, the form's validation, the dashboard
unlocking, the "Edit" link on Team Roles pre-filling from what was declared,
and a clerk invited alongside never seeing the gate at all.

Adding this gate broke every existing suite's setup — every chamber-founding
call in this repo is `admin` or `senior_advocate`, and every suite makes a
workspace-scoped call immediately after founding. Fixed with a shared
`scripts/ci/lib/bar-registration.mjs` helper, called in all seven other
suites right after founding or right after an invited senior/junior
advocate's session is established.

**Cause-list ingestion has a committed suite.**
`scripts/ci/suites/cause-list.mjs` is 67 checks running entirely on the
fixture adapter — which implements the same interface a real court adapter
does, so everything except HTML/PDF parsing is exercised for real. It covers:
the four court fields validated as a unit; `normaliseCaseType` bridging
"WP(C)" on the matter against "W.P.(C)" on the list; **that a sync creates no
calendar entry at all**; re-sync upserting without re-proposing; a second
chamber seeing none of the first's proposals and getting a 404 (not a 403)
deciding one; the same shared listing proposing correctly to both chambers
once both hold a matching matter; accept creating exactly one hearing carrying
the raw listing; double-accept refused with 409; dismissal surviving a later
sync; and all three run outcomes — `ok`, `failed` (adapter threw) and
`skipped` (adapter unwritten) — distinguishable in `cause_list_sync_runs`.
It also covers the patch path, which is how the feature reaches any matter
opened before it existed: identity added to an existing matter, a partial
patch refused without disturbing what is stored, a patch naming none of the
four leaving it alone, and `courtId: null` clearing all five columns.

A 24-assertion browser check drives the whole feature end to end: a matter
filed with a court identity, a sync run from the admin panel, the proposal
appearing, the listing as published, accept, the hearing turning up on the
calendar, and the identity being changed and cleared from the matter itself.

**The operator view has a committed suite.** `scripts/ci/suites/operator.mjs`
is 38 checks: anonymous is 401 and a signed-in stranger is **404 not 403**; a
chamber admin holding every capability in their own chamber is refused too — the
assertion that stops a future refactor turning this into a capability; a new
chamber appears with its seat count and no matters, then leaves the never-used
count when one is opened; and the response body is searched for a matter title,
a filing reference and an email address, none of which may appear. One check
exists purely as a regression guard: `neverSeen < total`, because the first
implementation recorded nothing at all and every activity number read zero.
The runner passes `OPERATOR_TEST_EMAIL` matching the `OPERATOR_EMAILS` the
server was started with, and the suite fails loudly when it is missing rather
than passing vacuously on a wall of 404s.

**File storage has a committed suite**, and it needs no server, network or
credentials: `scripts/ci/suites/blob-storage.mjs` is 21 checks over the SigV4
signer and the backend choice. The signature is recomputed independently from
the specification — longhand, so it agrees with S3 rather than with the
implementation — and key, body and method are each shown to change it. The
other half asserts that a partly configured R2 **throws** instead of quietly
falling back to a disk the next deploy will wipe.

**Mobile identity has two committed suites.** `phone-identity.mjs` is 19
offline checks on `normalisePhone` — every readable form of one number
collapsing to one E.164 string, everything unusable coming back empty rather
than half-parsed, and the country code being configuration rather than a
hardcoded `+91`. `phone-admission.mjs` is 29 checks against a live server: a
chamber founded by somebody with no address **and signed back into**, a
colleague invited by number and admitted at that role, both admission doors
refusing a half-formed identifier, and — the control — an emailed colleague
still admitted exactly as before.

That last point is the design claim, and the evidence for it is that **all
eleven pre-existing suites pass untouched**. The email path was extended, not
altered.

Last run: **596 checks green across sixteen API suites with `RAZORPAY_*`
unset**, each suite against a fresh server, plus 57 browser checks and 13
startup guards. The banner was checked
separately in a browser across all five of its states (17 assertions), which is
what caught the `daysLeft` rounding.

### The paid gate, and the screen that answers it

Two gates now stand between a new chamber and its first matter, and they are
different in kind:

```
found chamber
     ↓
requireWorkspace  ── bar enrolment not declared? ──→ 403 profile_incomplete
     ↓                                                (CompleteProfilePage)
requireCapability ── planState.neverPaid? ─────────→ 402 payment_required
     ↓                                                (ChoosePlanPage)
   the work
```

`neverPaid` (`lib/quota.ts`) is `!row || (status !== "active" && startedAt ===
null)`. It is **not** `lapsed`: lapsed means a plan was in force and ran out,
and "your plan expired" said to somebody who signed up ten minutes ago sends
them looking for a renewal button that does not apply. It rides the same
allowlist a lapsed chamber gets (`CAPABILITIES_WHEN_LAPSED`), so an unpaid
chamber still reads its own shell, its plan screen and its billing — the
chamber is never locked, only its features.

`GET /workspace/subscription` carries `neverPaid` back so the SPA gates on the
server's own answer rather than re-deriving it. `dashboard-layout.tsx` shows
`ChoosePlanPage` when it is true, **after** the bar gate — every
workspace-scoped read, that one included, is refused until enrolment is
declared, so there is nothing to render before it. "Skip for now" is component
state, not persisted: the offer returns next session and `PlanBanner` keeps it
standing meanwhile.

Preview has no payment provider, so `POST /preview/activate-plan` puts a trial
in force for the suites. It 404s unless `isPreviewAuth() && isPreviewDatabase()`,
grants a trial and nothing else, and writes **neither** once-only marker
(`users.trial_claimed_at`, `subscriptions.trial_used_at`) — which is what lets
`plan.mjs` §4 and `subs.mjs` still reach a genuinely unclaimed trial after
calling it. It inserts when there is no row to update: a chamber has no
subscription row until it selects something, and an UPDATE-only version looks
like it works and silently does nothing.

### Case access — narrowing a junior or a clerk

`GET`/`PUT /memberships/:id/case-access`, behind `access_control.manage`. The
`caseAccessRestricted` flag on the membership plus rows in `case_access_grants`.

In `lib/scope.ts` the restricted branch sits **before** the `assigned` branch
and **replaces** the role's row scope rather than filtering it. A restricted
junior's role scope is `all`; intersecting with `all` would be a no-op and the
restriction would do nothing — which is the obvious way to write it and the
reason it is written the other way. What a restricted member sees is: the
matters they hold a task on, plus the ones granted explicitly. Assigned work is
never revocable through this screen, because a person handed a task must be
able to open the file it is on.

`PUT` replaces the whole grant set rather than adding and removing, so a stale
tab cannot re-grant a matter an admin just took away. Every id is checked
against `cases.workspace_id` before it is written — a grant naming another
chamber's matter writes no row at all rather than a row that means nothing.
`senior_advocate` and `client` are refused with a 400: the first directs the
chamber's work, the second is already confined by row scope.

### Advocate credentials, and the six-month window

`users` gained `aor_high_court_no`, `cop_no`, `all_india_bar_no` and
`all_india_bar_due_at`. `barCredentialsComplete()` (`lib/permissions.ts`) is
two tiers: state bar council and enrolment number **now**, the All India Bar
Examination number **within six months**. The deadline is stamped once, on the
first declaration (`user.allIndiaBarDueAt ?? …+6 months`) — a deadline that
resets each time the form is saved is not a deadline.

`GET /users/me` returns `allIndiaBarDaysLeft`, computed by the same helper the
gate uses, so the countdown on the form and the day requests start being
refused are one calculation. `CredentialsNotice` on the dashboard is the
warning before it bites; it renders nothing for a clerk, a client, or anyone
who has supplied the number.

### The Case Brief replaced the Review

`DRAFT_KINDS` lost `review` and gained `brief`. It is not a rename: the review
covered defects and merits, and the brief covers the matter and a draft
together — the matter in short, the facts on the record, the chronology, the
merits, how the other side will run it, the objections to anticipate, the
defects to cure, the authorities, and what to confirm. `BRIEF_RULES` in
`lib/ai/prompts.ts` carries those headings; the output ceiling went 10k → 12k
tokens, which is why a trial's ₹40 buys one fewer call than it did.

`review` now 400s as an unknown kind, which `drafting.mjs` asserts — a stale
client asking for one is refused outright rather than quietly served something
else under a name it no longer means. The verify disclaimer is stated three
times on purpose: on the page before anything is asked for, on every output
card, and inside the body text itself, because the only copy that follows a
draft into a filing is the one in the text.

### Row scope is enforced in two helpers, and every route must use one

`lib/scope.ts` has four helpers and they are not interchangeable:

| Helper                     | Answers                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `visibleCaseIds(ctx)`      | which matters may this caller see — honours case-access grants |
| `getVisibleCase(ctx, id)`  | may this caller see THIS matter — same rules, single row       |
| `caseInWorkspace(ctx, id)` | is this matter in the chamber at all — **ignores row scope**   |
| `workspaceCaseIds(ctx)`    | every matter in the chamber — **ignores row scope**            |

The bottom two exist for writes that only need tenant validation (attaching a
calendar entry, validating an access-list `caseId`) and for admin aggregates
(`kpi.ts`). Using either on a read path is how the four leaks fixed after
`fe8c902` happened — see DECISIONS.md. A new route that returns anything
derived from a matter uses one of the top two, and a route that scopes its list
must scope its `:id` fetch with the same helper.

### Known, unfixed

- **The Clerk tenant is a development instance.** Production logs
  `Clerk collects telemetry data … development instances` on every boot. ~100
  user cap, Clerk's shared Google OAuth credentials. Nothing in code fixes this.
- **Nine Quick Action tiles on the dashboard mostly navigate nowhere useful** —
  four promise filtered views that do not exist. Information architecture, left
  alone deliberately.
- **`/invites` still renders a 529px table at 375px.** It scrolls in place.
  _Superseded_ — see the mobile work below: `/invites` and the other five
  table-heavy screens now render as cards below `md`, and the browser suite
  measures every signed-in route at every viewport.

---

## 5a. The mobile apps, and what they moved

Three changes, layered. Each is verifiable on its own.

### The frontend became responsive from 360px to 1440px

`AdaptiveTable` (`components/ui/adaptive-table.tsx`) takes ONE column spec and
renders a real `<table>` from `md` up, stacked cards below. `cell` renders in
both, so the two layouts cannot show different data — which is what went wrong
when this was solved page by page. Applied to tasks, consultations, invoices and
the operator view.

The nav gained a second shape in the other direction: an icon rail with a
dropdown below `lg`, a permanently visible sidebar above it. `navItems` is built
once and consumed by both.

Two latent bugs surfaced. `hidden xs:block` guarded the workspace switcher, but
Tailwind 4 has no `xs` and none was defined — the class never compiled, so the
tenant switcher was invisible at **every** width. And `useIsMobile` initialised
to `undefined` and corrected itself from an effect, which is invisible for
styling but wrong for anything seeding state from it: the calendar picked its
initial view that way, so every phone got the month grid.

### Sign-in gained a fourth door, and the identity model widened

```
Clerk verifies …                       … and the app resolves it
─────────────────────────────────────────────────────────────────────
oauth_google / oauth_custom_zoho   →   verified EMAIL
emailCode                          →   verified EMAIL
phoneCode                          →   verified PHONE   ← new
                                        │
                                        ▼
                        jit.ts: users.email / users.phone
                                        │
                                        ▼
              access-list.ts: findAccessListMatches({ email, phone })
                 kind=email  → exact address
                 kind=domain → domain-of(address)
                 kind=phone  → exact E.164          ← new
                                        │
                                        ▼
                          workspace_memberships (unchanged)
```

Everything below the membership row is untouched: `requireWorkspace`,
`capabilitiesFor`, `lib/scope.ts` and `billableClient()` were already keyed on
`users.id`.

The hot-path detail worth knowing: `getOrCreateUser` used to return early only
when `email` was set. A phone-only user's finished state is `email = ""`, so
that test sent them down the Clerk resync path on **every request**, forever.

An **erased** user has neither identifier and so falls past that early return
too — with a worse consequence than a round trip. The resync path reads "no
identifier" as "the provider had not verified anything yet" and refills both
from Clerk, which is where the erased address and number came back from. A
completed `deletion_requests` row now stops it before the resync:

```
getOrCreateUser
  ├─ email or phone present?          → return (the common case)
  ├─ a completed erasure for this id? → return AS IS   ← erasure holds
  └─ otherwise                        → resyncIdentity → Clerk
```

### The native shells sit ahead of the SPA boot

```
app launch
  └─ Capacitor loads the bundled SPA from https://localhost (Android)
                                       or capacitor://localhost (iOS)
      └─ App.tsx → ThemeProvider → NativeShell        ← no-op on the web
          ├─ back button   → wouter history, exit at root
          ├─ appUrlOpen    → in.lexpractice.app://… → router
          ├─ status bar    → follows the resolved theme
          └─ splash hidden once React has painted
      └─ AppLockGate wraps the routes (inside the session provider,
         outside the pages — so nothing renders behind the lock)
```

The OAuth round trip leaves the app entirely: `allowNavigation: []` means
Capacitor hands the provider to a Custom Tab / SFSafariViewController, and it
returns through the custom scheme. Email and SMS codes never leave the webview.

### Push, as a third channel

```
reminder-scheduler.ts  (node-cron, every 30 min)
  ├─ task deadlines        T-24h / T-2h
  ├─ consultations         T-24h / T-2h
  └─ calendar entries      today / tomorrow   ← new; hearings, filings, meetings
        │                                        fanned out over `audience`
        ▼
   notify()  ── in-app notifications row   (always; also the dedup key)
             ├─ sendMail()                 (when they have a verified address)
             └─ sendPush()                 (devices registered IN THIS workspace)
                    │
                    ▼
              push_outbox → FCM HTTP v1 → Android + iOS
              (drained every minute beside the mail outbox)
```

`notify()` replaced eight hand-written `notifications` inserts. The workspace
filter on `sendPush` is the tenant boundary: someone in two chambers holds a
device row per chamber, and a matter from one cannot surface while they are in
the other.

The other four inserts are event-driven rather than swept, and reach `notify()`
from the request that caused them:

```
POST /document-requests            → the client is asked for a document
PATCH /document-requests/:id       → the client marks it done
POST /cases/:id/documents          → an upload closes the request  (JSON)
POST /cases/:id/documents/content  → an upload closes the request  (raw bytes,
                                      which is the camera path)
```

All four pass `dedupe: false`. All four are the half of the loop that faces a
client, who is the member most likely to have signed up by mobile number and
have no email at all — so before push, the bell row was the only trace, and a
bell is only seen by somebody already looking at the app.

---

## 6. Going live

`DEPLOYMENT.md` is the full runbook. This is the short path, in order, with the
things that actually block you.

### Step 0 — merge to `main` (done)

Render deploys from `main` (`render.yaml`, `branch: main`), so merging IS
deploying — there is no staging step between the two.

Everything described above is on `main` as of `f33b396`: AI drafting, the three
security-review fixes, the paid plan gate with its subscription screen, case
access for juniors and clerks, advocate credentials, the AI case brief, and the
four routes taught about case access afterwards.

**The one thing to check after a deploy that crosses this point:** the paid gate
applies to chambers that already exist. A chamber only gets a `subscriptions`
row when somebody picks a plan, and before this it did not need one — no row
meant trial limits, free. After it, no row means `neverPaid`: the chamber reads
normally and cannot open a matter, invite anyone, draft or invoice.

Checked against production after the `f33b396` deploy, and **no chamber was
gated** — the one workspace that exists already carried an active trial. No
grandfathering migration was written, deliberately: a data migration that does
nothing on the database it was written for would still fire on the next one,
and quietly hand a free plan to chambers the gate is meant to catch.

If this repo is ever deployed onto a database that already has chambers
without subscription rows, that migration becomes necessary. The query that
answers it:

```sql
select count(*) from workspaces w
left join subscriptions s on s.workspace_id = w.id
where s.id is null or (s.status <> 'active' and s.started_at is null);
```

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

> **Both existing services predate the blueprint.** `lex-practice` is the live
> one; `brain-interface-lex` is an older duplicate also auto-deploying from
> `main`. Neither reads `render.yaml`, so neither picked up the `migrate` fix —
> `lex-practice` still has `push` in its Start Command. Migrations now run from
> `pnpm run start` regardless, so nothing is broken by leaving it, but the
> field is still wrong and the duplicate service should be deleted. Fixing them
> field by field is slower than re-applying the Blueprint and you will miss one.

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
