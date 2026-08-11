# Go-live plan

Getting LEX Practice into production with every feature actually working.

This is sequenced. Each phase ends at a **gate** — something you can check that
proves the phase worked. Do not carry a failed gate forward; every deployment
problem this project has already hit was a missed gate that surfaced three steps
later pointing at the wrong subsystem.

Reference: `DEPLOYMENT.md` is the detailed runbook. `FLOW.md` explains how the
code runs. This document is the order of operations and the division of labour.

---

## What "every feature operational" actually requires

Every feature in the product degrades quietly rather than failing loudly when
its configuration is missing. That is a deliberate design choice — it is what
makes the preview build possible — but it means **a deployment can look healthy
while half of it is inert.** This table is the real inventory.

| Feature                                     | Needs                                            | If unset                                                  |
| ------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| Matters, tasks, calendar, KPI, team, search | `DATABASE_URL`                                   | server refuses to start                                   |
| Document upload & download                  | `FILE_ENCRYPTION_KEY`, `FILE_STORAGE_DIR` + disk | server refuses to start                                   |
| Sign-in with Google                         | Clerk + Google OAuth **in the Clerk dashboard**  | button present, sign-in fails                             |
| Sign-in with Zoho                           | Clerk + Zoho OAuth in the Clerk dashboard        | button present, sign-in fails                             |
| Sign-in with email code                     | Clerk email strategy enabled                     | no way in at all                                          |
| Workspace switching                         | `WORKSPACE_TOKEN_SECRET`                         | **every restart signs everyone out** (warning, not fatal) |
| Email reminders & notifications             | `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM`          | recorded in `mail_outbox` as `suppressed`, never sent     |
| Payments & subscriptions                    | `RAZORPAY_KEY_ID/KEY_SECRET/WEBHOOK_SECRET`      | plan screen records the selection and **charges nothing** |
| Error alerting                              | `ERROR_WEBHOOK_URL`                              | errors logged only — you find out from a customer         |
| Legal documents at `/legal/*`               | `docs/legal/` present (or `LEGAL_DOCS_DIR`)      | 404                                                       |
| Correct rate limiting behind a proxy        | `TRUST_PROXY=on`                                 | limits key on the proxy, not the client                   |
| HSTS and full security headers              | `NODE_ENV=production`                            | HSTS missing — and more than HSTS is affected             |
| **Consultation transcription**              | **a provider — none is wired in the code**       | **returns "Transcription pending"**                       |

**Read the last row carefully.** Everything above it is configuration.
Transcription is the one feature that no amount of dashboard work will turn on,
because `artifacts/api-server/src/lib/stt.ts` has no provider implementation —
it deliberately reports "pending" rather than fabricating a transcript that
would look like a genuine record of what a client said. Decide about it in
Phase 0.

---

## Phase 0 — Decisions before you touch a dashboard

**Time: ~30 minutes. Nothing is reversible-hard here, but changing your mind
later costs a redeploy.**

### 0.1 Decide on transcription

Three honest options:

| Option                     | Effort      | Consequence                                                                     |
| -------------------------- | ----------- | ------------------------------------------------------------------------------- |
| **Launch without it**      | none        | Consultation recordings save; the transcript says "pending". Nothing is broken. |
| **Wire a provider**        | ~half a day | Real transcripts. Adds a subprocessor to your privacy policy and DPA.           |
| **Remove the recorder UI** | ~1 hour     | No half-feature on screen. Cleanest if you are not going to do it soon.         |

My recommendation: **launch without it**, and hide nothing — the "pending"
message is honest. Revisit once you have chambers using consultations enough to
care. If you do wire it, note that sending privileged client audio to a
third-party API is a DPDP disclosure that belongs in the privacy policy _before_
the first recording, not after.

### 0.2 Decide about payments at launch

You can go live with payments off. The plan screen records a chamber's selection
and charges nothing — a perfectly reasonable state for a pilot with chambers you
know. Turning it on later requires no code change, only three environment
variables and a redeploy.

**If you are charging real money from day one**, you must complete Phase 4.2 and
take one real end-to-end payment before opening the doors. Signature
verification and idempotency are tested in this repo; a live transaction is not.

### 0.3 Get a domain

Render gives you `something.onrender.com`. That works, but:

- You will paste it into Clerk as an allowed origin. Changing it later means
  re-doing Clerk config, the Razorpay webhook URL, and a redeploy.
- A chamber handing privileged material to `brain-interface-lex.onrender.com`
  is being asked for more trust than one using `app.lexpractice.in`.

Buy the domain now. It costs less than an hour of rework.

### 0.4 Decide the storage story

The blueprint attaches a 10 GB Render disk. Two things follow that you should
know before, not after:

- A Render disk **cannot be shared**, so the service is pinned to one instance.
  You cannot scale to a second replica without moving files off it first.
- At volume it is roughly **16× the cost** of Cloudflare R2.

For a pilot this is fine and is the simplest starting point. Just know that
"add a second replica" is a migration, not a slider.

### Gate 0

You can answer: transcription — yes/no/remove? payments — on/off at launch?
domain — what is it? You have a payment method on Render (this is a **paid**
deployment, ~$47/month as configured).

---

## Phase 1 — Get the right code onto `main`

**Time: ~15 minutes.**

Render deploys from `main` (`render.yaml`, `branch: main`). Right now `main` is
three commits behind the work — including the entire design port. **Deploying
today ships the old slate UI.**

```bash
git fetch origin
git log --oneline origin/main..origin/claude/bci-chamber-management-saas-j5cr4y
# expect: ee02078 (docs), c7cfe41 (design port), e58e3fe (preflight)
```

Merge that branch into `main`. Then confirm CI is green on `main` before
anything else — `.github/workflows/ci.yml` runs typecheck, lint, format,
the API suites, the startup guards and the browser suite.

### Gate 1

`main` contains `c7cfe41`, and CI on `main` is green.

---

## Phase 2 — Infrastructure

**Time: ~20 minutes plus a 10-minute first build.**

### 2.1 Delete the existing hand-made service

> If you already have a `brain-interface-lex` service on Render, **delete it.**

It predates `render.yaml`, so it has no database, no disk, no encryption key and
the wrong plan. That is precisely what caused the earlier failures. Repairing it
field by field is slower than recreating it and you will miss one.

### 2.2 Apply the Blueprint

Render dashboard → **New → Blueprint** → select this repository.

It reads `render.yaml` and creates the web service **and** the Postgres instance,
wired together. It fills in `DATABASE_URL` and generates
`WORKSPACE_TOKEN_SECRET` for you — two of the four things that broke the last
attempt.

### 2.3 Generate and paste the encryption key

```bash
openssl rand -hex 32
```

Paste as `FILE_ENCRYPTION_KEY`. Exactly 64 hex characters; the server checks the
length at startup and refuses a wrong one.

> **Back this up somewhere other than the disk it protects** — a password
> manager, not the server. Lose it and every uploaded document is
> unrecoverable. There is no recovery path, by design.

### Gate 2

The service exists and the build **fails** with a preflight error listing the
missing Clerk keys. That failure is the gate passing — it proves the preflight
is running and that everything except identity is configured.

---

## Phase 3 — Identity

**Time: ~45 minutes, most of it waiting on Google's consent screen.**

### 3.1 Create a Clerk production instance

Not the development one. Development keys (`pk_test_`) have different domains and
will not work on your domain.

### 3.2 Enable exactly the right strategies

In Clerk → User & Authentication:

- **Enable:** Google, Zoho, Email verification code.
- **Disable: password.**

That last one matters more than it looks. The app is passwordless by design and
the hosted sign-in component was removed specifically so a dashboard setting
could not reintroduce a password field. Leaving password enabled in Clerk
does not put one in the UI, but it leaves an authentication path open that
nothing in this codebase intends.

### 3.3 Google and Zoho OAuth

Each needs an OAuth client in that provider's console, with Clerk's callback URL
as the redirect. Clerk's dashboard shows you the exact URL to paste. Google's
consent screen may need verification if you request sensitive scopes — you do
not, so this is usually quick.

**Test both.** A provider that is enabled in Clerk but misconfigured at the
provider shows a working button that fails on click, which users report as "the
site is broken".

### 3.4 Paste the keys into Render

| Variable                     | Value                                 |
| ---------------------------- | ------------------------------------- |
| `CLERK_SECRET_KEY`           | Clerk → API keys                      |
| `CLERK_PUBLISHABLE_KEY`      | Clerk → API keys                      |
| `VITE_CLERK_PUBLISHABLE_KEY` | **same value** as the publishable key |

`VITE_CLERK_PUBLISHABLE_KEY` is inlined into the JavaScript bundle **at build
time**. Changing it needs a redeploy, not a restart. `REQUIRE_CLERK_KEY=true` is
already set in the blueprint, so a build without it fails loudly rather than
shipping a bundle nobody can sign into.

### 3.5 Point Clerk at your domain

Add your production URL as an allowed origin and set the redirect to
`https://<your-domain>/portal/callback`.

### Gate 3

The deploy succeeds. `curl -s https://<domain>/api/readyz | jq` returns
`database: "ok"`, `filesEncrypted: true`, `frontendBuilt: true`,
`nodeEnv: "production"`, and a `commit` matching what you merged.

---

## Phase 4 — Turn on the optional features

Each of these is independent. Skip any you decided against in Phase 0.

### 4.1 Email — reminders and notifications

Without this, the reminder scheduler runs, writes to `mail_outbox` with status
`suppressed`, and delivers nothing. Hearing reminders are one of the reasons a
chamber would buy this, so it is not really optional.

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`.

Use a transactional provider, not a mailbox. And configure **SPF and DKIM on
your domain** — mail from a new domain without them lands in spam, which looks
identical to the feature not working.

**Verify:** trigger a real notification (invite someone), then check the row in
`mail_outbox` says `sent`, and that it arrives.

### 4.2 Payments

Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.

In the Razorpay dashboard, create a webhook pointing at
`https://<your-domain>/api/billing/webhook`. **Test mode and live mode have
separate webhooks and separate secrets** — using the test secret against live
traffic gives silent signature failures.

**Verify, in this order:**

1. An unsigned POST to the webhook is refused with 400.
2. A real ₹99 Trial payment in **test mode** completes and the plan activates.
3. Switch to live keys, take one real payment, confirm it activates, then refund
   it.

Step 3 is not optional if you are charging. The webhook is the source of truth
for activation; if it is misconfigured, customers pay and get nothing.

### 4.3 Error alerting

Set `ERROR_WEBHOOK_URL` to a Slack or Discord incoming webhook — both accept the
JSON POST as-is. Set `SERVICE_NAME` if you will run more than one deployment.

**Verify:** hit a URL that throws and confirm the message arrives.

Without this you learn about faults from a customer. It takes five minutes.

### Gate 4

`/api/readyz` reports `paymentsConfigured`, `emailConfigured` and
`errorReportingConfigured` as `true` for everything you chose to enable — and
you have **observed each one working**, not merely seen the flag.

---

## Phase 5 — Prove it is locked down

**Do not skip this. It is the difference between "it loads" and "it is safe to
put privileged client material in".**

Run every command in `DEPLOYMENT.md` §7. The five that matter most:

```bash
D=https://<your-domain>

# 1. Health answers without auth (it is mounted ahead of auth deliberately).
curl -s $D/api/healthz

# 2. Security headers, HSTS among them.
curl -sI $D | grep -iE 'strict-transport|x-frame|x-content-type|referrer'
# Missing HSTS => NODE_ENV is not "production", and more than HSTS is affected.

# 3. A protected endpoint refuses an unauthenticated caller.
curl -s -o /dev/null -w '%{http_code}\n' $D/api/cases          # expect 401

# 4. CORS does not reflect an arbitrary origin.
curl -sI -H 'Origin: https://evil.example' $D/api/healthz | grep -i access-control-allow-origin
# Expect NOTHING. If it echoes evil.example, STOP.

# 5. Legal documents are readable with no account.
curl -s -o /dev/null -w '%{http_code}\n' $D/legal/terms        # expect 200
```

Then the tenancy check, which is the one that actually protects your users: sign
in as two people in two different chambers and confirm neither can see the
other's matters — by URL, not just by navigation.

### Gate 5

All five commands give the expected answer, and cross-chamber access is refused.

---

## Phase 6 — First user and pilot

### 6.1 Found the chamber yourself, first

**The first person to sign in is offered "Create a chamber" and becomes its Firm
Admin. Everyone after that must be invited.**

So sign in yourself before you tell anyone the URL. If a colleague gets there
first, they own the chamber, not you.

### 6.2 Walk every feature once, as a real user

Not a smoke test — an actual working session:

- Create a matter, with a party name that should trip the conflict check.
- Upload a document, sign out, sign back in, download it. **This proves
  encryption round-trips against the real disk**, which is the single most
  expensive thing to discover is broken later.
- Create a task with a due date, confirm the reminder email arrives.
- Add a calendar hearing, confirm it appears as "Next hearing" on the dashboard.
- Invite a Junior Advocate; confirm they see less than you do.
- Request a document from a client; sign in as the client and fulfil it.
- Open the KPI page and confirm the charts render with real numbers.

### 6.3 Take a backup, and restore it

Before real client data, prove you can get it back:

1. Take a Postgres backup.
2. Restore it somewhere else.
3. Confirm an uploaded document still opens — this requires the encryption key
   as well as the database, which is why the key must live somewhere the backup
   process does not depend on.

An untested backup is not a backup.

### Gate 6

Every item in 6.2 worked, and you have restored a backup successfully.

---

## Phase 7 — Before real client data

These are honest blockers, not polish.

1. **Counsel review of `docs/legal/*`.** They are served to users at `/legal/*`,
   they name your entity, and they contain `[SQUARE BRACKET]` placeholders. They
   describe what the software actually does — which is the hard part and is
   already done — but they are not signed off. Under DPDP you are the Data
   Fiduciary for account data; get this right before you hold anyone's matters.
2. **Fill in the subprocessor table** in the privacy policy with the providers
   you actually chose in Phases 2–4. It is currently placeholders.
3. **Appoint and name a Grievance Officer** with real contact details. DPDP
   requires it and the policy has a blank waiting.
4. **Decide your retention periods** — the policy has `[12]`, `[24]`, `[60]`
   months as placeholders.

### Gate 7

No square brackets remain in any file under `docs/legal/`, and counsel has seen
them.

---

## Known gaps, stated plainly

Things that will not be operational after this plan, and why:

| Gap                               | Why                                                     | Cost to close  |
| --------------------------------- | ------------------------------------------------------- | -------------- |
| Consultation transcription        | No provider implemented in `lib/stt.ts`                 | ~half a day    |
| Content-Security-Policy           | Needs the header set at a CDN, which does not exist yet | ~2 hours + CDN |
| Second replica / horizontal scale | Render disks cannot be shared                           | R2 migration   |
| Browser suite §8                  | Measures the Access Denied screen, not the dashboard    | ~1 hour        |

That last one is a test-quality bug found during the design port: the
chamber-founding step in `scripts/ci/browser/portal.mjs` looks for
`input[type="text"]`, which does not exist on the Access Denied page, so it
silently skips and seven assertions measure the wrong screen. They pass — but
not on what they claim.

---

## How I can help

Split honestly into what I can do, what only you can do, and where we hand off.

### I can do these now, without any credentials

- **Write a production smoke-test script.** One command against your live URL
  that checks every item in Phase 5 and every `readyz` flag from Phase 4, and
  prints a pass/fail table. This turns "did I remember to check CORS" into
  `node scripts/ci/production-smoke.mjs https://your-domain`. **This is the
  highest-value thing on this list** and I would suggest starting here.
- **Fix the browser-suite §8 flaw** so it measures the real dashboard.
- **Wire a transcription provider** once you tell me which one — the interface
  in `lib/stt.ts` is already shaped for it.
- **Remove the recorder UI instead**, if that is your Phase 0 decision.
- **Fill in `docs/legal/*`** with your entity name, addresses, the subprocessors
  you actually chose, and your retention decisions — so what goes to counsel is
  a complete draft rather than a form. _This does not replace counsel review._
- **Write a backup-and-restore runbook** for Phase 6.3, with the exact commands
  for Render's Postgres.
- **Add the CSP header** once you have a domain and know your CDN.
- **Move file storage to Cloudflare R2**, if you want to unpin the replica limit.
- **Merge to `main` and watch CI**, fixing failures until it is green.

### Only you can do these

- **Paste secrets into dashboards.** I have no access to your Render, Clerk,
  Razorpay or DNS accounts — and you should not share those credentials with me
  or with any agent.
- **Buy the domain and configure DNS.**
- **Approve the spend** (~$47/month).
- **Take the real payment** in Phase 4.2.
- **Get counsel sign-off.**

### Where we hand off — and one real constraint

**I cannot reach your deployed URL from here.** Outbound requests to
`*.onrender.com` are blocked by this environment's egress proxy — I tried during
the earlier troubleshooting and got a 403 from the proxy, not from your server.

So the loop is: **you run the command, paste the output back, I read it and tell
you what is wrong.** That worked well for the earlier failures — the
`FILE_ENCRYPTION_KEY` error you pasted was diagnosed from the log line alone.
`curl -s https://<domain>/api/readyz | jq` is usually enough for me to tell you
exactly which phase you are stuck in.

### Suggested order for my part

1. Production smoke-test script — so Phase 5 is one command, not fifteen.
2. Merge to `main`, get CI green — unblocks Phase 1.
3. Your Phase 0 transcription decision, then either wire it or remove the UI.
4. Legal documents filled in, ready for counsel.
5. Backup/restore runbook.

Say which of these you want and I will start. If you want the smoke-test script
first, I need nothing from you except your eventual domain — it takes the URL as
an argument.

---

## Realistic timeline

| Phase                     | Elapsed   | Blocked on                     |
| ------------------------- | --------- | ------------------------------ |
| 0 — Decisions             | 30 min    | you                            |
| 1 — Merge, CI green       | 15 min    | —                              |
| 2 — Infrastructure        | 30 min    | Render build                   |
| 3 — Identity              | 45 min    | Google/Zoho consent screens    |
| 4 — Optional features     | 1–2 hours | SPF/DKIM propagation, Razorpay |
| 5 — Security verification | 30 min    | —                              |
| 6 — First user + backup   | 1–2 hours | —                              |
| 7 — Legal                 | **days**  | **counsel**                    |

**One working day gets you a live, secure, fully-featured deployment you can
pilot with chambers you know.** Phase 7 is the long pole and it is not
engineering — start counsel review in parallel with Phase 1, not after Phase 6.
