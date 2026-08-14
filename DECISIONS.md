# Decisions

A log of the meaningful choices made while building LEX Practice, with the
reasoning behind each. This is not a changelog — it does not list what changed.
It records **why** the code looks the way it does, so that a future reader (or a
future me) does not undo a deliberate decision thinking it was an accident.

Entries are newest first. Each answers: what was decided, what the alternatives
were, and what would make it worth revisiting.

---

## The beta hardening pass (2026-08-14)

Phases 1–5 and 8 of a brief to prepare the app for an external feedback beta.
One branch per phase, each stacked on the last, none merged to `main` at the
time of writing.

### Investigate before changing, and report before building

**Decided:** every phase that touched behaviour started with a read-only pass —
tracing the real code path, querying the production database, or auditing the
rendered app — and reported findings before any edit.

**Why:** the brief described a Next.js app with a password signup flow. It is a
Vite SPA with an Express API and a passwordless Clerk flow, so four of the ten
things Phase 1 asked about did not exist. Building to the brief's assumptions
would have produced confident, wrong work. The same pass found that Phase 3's
`NOT NULL` needed no backfill (the table was empty) and that Phase 5's design
system was already sound, which turned a large speculative job into a small
evidenced one.

### Verify in a real browser, not by reading the diff

**Decided:** each phase was checked with Playwright against the app running in
preview mode — real Postgres via PGlite, no Clerk tenant, no external service.

**Why:** typecheck and lint prove the code compiles, not that the product works.
This caught things review would not: the Phase 5 audit initially reported every
table as broken until it was corrected to measure the document's `scrollWidth`
rather than element rectangles, and the Phase 8 migration re-run failed on an
unguarded `CREATE INDEX` that would have aborted the production deploy.

**Cost:** the checks live in the session scratchpad, not the repository. They
were written per phase and thrown away. Adding them to `scripts/ci/browser/`
would make them regressions rather than one-shot evidence; the repository still
has **no test files at all**.

---

### Phase 1 — the sign-up flow

#### Joining an existing chamber is by invitation only

**Decided:** the "Request access" form is gone from both gate screens. Founding
a chamber is the only self-serve path; joining one requires an admin to add the
address.

**Why:** both screens posted to a workspace slug hardcoded in their own default
props — `"raghavan-chambers"` — which exists in no seed, no migration and no
deployment, so every request returned 404. The fix had two shapes: show the
signed-in stranger a list of chambers to request access to, or remove the
option. A picker discloses the existence and names of every chamber to anyone
who can authenticate, which is a confidentiality decision rather than a styling
one. The product owner chose removal.

**Kept:** `POST /api/access-requests` and the admin approval queue still exist.
Nothing in the UI creates a row, but re-enabling it is one import. Deleting the
endpoint would have been an API change for no gain.

#### `userMessage()` is a client-side helper, not a change to `ApiError`

**Decided:** `ApiError.message` still leads with `HTTP 404 Not Found:`. A
separate `lib/errors.ts` produces the sentence shown to a person.

**Why:** the status-prefixed form is the right thing in a console and in a bug
report. Rewriting it at source would have improved toasts and degraded
debugging. Two consumers, two strings.

#### The email re-sync only fires when the stored address is empty

**Decided:** `getOrCreateUser` re-reads Clerk only for a user whose stored email
is `""`.

**Why:** the bug was real — a provider that had not verified an address stored an
empty string, nothing ever re-read it, and the access list matches on address, so
the user was stranded permanently. But the obvious fix, re-syncing on every call,
puts a Clerk API round trip on the hot path of every authenticated request.
Gating on the empty value makes it self-healing and free in the common case.

#### Races are absorbed, not locked out

**Decided:** `onConflictDoNothing` then re-select for user creation; a
transaction with a bounded retry loop for chamber founding.

**Why:** both were select-then-insert against a unique column, and both are hit
by exactly the traffic a new user generates — the dashboard fires several
queries at once on first load. Advisory locks would serialise every sign-in to
protect against a collision that is rare and cheap to retry. Treating the unique
violation as the expected outcome for the loser is simpler and has no steady-state
cost.

#### The half-finished sign-in lives in `sessionStorage`

**Decided:** the outstanding one-time code — which address, which Clerk leg —
persists per tab, not per browser.

**Why:** refreshing while reading the code out of an email client used to strand
the user. But a half-finished sign-in is not a preference; it should not outlive
the tab, and `localStorage` would leave it for the next person on a shared
machine.

---

### Phase 2 — filing a case from the dashboard

#### The filing dialog was extracted, not copied

**Decided:** `components/case-form-modal.tsx`, used by both the dashboard and
the Case Registry.

**Why:** filing a case screens for conflicts of interest and can be refused by
the plan limit. A second copy of that logic is a second copy that drifts, and
the copy that drifts is the one that stops checking for conflicts. Extraction
also meant Phase 3's required-field work was one edit instead of two.

#### Modal, because the codebase already says modal

**Decided:** a Radix `Dialog`, matching `task-form-modal`, `document-request-modal`
and `pricing-modal`.

**Why:** the brief asked for the existing convention rather than a new one. There
was no ambiguity to resolve — three modals, no drawers, no inline forms.

#### "Refresh the dashboard's case list" was read as the counters

**Decided:** on success, invalidate both `listCases` and `getDashboardSummary`.
No new list section was added to the dashboard.

**Why:** the dashboard landing page has stat cards, not a case list. Inventing a
"Recent matters" section to have something to refresh would have changed the
information architecture the brief said to leave alone. Flagged to the owner
rather than assumed.

---

### Phase 3 — the mandatory filing reference

#### The production database was queried before the constraint was written

**Decided:** `SELECT count(*) FILTER (WHERE filing_ref IS NULL) …` against the
live Render Postgres, first.

**Why:** the brief required it, and the answer changed the plan: `cases` holds
zero rows, so `SET NOT NULL` needs no backfill and cannot fail. Had there been
rows, the constraint would have been left unwritten pending a backfill decision.

#### No database default on `filing_ref`

**Decided:** `text("filing_ref").notNull()` with no `.default()`.

**Why:** a default would let an insert that forgot the reference succeed with a
placeholder, which is the exact failure the constraint exists to prevent. A
failing insert is the point.

#### The server re-checks the trimmed value

**Decided:** the route trims and re-tests length even though the generated
validator already enforces `min(3)`.

**Why:** `.min(3)` counts characters, so `"   "` satisfies it and then trims to
nothing. The stored value is the trimmed one, so the trimmed one has to pass.

#### `CaseUpdate` keeps the field optional

**Decided:** required on create, optional on update — but it cannot be set to
something empty.

**Why:** a partial patch that omits a field must leave it alone. Making it
required on update would break every request that only changes status.

#### The minimum length is 3, and that is a guess

**Decided:** three characters, stated in one constant per layer.

**Why:** the brief said "a minimum length" without naming one. Three admits every
real registry format (`CV-2026-118`, `WP(C) 1234/2026`) and rejects `"A"`. It is
the least defensible number in this document and the easiest to change.

---

### Phase 4 — the "(optional)" labels

#### Only Notes fields, and three were deliberately left

**Decided:** seven changes. `Comment (optional)` on client feedback,
`Display name (optional)` in the preview sign-in, and `Restrict to Case ID
(Optional but recommended)` on invites were not touched.

**Why:** the brief said "(optional)" _attached to Notes fields_. The first two
are not Notes fields. The third carries a recommendation, not just an optionality
marker, so trimming it would delete advice rather than noise.

#### One of the seven is a placeholder, not a label

**Decided:** the access-list note field was changed too, and flagged.

**Why:** it has no label at all — the placeholder is the only thing naming it, so
that is where the suffix lived. Consistent, but strictly outside "label change".

---

### Phase 5 — the design pass

#### The audit measured the rendered page, then measured itself

**Decided:** contrast and overflow were computed in a browser across twelve
pages and both themes. The first version of that audit was wrong and was fixed
before any code was.

**Why:** element rectangles wider than the viewport reported every table on six
pages as broken. They are not: the shadcn `Table` already wraps in
`overflow-auto` and scrolls in place, which is the intended pattern. Measuring
`document.documentElement.scrollWidth` gives the real answer — no page overflows
anywhere — and the two genuine contrast failures only became visible once the
false positives stopped drowning them.

#### A preview-only failure did not get a global fix

**Decided:** the single AA failure was fixed by pairing the text with the surface
it sits on, not by lightening `--muted-foreground`.

**Why:** the failing element is in the preview banner, which never renders in
production. Changing the token would have shifted every muted label in the app
to correct a development-only artefact.

#### Two type tokens, and 9px folded into 10px

**Decided:** `--text-3xs` (10px) and `--text-2xs` (11px) replace 55 one-off
`text-[9px]` / `text-[10px]` / `text-[11px]` declarations.

**Why:** three sizes chosen ad hoc, none carrying a line-height, all below
Tailwind's `text-xs` floor and therefore outside the scale entirely. The 9px
step was not a deliberate third size and nothing depended on the difference.

#### Wide tables lose columns on phones rather than becoming cards

**Decided:** secondary columns are `hidden sm:table-cell`; the scroll container
stays as the fallback.

**Why:** `/team` asked for 867px of sideways scrolling in a 375px viewport.
Restructuring tables into card lists is a larger change than a design pass, and
the tables were already functional. Dropping columns took `/team` to 499px and
`/cases` inside the viewport. `/invites` is unchanged at 529px — its width comes
from its header labels, not its data.

#### The nine Quick Action tiles were left alone

**Decided:** styled, not removed.

**Why:** four of them ("Priority / Urgent Cases", "Pending Cases / Cause List",
"Case Briefs & Drafting", "Upload Digital Copy") navigate to plain `/cases` or
`/tasks` with no filter applied, and three more duplicate the nav menu. It is the
largest problem on the dashboard and it is an information-architecture decision,
which the brief placed out of scope. Raised twice, still open.

---

### Phase 8 — beta readiness

#### The baseline migration is guarded, so there is no baselining step

**Decided:** every `CREATE TABLE` and the one `CREATE INDEX` in
`0000_baseline.sql` carry `IF NOT EXISTS`.

**Why:** production already has all twenty tables, so an unguarded baseline
aborts on its first statement. The orthodox alternative — insert the migration
hash into drizzle's bookkeeping table by hand so it is skipped — is a manual step
against production that has to be done exactly once and correctly. Guarded, the
same file initialises a new database and no-ops against the old one, and there is
nothing to remember.

**Cost:** a guarded baseline cannot `ALTER` anything, so a change to a table that
predates migrations needs its own numbered file. `0001` is the first.

**Found by testing:** the unguarded `CREATE INDEX` was invisible on a fresh
database and only appeared on the idempotency re-run. It would have failed the
production deploy.

#### `/api/health` answers 503 when the database is unreachable

**Decided:** 200 with a body when healthy, 503 when the query fails.

**Why:** the brief said "returning 200 with a real database connectivity check".
A health check that answers 200 while reporting `"database":"unreachable"` is one
that nothing pages on, which defeats the point of adding it. Three endpoints now
exist deliberately: `/healthz` is liveness and never touches the database,
`/health` is for a monitor, `/readyz` is for a human diagnosing a deploy.

#### The root error boundary tells the user nothing about the error

**Decided:** the per-module boundary still prints `error.message`; the new root
one does not.

**Why:** the module boundary is scoped to a panel a developer is probably looking
at. The root boundary fires on the paths nobody anticipated, in front of external
beta users, where "Cannot read properties of undefined (reading 'map')" tells
them nothing actionable while telling a stranger something about our internals.
It is also written with inline styles and `window.location` because it wraps the
theme provider, the router and Clerk — it cannot assume any of them mounted.

#### `beta_feedback` is a new table, not the existing `feedback`

**Decided:** a second table rather than relaxing the first.

**Why:** `feedback` is a client rating a matter out of five — it requires a case,
requires a rating, and only the client who owns the matter may write it. Those
constraints are what make it trustworthy as a review. Product feedback has a
different author, a different lifetime and a different audience; folding them
together would mean loosening constraints that exist for a reason.

#### `beta_feedback.workspace_id` is nullable

**Decided:** nullable, and the route sits behind `requireAuth` rather than
`requireWorkspace`.

**Why:** the people most worth hearing from during a beta are the ones stuck on
the access-denied and pending-approval screens. They belong to no workspace, so
`requireWorkspace` would refuse them and a `NOT NULL` would silence exactly the
group that has no other way to tell you anything.

#### The widget is mounted in `App.tsx`, bottom-left

**Decided:** alongside `<Toaster />` in both app trees, not inside the dashboard
shell; positioned bottom-left.

**Why:** the two screens that most need a way to report a problem render
_outside_ that shell. Bottom-left because toasts land bottom-right, and a button
covered by its own confirmation is one people stop trusting.

#### `lib/db/drizzle/` is in `.prettierignore`

**Decided:** prettier does not format drizzle's migration state.

**Why:** drizzle-kit rewrites those files and does not format to our rules, so
`format:check` fails after the next `generate`. The snapshot chain is also
validated by the tool — it rejected a hand-copied snapshot whose `prevId` did not
link — so it is tool-owned, not ours.

---

## Architecture

### Single origin: the API server also serves the frontend

**Decided:** one Node process serves both `/api/*` and the built React bundle.

**Why:** the alternative — a static host for the SPA and a separate API host —
introduces cross-origin requests, which means CORS, which means the API has to
decide which origins may send credentialed requests. Get that wrong by
reflecting an arbitrary `Origin` and any website can issue authenticated
requests using a signed-in user's cookie. Same-origin removes the entire class
of mistake: no CORS headers are needed at all.

It also halves the number of things that can be misconfigured at deploy time,
which for a one-person operation matters more than the theoretical scaling
headroom of splitting them.

**Cost accepted:** the API process spends cycles serving static files that a CDN
would serve better, and the frontend cannot be deployed independently of the
backend.

**Revisit when:** traffic justifies a CDN, or the frontend release cadence
diverges from the API's. `CORS_ALLOWED_ORIGINS` and `VITE_API_BASE_URL` already
exist to support the split — see DEPLOYMENT.md, Topology B.

---

### pnpm workspace monorepo rather than separate repositories

**Decided:** `artifacts/*` (api-server, practice-portal, mockup-sandbox) and
`lib/*` (db, api-spec, api-zod, api-client-react) in one repo, one lockfile.

**Why:** the API contract is shared. `lib/api-spec` holds an OpenAPI document;
`lib/api-zod` and `lib/api-client-react` are generated from it. In separate
repos, a route change and its client would land in different pull requests and
drift between them would be invisible until runtime. Here a contract change that
breaks a caller fails `pnpm run typecheck` in the same commit.

**Cost accepted:** every CI run builds everything.

---

### The API contract is generated, not hand-written

**Decided:** `lib/api-spec` (OpenAPI 3.1) is the source of truth. `orval`
generates Zod schemas into `lib/api-zod` and React Query hooks into
`lib/api-client-react`.

**Why:** the request validator on the server and the types on the client come
from the same document, so they cannot disagree. Hand-written types on both
sides drift, and the drift shows up as a runtime 400 that neither side's tests
caught.

**Problem this created, and its fix:** orval's barrel files were not idempotent
— each codegen run appended to them, so a "check the generated code is current"
CI step could never pass. Rather than abandon the check, a normaliser
(`lib/api-spec/scripts/normalise-barrels.mjs`) sorts and dedupes the barrels
after generation, making the output stable.

---

### Postgres via Drizzle, with PGlite for preview

**Decided:** Drizzle ORM against Postgres in production; PGlite
(Postgres compiled to WebAssembly) when `DATABASE_URL` is absent outside
production.

**Why Drizzle over Prisma:** Drizzle's query builder is close enough to SQL that
a reviewer can see what a query will actually do, which matters when the
correctness of a query _is_ the security boundary — every read in this codebase
is scoped by workspace, and an ORM that hides the WHERE clause makes that hard
to audit.

**Why PGlite for preview:** the app can be run and demonstrated with no database
service at all, which is what makes the preview build possible. It is real
Postgres, so a query that works in preview works in production — an SQLite
fallback would not have that property.

**Guard:** `initDatabase()` refuses the preview fallback when
`NODE_ENV=production`. Silently running a real deployment on an ephemeral
database is worse than refusing to start.

**Cost accepted:** the preview schema is defined separately in
`lib/db/src/preview.ts` and can drift from the migrations. It has, once — a
`NOT NULL` on `started_at` that production did not have, which made one endpoint
500 only in preview.

---

### `db` is a Proxy, not a plain export

**Decided:** `lib/db/src/index.ts` exports a `Proxy` that throws until
`initDatabase()` has been awaited.

**Why:** the preview driver boots WebAssembly, so the connection cannot be
established synchronously at import time. Every call site would otherwise have
to `await getDb()` and thread it through. The proxy keeps the plain
`db.select()...` form everywhere and moves the one asynchronous step to a single
`await initDatabase()` in `artifacts/api-server/src/index.ts`.

**Cost accepted:** forgetting that await produces a runtime error rather than a
compile error. The error message says exactly what to do.

---

## Authorisation

### Never trust client-side state for authorisation

**Decided:** every protected endpoint runs through `requireWorkspace`, which
re-reads the user's membership **from the database on every request**.

**Why:** the alternative is putting the role in a JWT claim and trusting it.
That makes revocation take effect only when the token expires — so a person
removed from a chamber keeps their access for the remainder of the token's life,
holding privileged client material they are no longer entitled to. For a product
under BCI Rule 36 that is not an acceptable window.

**Cost accepted:** a database round trip on every authenticated request. This is
the single largest recurring cost in the request path and it is bought
deliberately.

**Corollary:** the frontend's `can()` helper reads capabilities the _server_
issued. It decides what to render, never what is permitted. Every capability
checked in the UI is checked again by `requireCapability` on the server.

---

### Capabilities, not role checks, at the endpoint

**Decided:** endpoints declare `requireCapability("cases.write")` rather than
`requireRole("firm_admin", "senior_advocate")`.

**Why:** role lists at the endpoint have to be edited in dozens of files when a
role's powers change, and the ones that get missed are silent. A capability
names the _action_, so the role→capability mapping lives in one file
(`lib/permissions.ts`) and changing a role's powers is a single edit.

**Bug this caught:** removing `feedback.read` from a shared `ADVOCATE_CAPABILITIES`
list stripped it from Senior Advocate as well, which was not intended. The
chamber test suite caught it because capabilities are asserted per role in one
place.

---

### 403 with a reason, never 404 or a silent empty list

**Decided:** an authorisation failure returns 403 and says which capability was
missing.

**Why:** hiding the boundary by returning 404 or an empty list is a common
"security by obscurity" reflex that mostly harms legitimate users, who cannot
tell a permissions problem from a bug. This app's tenancy boundary is enforced
by the query scoping, not by hiding the existence of endpoints, so there is
nothing to protect by lying.

The 403 body distinguishes `no_active_membership` (pending approval),
`not_a_member`, `workspace_not_selected` and `invalid_workspace_token`, because
each needs a different screen.

---

### Passwordless only

**Decided:** the Clerk-hosted `<SignIn>` component was removed; `/sign-in` and
`/sign-up` both redirect to `/portal`, which drives Clerk's OAuth and email-code
strategies directly.

**Why:** the hosted component renders whatever strategies the Clerk dashboard
has enabled, including a password field. A password field could be re-enabled by
a dashboard setting with no code change and no review. Driving the strategies
directly means the code is the guarantee.

---

## The request path

### The payment webhook is mounted before the JSON parser, on the raw body

**Decided:** `app.post("/api/billing/webhook", express.raw(...))` sits above
`app.use(express.json())` in `app.ts`.

**Why:** the provider signs the exact bytes it sent. Parsing JSON and
re-serialising changes key order and whitespace, so the HMAC digest no longer
matches — and the usual "fix" for that is to skip verification, which is how
these integrations end up authenticating nothing. Mounted at the top level
rather than inside the billing router so the ordering is visible to anyone
reading `app.ts`.

---

### Health checks are mounted ahead of authentication

**Decided:** `/api/healthz` and `/api/readyz` are registered before
`clerkMiddleware`.

**Why:** behind it, a missing or invalid Clerk key makes the health check return 500. Hosts that gate a release on the health check (Render, Railway, Fly, ECS)
then fail the deploy with an error pointing at the wrong subsystem. `/healthz`
also touches no database, so it answers during a database outage — which is what
distinguishes "the process is dead" from "the database is unreachable".

`/readyz` is the opposite: it reports on everything, including the database
error unwrapped to its root cause, and is the fastest way to learn what a
running deployment actually has configured.

---

### `clerkMiddleware` is scoped to `/api`, not mounted globally

**Decided:** `app.use("/api", clerkMiddleware(...))`.

**Why:** applied globally, Clerk answers an unauthenticated request lacking its
dev-browser cookie with a handshake redirect. That redirect hits the HTML
document request, so loading the site bounced to Clerk instead of rendering. The
SPA must be served unauthenticated — it runs its own Clerk client and decides
what to show.

---

### Rate limits are tiered, strictest on the sign-in path

**Decided:** `/session` and `/workspaces` at 30/min, `/access-requests` at
20/min, all non-GET at 120/min per user, GETs unlimited.

**Why:** the sign-in path is what an attacker hits to enumerate addresses or spam
one-time codes, so it gets the tightest budget. A busy chamber refreshing a
cause list is not an attack, so reads are left alone — a limit that fires on
normal use gets removed by the next person who is paged at midnight.

---

## Data protection

### Uploaded documents are encrypted at rest, and reads are buffered

**Decided:** AES-256-GCM with a per-file random IV. On-disk layout is
`magic "LEXP1"(5) | iv(12) | authTag(16) | ciphertext`.

**Why GCM:** it authenticates as well as encrypts, so a modified file fails to
open rather than returning altered content. For evidence and pleadings, silently
returning altered bytes is worse than returning nothing.

**Why reads are buffered rather than streamed:** GCM only verifies the
authentication tag at the _end_ of the stream. Streaming to the client would
send most of a tampered file before discovering it was tampered with. The whole
file is decrypted and verified before a byte goes out.

**Cost accepted:** memory proportional to file size, and no range requests.

**Guard:** the server refuses to start in production without
`FILE_ENCRYPTION_KEY`. Writing privileged client files in the clear is worse
than not starting.

---

### IP addresses are truncated before storage

**Decided:** IPv4 keeps three octets, IPv6 keeps its /48.

**Why:** enough to notice an anomaly or an account compromise, not enough to be
a record of where someone was. The privacy policy says so, so the code has to
mean it.

---

### No third-party fonts, analytics, or tracking

**Decided:** system font stacks only.

**Why:** the privacy policy states that no fonts, analytics or advertising are
loaded from third parties. A Google Fonts `@import` discloses every visitor's IP
address to Google _before_ they sign in, which would make that statement false.

**How this went wrong once:** the `<link>` tags were removed from `index.html`
and the fix reported as complete, but line 1 of `src/index.css` still had
`@import url("https://fonts.googleapis.com/...")`. A written privacy claim was
untrue for several commits. The lesson recorded here: when a claim is about the
_absence_ of something, grep the built output, not the source you remember
editing. The browser suite now asserts no third-party request is made.

A related loose end survived until the design port: the Clerk sign-in card still
named `'Plus Jakarta Sans'`, which had been silently falling back to
`sans-serif` since the import was removed.

---

### The audit log is append-only

**Decided:** privileged actions are written to a log nothing in the application
can edit or delete.

**Why:** an audit trail that the application can rewrite is not evidence of
anything. Erasure requests are honoured by _anonymising_ the actor — the record
survives, the link to the person does not.

---

## The design port (2026-08-11)

### Re-skin through the token layer, not through the components

**Decided:** the neumorphic palette was applied by rewriting the CSS custom
properties in `src/index.css` and redefining Tailwind's shadow scale, rather
than editing the 55 shadcn primitives.

**Why:** a census found 399 token-based class usages against only 7 hardcoded
colours. Swapping the token values re-skins nearly the whole application from
one file. Editing components would have been 55 files of mechanical change with
55 chances to introduce an inconsistency.

---

### The shadow scale is defined in `@theme inline`, pointing at relief variables

**Decided:**

```css
@theme inline {
  --shadow-sm: var(--raise-sm);
  --shadow-md: var(--raise);
  --shadow-lg: var(--raise-lg);
}
```

**Why `inline` specifically:** it makes Tailwind emit
`--tw-shadow: var(--raise-sm)` into the utility rather than freezing the value
at build time. The variable therefore resolves _per element_, against whichever
theme is active. Two consequences follow: every `shadow-sm` already written in
the app became extruded material with no edit, and the dark theme inverts the
entire relief system by redefining just two colours (`--lift` and `--sink`).

Without `inline`, the light-mode value would have been baked into the utility
and the dark theme would have needed its own set of shadow classes.

---

### Relief is built from colours sampled off the ground, not from black and white

**Decided:** `--lift: #fdf9f2` and `--sink: #bcac96`, both drawn from the ground
colour, rather than `rgba(255,255,255,…)` and `rgba(0,0,0,…)`.

**Why:** a neutral highlight and a neutral shadow on a warm surface read as a
drop shadow — an object floating above a page. A highlight and shadow in the
ground's own hue read as the _same material_ deformed. That difference is the
whole effect.

---

### Containers raised, inputs recessed, data flat

**Decided:** the discipline is applied at the element level in `@layer base`:

```css
input:not([type="checkbox"], [type="radio"], …),
textarea,
[data-slot="select-trigger"] {
  box-shadow: var(--press-sm);
}
```

**Why at the element level rather than on the `Input` primitive:** native
fields, Clerk's hosted fields, and anything else rendered into the page get the
same treatment. A rule on our own component would have left Clerk's sign-in
fields extruded while ours were recessed, on the same screen.

**Why this rule at all:** a field carved into the ground reads as a place to put
something. One extruded from it reads as a button — and a form full of buttons
is unusable.

The excluded input types are hit areas, not wells.

---

### `rounded-none` was swept, with two deliberate exceptions

**Decided:** 210 of 223 `rounded-none` usages became `rounded-lg`. The
exceptions are inside input groups (segments joined into one control) and the
middle of a selected date range (a continuous band).

**Why:** the square geometry had been hardcoded in the markup, so changing
`--radius` from `0` to `14px` moved nothing. Paired relief shadows on a hard
corner read as a printing error, because no real extruded material has one.

---

### Nine hand-picked greys became one tile

**Decided:** the dashboard's nine quick-action tiles, each with its own shade
from Tailwind's `slate`/`zinc`/`stone`/`gray`/`neutral` ramps, are now one
shared class.

**Why:** the busiest surface on the dashboard was the one place a theme change
could not reach. The nine shades also implied a ranking between the actions that
does not exist — "Upload Digital Copy" is not two steps less important than
"Create / Assign Task". What distinguishes the tiles is the label, which is the
only thing that actually differs.

---

### Warning and success became tokens

**Decided:** added `--warning` / `--warning-foreground` and `--success` /
`--success-foreground`, in the palette's own wood tones.

**Why:** the app needed both and had been reaching for Tailwind's `amber-500`
and `green-100` — colours from outside the palette. That is why those notices
never followed a theme change and had no dark counterpart worth the name.

---

## Deployment

### Render Blueprint (`render.yaml`) rather than dashboard configuration

**Decided:** the shape of the deployment lives in version control.

**Why:** a service configured by hand in twenty dashboard fields has no history,
cannot be reviewed, and cannot be recreated. The specific failure that motivated
this: a hand-made service was missing the database, the encryption key and the
Clerk keys, and each missing value surfaced only after the previous one was
fixed — three full builds to discover three variables.

**Secrets are deliberately not in it.** Every `sync: false` is a value pasted
into the dashboard once. A blueprint is a file in a repository.

---

### `drizzle-kit push` runs in `startCommand`, not `preDeployCommand`

> **SUPERSEDED 2026-08-14** by the migrations decision above. The placement in
> `startCommand` was right and is unchanged; the command is now `migrate`, not
> `push`. `push` had been failing on every production boot with "Interactive
> prompts require a TTY terminal" — it asks for confirmation on an ambiguous
> diff and there is no terminal in a deploy container — so the deployed schema
> had silently stopped tracking the code. Kept here because the reasoning about
> `preDeployCommand` still applies.

**Decided:** `startCommand: pnpm --filter @workspace/db run push && pnpm run start`.

**Why:** `preDeployCommand` requires a paid instance type, and Render only shifts
traffic once the new instance passes its health check. So a failed migration
means the deploy does not go live while the previous instance keeps serving —
the same safety, without the plan dependency.

---

### The build fails when the Clerk key is missing, gated on an explicit flag

**Decided:** `vite.config.ts` throws when `REQUIRE_CLERK_KEY === "true"` and
`VITE_CLERK_PUBLISHABLE_KEY` is absent.

**Why fail the build:** the alternative is shipping a bundle in preview mode
that nobody can sign in to — a deployment that looks successful and is not.

**Why an explicit flag rather than `NODE_ENV`:** `vite build` sets
`NODE_ENV=production` itself, so keying on it fired during CI's _deliberate_
preview builds and broke the pipeline. The first version of this guard did
exactly that.

---

### A fatal startup failure must exit non-zero

**Decided:** the `uncaughtException` handler sets `process.exitCode = 1`
immediately and its forced-exit timer is **not** `unref()`d.

**Why:** the first version reported the error and then let Node exit 0, because
the handler suppressed Node's own non-zero exit and the timer was unref'd so the
event loop drained. Render read that as a **successful deploy** of a process
that had already died. `scripts/ci/startup-guards.mjs` now asserts on the exit
code rather than on log text, because log text was what made this invisible.

---

### One preflight reports every missing setting at once

**Decided:** `lib/preflight.ts` checks `FILE_ENCRYPTION_KEY`, `DATABASE_URL`,
`CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` together and throws once, listing
all of them with what each is for and where to get it.

**Why:** the individual guards each threw on their own, so a deployment missing
four variables cost four builds to diagnose — and each build on a managed host
is several minutes. The individual guards are kept behind it; this does not
replace them, it just gets there first with a better message.

`WORKSPACE_TOKEN_SECRET` is a warning rather than a failure: unset, a random
per-process secret is used and every restart signs users out of their workspace.
Annoying, not unsafe.

---

## Pricing

### Trial is priced below cost on purpose

**Decided:** Trial ₹99 against roughly ₹394 of cost — a deliberate loss of
₹295 per trial. Pro ₹1,999 (cost ₹165, 91.7% margin), Firm ₹4,999 (cost ₹531,
89.4%). Break-even at 3 Pro chambers.

**Why:** the trial's job is to convert, not to earn. Pricing it at cost would
put it near ₹400, which is close enough to Pro that it stops being a trial and
starts being a cheap plan people stay on.

Full working in `docs/UNIT-ECONOMICS.md`.

---

## Things deliberately not done

Recorded so they are not mistaken for oversights.

- **Content-Security-Policy at the edge.** Meaningful CSP for a page that loads
  Clerk's script needs the header set at the CDN, which does not exist yet.
- **Object storage for documents.** A Render disk is roughly 16× the cost of R2
  at volume, and pins the service to one instance because Render disks cannot be
  shared. It is the simplest starting point, not the cheapest one.
- **Counsel review of the legal drafts.** `docs/legal/*` are drafts with
  `[SQUARE BRACKET]` placeholders. They describe what the software actually
  does, which is the hard part, but they are not signed off.
- **An end-to-end Razorpay test against live keys.** The signature verification
  and idempotency are tested; a real payment has not been taken.
