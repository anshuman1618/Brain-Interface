# Deploying LEX Practice

A step-by-step runbook for putting this platform into production safely.

This app holds privileged client material — matter files, cause lists, client
identities. The steps below are ordered so that nothing is exposed before the
control that protects it exists. **Work through them in order.** Section 9 is a
checklist to run before you hand the URL to anyone.

If you only want to see it running, skip to [Local development](#local-development).

---

## What you are deploying

| Unit            | Path                        | What it is                               | Where it runs                                                               |
| --------------- | --------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| Practice portal | `artifacts/practice-portal` | Vite + React SPA, builds to static files | Any static host (Netlify, Vercel, Cloudflare Pages, S3+CloudFront)          |
| API server      | `artifacts/api-server`      | Express 5 + Postgres (Drizzle) + Clerk   | Any host that runs a long-lived Node process (Render, Railway, Fly.io, ECS) |

**Netlify hosts the frontend only.** The API needs a persistent process and a
Postgres connection, so it cannot run on Netlify as-is.

### Pick a topology first

|                | **A — same origin**                                 | **B — split hosting**                                    |
| -------------- | --------------------------------------------------- | -------------------------------------------------------- |
| Shape          | One Node process serves the API _and_ the built SPA | Static host for the SPA, separate host for the API       |
| Auth transport | Session cookie                                      | `Authorization: Bearer` (the app switches automatically) |
| CORS           | None involved                                       | Must be configured, or the browser is blocked            |
| Attack surface | Smaller — no cross-origin path at all               | Larger — one more origin to get right                    |
| Choose when    | You want the simplest secure setup                  | You need a CDN in front of the frontend                  |

**Topology A is the safer default.** Every cross-origin concern below simply
does not apply to it. Take B only if you need the CDN.

---

## 1. Provision Postgres

Create a database on a managed provider (Neon, Supabase, RDS, Cloud SQL).

Required before anything connects to it:

- **TLS in transit.** Use a connection string with `?sslmode=require`. Most
  managed providers give you one; if yours hands you a plain `postgres://` URL,
  append it.
- **A dedicated role.** Do not deploy with the provider's superuser. Create a
  role that owns only this database.
- **Private networking** where the host offers it, so the database is not
  reachable from the public internet at all. Otherwise restrict inbound IPs to
  your API host.
- **Automated backups** with point-in-time recovery. Note the retention window;
  the default is often shorter than you would want for legal records.

```bash
# Verify TLS is actually in force before you put data in it.
psql "$DATABASE_URL" -c "SELECT ssl, version FROM pg_stat_ssl
  JOIN pg_stat_activity USING (pid) WHERE pid = pg_backend_pid();"
```

## 2. Generate secrets

Generate these now, store them in your host's secret manager, and never put
them in the repo. `.env` is gitignored; `.env.example` is the checked-in
template and holds no real values.

```bash
# HMAC key for scoped workspace tokens.
openssl rand -hex 32
```

| Secret                   | Where it comes from        | If you get it wrong                                                                                                                                                               |
| ------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | Your Postgres provider     | No app                                                                                                                                                                            |
| `CLERK_SECRET_KEY`       | Clerk dashboard → API keys | No authentication                                                                                                                                                                 |
| `WORKSPACE_TOKEN_SECRET` | `openssl rand -hex 32`     | **Unset, the server uses a random per-process secret.** Every restart signs users out of their workspace, and with more than one replica each process rejects the others' tokens. |

> `WORKSPACE_TOKEN_SECRET` must be at least 16 characters or it is ignored and
> the random fallback is used instead — silently. Check the length.

Rotating `WORKSPACE_TOKEN_SECRET` invalidates every workspace token in flight.
Users re-select their workspace and carry on; nothing is lost. Rotate it if it
is ever exposed.

## 3. Configure Clerk

1. Create a Clerk application and copy the publishable and secret keys.
2. **Enable only passwordless strategies.** This app has no password field
   anywhere, by design. Under _User & Authentication → Email, Phone, Username_,
   enable **Email verification code** and disable **Password**. Leaving password
   enabled in Clerk creates an authentication path the application UI does not
   show and does not expect.
3. Under **SSO connections**, enable Google if you want it.
4. Zoho is **not** a Clerk built-in. Add it as a _custom OAuth connection_ with
   the slug exactly `zoho` — the app looks for the strategy `oauth_custom_zoho`.
   Zoho's endpoints, including the regional domains, are in README →
   _Sign-in providers_. Without this connection the Zoho button reports that the
   provider is not enabled rather than failing silently.
5. Add your production domain to Clerk's allowed origins.
6. Use **production** Clerk keys (`pk_live_` / `sk_live_`) for production. Test
   keys have relaxed limits and are not meant to face real users.

> **Only verified email addresses are matched against the access list.** An
> unverified Clerk email is stored as an empty string and matches nothing. Do
> not disable email verification: it is what stops someone claiming a
> colleague's address and inheriting their role.

## 4. Deploy the API server

Build and start:

```bash
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run start
```

Environment:

| Variable                                                | Required             | Purpose                                                                               |
| ------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                          | yes                  | Postgres connection string, with `sslmode=require`                                    |
| `CLERK_SECRET_KEY`                                      | yes                  | Clerk backend API key                                                                 |
| `CLERK_PUBLISHABLE_KEY`                                 | yes                  | Clerk publishable key                                                                 |
| `WORKSPACE_TOKEN_SECRET`                                | **yes in prod**      | HMAC key for scoped workspace tokens (section 2)                                      |
| `NODE_ENV`                                              | yes                  | `production` — also switches on HSTS and the strict CORS default                      |
| `CORS_ALLOWED_ORIGINS`                                  | Topology B only      | Comma-separated frontend origins                                                      |
| `PORT` / `HOST`                                         | usually injected     | Default `5000` / `0.0.0.0`                                                            |
| `CLIENT_DIST_PATH`                                      | Topology A, if moved | Where the built SPA lives                                                             |
| `HSTS`                                                  | no                   | `off` only if TLS terminates at a proxy that already sends HSTS                       |
| `TRUST_PROXY`                                           | no                   | `off` when NOT behind a proxy, so a forged `X-Forwarded-For` cannot dodge rate limits |
| `FILE_STORAGE_DIR`                                      | **yes in prod**      | Where uploaded case files are written (section 4a)                                    |
| `FILE_ENCRYPTION_KEY`                                   | **yes in prod**      | 32 bytes of hex. Without it the server refuses to start (section 4a)                  |
| `RAZORPAY_KEY_ID` / `_KEY_SECRET` / `_WEBHOOK_SECRET`   | to take payment      | All three, or the plan screen records selections and charges nothing (section 4c)     |
| `ERROR_WEBHOOK_URL`                                     | strongly advised     | Where faults are reported. Unset, you find out from a customer (section 4d)           |
| `MAX_UPLOAD_BYTES`                                      | no                   | Per-file cap. Defaults to 25 MB                                                       |
| `SMTP_HOST` / `_PORT` / `_USER` / `_PASS` / `MAIL_FROM` | for email            | Unset, reminders are recorded but never delivered (section 4b)                        |

Apply the schema once the database is reachable:

```bash
pnpm --filter @workspace/db run migrate
```

Run this on every deploy that changes `lib/db/src/schema/`. It is additive; it
does not drop columns.

> **Upgrading a database that predates the current plan names.** The plan
> catalogue was `starter` / `pro` / `firm`; it is now `trial` / `pro` / `firm` /
> `custom`. `push` will not rewrite existing rows, and a row still reading
> `starter` is treated as an unknown plan — which falls back to the trial
> allowance, so it fails closed rather than granting anything. Rename them
> explicitly if you have any:
>
> ```sql
> UPDATE subscriptions SET plan = 'trial', billing_period = 'one_time'
>  WHERE plan = 'starter';
> ```
>
> `started_at` also became nullable, because a Custom-plan enquiry is recorded
> before anything has started. Dropping a `NOT NULL` is not something `push`
> will always do on its own:
>
> ```sql
> ALTER TABLE subscriptions ALTER COLUMN started_at DROP NOT NULL;
> ```

### 4a. Persistent storage for case files, and the key that protects them

Uploaded documents are written to `FILE_STORAGE_DIR`, not to the database, and
they are **encrypted at rest** with AES-256-GCM before they touch the disk.

```bash
openssl rand -hex 32   # -> FILE_ENCRYPTION_KEY
```

- **Production will not start without it.** That is deliberate: writing
  privileged client files in the clear is a worse outcome than a failed deploy.
- **Back the key up somewhere other than the files it protects.** Lose it and
  every uploaded document is unrecoverable. A password manager or your host's
  secret store, not the same volume.
- **Rotating it is not yet automatic.** Files are encrypted under the key that
  was current when they were written; changing the key makes older files
  unreadable. If you must rotate, decrypt and rewrite first.
- **Upgrading an existing deployment**: files written before encryption existed
  are read back as-is, so nothing breaks. Convert them with

  ```bash
  FILE_ENCRYPTION_KEY=... FILE_STORAGE_DIR=... \
    pnpm --filter @workspace/api-server run encrypt-existing
  ```

  It is idempotent and resumable. Back up the directory first.

> **Object storage is markedly cheaper than a mounted disk.** A persistent disk
> runs about $0.25/GB/month against $0.015/GB/month with zero egress on
> Cloudflare R2. The blob store is four functions behind an interface so the
> swap is contained. See `docs/UNIT-ECONOMICS.md`.

- **It must survive a restart.** On Render, Railway or Fly this means a mounted
  volume — a container's own filesystem is discarded on every deploy, and with
  it every file a chamber uploaded.
- **It must be outside the web root.** Nothing should be able to request a file
  by path; the only way in is `GET /api/documents/:id/content`, which re-checks
  matter scope and visibility on every request.
- **Back it up alongside the database.** The two are useless separately: rows
  without bytes are broken links, bytes without rows are unidentifiable.
- Only PDF, common image formats, plain text, CSV and Office documents are
  accepted. Everything is served as an attachment with `nosniff`, so nothing a
  user uploads is ever rendered by the browser in this origin.

```bash
FILE_STORAGE_DIR=/data/lex-files     # a mounted volume, not the container FS
MAX_UPLOAD_BYTES=26214400            # 25 MB
```

> Storage keys are generated server-side. A file named `../../etc/passwd`
> is kept as a display label only; it never touches the filesystem path.

### 4c. Payments

Unset, the plan screen records a chamber's selection and charges nothing, which
is a supported state — self-hosted and preview deployments run this way.

To take money, set all three of `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and
`RAZORPAY_WEBHOOK_SECRET`, then in the Razorpay dashboard:

1. Add a webhook pointing at `https://your-host/api/billing/webhook`.
2. Subscribe it to **`payment.captured`** and **`order.paid`**. Nothing else is
   acted on — an `authorized` payment can still fail.
3. Set the webhook secret to the same value as `RAZORPAY_WEBHOOK_SECRET`. Test
   and live mode have **separate webhooks and separate secrets**.

Two things to verify once, against the live deployment:

```bash
# An unsigned webhook must be refused.
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'content-type: application/json' -d '{"event":"order.paid"}' \
  https://your-host/api/billing/webhook
# expect: 400
```

and that the plan did not change afterwards. The server recomputes the price
from its own catalogue and refuses a payment whose amount does not match, so a
tampered order cannot buy a year for a rupee — but confirm the 400, because a
webhook that verifies nothing is the classic failure here.

**CSP.** The browser checkout loads `https://checkout.razorpay.com`. Add it to
`script-src` and `frame-src`, and `https://api.razorpay.com` to `connect-src`,
or the pay button will fail silently in the console.

### 4d. Error reporting

Set `ERROR_WEBHOOK_URL` to any https endpoint that accepts a JSON POST — a
Slack or Discord incoming webhook needs no adaptation. Uncaught exceptions,
unhandled rejections and every 500 are forwarded, rate-limited to ten per
minute and de-duplicated, carrying the message and stack frames only — never
request bodies or chamber content.

Unset, faults are logged and nothing is forwarded, which in practice means you
learn about them from a customer.

### 4b. Email

Without `SMTP_HOST`, deadline reminders and erasure notices are still written
to the `mail_outbox` table but marked **`suppressed`** and never delivered.
That is deliberate — a suppressed message is visible and countable, where a
silently dropped one is not.

```bash
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587                        # 587 STARTTLS, or 465 implicit TLS
SMTP_USER=...
SMTP_PASS=...
MAIL_FROM=no-reply@yourchamber.in
```

Check delivery after go-live:

```sql
SELECT status, count(*) FROM mail_outbox GROUP BY status;
```

Anything in `failed` carries the reason in `error`. Anything in `suppressed`
means no transport was configured when it was queued.

### Terminate TLS

The API must not be reachable over plain HTTP in production. Most hosts
(Render, Railway, Fly) terminate TLS for you at their edge — confirm it rather
than assume it. If you are running behind your own proxy, redirect `:80` to
`:443` there.

The server sets `Strict-Transport-Security` itself when `NODE_ENV=production`,
so the browser refuses to downgrade after the first visit.

## 5. Deploy the frontend

### Topology A — nothing more to do

Build the SPA before starting the API and the same process serves both:

```bash
# No VITE_API_BASE_URL: requests stay relative, auth stays on the cookie.
VITE_CLERK_PUBLISHABLE_KEY=pk_live_... pnpm --filter @workspace/practice-portal run build
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run start
```

The server looks for the SPA at `artifacts/practice-portal/dist/public`,
resolved relative to its own bundle; `CLIENT_DIST_PATH` overrides that. With no
build present it logs a warning and runs API-only, so this topology is opt-in
simply by building the frontend or not.

### Topology B — Netlify plus a separate API

`netlify.toml` already sets the build command, publish directory, Node/pnpm
versions and the SPA redirect. Set these in the Netlify UI:

| Variable                     | Purpose                                                                     |
| ---------------------------- | --------------------------------------------------------------------------- |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key. **Required** — the app throws on startup without it. |
| `VITE_API_BASE_URL`          | Absolute API origin. Setting it switches the client to bearer-token mode.   |

Then set `CORS_ALLOWED_ORIGINS` on the **API** to your exact frontend origin:

```
CORS_ALLOWED_ORIGINS=https://chambers.example.com
```

Scheme and host must match exactly, with no trailing slash. List multiple
origins comma-separated if you also run a staging frontend.

> **Never set this to `*`, and never reflect the request's `Origin`.** Allowing
> an arbitrary origin _with credentials_ lets any website on the internet issue
> authenticated requests using a signed-in user's session. The server refuses to
> do this: with `CORS_ALLOWED_ORIGINS` unset in production it sends no CORS
> headers at all and cross-origin requests fail. That failure is the safe
> outcome, and it is deliberate.

Vite inlines `VITE_*` variables at **build** time, so changing either one needs
a redeploy, not a restart.

## 6. Harden the edge

The API sets these on every response already:

| Header                      | Value                                                   |
| --------------------------- | ------------------------------------------------------- |
| `X-Content-Type-Options`    | `nosniff`                                               |
| `X-Frame-Options`           | `DENY`                                                  |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                       |
| `Permissions-Policy`        | `camera=(), geolocation=(), microphone=(), payment=()`  |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` (production only) |

**Content-Security-Policy is not set by the app** and should be added at your
proxy or CDN, where you can roll it out in report-only mode first. It has to
name your specific Clerk domain, so a policy baked into the code would break
every deployment that differs from the one it was written for.

A working starting point — verify in report-only mode before enforcing:

```
Content-Security-Policy-Report-Only:
  default-src 'self';
  script-src 'self' https://*.clerk.accounts.dev https://challenges.cloudflare.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com data:;
  img-src 'self' data: https://img.clerk.com;
  connect-src 'self' https://*.clerk.accounts.dev;
  frame-src https://challenges.cloudflare.com;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self'
```

Replace the Clerk hosts with your own — production Clerk instances use your
domain (e.g. `https://clerk.example.com`), not `*.clerk.accounts.dev`.

> **Consider self-hosting the fonts.** `index.html` loads Plus Jakarta Sans and
> Space Mono from `fonts.googleapis.com`. Every visitor's browser therefore
> discloses its IP address to Google before they have signed in. If you are
> claiming DPDP 2023 compliance to Indian clients, that is a transfer you have
> to be able to justify — and it is avoidable. Download the two families into
> `artifacts/practice-portal/public/fonts/`, swap the `<link>` for local
> `@font-face` rules, and the `font-src`/`style-src` entries above collapse to
> `'self'`. It also removes a third-party dependency from your critical
> rendering path.

## 7. Verify the deployment is actually locked down

Run these against the **live** deployment, not localhost. Every one should
produce the outcome in the right-hand column.

```bash
API=https://your-api.example.com

# 1. Health check answers without auth (it is mounted ahead of auth on purpose).
curl -s $API/api/healthz                                  # => {"status":"ok"}

# 2. Security headers are present, HSTS among them.
curl -sI $API/api/healthz | grep -iE \
  'strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy'
# => all five. If Strict-Transport-Security is missing, NODE_ENV is not
#    "production" — see the warning below, because more than HSTS is affected.

# 3. An unauthenticated request to a protected endpoint is refused.
curl -s -o /dev/null -w '%{http_code}\n' $API/api/cases    # => 401

# 4. CORS does not reflect an arbitrary origin.
curl -sI $API/api/healthz -H 'Origin: https://evil.example' \
  | grep -i 'access-control-allow-origin'
# => nothing at all (Topology A), or only your own origin (Topology B).
#    If it echoes back https://evil.example, STOP and read the warning below.

# 5. HTTP is redirected to HTTPS.
curl -sI http://your-api.example.com/api/healthz | head -1 # => 301/308
```

> ### `NODE_ENV` is a security control here, not just a log level
>
> Outside production the API runs `cors({ origin: true })`, which **reflects
> whatever `Origin` the request carried, with credentials allowed**. That is
> convenient on localhost and dangerous anywhere else: it lets any website issue
> authenticated requests using a signed-in user's session. Production instead
> defaults to sending no CORS headers at all unless `CORS_ALLOWED_ORIGINS` names
> the origin explicitly.
>
> Check 4 above is how you catch this. A deployment that echoes back
> `https://evil.example` is running in development mode — set
> `NODE_ENV=production` and redeploy before going further.

### Verifying the workspace-token guard

Check 3 proves an anonymous request is refused. To prove the _scoped token_ is
verified rather than trusted, the request has to come from someone who really is
a member — otherwise the membership check fires first and you learn nothing
about the token.

Signed in as a real member of a chamber, with a tampered token:

```bash
curl -s $API/api/cases \
  -H "authorization: Bearer <a real session token>" \
  -H 'x-workspace-token: forged.token.here'
# => 401 {"reason":"invalid_workspace_token"}
```

The status that matters is **401**, not 200. A present-but-unverifiable token is
rejected outright; it is never quietly downgraded to a default workspace, which
would turn a forged token into a successful request.

For contrast, the same forged token from an address with no membership returns
**403 `no_active_membership`** — a different check, failing earlier, for a
different reason.

Then, in a browser, confirm the authorization boundary end to end:

1. Sign in with an address that is **not** on any access list → you should get
   the "not recognised" screen, not an empty dashboard.
2. Have an admin invite that address as **Client**, sign in again → the client
   portal, with no Master Calendar and no Tasks in the menu.
3. As that client, navigate directly to `/kpi` → the 401 page, not the KPI
   screen. This is the check that matters: it proves the guard is server-side
   and not merely a hidden menu item.
4. In devtools, edit `localStorage` to claim an admin role and reload → nothing
   changes. UI visibility is derived from server-issued claims.

## 8. Operate it

- **Backups.** Confirm the first automated backup exists and _restore it into a
  scratch database once_. An untested backup is not a backup.
- **Logs.** The server logs with pino. Request logs deliberately drop query
  strings (`req.url?.split("?")[0]`) so search terms and filters do not land in
  your log store. Keep it that way.
- **Health checks.** Point your host's check at `/api/healthz`. It is mounted
  ahead of authentication so a Clerk misconfiguration does not make a healthy
  process look dead.
- **Shutdown.** The process handles `SIGTERM` and drains in-flight requests for
  up to 10 seconds. Give your host at least that much grace or you will kill
  writes mid-flight.
- **Access review.** The access list and the member list are the entire
  authorization surface. Review both when someone leaves. Removing an
  access-list entry stops _future_ sign-ins; it does not revoke an existing
  membership — do that in Team Roles.
- **Dependencies.** `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`, so a
  package must have been public for a day before it can be installed. Leave it
  on; it is a cheap defence against a compromised release being pulled in
  within hours.

## 9. Pre-launch checklist

Everything here should be true before the first real client signs in.

- [ ] `NODE_ENV=production` — verified by check 4, not just by reading the
      config. In development the API reflects any `Origin` with credentials.
- [ ] `WORKSPACE_TOKEN_SECRET` set, 32+ characters, unique to this environment
- [ ] Clerk **production** keys, password strategy **disabled**, email
      verification **enabled**
- [ ] `DATABASE_URL` uses `sslmode=require`, and the role is not a superuser
- [ ] Database not reachable from the public internet, or IP-restricted
- [ ] Automated backups on, and one restore tested
- [ ] `FILE_ENCRYPTION_KEY` set, and backed up somewhere other than the volume
- [ ] An unsigned POST to `/api/billing/webhook` returns 400
- [ ] `ERROR_WEBHOOK_URL` set, and a deliberate error seen arriving
- [ ] The legal documents at `/legal/terms` and `/legal/privacy` reviewed by
      counsel and their placeholders filled in
- [ ] TLS terminated; HTTP redirects to HTTPS
- [ ] `CORS_ALLOWED_ORIGINS` set to exact origins (Topology B) — or unset and
      unused (Topology A)
- [ ] Security headers verified on a live response (section 7, check 2)
- [ ] CSP rolled out at the edge, report-only first
- [ ] Fonts self-hosted, or the third-party transfer consciously accepted
- [ ] `pnpm --filter @workspace/db run migrate` applied against production
      (runs automatically in `startCommand`; this is the box for confirming it succeeded)
- [ ] `FILE_STORAGE_DIR` points at a mounted volume, is outside the web root,
      and is included in backups
- [ ] SMTP configured, and `mail_outbox` shows `sent` rather than `suppressed`
- [ ] Plan limits are the ones you intend to sell — they are enforced, so a
      chamber on Starter is genuinely stopped at 5 open matters and 2 seats
- [ ] Browser walkthrough in section 7 completed, including the `/kpi` check
- [ ] No `.env` file committed — `git log --all --full-history -- .env` is empty
- [ ] The first chamber founded, and the founding address confirmed correct:
      whoever founds a chamber owns it

> **The subscription screen does not take payments.** No payment provider is
> connected in this repo. Choosing a plan records the selection against the
> workspace and nothing is charged. If you are going to bill real money, wire a
> provider and set the subscription `status` from its webhook — that is the only
> integration point; the rest of the app already reads from this table.

---

## 10. Render, start to finish

Sections 1-9 are host-agnostic. This one is the concrete path on Render, using
the `render.yaml` blueprint in the repository root. Budget an afternoon; most
of it is waiting for builds and DNS.

The blueprint creates **one web service** (the API, which also serves the built
SPA on the same origin — topology A) and **one managed Postgres**, on Render's
Singapore region, which is the closest to India.

### Before you touch Render

Have these ready, because the deploy stops without them:

```bash
openssl rand -hex 32      # FILE_ENCRYPTION_KEY — save it in a password manager
```

- A **Clerk application**, configured per §3, with its publishable and secret
  keys. Use `pk_test_`/`sk_test_` for the first deploy and swap to live keys
  once it works.
- The `FILE_ENCRYPTION_KEY` above, **stored somewhere other than Render**. It
  is the only thing that can read your uploaded documents back.

You do NOT need Razorpay, SMTP or an error webhook to get a working deployment.
All three are optional and the app tells you what it is doing without them.

### Step 1 — Create the blueprint

1. Push this repository to GitHub if it is not there already.
2. Render dashboard → **New** → **Blueprint** → connect the repo → pick the
   branch you deploy from.
3. Render reads `render.yaml` and shows you the service and the database it is
   about to create. It will prompt for every `sync: false` variable.

Fill in at minimum:

| Variable                     | Value                               |
| ---------------------------- | ----------------------------------- |
| `FILE_ENCRYPTION_KEY`        | the 64 hex characters you generated |
| `CLERK_SECRET_KEY`           | `sk_test_…` from Clerk              |
| `CLERK_PUBLISHABLE_KEY`      | `pk_test_…` from Clerk              |
| `VITE_CLERK_PUBLISHABLE_KEY` | the same `pk_test_…`                |

Leave the Razorpay, SMTP and `ERROR_WEBHOOK_URL` fields blank for now.

4. **Apply.** Render provisions the database first, then builds.

> `VITE_CLERK_PUBLISHABLE_KEY` is inlined into the JavaScript bundle at BUILD
> time. Changing it later needs a redeploy, not a restart — a restart will
> appear to do nothing.

### Step 2 — Watch the first build

It runs `pnpm install --frozen-lockfile --prod=false && pnpm run build`, which
typechecks four packages and builds both the SPA and the server. Expect 3-6
minutes.

Then `preDeployCommand` runs `drizzle-kit migrate` to apply the schema, and the
service starts.

**If the deploy fails here, read the message before changing anything:**

- `FILE_ENCRYPTION_KEY must be 32 bytes` — you pasted something other than 64
  hex characters. This is the startup guard doing its job.
- A `drizzle-kit push` prompt or refusal — push stops rather than guess when a
  schema change could destroy data. That failure is deliberate and the old
  version keeps serving. Open a Render **Shell** on the service and run
  `pnpm --filter @workspace/db run migrate` by hand so you can read what it wants
  to do.
- `Cannot find module` during build — almost always devDependencies being
  skipped. The `--prod=false` in the build command exists to prevent that;
  check it survived any edit.

### Step 3 — Confirm it is actually up

```bash
curl -s https://<your-service>.onrender.com/api/healthz
# {"status":"ok",...}

# The legal documents are served outside the app and need no account.
curl -s -o /dev/null -w '%{http_code}\n' https://<your-service>.onrender.com/legal/terms
# 200

# An anonymous API call must be refused.
curl -s -o /dev/null -w '%{http_code}\n' https://<your-service>.onrender.com/api/session
# 401
```

Then open the URL, sign in with the address you want as the first Firm Admin,
and found the chamber. **The first person to sign in on an empty platform is
offered the chance to create the first chamber — so do this before you tell
anyone else the URL.**

### Step 4 — Custom domain and Clerk

1. Render → service → **Settings → Custom Domains** → add `app.yourdomain.in`.
2. Add the CNAME Render gives you at your DNS provider. TLS is issued
   automatically once it resolves.
3. Add the same domain to **Clerk → Domains** and to its allowed origins, or
   sign-in will fail on the custom domain while working on the
   `.onrender.com` one.

### Step 5 — The security headers Render does not add

Render terminates TLS and adds nothing else. The app already sends `nosniff`,
`X-Frame-Options`, a referrer policy and HSTS (§6), but **CSP is deliberately
left to the edge**. Render has no header configuration, so either put
Cloudflare in front of it — which also gives you the CDN and a WAF — or add the
policy from §6 to the security-headers middleware and redeploy.

Do not skip this because everything appears to work. It will.

### Step 6 — Backups, and proving they work

Render's `basic-1gb` Postgres includes daily backups with point-in-time
recovery. **Restore one into a scratch database before you trust it**, per §8.
An untested backup is a belief, not a backup.

The disk is a separate matter: **Render disks are NOT included in database
backups**. Uploaded case files live only on that disk. Either move to object
storage (below) or set up your own copy — and remember the files are encrypted,
so a copy without the key is worthless.

### Step 7 — Move files to object storage when you have real customers

The blueprint mounts a 10 GB Render disk because it is the simplest thing that
works on day one. At roughly $0.25/GB/month it is about **16x** the price of
Cloudflare R2, which also charges nothing for egress. `docs/UNIT-ECONOMICS.md`
has the arithmetic.

`artifacts/api-server/src/lib/blob-store.ts` is four functions behind an
interface — `put`, `read`, `exists`, `remove` — precisely so this swap does not
touch a route. Encryption happens above that boundary and is unaffected.

A disk also pins you to **one instance**: Render disks cannot be shared, so you
cannot scale to a second replica while files live on one. That matters as soon
as you care about a deploy not being an outage.

### Troubleshooting a deploy that built but does not work

Ask the service what is wrong before changing anything:

```bash
curl -s https://<your-service>.onrender.com/api/readyz | jq
```

It returns 200 `ready` or 503 `degraded`, and names every subsystem that can be
misconfigured without stopping the process — including **the deployed commit**,
which is the fastest way to find out you are running older code than you think.

**`GET /` returns 404 `Cannot GET /`** — the API is running without a frontend.
The SPA build did not happen or landed somewhere the server does not look.
Check `frontendBuilt` and `frontendPath` in `/api/readyz`. Usually the build
command was narrowed to the API only; it must be `pnpm run build`, which builds
both.

**`GET /` returns 500 `Internal server error`** — the frontend WAS found at
startup but could not be read when serving. Search the logs for

```
Could not serve the SPA entry document
```

which names the resolved path and the errno. This is not the same failure as
the 404 above and the fix is different.

**`/api/readyz` says `database: unreachable`** — read `databaseError`. It
carries the real cause rather than the wrapper: `ECONNREFUSED` means nothing is
listening, `ENOTFOUND` a wrong host, `password authentication failed` a wrong
credential. If the blueprint created the database, `DATABASE_URL` is wired
automatically; a hand-configured service usually has it missing or stale.

**Sign-in does nothing, or every session is rejected** —
`VITE_CLERK_PUBLISHABLE_KEY` was missing at build time, so the bundle shipped in
preview mode and the server correctly refuses every one of those sessions in
production. `REQUIRE_CLERK_KEY=true` in the blueprint turns this into a build
failure instead; if you configured the service by hand, set both.

**The deployment behaves like an older version** — check `commit` in
`/api/readyz` against what you expect. `render.yaml` deploys `branch: main`, so
work living on a feature branch is not what Render is building.

**Whatever the symptom, the real error is in the logs.** Every 500 is logged by
the application with `"msg":"Error at express"` and the full stack, separately
from the access-log line that only reports the status code. That access-log line
(`"msg":"request errored"`) is a summary, not the error.

### What this costs

| Item                  | USD/mo |
| --------------------- | -----: |
| Web service, Standard |     25 |
| Postgres, basic-1gb   |     20 |
| Disk, 10 GB           |      2 |
| **Total**             | **47** |

Clerk is free to 50,000 users, so authentication adds nothing. A second replica
for zero-downtime deploys is another $25 and requires moving files off the disk
first.

---

## Local development

```bash
pnpm install
pnpm --filter @workspace/api-server run dev        # API on :5000
pnpm --filter @workspace/practice-portal run dev   # SPA on :5173
```

To run the whole product with no Clerk key, no database and no secrets at all:

```bash
pnpm run preview     # http://localhost:5000
```

Preview mode is for local exploration only. Sign-in is mocked — any address you
type is treated as verified — while every authorization check after that is the
real one. Data is stored in a real Postgres data directory at `.preview-data`
and survives restarts; delete the directory to start over. **Never expose a
preview-mode process to the internet.**

## Repository commands

```bash
pnpm run check       # format check + lint + typecheck: the full gate
pnpm run build       # typecheck, then build every package
pnpm run lint        # ESLint over the workspace
pnpm run format      # rewrite with Prettier
```
