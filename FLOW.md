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

Two commits, both on `claude/bci-chamber-management-saas-j5cr4y`, **neither yet
on `main`** — so neither is deployed.

### `e58e3fe` — one preflight instead of four failed deploys

| File                                        | Change                                                                                                                                                                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `artifacts/api-server/src/lib/preflight.ts` | **New.** `inspectProductionConfig()` and `assertProductionConfig()`. Checks four required settings together, throws once listing all of them with what each is for and where to get it. `WORKSPACE_TOKEN_SECRET` is a warning, not a failure. |
| `artifacts/api-server/src/index.ts`         | Calls it at step 2 of startup, before every other guard.                                                                                                                                                                                      |
| `scripts/ci/startup-guards.mjs`             | Asserts on the **exit code**, not on log text.                                                                                                                                                                                                |

**Why:** each guard used to throw on its own, so a deployment missing four
variables cost four builds to diagnose.

### `c7cfe41` — the neumorphic design port (44 files)

The standalone demo artifact had been redesigned; the React portal had not. They
are separate codebases, so the redesign had never reached the thing that
deploys.

**The three files that carry the change:**

| File                      | Change                                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/index.css`           | The whole port. New palette (both themes), `--lift`/`--sink`, the `--raise*`/`--press*` primitives, `--radius` 0 → 14px, the `@theme` shadow scale, the inputs-recessed base rule, and new `--warning`/`--success` tokens.                 |
| `src/pages/dashboard.tsx` | Nine quick-action tiles, each a different hardcoded grey, collapsed into one `quickActionTile` class. Document-request tray recessed. Fixed a layout bug where at 390px the "Document requests out" button was clipped off the right edge. |
| `src/App.tsx`             | The Clerk sign-in appearance, which had the old slate palette hardcoded as literals and named a webfont removed months earlier.                                                                                                            |

**Mechanical across the other 41 files:** `rounded-none` → `rounded-lg` (210
occurrences), and `border border-border bg-background` → `rounded-lg bg-card
shadow-sm` (37 panels). Nine primitives in `components/ui/` were adjusted
individually.

**Bugs found while porting** (each was a colour a theme change could not reach):

- `pages/kpi.tsx` passed `var(--border)` and `var(--background)` as CSS colours.
  Those tokens are bare HSL triples, so the values were never valid — the chart
  tooltips had no background at all. Now `hsl(var(--…))`.
- Amber and green notices came from Tailwind's palette because the app had no
  warning or success token.

**Verification run:** `scripts/ci/browser/portal.mjs` — 46/46 assertions across
seven viewports (360/390/414/768/1024/1280/1440), zero console errors, zero
failed requests. Separately, all 295 rendered text nodes were measured against
the background actually painted behind them: no contrast failure at any size.

### One thing found and not fixed

`scripts/ci/browser/portal.mjs` §8 claims to measure "the signed-in
application", but its chamber-founding step looks for `input[type="text"]`,
which does not exist on the Access Denied page. It silently skips, so all seven
`dashboard @ Npx` assertions actually measure the **Access Denied screen**. They
pass — but not on what they claim. Outside the scope of the port, so it was left
alone; worth fixing.

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
