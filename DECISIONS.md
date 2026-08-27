# Decisions

A log of the meaningful choices made while building LEX Practice, with the
reasoning behind each. This is not a changelog — it does not list what changed.
It records **why** the code looks the way it does, so that a future reader (or a
future me) does not undo a deliberate decision thinking it was an accident.

Entries are newest first. Each answers: what was decided, what the alternatives
were, and what would make it worth revisiting.

---

## Cause-list ingestion: shared fetch, per-chamber proposals, no automatic calendar (2026-08-18)

**Decided:** read court cause lists on a schedule into a global store, match
them against matters by structured court identity, and surface every match as
a **proposal a person accepts**. Nothing published by a court reaches a
chamber's calendar without somebody agreeing to it.

**Why proposals and not automatic entries.** This was the product owner's
call and it is the right one. A wrong hearing date in a practice-management
tool is not a cosmetic bug — an advocate who does not appear because the tool
said the listing was Thursday can have the matter dismissed for
non-appearance. A parser that misreads a court number should therefore
produce something a person looks at, not a date somebody plans their week
around. The cost is that a proposal queue has to be cleared; the benefit is
that the failure mode of every scraper bug is "a proposal you ignore" rather
than "a hearing you miss".

**Why the scraped data is GLOBAL, breaking this codebase's central
invariant.** Every other table here is workspace-scoped, and `courts`,
`cause_list_entries` and `cause_list_sync_runs` are deliberately not. A
published cause list is one public document that every chamber appearing in
it reads identically. Fetching it per tenant would mean fifty chambers making
fifty requests to one government server for one identical file — rude, and
the fastest route to a blocked IP. Fetch once, store once, match per
workspace.

The tenant boundary moves to `cause_list_matches`, and it is structural
rather than a filter that could be forgotten: a proposal's workspace is read
from the MATTER it matched (`cases.workspaceId`), so a chamber can only ever
be told about a listing that hit a matter it already holds. There is no query
in the matcher a caller could widen.

**Why `cases` needed four new columns before any of this could work.**
`filingRef` is free text and stays that way — it is whatever the chamber
writes on the file, and chambers write it a dozen ways ("W.P.(C) 1234/2026",
"WP 1234 of 26", "CV-2026-118"). A court's list keys on a TYPE, a NUMBER and
a YEAR at a named court and nothing else, so matching against `filingRef`
would be parsing prose. `courtId` / `caseType` / `caseNumber` / `caseYear` are
asked for once, at filing. They travel as a unit — all four or none — because
a case number with no court matches nothing and a court with no number would
match everything the parser failed to read.

`caseTypeNorm` is stored on both sides, written by one shared
`normaliseCaseType()`, so "W.P.(C)" on the matter and "WP(C)" on the list
compare as plain equality. Same reasoning as `normaliseEmail` on the access
list: normalise on write, compare exactly, keep the original for display.

**Why matching is exact only.** Fuzzy matching on party names would produce
proposals that are wrong often enough to train an advocate into clicking
accept without reading — which is strictly worse than proposing nothing,
because the entire value of the feature is whether the person still trusts it
on the day it matters. The `confidence` column exists so a future fuzzy
matcher has somewhere to record how sure it was, and so the queue can sort by
it, without a migration.

**Why an adapter that does not exist is `skipped`, not `failed`.** The
Lucknow Bench is seeded and selectable on a matter today, with no adapter
written. That is a real and useful state — a chamber can record its court
identity now and get proposals the day the adapter lands — and it is not an
error. `failed` is reserved for an adapter that ran and broke, which is a
thing somebody has to fix.

**Why `cause_list_sync_runs` exists at all.** A scraper's characteristic
failure is not crashing, it is going quiet after a site redesign: returning
zero rows while everything downstream keeps working on an empty set, for a
month, unnoticed. An empty list is also a legitimate answer, because courts
do not sit every day. Those two have to be distinguishable in the data rather
than in a log nobody reads, which is why every run is recorded and why an
adapter must THROW rather than return `[]` when it fails.

**Why the scheduler is off unless `CAUSE_LIST_SYNC=on`.** It makes requests
to other people's servers, so it should be switched on deliberately and be
switchable off in one environment variable if a registry ever objects —
without a deploy. It also keeps CI deterministic (the suites drive sync
explicitly), and it avoids promising a schedule that Render's free plan
cannot keep, since a cron inside a spun-down instance does not fire.

**The line not crossed.** Cause lists are public records published precisely
so advocates know when to appear — this is the intended audience, not a
loophole. That is an argument for reading them politely (robots.txt honoured,
a real User-Agent with a contact, rate-limited, fetched once globally,
cached), not for ignoring what a site asks. Where a court gates its list
behind a CAPTCHA, the answer is assisted import for that court, not defeating
the control: that is where "public data" stops describing what you are doing.

**What is deliberately NOT built.** The Lucknow adapter itself. This was
written in an environment whose egress policy blocks
`allahabadhighcourt.in`, so the page has never been fetched here. Writing
selectors against HTML nobody has looked at produces code that compiles,
passes review, and silently returns zero rows forever — the exact failure the
run table exists to catch, and not one worth shipping deliberately.
`adapters/allahabad-lucknow.ts` is a documented stub carrying the checklist
for writing it against the live site.

**Where the four court fields are typed.** A matter opened before this feature
existed carries none of them, and that is nearly every matter a chamber has —
so the fields sit in two places, not one: on the create-matter form, and on the
matter itself (`case-court-identity.tsx`) where somebody has the filing in
front of them. One shared `CourtIdentityFields` renders both, so the all-or-none
rule cannot drift out of step with `courtIdentity()` on the server.

Clearing an identity is an explicit `courtId: null` on the patch — the one
field on `CaseUpdate` that is nullable, and the only way back out of a mistyped
number that would otherwise propose somebody else's listings forever. On every
other field `undefined` still means "leave it alone", which is what a patch
means everywhere else in this API.

**The manual "check now" is not a convenience.** The scheduler is off unless
`CAUSE_LIST_SYNC=on`, so on a default deployment an admin would otherwise face
a permanently empty queue with nothing to press and no way to tell an empty
queue from a broken reader. The run log is on the same screen for the same
reason: a scraper's real failure is going quiet, and a failure nobody can see
is a failure nobody fixes. Both are `audit.read` — admin only, because
"check now" reaches out to somebody else's server on demand.

---

## A mobile number is a full identity, not a second factor (2026-08-21)

**Decided:** `users.phone`, a `kind:"phone"` access-list entry, invites by
number, and a founder who can create a chamber with no email address at all.

**Why it was more than a login button.** Email was the single bridge from
_authenticated_ to _authorized_: `workspace_access_list.value` compared by
equality against a Clerk-verified address, `reconcileAccessList` returning early
without one, and `foundChamber` writing the founder's address as their own
self-admitting row. Adding a phone sign-in without widening that seam produces a
user who authenticates perfectly and reaches nothing — and a founder who creates
a chamber and is locked out of it on their next request. That last one is the
single most important line in `phone-admission.mjs`.

**Why at all.** An Indian chamber's clerks, interns and most of its clients have
a mobile and no work email. Requiring an address to be admitted excluded exactly
the people a practice needs on the system.

**Verified-only, exactly as for email.** `identityFromClerk` takes the number
only when Clerk reports it verified. An unverified number is attacker-supplied
text, and matching it against the access list would let anyone claim a
colleague's mobile and inherit their role — the same sentence that already
governed addresses, now governing both.

**`normalisePhone` is the phone half of normalise-on-write.** Every comparison
is a plain equality check, so `+91 98765 43210`, `098765 43210` and
`9876543210` must collapse to one string before storage. The default country
code is `DEFAULT_COUNTRY_CODE`, not a hardcoded `+91`: the product should be
wrong in one configurable place rather than in a regex somebody has to find.

**Email beats phone beats domain**, per workspace. Exact identifiers beat a
blanket domain rule for the reason they always did. Email beats phone because an
address is never reassigned to a stranger and an Indian mobile is — so where a
chamber has recorded both for one person, the more durable identifier decides
their role.

### Number reassignment: accepted, and written down three times

Indian telcos reassign a disconnected mobile after roughly ninety days. A
standing `kind:"phone"` entry can therefore admit a **different person** later.
Email has no equivalent failure.

This was accepted deliberately rather than mitigated in code — no expiry, no
role ceiling — because the friction of either would fall hardest on the small
chamber this feature exists for. Accepting a risk is only honest if it is
visible, so it is stated in the schema comment on `ACCESS_LIST_KINDS`, in the
admin UI at the moment somebody adds a number, and in the privacy policy. The
`lastUsedAt` column already records when an entry last admitted anybody, and the
access-list table surfaces it, which is the signal for spotting a number that
has gone quiet.

**What phone deliberately cannot do:** the operator allowlist stays email-only.
It is an environment variable rather than an access-list row, and a recycled
number must never be able to reach a cross-tenant surface.

### One asymmetry closed on the way past

`POST /invites` applied **no** email-format validation while
`POST /workspace/access-list` applied a regex — so garbage could be written
through one of the two admission doors and not the other, and would then sit on
the access list matching nothing forever. Both doors now validate the shape of
whichever identifier they were given.

---

## Case files go to object storage, and the SDK does not come with them (2026-08-20)

**Found:** the live service runs on Render's free plan, which cannot mount a
disk at all. `FILE_STORAGE_DIR` therefore pointed at the container's own
filesystem, so every uploaded case file was already being destroyed by each
deploy, restart and wake from hibernation. Not the scaling concern the runbook
described — active data loss, invisible until a chamber opens a filing weeks
later and finds nothing there.

**Decided:** a `BlobBackend` interface with two implementations, chosen from
the environment. Four operations on an opaque key; everything that makes a
stored file _safe_ stays above the choice.

**What stays above it, and why that line is where it is.** The generated key,
the size cap, the MIME allowlist, the content-signature check and — most
importantly — **encryption** all live in `blob-store.ts`. A backend receives
ciphertext and returns ciphertext. That is what makes object storage acceptable
for privileged client files at all: Cloudflare holds AES-256-GCM blobs it
cannot open, and `FILE_ENCRYPTION_KEY` never leaves the server. Putting
encryption inside a backend would have meant a future third backend could
forget it.

**No AWS SDK.** `@aws-sdk/client-s3` is tens of megabytes of dependency loaded
into a process that holds the decryption key and every chamber's files, to make
four HTTP requests. SigV4 is about a hundred lines, and this server already
hand-verifies HMAC signatures for the Razorpay webhook, so it is not an
unfamiliar kind of code to own. The trade is fewer moving parts next to the
sensitive data, paid for by writing the signer once and testing it properly.

**Which is why the signer has a known-answer test.** A wrong SigV4
implementation fails every request identically with `SignatureDoesNotMatch`,
which localises nothing among its eight steps. `blob-storage.mjs` recomputes
the signature independently — written out longhand rather than sharing a helper
with the implementation, so it agrees with S3 rather than with a bug — and
checks that the key, the body and the method each change the result. All of it
offline: no account, no network, no credentials.

**A partial configuration refuses to start.** Three of four R2 variables does
not fall back to local disk. The fallback is precisely the failure being
removed: uploads that look like they work until the deploy that destroys them.
Falling back would be the silent, plausible, wrong thing.

**And the filesystem backend now warns in production, every boot.** Not once in
a runbook — a chamber cannot tell that the store forgets, so the server says so
where an operator will actually see it, and `/api/readyz` reports which store
is in use.

---

## Knowing whether anybody came back (2026-08-20)

**Decided:** one nullable column, `users.last_seen_at`, and a cross-tenant
operator view gated on an environment allowlist rather than on any capability.

**Why a column and not analytics.** The privacy policy says, in writing and in
production, that no analytics or tracking scripts are loaded from third
parties. Adding Google Analytics or PostHog Cloud would make a published legal
document false, which is a worse cost than the missing number. A column the
server writes about its own users is first-party operational data the policy
already discloses, so this direction needs no retraction.

**Why it was the missing number.** Everything else records who _registered_.
`audit_events` records fourteen privileged write actions, so an advocate who
opens the diary each morning and writes nothing is indistinguishable from an
account that signed up once and never returned — the two most important cohorts
to tell apart collapse into one.

**Written at most once an hour, per person, off the request path.** That is a
performance decision (a busy user would otherwise generate hundreds of UPDATEs
an hour on one row) and a privacy one: "seen this week" is what the product
needs, and a minute-accurate record of when an advocate was at their desk is a
different and more sensitive thing that is deliberately not collected. The
throttle is in process memory, so several instances each write once an hour;
the column means "seen around then" and every reader treats it that way.

**It is written in `requireAuth`, not `requireWorkspace`.** Somebody who signs
in and is never admitted to a chamber never reaches `requireWorkspace`, and
they are exactly the cohort worth counting.

**The bug this ordering caused, kept here because it nearly shipped.** The
write is fired before `getOrCreateUser` has created the row, so a person's
first-ever request updates nothing — and because the throttle entry was
recorded _before_ the write, the miss was remembered for an hour. Every one of
the SPA's opening requests falls inside that hour, so a new account read as
never-seen indefinitely: a column that existed, code that ran, and a metric
permanently zero. `touchLastSeen` now checks whether a row was actually
updated and drops the throttle entry when none was. The suite asserts
`neverSeen < total` for that reason alone.

### The operator view is gated on an env allowlist, never a capability

`OPERATOR_EMAILS` is the entire authorisation. It is deliberately not a
capability, and the reason is structural: capabilities are granted per
membership by chamber admins, and **anyone can found a chamber and become its
admin**. A capability called `platform.read` would be one self-invite away for
every user on the platform. An environment variable can only be changed by
whoever can deploy, which is the correct definition of "operates the service".

**Unset means the route does not exist** — not "open", and not "the first
registered user". A default that fell open would hand every chamber's numbers
to whoever signed up first.

**It refuses with 404, not 403.** A 403 would confirm that a cross-tenant
surface exists and that the caller merely lacks permission. There is nothing to
gain by admitting it: an operator knows the URL, and to everybody else the
route should be indistinguishable from a typo. Same reasoning as another
chamber's cause-list proposal returning 404.

**Counts, never content.** Chamber name, plan, seat and matter counts are facts
about a customer. A matter's title or a client's name is a fact about somebody
who never agreed to be visible outside their advocate's chamber — and the DPA
says we are a Processor of it, not its Fiduciary. Addresses are excluded too:
knowing four chambers went quiet is operations, knowing who to email about it
is marketing, and the difference is a mailing list assembled out of other
people's professional records. The boundary is drawn in the SQL rather than
trusted to the page, and the suite greps the response body for a matter title,
a filing reference and an email address.

**The page is not in the navigation.** The nav is a projection of capabilities
and this is not one. That is tidiness — the server's 404 is the lock.

---

## `"/:rest*"` matched exactly one segment, so `/cases/:id` was blank (2026-08-19)

**Found:** every matter detail page in the product rendered an empty document.
No console error, no failed request, no 404 — the router simply matched nothing
and React rendered nothing.

`App.tsx` mounted the whole application behind
`<Route path="/:rest*" component={DashboardLayout} />` in both the preview and
the Clerk tree. In wouter 3 (regexparam 3) `/:rest*` compiles to
`/^\/([^/]+?)\/?$/` — a **single** segment. `/cases` matched; `/cases/1` did
not, fell past every route in the `Switch`, and rendered nothing at all. The
catch-all is now `/*`, which compiles to `/^\/(.*)\/?$/`.

**Why nothing caught it:** the browser suite founded no chamber. It filled
`input[type="text"]` on the Access Denied screen — where there is no such
input, so the block silently did nothing — and then asserted only that the page
did _not_ say "sign in to your chamber", which the Access Denied screen also
does not say. Every "dashboard @ Npx has no horizontal scroll" check below it
was measuring Access Denied. Both are fixed: the suite now walks the real
founding flow, asserts a **positive** signal (the nav button, which exists only
inside the application shell), and opens a matter — the deep route is now a
committed check rather than something to rediscover.

---

## Bar registration: self-declared, gated, enforced twice (2026-08-18)

**Decided:** four additive columns on `users` (`bar_council_state`,
`bar_enrolment_no`, `aor_no`, `bar_declared_at`), required for `admin`,
`senior_advocate` and `junior_advocate` before they reach anything
workspace-scoped. Computed server-side as `SessionClaims.profileComplete` and
enforced twice: a full-screen client gate in `dashboard-layout.tsx`, and a
403 `profile_incomplete` directly inside `requireWorkspace` — the same
middleware every protected route already runs through, so no route can forget
the check by omission.

**Why `admin` is included, not just the two advocate tiers:** in this
product's model, a firm admin is assumed to be a practicing advocate running
their own chamber, not a pure back-office role — the two self-serve founder
roles (`create-chamber.tsx`) are exactly `admin` and `senior_advocate`. `clerk_intern`
and `client` are exempt outright; neither ever appears in front of a bench.

**Why `bar_declared_at`, not `bar_verified_at`:** nothing here is checked
against a bar council. The column name has to say so, or a future reader
building an admin screen around it could reasonably assume the state means
"verified" when it only ever meant "the person typed something and clicked
save." Enrolment formats vary by state bar and are not standardised, so
validation is "both fields non-empty," not a pattern — what is typed is what
is stored.

**Why enforced in `requireWorkspace` rather than as an allowlist like the
lapsed-plan gate:** the lapsed-plan gate (`CAPABILITIES_WHEN_LAPSED`) exists
because a lapsed chamber should keep reading its own data. There is no
equivalent case here — nothing in the UI calls a workspace-scoped endpoint
while the gate is up, because the gate replaces the entire dashboard shell,
not just disabled buttons on it. A full block, checked once in the same place
every other membership check already lives, is simpler than maintaining a
second allowlist and has no legitimate action to carve an exception for.
`PUT /users/me/bar-registration` — the one thing that has to remain reachable
while blocked — sits behind `requireAuth`, not `requireWorkspace`, so it was
never inside the blocked surface to begin with.

**Why the declaration endpoint is `requireAuth`, not scoped to a workspace at
all:** the fields live on `users`, not on a membership — an advocate's bar
enrolment does not change chamber to chamber. `profileComplete` is still
recomputed per active workspace, because a person who is `senior_advocate` in
one chamber and `client` in another must not be blocked in the second by a
requirement that role doesn't carry there.

**Why it stays editable, with no lock after the first declaration:** self-
declaration has nothing to protect against a second honest answer, so
`PUT /users/me/bar-registration` is callable at any time, not just once. The
"Edit bar registration" link on a person's own row in Team Roles — never on
someone else's, since this is self-declared — reuses the same
`complete-profile.tsx` component the gate renders, given an `onDone` callback
that returns to Team Roles instead of nothing (the gate has nowhere to
"return" to, since clearing it is what un-blocks the page underneath).

**The founder path was the largest blast radius, and it was not obvious until
measured.** Every existing chamber-founding call in the seven CI suites is an
`admin` or `senior_advocate`, and every suite makes a workspace-scoped call
immediately afterward — creating this gate meant every suite's setup started
failing at step one. Fixed with a shared `scripts/ci/lib/bar-registration.mjs`
helper, called right after founding or right after an invited
senior/junior-advocate's session is first established, in all seven suites —
the same shape as the client-invite blast radius from the case-restriction
change earlier the same day, and the same lesson: a gate added to shared
middleware has to be measured against every existing caller, not reasoned
about in isolation.

---

## "Restrict to Case ID" made real, then mandatory (2026-08-18)

**Decided:** `case_id` on `workspace_access_list` and `workspace_memberships`
(additive, nullable, no FK — matching every other cross-reference in this
schema, which is validated in application code, not constraints). Propagated
from an invite through the access-list entry to the membership at reconcile,
then intersected into `lib/scope.ts`'s visibility. Required for the `client`
role, rejected for every other role, on **both** paths that can create a
client membership.

**Why it needed a real fix, not just wiring:** the field existed on the
`invites` table already, the invite screen already had the input, and the
client list already rendered a `RESTRICTED TO CASE-42` badge. All three were
decoration — `case_id` was written to the invite row and read by nothing.
`lib/scope.ts`'s "own" case scope is `cases.clientId = caller`, which has no
relationship to what an invite claimed to restrict. A client invited "to
matter 42" saw every matter naming them as client, exactly as an unrestricted
one would.

**Why both grant paths, not just `invites.ts`:** `POST /workspace/access-list`
(`AccessListManager` in the UI) can create a client membership directly,
bypassing `invites.ts` entirely — it is the same table, same role, same
`reconcileAccessList` reading it on sign-in. Closing the hole in one path and
leaving the other open would make "mandatory" true only when an admin happened
to use the invite screen instead of the access-list screen. Both now enforce
the identical rule, and a dedicated suite (`case-restriction.mjs`) exercises
each independently rather than assuming one implies the other.

**Why intersected, not substituted, in `scope.ts`:** a restriction narrows
whatever the role's scope already computed; it does not grant anything a
`caseScope` wouldn't otherwise allow. In practice only a client (`own` scope)
ever carries one — every other role is rejected at the write path — but
checking the intersection unconditionally in `visibleCaseIds` and
`getVisibleCase` means the guarantee holds regardless of what role ends up
with a value there, rather than depending on the write-side rule never having
a bug.

**Why validated against a real case, not just "some integer":** `invites.ts`
had no foreign key on `case_id`, so case 9999 was silently accepted in a
workspace with no matter 9999 at all — a restriction to nothing, which reads
as "restricted" in the UI while doing nothing at all. Both paths now call
`caseInWorkspace()` before accepting the value, the same helper the codebase
already uses to validate a task's or calendar entry's `caseId`.

**Why the mandatory rule is enforced twice (client and UI both check it):** the
UI disables the submit button until a case id is present, and the server
checks again — the same shape as every other "required, but which field
depends on another field" rule in this codebase (see the migration add-on's
phone-preference validation, added the same day). A client UI can be wrong or
bypassed; the API is the actual boundary.

---

## Migration service add-on: a lead, not a plan (2026-08-18)

**Decided:** a new `service_enquiries` table, one `POST /service-enquiries`
endpoint behind `requireWorkspace` + `requireCapability("billing.manage")`, and
a small dashed-border square card below the pricing tiers — not a fifth tier —
opening a form that records the enquiry and nothing more.

**Why not a fifth tier:** the pricing grid is four columns of things a chamber
can buy by clicking a button. Migration help is not that — nobody can self-serve
their way into having their files moved, so putting it in the grid would promise
a transaction the product cannot complete. A visually distinct box under the
grid says "this is different" before anyone reads the label.

**Why `billing.manage`, the same boundary as choosing a plan:** this is a
conversation about the chamber's account, not a support ticket. The alternative
— any signed-in team member could open it — would let a junior advocate start a
commercial negotiation the chamber owner never agreed to.

**Why no admin screen yet:** the table is the whole deliverable. Building a
listing screen before a single enquiry has arrived is building for a load that
does not exist. `status` (`new` / `contacted` / `closed`) is on the row now
specifically so that screen, whenever it is worth building, needs no migration
of its own.

**Why `serviceKind` is an enum of one:** `migration` is the only kind today, and
a free-text field would let a future client-side change silently start writing
values the server has no opinion about. An enum that grows by one value when a
second service exists costs nothing now and closes that door.

**Why a phone preference without a phone number is refused, not silently
stored:** an enquiry nobody can act on is worse than no enquiry — it looks like
a lead and wastes whoever follows up. Checked on both sides: the form validates
before it will submit, and the endpoint checks again, because the API is never
allowed to trust the form it happens to be talking to today.

---

## Calendar audience validated on write, not just filtered on read (2026-08-18)

**Decided:** `POST /calendar` and `PATCH /calendar/:id` now reject an audience
that `audienceIncludes()` would silently hide from everyone, with a 400 naming
the problem — instead of accepting it and creating an entry nobody could ever see.

**Why:** `audienceIncludes()` fails closed by design, and that is correct for a
_read_ — an unrecognised value should match nobody rather than everybody. But
nothing stopped that same value from being _written_, so an admin who typed
`audience: "firm"` instead of `"all"` got a 201 and a hearing that existed on
the calendar with no code path that would ever show it to a single person. No
error, no warning — the record was silently unreachable from the moment it was
created.

**Also checked, not just the shape:** `role:<role>` is validated against the
real role list (`role:advocate` is not a role; the real ones are
`senior_advocate` / `junior_advocate`), and `user:<clerkId>` is validated
against an active membership of the caller's own workspace, the same pattern
`tasks.ts` already uses for assignee validation. Both are the identical failure
mode as the typo that motivated this — a value that parses as _a_ shape but
addresses nobody real.

---

## Plan enforcement — making the subscription model real (2026-08-18)

Five enforcement holes existed: any plan could be selected for free, seats were bypassable, revoked members could be reactivated unlimited, closed matters could be reopened unlimited, and expired plans were never checked. Each is now closed by a server-side gate on the specific transition.

### Chargeable plans require payment before activating

**Decided:** `PUT /workspace/subscription` returns `pending_payment` status when a plan costs money and Razorpay is configured, rather than immediately activating it.

**Why:** the trial pack costs ₹99, but the check was looking at `metered` (which is false for trial). Without payment, selecting it granted unlimited access for nothing. Payment is optional in preview mode and self-hosted (no Razorpay configured), so the gate only applies when `paymentsEnabled()` is true. Trial remains free in self-hosted.

### Seat quota enforced at three choke points, not just one

**Decided:** seats are checked when:

1. Reconciling access-list entries on sign-in — over-cap creates as `pending` (routes to approval queue)
2. Approving an access request — over-cap returns 402 (already existed, verified)
3. Reactivating a revoked member — over-cap returns 402 (newly added)

The founder of a chamber is never blocked — they create the chamber, so they cannot be over-cap.

**Why:** before, only approval-queue entries were checked. An admin could invite a user via the access list and it would silently succeed even when the seat cap was exceeded, and a revoked member could be flipped back to active without a check. Three sites set `status:"active"`; two were unguarded. Now all three enforce. The access-list path creates as pending rather than failing because an invited colleague should not be locked out — the admin can free a seat or upgrade before approving.

### Matters quota checked on reopen, not just on create

**Decided:** reopening a closed matter checks the matters quota, just as creating a new one does.

**Why:** close a matter, create a new one, reopen the closed one — the seat cap was checked on create but the reopen bypassed it because `openMatters` counts `ne(status,"closed")`, so the matter being reopened was not in the denominator. The check is guarded on the transition (closed → not closed) so editing an already-open matter never 402s.

### Plan expiry is evaluated on every request, never written by reads

**Decided:** `planStateFor()` returns the effective plan, status, and days-left. When `status:"active"` but `currentPeriodEnd` is in the past, the effective plan falls back to trial and `lapsed:true`.

**Why:** a cron job to sweep expired plans is strictly weaker than checking on every request — a chamber lapsing at 3 AM would still accept writes until midnight. No scheduler is needed. Write-on-read is wrong under concurrency, so the stored status stays the transaction history (written only by webhooks) and lapsed-ness is derived. A plan that lapsed thirty seconds ago stops working now, not at token expiry.

### Lapsed plans are read-everything, write-nothing

**Decided:** `requireCapability` checks `planState.lapsed` and rejects writes outside `CAPABILITIES_WHEN_LAPSED` with 402. The allowlist includes read-only operations, `tasks.complete`, `document_requests.respond`, `feedback.respond`, and `billing.manage` (so they can upgrade).

**Why:** a lapsed chamber should not lose access to its data, but should not be able to create new matters or invite new members. A handful of actions (completing a task assigned before expiry, responding to a client request) are finishing existing work, not new work. Privacy erasure (`privacy.manage`) also stays allowed — that is a legal obligation, not a write that should be gated.

**A consequence worth knowing:** `access_control.manage` is deliberately _not_ on the list, so a lapsed chamber cannot invite anybody. This surfaced while writing the banner check, which invited a junior advocate after expiring the plan and got a 402 instead of a member. That is the rule working, but it means a chamber that lapses with an invitation outstanding cannot issue another until it renews.

### The trial allowance is 10 matters and 5 seats, not 5 and 2

**Decided:** `TRIAL_LIMITS` is a single constant, referenced by both `trial` and `custom`.

**Why:** the old cap could not hold a chamber long enough to evaluate the product. A senior advocate, a junior, a clerk and two clients is five people before any work happens, and two months of practice is more than five matters. A trial that fails for reasons unrelated to the product teaches the customer nothing except that the product does not fit.

**A side effect worth recording, because the plan predicted the opposite:** the implementation plan expected closing the seat hole to break all five CI suites, since they seat three to five members against a cap of two. Raising the cap to five absorbed it entirely — the only failures were the two suites that assert the allowance deliberately. The prediction was reasonable and wrong, and the measurement was cheap.

### `daysLeft` rounds up

**Decided:** `Math.ceil`, not `floor`.

**Why:** a period ending in twenty hours has 0.83 days left, and flooring that reports "renews in 0 days" on the single day the notice matters most. Rounding up also absorbs the sub-second gap between a period being written N days out and being read back, which otherwise reports N−1 for the whole first day — which is exactly how the browser check caught it. `lapsed` is decided by comparing the dates directly and never from this number, so the rounding cannot affect what is enforced, only what is said.

### The trial pack is stamped on selection, not on payment

**Decided:** a new `trial_used_at` column, written when the trial is _chosen_, and never cleared.

**Why:** nothing otherwise stops a chamber re-selecting the ₹99 two-month pack the moment it expires, forever, which makes every paid plan optional. Stamping at selection rather than at payment matters: a chamber that could abandon checkout and start again would have an unlimited supply of trials. It is carried forward when another plan is chosen, so upgrading to Pro and back does not re-open it. Deliberately separate from `startedAt`, which the next plan overwrites and so cannot answer "have they already had their trial?".

### `subscription.halted` is enumerated and deliberately ignored

**Decided:** the webhook names the event and does nothing with it.

**Why:** this integration bills by one-time order per period and never creates a Razorpay Subscription, so the event carries no entity that can be joined to the table. It is listed rather than left to the default branch so the next reader can see the omission was considered rather than missed. Expiry does not depend on it — `planStateFor` derives lapse from `currentPeriodEnd` on every request.

### The time-travel endpoint moves the period both ways

**Decided:** `POST /api/preview/set-period-end` takes a signed `daysFromNow`, negative for the past and positive for the future.

**Why:** it started as `expire-subscription` and only went backwards, which made the "renews in N days" state unreachable by any test. Where the period ends is the one enforcement input no public API can set, and both directions are needed to cover the banner. Three things keep it out of production: `isPreviewAuth()` is hard-false under `NODE_ENV=production` and the route 404s rather than 403s so it does not advertise itself; it sits behind `requireWorkspace` so it can only touch the caller's own workspace; and it moves a date — it cannot grant a plan, change a status or add a seat.

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

### A stat card opens the list behind it, from data already loaded

**Decided:** each Status Overview card is a button opening a dialog of the rows
that make up its number, built from queries the dashboard already makes — no new
endpoint.

**Why:** `GET /dashboard/summary` returns counts and nothing else, so "3 overdue"
could only be answered by leaving the page. Adding a `/dashboard/summary/detail`
endpoint was the obvious move and the wrong one: the count and the list would
then be two separate answers that can disagree. Deriving both from the same rows
means they cannot. `useListTasks` and `useListCalendarEntries` were already on the
page; `useListCases` is the single addition, and the server scopes it to what the
caller may see like every other list.

**Two cards are not always buttons.** Active Cases carries its own "File your
first case" action at zero, and a button inside a button is invalid markup. It is
also the right behaviour — opening an empty list teaches nobody anything, while
the empty state already offers the one move worth making. `MaybeStatButton`
renders a plain card until there is something to show. The browser check asserts
`document.querySelectorAll("button button")` is empty, so the markup cannot
regress quietly.

**Every row leads somewhere.** A dialog that lists records and strands you there
has moved the dead end one click deeper rather than removing it. Rows carrying no
destination render as plain `div`s rather than buttons, so a click is never
promised and then ignored.

**Verified:** 21 checks in a real browser — each card opens, the overdue dialog
lists the overdue task and _not_ the one still in the future, a row navigates and
the dialog closes behind it, "see all" reaches the full page, and a fresh chamber
produces no nested buttons while keeping its empty-state action.

### The stacking ladder is explicit, not accidental

**Decided:** header at `z-30`, sidebar and feedback widget at `z-20`, and the
page's scroll container marked `isolate`.

**Why:** page content painted over the sticky header on every scroll, on every
page, at every width. The cause was a tie, not a missing z-index. The header was
`z-10` and the page content inside the scroll container was **also** `z-10`; the
scroll container is `relative` with no z-index of its own, so it creates no
stacking context and its child competed directly with the header. Equal
z-index means document order decides, and the content comes later.

`isolate` on the container is the half that matters most. Raising the header
alone would have fixed today's symptom and left the trap armed: any page that
later raised an element above `z-30` would silently reopen it. Isolation makes a
page's z-indexes local to that page, so the chrome cannot be reached from inside
it at all.

There is a second consequence that was invisible until it was looked for. The
search results dropdown is `z-50`, but it renders **inside** the header, which
does create a stacking context — so its `z-50` was always measured against its
siblings in the header, never against the page. It could not have risen above
content that was drawing over the header itself. The fix is the same one.

**Verified by breaking it first.** The Playwright check asserts, via
`document.elementFromPoint` at the search bar's centre, that nothing covers the
header after scrolling to the bottom — across four pages and three widths.
Against the unfixed build it fails **15 of 19**, naming the exact element doing
the covering on each page. Against the fixed build, 19 of 19. A check that had
passed both ways would have proved nothing.

One honesty note recorded with it: the two dropdown assertions passed _before_
the fix as well, because the dropdown is only opened on an unscrolled page where
the header is not yet being overdrawn. They are a regression guard for the
isolation, not a reproduction of a bug that was occurring.

#### The feedback widget stops competing

**Decided:** kept for every role, but moved clear of the sidebar rail
(`sm:left-20`), dropped from `z-40` to `z-20`, and reduced to an icon that
reveals its label on hover or focus.

**Why:** it was the one permanently visible control on every screen and it
outranked the header, which is the wrong priority for the least important thing
on the page — and at `left-4` it sat on top of the navigation rail. It stays for
staff, not only clients, because staff are the people who find the bugs during a
beta and taking away their reporting channel would cost more than the clutter
did. Reducing it to 36px at rest was the alternative to removing it.

Both `App.tsx` mount points are unchanged: it must keep rendering on the
access-denied and pending-approval screens, which live outside the dashboard
shell and whose users have no other way to tell you they are stuck.

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

## AI drafting

### The chamber's own knowledge is the product; the model is not

**Decided:** drafting assembles a prompt from the matter, the chamber's recorded
observations, and past filings kept as style examples. Insights and examples are
**workspace-scoped** and never pooled across chambers.

**Why:** a general model given the same instruction writes a generic petition.
What makes this worth paying for is that it knows the Lucknow registry returns
an unstamped vakalatnama, because an advocate here wrote that down. Pooling
those observations across the platform would be worth more to everyone and is
**irreversible**, so it is not done — `chamber_insights.shared_at` exists so
consent can be added later without moving rows across a tenant boundary.

### Only what the advocate ticks leaves the server

**Decided:** documents reach the model by explicit id, per draft, and every id
is re-checked against the caller's workspace _and_ the matter it claims to be
on. There is no "use all documents" option. What was sent is recorded in
`draft_sources`.

**Why:** this is the whole basis on which sending privileged client material to
a third party is defensible. A choice with no record of what was chosen is not a
control — `draft_sources` is what makes "the advocate chose" checkable, and it is
the answer when a client asks what of theirs was used.

### Retrieval is full text, not embeddings

**Decided:** `to_tsvector('simple', …)` with a GIN index, ranked in SQL, with
the forum preference applied in JavaScript.

**Why:** `pg_trgm` and `pgvector` are unavailable in PGlite, which is what
preview mode and every CI suite run on — verified, not assumed. An embedding
retriever would be a production-only path no test could execute, the same trap
the cause-list search avoided. At the volume one chamber writes, full text finds
the right note and costs nothing per query.

_Also:_ bound parameters inside an `ORDER BY` came back from PGlite as
`invalid byte sequence for encoding "UTF8": 0x00`. The ordering expression is
kept parameter-free for that reason, which is noted in `lib/ai/context.ts`.

### A style example is inert until a person has checked the redaction

**Decided:** an uploaded filing gets an automatic redaction pass (Haiku), and is
excluded from every prompt until `reviewed_at` is set by a named person.

**Why:** an example rides in the **cached prefix of every draft of its kind**,
so an unreviewed one puts another client's facts in front of unrelated work
indefinitely. The model catches every name and misses "the Kanpur consignment".
The automatic pass makes reviewing a two-minute job; it is not the control.

### The budget is derived, pessimistic, and hard

**Decided:** the remaining allowance is a SUM over `ai_usage_events`, checked
against a **worst-case** estimate before the call. Over budget is a 402, not a
warning. Deleting a draft does not refund its spend.

**Why:** there is no way to un-spend tokens, so the only place a limit can be
enforced is in front of the call. The estimate assumes output runs to its cap,
which sometimes refuses a draft that would have fitted — that is the right way
round to be wrong. A budget derived from rows a chamber can delete would not be
a budget.

### Every draft carries a verification banner, prepended by the server

**Decided:** the "verify before filing" line is added in `drafting.ts`, not left
to the model's instructions.

**Why:** an instruction the model usually follows is not a guarantee, and this
is the line that stands between a first draft and a filing nobody read.

### Case law is web-search verified, and unconfirmed citations say so

**Decided:** the review prompt enables the `web_search` server tool and requires
each authority to be confirmed before it is given; anything unconfirmed is
labelled.

**Why:** Claude has no Indian case-law database. Unaided it produces citations
that look real and sometimes are not, and advocates in several countries have
been sanctioned for filing exactly that. Search adds roughly ₹12 to a review —
cheap against the alternative.

### Pricing, and what the AI allowance costs

**Decided:** Pro ₹2,499/month with a ₹600 drafting budget; Firm ₹7,999 with
₹3,000; Trial ₹40 for the pack, routed to the light model only. Per chamber,
flat — not per seat. Top-ups (₹500/₹1,000/₹2,500) are sold **at cost** and carry
forward while the subscription is live.

**Why:** a working Pro chamber drafting 25 petitions and 60 applications a month
costs roughly ₹1,110 in tokens — over half of a ₹1,999 plan, which is why the
old prices could not carry this feature. Firm's ₹3,000 is 37% of its price and
deliberately generous: it is the plan drafting is sold on. Both are constants in
`plans.ts`; set them from a month of `ai_usage_events`, not from this estimate.

The trade taken knowingly: at-cost top-ups mean the heaviest chambers are the
least profitable. Halving `grantMinor` is a one-line 2× markup if that matters.

---

## Security review, 2026-08-25

A 36-point review was run against the repository and the deployed
configuration. 27 pass, 3 fail, 4 unknown, 2 not applicable. The three failures
are recorded here with what was wrong, because each was a control that looked
present and was not.

### The budget has to hold on every route that reaches a model

**Was:** `POST /exemplars` called the redaction pass with no budget check.
`POST /cases/:id/drafts` had one; the exemplar route did not, so a chamber whose
allowance was exhausted could keep spending by uploading style examples instead
of drafting.

**Now:** the same pessimistic `checkBudget` runs before `anonymise()`, estimated
against `ANONYMISE_MAX_OUTPUT` — the actual ceiling, exported for that purpose
rather than guessed at.

**The general lesson**, which is why this is here and not just in a commit
message: "the expensive route is guarded" is not the same as "spending is
guarded". Any new call into `lib/ai` needs the check, and the drafting suite now
exhausts a trial pack and asserts that both routes refuse.

_Side effect worth knowing:_ the preview stub used to report the token count of
its own placeholder text, so a draft cost a third of a paisa and the budget
could never be exhausted in any test. It now reports output as a realistic
fraction of the ceiling. Preview spend resembles production spend instead of
flattering it, which is what made the control testable at all.

### Readiness detail is for whoever runs the service, not for everyone

**Was:** `/api/readyz` and `/api/health` are mounted ahead of `clerkMiddleware`
— correctly, a monitor must not need a session — and returned `databaseError`,
which `describeCause` deliberately fills with the innermost driver message. For
a connection failure that is the host and port; for a credential failure it says
so. Plus `frontendPath`, `nodeEnv` and the commit.

**Now:** in production those two fields are omitted, leaving booleans about what
is configured. The full object moved to `GET /api/operator/readiness`, behind
the `OPERATOR_EMAILS` allowlist, which 404s rather than 403s like the rest of
that surface.

**Why not authenticate `/readyz` itself:** it sits in front of all auth on
purpose, and moving it behind `clerkMiddleware` would make a health check fail
when Clerk is misconfigured — precisely when you need it to answer.

### A party's document is untrusted input sitting next to a tool

**Was:** document text went into the review prompt as plain text, and the review
enables the `web_search` server tool with no domain restriction. An opposing
party's filing — exactly what an advocate ticks for a review — could carry text
instructing the model to search for a string built from the matter's own facts,
which turns the search box into a way to carry privileged information out.

**Now, two halves, and the second is the one that matters:**

1. Document text is wrapped by `wrapUntrusted()` (`lib/ai/untrusted.ts`) in an
   envelope it cannot end — both tags are neutralised in the body, visibly, so
   a reader can see something was defanged. The cached prefix tells the model
   everything in that envelope is evidence and never an instruction.
2. `web_search` carries `allowed_domains` — four court and case-law hosts. This
   is the containment. Wording does not stop a model being told to search for
   something; an allowlist stops the search being worth telling it to do.

`untrusted.ts` is its own module with no database import specifically so the
escaping is a pure function with its own offline suite. A live server cannot
show what went into a prompt, and asserting on the stub's output would be
asserting on the stub.

---

## The paid gate, case access, and the brief (2026-08-27)

### The chamber is never locked. Its features are.

**The choice:** where to put the wall for a chamber that has not paid.

A wall in front of the door is the obvious build and it is wrong. A founder
whose card was declined would be shut out of a chamber that exists, with their
own data behind it, and their only route back in is a support ticket. Payments
fail for reasons that have nothing to do with the customer — a bank that times
out, a 3-D Secure page that never returns, a window closed by accident.

**So `neverPaid` is a capability gate**, sharing the allowlist a lapsed chamber
already has. An unpaid chamber reads its own shell, its plan screen and its
billing, and cannot open a matter, draft, or invoice. Everything needed to fix
the situation is inside, and the person is inside with it.

**Why not reuse `lapsed`:** they are the same enforcement and opposite
sentences. "Your plan expired" to somebody who signed up ten minutes ago is
nonsense that sends them hunting for a renewal button. Two flags, two messages,
one allowlist.

### The subscription screen sits after the bar gate, not before it

The order asked for was setup → plans → credentials. The order shipped is setup
→ bar enrolment → plans → the rest of the credentials, for a mechanical reason:
`requireWorkspace` refuses every workspace-scoped read until enrolment is
declared, and that includes reading the subscription. There is literally
nothing to render on a plan screen before it.

The compulsory pair — state bar council and enrolment number — was already
taken at the door and is unchanged. What now follows payment is everything
else: Certificate of Practice, Advocate-on-Record at either court, and the All
India Bar number. Those are a notice on the dashboard rather than a second
wall, because most advocates hold none of the first three and the fourth has a
six-month statutory-style window of its own. Stopping a chamber that has just
paid, to demand a number the person may not hold for months, would be a wall in
front of work they had already bought.

### The six-month deadline is stamped once

`all_india_bar_due_at` is written on the first declaration and never moved
(`user.allIndiaBarDueAt ?? …+6 months`). Recomputing it on save would make the
deadline resettable by anyone who reopened the form, which is not a deadline.
`allIndiaBarDaysLeft` is computed server-side by the same helper that enforces
it, so the countdown and the refusal cannot disagree — a browser clock is not
what the gate reads.

### Case access replaces row scope; it does not filter it

**The trap:** the obvious implementation intersects the grants with the role's
own scope. A junior advocate's scope is `all`. Intersecting with `all` is a
no-op, so the restriction compiles, ships, tests green against a clerk, and
does nothing whatsoever to the junior it was built for.

**So the restricted branch runs first and substitutes.** A restricted member
sees the matters they hold a task on, plus what was granted. `case-access.mjs`
asserts exactly this — that Beta disappears "though the junior's ROLE scope is
`all`" — because that is the assertion the wrong implementation fails.

Assigned matters are not in the tick list and cannot be removed there. A person
given work must be able to open the file it is on, or the work is unassignable.

**The grant list is sent whole**, not as add/remove: a stale tab cannot
re-grant something an admin has just withdrawn, because the last complete
picture wins. Every id is validated against `cases.workspace_id` first — a
grant naming another chamber's matter writes no row rather than a row that
resolves to nothing, because a row that means nothing is worse than no row.
Somebody will read it as access.

### `review` became `brief`, and the old name is now an error

Not a rename. The review answered "what is wrong with this draft"; the brief
answers what an advocate opens a file to get — the matter in short, the facts
on the record, the chronology, the merits, how the other side will run it, the
objections to anticipate, the defects to cure, the authorities, and what to
confirm.

`review` is refused with a 400 rather than quietly mapped to `brief`. A stale
client asking for a review would otherwise be served nine sections it did not
ask for under a name that no longer means what it did.

**The output ceiling went 10k → 12k tokens**, which is a real cost: a trial's
₹40 now buys one fewer call. That surfaced as a suite failure — a junior's
draft refused for want of budget, which looks exactly like a junior refused for
want of a capability. The fix was to give the role checks their own chamber on
an untouched allowance, not to shrink the brief. An assertion that passes or
fails on the price of a brief is not testing what it claims to.

**The disclaimer is stated three times** — on the page, on every output card,
and prepended to the body server-side. That is not redundancy. Someone who
pastes a draft into a filing has left the page and the card behind; the only
copy that travels with the text is the one inside it.

### `POST /preview/activate-plan` writes no once-only marker

Preview has no payment provider, so the suites need a way past the paid gate.
The route is guarded like `preview/set-period-end` — 404 unless
`isPreviewAuth() && isPreviewDatabase()`, behind `requireWorkspace`, and can
grant a trial and nothing else.

It deliberately does **not** write `users.trial_claimed_at` or
`subscriptions.trial_used_at`. One trial per person and one per chamber are
commercial rules about real money; consuming somebody's entitlement from a
preview route would be a bug, and leaving both unwritten is what lets
`plan.mjs` §4 and `subs.mjs` still reach a genuinely unclaimed trial after
calling it.

**It is not called automatically at chamber creation.** A gate is only worth
having if it is exercised, and a suite that never meets it would not notice the
day it stopped working — so `plan.mjs` §1 now asserts the 402 by name before
taking a plan and opening its first matter.

It inserts when there is no row to update. A chamber has no subscription row
until it selects something; the UPDATE-only first version returned 200,
reported `activated: true`, and changed nothing.

---

## The case-access restriction had to be taught to four more routes (2026-08-27)

Found by pen-testing `fe8c902` rather than by review, which is the point: the
feature's own suite proved the restriction on `/cases`, and `/cases` was never
where it was going to fail.

**The shape of the bug.** Case-access grants introduced a distinction that had
not existed before. Until then "is this matter in my chamber" and "may I see
this matter" were the same question for a junior advocate, whose row scope is
`all`. Every route written against the weaker check — `caseInWorkspace`, or a
bare `workspace_id` filter — was correct when it was written and silently
became a hole the moment an admin could narrow somebody.

Four routes reached case-scoped data without going through `visibleCaseIds` or
`getVisibleCase`:

| Route                              | What leaked                                                                                                                                                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /tasks/:id`                   | Task title and deadline on a walled-off matter. The LIST was scoped (`visibleTasks` → `visibleCaseIds`); the single fetch was not.                                                                                                 |
| `GET /calendar`                    | Filtered by audience only, so every hearing in the chamber was served with the matter's name in the title.                                                                                                                         |
| `GET`/`POST /cases/:id/drafts`     | A draft body is the matter's facts written out in full — the richest thing in the chamber to leak. POST also let a restricted member commission a brief on a matter they could not open, spending the chamber's budget to read it. |
| `GET`/`PATCH`/`DELETE /drafts/:id` | Read, rewrite or destroy any draft in the chamber by id.                                                                                                                                                                           |

**The list/detail asymmetry is the recurring one.** Three of the four scoped
the collection and not the item. It is easy to write and it looks tested,
because the list assertion passes.

**Two of the fixes are about ordering, not scope.** `PATCH` and `DELETE` on
`/drafts/:id` filtered in the `WHERE` clause and checked the returned row
afterwards — so a draft outside the caller's scope was already overwritten or
deleted by the time the handler answered 404. They now read, check, then write.
A refusal that fires after the row is gone is not a refusal.

**What held.** Tenant isolation everywhere probed (replayed workspace tokens,
forged `X-Workspace-Id`, cross-chamber membership ids, the preview
plan-activation route). The never-paid gate on every write, with reads still
open so the chamber is never locked out. Self-escalation — a restricted junior
widening their own grants, promoting themselves to admin, or self-assigning a
task on a hidden matter to make it visible. The once-stamped All India Bar
deadline, and writing another user's credentials.

**The probe is not in the repository**; its assertions are, in
`case-access.mjs`. A one-off script that proves a hole once is worth less than
the assertion that stops it coming back, and the calendar assertion in
particular was rewritten after it first passed vacuously — the junior could see
no entries at all, so "chamber-wide entries are untouched" proved nothing. It
now seeds an entry on the hidden matter, one on the granted matter and one
chamber-wide, so the filter has to discriminate rather than merely return
nothing.

---

## Mobile

### Capacitor around the existing SPA, not a second frontend

**Decided:** the Android and iOS apps bundle the same built SPA the web
deployment serves and point it at the same API. `artifacts/mobile-app` holds
`capacitor.config.ts` and the two native projects; `webDir` reaches into
`artifacts/practice-portal/dist/public`.

**Why:** the brief was every feature of the website, on a phone. A React Native
rebuild re-implements 24 pages, every capability guard and every route — and
then has to be kept in step with the web forever. Wrapping the SPA gets parity
by construction: there is one frontend, and a page added to it is in the apps
the next time they are built.

**The cost, stated plainly:** the UI is a webview, not native controls. It will
never feel like a platform app, and a screen that is slow on the web is slow
here. That is the trade accepted for parity and one codebase.

**Revisit when:** a feature needs sustained native performance (offline sync of
a whole matter, live document editing), or the webview's feel becomes the
complaint people actually make.

### Bundled assets, not a webview pointed at the site

**Decided:** the SPA ships inside the binary. UI changes need an app release.

**Why:** it paints instantly, works with no signal up to the first API call, and
— the practical reason — Apple rejects apps that are a webview wrapped around a
website. Loading the live site would make every UI change instant and every
review a gamble.

### The localhost CORS origins are safe here, and only here

**Decided:** `CORS_ALLOWED_ORIGINS` includes `https://localhost` and
`capacitor://localhost` for the mobile deployment.

**Why this is not the hole it looks like:** those origins are shared by _any_
Capacitor app on the device, so `cors({ credentials: true })` against them would
normally be alarming. It is acceptable because the apps authenticate with a
**bearer token another app cannot read**, not with an ambient cookie the browser
would attach for them. This is the existing Topology B path — setting
`VITE_API_BASE_URL` already switches the client to bearer tokens, because a
cross-origin cookie would never be sent anyway.

DEPLOYMENT.md's rule stands unchanged: never `*`, never reflect the request
origin.

### Google sign-in works because `allowNavigation` is empty

**Decided:** `server.allowNavigation: []` in `capacitor.config.ts`, and the
OAuth round trip returns through the `in.lexpractice.app://` scheme.

**Why:** Google refuses OAuth inside an embedded webview outright
(`disallowed_useragent`), so the flow has to leave the app. Because no provider
host is listed, Capacitor hands any non-local navigation to a Custom Tab /
SFSafariViewController automatically — the documented behaviour, doing real work
here rather than being incidental config.

**The trap:** adding `accounts.google.com` or a Clerk domain to that list, which
looks like making sign-in work, pulls the flow back inside the webview and
breaks it.

### The app lock is a UX control, not a security boundary

**Decided:** Face ID / fingerprint on returning to the app, off by default, with
a device-passcode fallback.

**Why it exists:** a phone left face-up on a table between hearings. Client files
are not something to leave scrollable, and signing out a dozen times a day is not
a real option.

**What it is not:** encryption. The session token still lives in the webview, the
API cannot tell a locked app from an unlocked one, and anybody who can read the
device's storage can read it either way. The code says so, and so does the
user-facing copy — describing it as protection at rest would be false.

**Also:** this is the one non-official Capacitor plugin in the tree
(`@aparajita/capacitor-biometric-auth`). Capacitor ships no biometric plugin, so
it is a deliberate supply-chain acceptance under the `minimumReleaseAge` rule
rather than an oversight.

---

## Notifications

### Push is a third channel on the machinery that already existed

**Decided:** `notify()` writes the in-app row, sends the email, and queues the
push. `push_outbox` mirrors `mail_outbox` down to the retry ladder and the
five statuses.

**Why:** there were eight hand-written `notifications` inserts, only two of which
also emailed. Adding push at each site would have been eight chances to forget
one. One helper means the three channels cannot disagree about who was told what.

**Why an outbox rather than fire-and-forget:** the same reason mail has one. The
things this system notifies about are filing deadlines and hearing dates; a
message that failed to send has to stay visible instead of becoming a log line.

**One transport for two platforms:** FCM HTTP v1 delivers to iOS too, once the
APNs key is uploaded to Firebase. Hand-rolled service-account JWT and one POST,
matching how `lib/r2.ts` speaks SigV4 without an AWS SDK.

### Hearings were the reminder nobody was getting

**Decided:** the reminder sweep now reads `calendar_entries`.

**Why:** it never had. Task deadlines and consultations were covered only because
those tables happen to carry an assignee — so the most important thing in an
advocate's week was the one event the chamber was never reminded about. The
entry's own `audience` (`all` / `staff` / `role:` / `user:`) already modelled the
fan-out exactly, so this is a new loop over an existing model, not new plumbing.

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
- **Streaming drafts token by token.** A draft is written server-side and the
  page polls. It survives a browser that navigates away, works through any
  proxy, and is testable in CI; SSE would look better and do none of those.
- **OCR for scanned filings.** A scanned order yields no text and says so.
  Claude reads images directly, so the cheap path in is page images rather than
  an OCR stack — worth doing, not done here.
- **A shared cross-chamber insight library.** See above: irreversible.
- **Auto-filing anything.** Drafting a petition and lodging one are different
  categories of act. The platform does not file, serve, or send to a client.
- **CSRF tokens.** Auth is a bearer token, not an ambient cookie, and production
  sends no CORS headers unless configured. `express.urlencoded` is still mounted
  and unused; removing it would close the remaining theoretical surface.
- **A production-mode test of the `/readyz` redaction.** Production refuses to
  boot without a real Postgres, which CI does not have. The dev branch is
  exercised; the production branch is verified by inspection and by the operator
  route's own tests.
- **A push delivered to a real handset.** The queue, the retry ladder, the tenant
  boundary and the hearing fan-out are all tested; nothing has been sent, because
  that needs a Firebase project and an APNs key.
- **A compiled APK or IPA.** Both native projects are generated, committed and
  `cap sync`-clean. CI builds the Android debug APK; an iOS archive needs Xcode
  on a Mac and has not been produced.
- **Designed app icons.** Generated from `logo.svg` and serviceable. A designer
  should replace them before either store submission.
- **Android App Links.** The OAuth return uses a custom URL scheme. A verified
  `https://` deep link is strictly nicer and needs an `assetlinks.json` served
  from the API; not done.
- **Per-page mobile redesign beyond the tables.** `AdaptiveTable` covers the six
  table-heavy screens. The dashboard, KPI charts and the calendar fit, but were
  not redrawn for a phone.
