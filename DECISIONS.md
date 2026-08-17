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

### Phase 6 — time capture and chamber performance

#### Effort could not be reported, because effort was not recorded

**Decided:** build `time_entries` first. Manual entry AND a start/stop timer.

**Why:** the investigation found no time capture anywhere — no hours,
duration, billable flag or rate in any of twenty tables. The brief was explicit
that a proxy must not be presented as effort, and it is right: a task count is
not hours, because a task is five minutes or five days. Both entry paths exist
because both are how people work — nobody starts a timer before a corridor
conversation, and nobody reconstructs a three-hour drafting session accurately
from memory a week later.

**Minutes, as integers.** A timer that runs twenty minutes is 20, not 0.3333
hours. Hours are produced only at display.

#### A second timer banks the first rather than refusing

**Decided:** starting a timer stops any timer the same person already has
running, records its minutes, and opens the new one.

**Why:** the alternatives are worse. Refusing blocks somebody who forgot to stop
yesterday's, and allowing two silently double-counts their day.

#### `cases.closed_at` is a real column, not a parsed sentence

**Decided:** new nullable column, maintained by the update route both ways —
set when a matter closes, cleared if it reopens. Backfilled in migration 0003.

**Why:** the only previous record of a closure was a `status_changed` timeline
row with the status inside free text. A median computed by pattern-matching
prose breaks the day somebody rewords the message, and cycle time is the
headline metric of the phase.

#### Aggregation is SQL, and the old KPI route is the counter-example

**Decided:** `lib/performance.ts` computes every figure with SQL aggregates —
`percentile_cont` for the medians, `FILTER` clauses for the windows — plus three
indexes on `time_entries`.

**Why:** the brief asked for it, and the existing `/kpi/summary` route shows
what the alternative looks like: `SELECT *` on cases and tasks, then
`.filter().length` in JavaScript. Fine at demo volume, a full table scan per
page load at real volume. Median rather than mean is the brief's call and the
right one — one matter that sat three years drags an average somewhere no real
matter lives.

#### A metric below five data points refuses to draw itself

**Decided:** `MINIMUM_SAMPLE = 5`. Below it the payload reports the sample size
and a null value, and the page says "not enough data yet".

**Why:** a trend through four points is decoration. Five is a judgement call
rather than a statistical result, which is why the threshold is in the payload
and stated on screen rather than hidden in the client.

#### Permissions: everything KPI stays admin-only

**Decided:** confirmed with the product owner before building. `kpi.read` is
held by admin alone — the matrix already excludes `senior_advocate` explicitly —
so chamber aggregates AND per-member hours both sit behind it. Per-individual
effort therefore travels in the same payload with no second gate, and a comment
at the endpoint records that `byMember` must be split out first if `kpi.read` is
ever widened.

**Why:** putting one advocate's hours in front of their colleagues is a
workplace-surveillance decision, not a UI one. It was put to the owner as such,
with the surveillance implication named, and they chose the strictest option.

**Separately:** `time.write` and `time.read` are new capabilities granted to all
staff roles, because recording your own hours is part of doing the work.
Clients get neither.

---

### Phase 7 — invoicing (data model and numbering only)

#### A counter row, not a Postgres sequence

**Decided:** `invoice_series`, one row per chamber per financial year, locked
with `SELECT … FOR UPDATE` inside the same transaction that writes the invoice.

**Why:** the requirement is _gapless_, and Postgres sequences are explicitly
documented as not being that — a transaction that rolls back has already
consumed its value and does not return it. That is the correct trade for a
surrogate key and the wrong one for a legal document series a tax authority may
inspect. With a locked row, a failed invoice write rolls the increment back with
it and the number goes to the next caller instead of being burned.

**Verified:** eleven checks against real Postgres, including that a transaction
which fails after reserving leaves no gap. **Not verified:** the concurrent case
itself — PGlite is single-connection and physically cannot hold twenty
simultaneous transactions. The guarantee rests on ordinary `FOR UPDATE` row
locking and needs a multi-connection Postgres to demonstrate.

#### Numbers are assigned at issue, never at draft

**Decided:** `invoice_number` and `financial_year` are null until an invoice is
issued. The unique constraint spans all three columns.

**Why:** this is what actually keeps the series gapless in practice. Somebody
will create three drafts and delete two; if drafts held numbers, that would tear
two holes in the run. Postgres does not treat nulls as equal, so any number of
numberless drafts coexist under the same constraint that forbids two issued
invoices sharing a number.

#### "Overdue" is derived, never stored

**Decided:** the stored statuses are draft, issued, sent, paid, void. Overdue is
computed as issued-or-sent with a due date in the past.

**Why:** the brief lists overdue among the statuses, but it is a question about
today's date. Storing it would require a scheduled job whose only purpose is to
stop a derived value going stale, and would produce invoices that are overdue
only because the job ran.

#### Money in paise, quantities in thousandths

**Decided:** every amount column ends `_minor` and holds integer paise;
`quantity_milli` holds thousandths, so 1.5 hours is 1500. `amount_minor` is
stored per line rather than recomputed on read.

**Why:** the first is the brief's non-negotiable and already the house rule —
`lib/plans.ts` says "money never touches a float" for subscription pricing. The
second follows for the same reason: 7.7 hours at ₹4,500 must reach the same
total twice. Storing the line amount means the printed document, the stored row
and the total cannot drift apart if a rounding rule is ever adjusted.

#### Client and firm details are snapshots, deliberately duplicated

**Decided:** name, address, email and GSTIN for both parties are columns on the
invoice, not joins to the client record.

**Why:** the brief requires it and the reason is sound. A client who moves
office after being invoiced must not retrospectively change the address on a
document already in their hands.

#### No tax rate is assumed anywhere

**Decided:** `tax_treatment` is free text defaulting to `"unspecified"`, and
`cgst_rate_bp` / `sgst_rate_bp` / `igst_rate_bp` default to zero. Rates are basis
points as integers — 9% is 900.

**Why:** the brief was explicit that the tax logic is the accountant's decision,
not this code's, and legal services in India carry specific rules including
reverse charge in some cases. Nothing defaults to 9/9 or 18. An unconfigured
invoice produces zero tax and says so, rather than guessing and being quietly
wrong on a document that goes to a tax authority.

---

### Phase 7 — invoicing (routes, PDF, billing details)

The numbering above was reviewed first, as the brief required. What follows is
what was built on top of it.

#### Billing details live on the chamber and the client, not on a settings blob

**Decided:** the firm's address, GSTIN, place of supply, SAC code, default tax
rates, hourly rate and payment terms are columns on `workspaces`. The client's
address, GSTIN and place of supply are columns on `users`.

**Why:** every one of these is a real attribute of a real party, and the invoice
snapshots them at issue. A JSON settings column would have been quicker to add
and would have made the snapshot code guess at shapes that no type checks. They
are also the fields a chamber will want to filter and report on later.

Every column is nullable or defaults to empty/zero, so `0005_billing_details.sql`
adds them to a populated table without a table rewrite and without inventing a
tax position for an existing chamber. Nothing existing is dropped or retyped.

#### Issuing an invoice is one transaction, and it does four things

**Decided:** `POST /invoices/:id/issue` reserves the number, snapshots the
client, snapshots the firm, and flips the status — all inside a single
`db.transaction`.

**Why:** any one of those failing after another succeeded leaves a document that
is wrong in a way nobody would notice until a client queried it. A number
reserved but not written is the gap the whole counter design exists to prevent;
a status flipped without a snapshot is an invoice whose address silently follows
the client's next office move.

#### The PDF recomputes nothing

**Decided:** `lib/invoice-pdf.ts` prints `line.amountMinor` and
`invoice.totalMinor` straight from the stored row. It never multiplies quantity
by rate.

**Why:** the paper is the copy the client is holding. If the PDF derived its own
figures, changing a rounding rule later would make the document and the database
disagree, and the disagreement would surface as a client dispute rather than as
a failing test. Rendering server-side rather than in the browser is the same
argument: the bytes must not depend on who downloaded it.

#### Immutability is enforced by the route, not by convention

**Decided:** `PATCH` and `DELETE` on anything past draft return **409**, not 403.
`paid → sent` returns 409. Voiding is the only way to retract an issued invoice,
and it records who and why while keeping the number.

**Why:** 403 would say "you lack permission", which is false and would send an
admin looking for a role to grant. 409 says the document's state forbids it,
which is the actual reason. Voiding rather than deleting is what keeps the series
gapless after a mistake — the number stays spent and the record says why.

#### pdfkit 0.19, and two things it needs that are not obvious

**Decided:** pdfkit `^0.19.1`, with `@swc/helpers` declared as a direct
dependency of `api-server`, and `build.mjs` copying pdfkit's `.afm` font metrics
into `dist/data`.

**Why:** pdfkit 0.15 pulls fontkit 1.9, which calls
`@swc/helpers`'s `applyDecoratedDescriptor` — removed in the 0.5 line that
everything else in the tree resolves to, so the server would not boot at all.
0.19 pulls fontkit 2, which works, but still `require`s `@swc/helpers` without
declaring it; under pnpm's strict layout that resolves only if `api-server`
declares it. Removing that dependency was tried and the server failed to start.

The font metrics are a separate trap: esbuild bundles JavaScript and nothing
else, so the built server threw `ENOENT: Helvetica.afm` on the first PDF
request while every test against the source tree passed.

#### Verified

41 checks end to end against the built server: rounding applied once (7.7h ×
₹4,500 = 3,465,000 paise exactly), tax taken from chamber settings, no number on
a draft, `RC/2026-27/0001` at issue, both parties snapshotted, edit and delete
refused with 409 once issued, `paid → sent` refused, **a deleted draft leaves no
gap** (the next issue took number 2), a void keeping its number and recording
who and why, list totals excluding voided invoices, a real PDF with correct magic
bytes, stored totals unchanged since issue, and a non-member refused on both the
list and the PDF.

---

### Phase 7 — the invoicing screen, and a hole it exposed

#### Only a member of the chamber can be billed

**Decided:** `billableClient()` in `routes/invoices.ts` resolves the client by
joining `workspace_memberships`, and both creating and editing a draft refuse a
user who holds no active membership of the caller's workspace.

**Why:** wiring the client picker to `listWorkspaceMembers` is what surfaced
this. Until then the route accepted **any** user id in the table — every
chamber's users share one — so an admin could name an id belonging to a
different firm and the invoice would snapshot that person's name, email and
billing address onto a document their own chamber then reads and prints. It is
exactly the cross-tenant leak the capability matrix exists to prevent, arriving
through a field nobody thought of as an access decision.

Membership is checked at draft time only. An invoice already issued keeps the
snapshot it was issued with even if the person later leaves the chamber — they
were a client when the work was billed, and rewriting that is the thing the
snapshot exists to stop.

#### A draft shows a live name; an issued invoice shows its snapshot

**Decided:** the list and the detail view print `clientName` when the invoice
has one, and otherwise look the client up in the current member list.

**Why:** the snapshot is written at issue, so a draft has none and every draft
row read "—" — including one raised seconds earlier for a named client. The
fallback is deliberately one-directional: an issued invoice always shows its own
stored name, never the member record, because that is the name actually printed
on the paper the client is holding.

#### One rounding rule, restated in the form

**Decided:** `lineAmountMinor` is duplicated in `invoice-form-modal.tsx` with a
comment saying why, rather than the form deriving totals its own way.

**Why:** the preview must not be able to disagree with what the server stores.
The alternative — a round trip per keystroke — is worse, and a form that quietly
computes 7.7 × ₹4,500 differently from the document is the specific failure this
whole phase is built to avoid. The figures shown after saving are re-read from
the server regardless, so the duplicate is a preview and never the authority.

#### Verified

24 checks in a real browser (Chromium, preview mode) on top of the 44 against
the API: the nav item appears for admin only, the preview rounds 7.7h × ₹4,500
to ₹34,650 exactly, tax defaults arrive from chamber settings, the dialog names
the number issuing would assign, a draft shows no number, issuing shows one and
moves the outstanding figure, an issued invoice offers no Edit or Delete, the
PDF downloads named `RC-2026-27-0001.pdf`, voiding refuses to proceed without a
reason and then keeps the number while dropping out of the outstanding total,
and a client signed in to the same chamber cannot reach the page at all.

The API suite also now proves the cross-tenant refusal directly: billing a user
from outside the chamber returns 400 and says why.

---

### Migrations run in-process, not by shelling out to drizzle-kit

**Decided:** `migrate-on-boot.mjs` uses drizzle-orm's programmatic migrator
against a single `pg.Client`, instead of spawning
`pnpm --filter @workspace/db run migrate`.

**Why:** a deploy failed with **"Port scan timeout reached, no open ports
detected"**, and the logs showed the cause was time, not a crash. The new
instance did bind — `Server listening … port 10000, commit b282e14` — but the
window had already gone: Render logged `Deploying…` at 08:16:40 and the start
command did not begin until **08:25:15**, eight and a half minutes of container
scheduling on the free plan, before any code in this repository ran.

Nothing here can shorten that eight minutes. What it can shorten is the part
after it. The old chain was `node → pnpm → drizzle-kit → tsx` compiling
`drizzle.config.ts` before a single row moved: three extra processes and a
TypeScript compile, all inside the window Render is waiting in. Measured end to
end, from start command to a bound port:

|                                   | before | after     |
| --------------------------------- | ------ | --------- |
| migration step alone              | ~15 s  | **1.3 s** |
| whole chain to `Server listening` | ~38 s  | **4.1 s** |

It also takes drizzle-kit — a devDependency — out of the production boot path,
where it never belonged, and drops the peak memory of the boot. That matters
here: one instance in the failed deploy logged nothing but `ELIFECYCLE Command
failed.`, which is what a process killed for memory looks like on a 512 MB box.

**The ledger is the same ledger.** Verified in both directions against real
Postgres 16: a database migrated by `drizzle-kit migrate` then handed to the
programmatic migrator reports "schema is up to date" and re-applies nothing —
25 tables and 6 ledger rows before and after — and a database migrated
programmatically is still readable by `drizzle-kit migrate` by hand. Production
already carries a drizzle-kit-written ledger, so that first direction is the one
the next deploy depends on.

Failure is still fatal: a bad `DATABASE_URL` exits 1, and the `&&` chain stops
before the server starts.

**Not fixed by this, and not fixable from the repository:** the service has
`healthCheckPath: ""` and runs on the free plan. With no health check, Render
falls back to blind port scanning, and the free plan is what produces both the
eight-minute scheduling delay and the memory pressure. Setting the health check
path is a dashboard field; `render.yaml` already specifies `/api/healthz` and is
still not read.

### `drizzle-kit push` refuses to run on a deployed instance

**Decided:** `lib/db/push-guard.mjs` stands in front of the `push` and
`push-force` scripts. On Render or with `NODE_ENV=production` it prints why it
is refusing and **exits 0**. Locally it forwards to drizzle-kit unchanged,
`--force` included.

**Why:** the live service's dashboard Start Command still reads
`pnpm --filter @workspace/db run push && pnpm run start`, and that field cannot
be changed from the repository — Render does not read `render.yaml` for a
service created by hand, and the Render MCP exposes no way to update a service.
So `push` runs on every deploy, and on the last one it asked, in the production
log:

> You're about to add `workspace_memberships_workspace_user_key` unique
> constraint to the table, which contains 2 items. Do you want to truncate
> `workspace_memberships` table?

It could not read an answer — no TTY — so it gave up and the deploy continued.
That was luck. The same prompt under a different drizzle-kit version, or a
`--force` reaching that command, drops every membership row, which is every
user's access to every chamber. Migrations are applied by `migrate-on-boot.mjs`
from `pnpm run start`, so push has no work to do there anyway.

**Exit 0 is load-bearing.** The Start Command chains with `&&`. A non-zero exit
would mean `pnpm run start` never runs and the service never comes up — refusing
to push must not become refusing to deploy. Verified by running the exact chain:
push refuses, migrate applies six files, the server reaches "Server listening"
with `nodeEnv: production`.

`RENDER` is checked as well as `NODE_ENV`, because a deployed service with
`NODE_ENV` unset is precisely the misconfiguration that would make this guard
silently not apply.

**This does not replace fixing the dashboard field**, which should say `migrate`.
It is the half of the problem that can be fixed from the repository.

### Migrations run from `pnpm run start`, not from the Start Command

**Decided:** the root `start` script runs `lib/db/migrate-on-boot.mjs` before
handing off to the API server. A migration failure is fatal and the server does
not start.

**Why:** the deployed service was created by hand in the Render dashboard before
`render.yaml` existed, so Render never reads that file — the blueprint has said
`migrate` for a while and the live service still said `push`. That is not a
harmless difference. `drizzle-kit push` diffs the schema against the live
database and applies what it infers, and it exits **0** either way, so the
service came up healthy while the schema quietly stopped tracking the code.
Production was missing `time_entries`, `beta_feedback`, all three invoicing
tables and `cases.closed_at`, with `filing_ref` still nullable — everything
added after phase 3.

Putting the migration inside `pnpm run start` makes the stale dashboard field
harmless: whatever runs before it, the server cannot start against a schema it
does not match. The dashboard field is still worth correcting, but the
deployment no longer depends on anyone remembering to.

Fatal-on-failure is the safe direction here specifically because Render only
shifts traffic once the new instance passes its health check. A failed migration
means the deploy does not go live and the previous instance keeps serving, which
is strictly better than a server running in front of a schema it disagrees with.

No `DATABASE_URL` means PGlite, which builds its schema from `preview.ts` on
boot, so the script skips rather than failing — otherwise every local `pnpm
start` would die on `drizzle.config.ts` throwing.

**Verified against a real Postgres 16**, which is the first time this stack has
been exercised outside PGlite:

- A **fresh** database migrates to 25 tables, `filing_ref` NOT NULL, ledger at 6.
- A **production-shaped** database — baseline tables present, no
  `__drizzle_migrations` ledger, which is exactly what `push` leaves behind —
  replays 0000 harmlessly and applies 0001 through 0005. Re-running adds nothing.
- The **real deploy sequence**, stale command included: `push` (which does write
  — it reported "Changes applied") followed by `migrate`. It survives only
  because every migration from 0000 onward is guarded with `IF NOT EXISTS`;
  without those guards `push` creating a table first would make the next
  migration fail and abort the deploy.
- `pg_dump` of the two paths is **byte-identical**, so push-then-migrate and a
  clean migrate converge on the same schema.
- The full `pnpm run start` chain then boots the API server against that
  Postgres and serves `/api/invoices` and `/api/billing-settings`.

---

### Security hardening — reads, uploads, and dependency drift

Three findings from a checklist audit. Each was real; none was reachable by an
anonymous attacker, which is why they were fixed together rather than urgently.

#### Reads are throttled, and the two expensive ones have their own bucket

**Decided:** GET now carries a 300/min ceiling per user, and
`/kpi/performance` and `/invoices/:id/pdf` carry a tighter 20/min on top.

**Why:** reads were exempt entirely, on the stated reasoning that "a busy
chamber refreshing a cause list is not an attack". That was true when every GET
was a cheap indexed select. It stopped being true when `/kpi/performance`
arrived — eight SQL aggregates with `percentile_cont` over full tables — and
again with `/invoices/:id/pdf`, which renders a document with pdfkit on every
call and caches nothing. Both are admin-only, so the threat is an authenticated
user or a leaked session looping a request, not an anonymous flood. On one small
instance either is enough to starve everyone else.

Separate named buckets rather than one number: a named bucket does not draw from
another's budget, so the specific limit binds first and the general ceiling still
catches anything cheap being hammered. Verified that exhausting the PDF bucket
leaves ordinary reads answering 200.

#### `perUser` did not actually key per user

**Decided:** the limiter resolves the subject itself via `resolveClerkId`
instead of reading `req.userId`.

**Why:** found while adding the above. `req.userId` is set by `requireAuth` /
`requireWorkspace`, which run **inside** the routers — later than the limiters
mounted on `/api`. So every limiter marked `perUser` silently fell back to the
client address, and a whole chamber behind one NAT shared a single write budget.
`clerkMiddleware` runs before the limiters and preview identity is in the bearer
token, so identity is available at that point; it just was not being read.
Verified: with the admin down to 275 of their 300 reads, a second identity from
the same socket starts at 298.

#### An upload must be what it says it is

**Decided:** `contentMatchesMime()` checks file signatures, and the upload route
refuses a mismatch with `415 content_type_mismatch` — distinct from the
allowlist's `unsupported_type`.

**Why:** the allowlist checked a `Content-Type` header, which the client writes.
That is a declaration, not a fact: a shell script uploaded as `application/pdf`
passed it. Nothing here executes an upload, downloads are forced to `attachment`
with `nosniff`, and files are stored encrypted outside any served directory — so
it was not exploitable. It was still the one property in that path taken on
trust, and checking it costs sixteen bytes.

Signatures only, not container parsing: proving a PDF is a well-formed PDF means
running a parser over hostile input, which adds more attack surface than it
removes. Text has no signature, so that test is inverted — reject a NUL byte in
the first 8 KB, which catches a binary renamed to `.txt`. A shell script sent as
`text/plain` is _accepted_, correctly: it is genuinely text, nothing will run it,
and refusing it would break a chamber attaching a plain-text exhibit.

Two error codes rather than one because "not accepted" and "not what you said it
was" send someone to different fixes.

#### Search is capped, and its wildcards are literal

**Decided:** `/search` refuses a query over 200 characters with
`400 query_too_long`, and `likePattern()` escapes `%`, `_` and `\` before the
text reaches ILIKE.

**Why:** the query was type-checked but unbounded, and this endpoint runs four
ILIKE patterns per call, so a megabyte of pasted text was matched against every
visible case title and description on every keystroke.

Escaping turned out to matter more than the cap. `` `%${q}%` `` handed the
user's own text to ILIKE as _grammar_: a query of `%` matched every row, and a
chamber searching for "50%" got the whole registry back. That is a correctness
bug that happens to also be the cheapest way to make the endpoint expensive,
since a run of `%` is pathological to match. Backslash is Postgres's default
LIKE escape character, so escaping the three metacharacters needs no `ESCAPE`
clause. This was never an injection risk — Drizzle binds the value as a
parameter either way; it is about ILIKE's own syntax.

**Refused rather than truncated:** searching the first 200 characters of a
pasted document and presenting that as the answer is a quiet lie. 200 because
nobody types more than that into a search box.

#### Dependabot reports; CI does not block on it

**Decided:** weekly grouped Dependabot, plus `pnpm audit` in CI as a
non-blocking step.

**Why:** all eight open advisories are in transitive **dev** tooling — orval's
yaml parser, eslint's glob matcher, the sandbox's vite. None sits in the path a
request takes through the running server. Failing the build on them would stop
unrelated work to fix something unreachable in production, and a gate that fires
for reasons the author cannot act on is one people learn to route around. Grouped
weekly rather than one PR per bump for the same reason: twelve PRs every Monday
is how a team learns to ignore Dependabot. Security updates are grouped
separately so they arrive alone and reviewable.

#### Verified

36 new checks (21 hardening, 15 search), plus every existing suite re-run: 52
across the five API suites, 44 on invoicing, 46 in the browser.

The new checks cover a real PDF, PNG, docx, webp and plain text accepted; an ELF
declared as PDF, a shell script declared as PDF, an ELF declared as text, and a
PNG declared as JPEG all refused with the right code; a disallowed type still
refused by the allowlist; the PDF route limiting at 21 requests, not 300;
ordinary reads unaffected when it does; and the per-user keying above.

**Suites must be run against a fresh server, one at a time.** This bit twice
while verifying the above. The browser suite run straight after the API suites
reports three 429s and a failure; the invoicing suite run after them fails 41 of
44, starting with `429` on chamber creation. Both are the same thing: the
`auth` limiters on `/api/session` and `/api/workspaces` are keyed by **address**
at 30/min, the security suite deliberately exhausts them as one of its tests,
and the counters live in process memory — so anything run next from the same
machine inherits an empty budget.

Confirmed from the limiter name in the server log rather than inferred: all 49
rejections were `limiter: "auth", subject: "a:127.0.0.1"`, none from the new
`read` or `expensive` buckets. On fresh servers: browser 46/46, invoicing 44/44,
hardening 21/21, search 15/15.

CI is unaffected — it runs the API and browser suites as separate jobs on
separate runners, so they never share limiter state. The trap is local.

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
