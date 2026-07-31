# Deployment

This repo is a pnpm monorepo with two deployable units:

| Unit | Path | What it is | Where it can run |
| --- | --- | --- | --- |
| Practice portal | `artifacts/practice-portal` | Vite + React SPA, builds to static files | Any static host (Netlify, Vercel, Cloudflare Pages, S3+CloudFront) |
| API server | `artifacts/api-server` | Express 5 + Postgres (Drizzle) + Clerk | Any host that runs a long-lived Node process (Render, Railway, Fly.io, ECS) |

**Netlify hosts the frontend only.** The API server needs a persistent process
and a Postgres connection, so it cannot run on Netlify as-is.

There are two supported topologies.

---

## Topology A — same origin (one process serves both)

The API server serves the built SPA itself, so a single process answers both
`/api/*` and the frontend. Requests stay relative and same-origin, the browser
sends the Clerk session cookie automatically, and no CORS is involved.

Leave `VITE_API_BASE_URL` **unset** — that keeps the client on relative paths.

```bash
pnpm install
# 1. Build the SPA (no VITE_API_BASE_URL => relative /api paths + cookie auth)
VITE_CLERK_PUBLISHABLE_KEY=pk_test_... pnpm --filter @workspace/practice-portal run build
# 2. Build and start the API, which picks the SPA up automatically
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run start
```

The whole app is then on `http://0.0.0.0:5000` (override with `PORT`/`HOST`).

By default the server looks for the SPA at
`artifacts/practice-portal/dist/public`, resolved relative to its own bundle.
Set `CLIENT_DIST_PATH` to point elsewhere — e.g. when the two artifacts are
copied into different directories of a Docker image. If no build is found the
process logs a warning and runs API-only, so this topology is opt-in by simply
building the frontend or not.

This is also how the Replit deployment runs, and it is the simplest way to
self-host: one process, one origin, no CORS and no bearer-token bridge.

## Topology B — split hosting (Netlify frontend + separate API)

The SPA and the API are on different origins, so requests become cross-origin.
Two things follow from that, and both are handled in code:

1. **Cookies are not sent** cross-origin (`fetch` defaults to
   `credentials: "same-origin"`). The app instead attaches Clerk's session JWT
   as an `Authorization: Bearer` header — see
   `artifacts/practice-portal/src/hooks/use-api-auth-bridge.ts`. Clerk's
   `clerkMiddleware` on the API accepts either transport, so no API change is
   needed.
2. **The API must opt into the frontend's origin** via `CORS_ALLOWED_ORIGINS`.

### 1. Deploy the API server

Build and start commands:

```bash
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run start
```

Required environment variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `CLERK_SECRET_KEY` | Clerk backend API key |
| `CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CORS_ALLOWED_ORIGINS` | Comma-separated frontend origins, e.g. `https://your-site.netlify.app` |
| `NODE_ENV` | `production` |
| `PORT` | Usually injected by the host; defaults to `5000` |
| `HOST` | Interface to bind; defaults to `0.0.0.0` |
| `CLIENT_DIST_PATH` | Only for Topology A — override where the built SPA is read from |

Apply the schema once the database is reachable:

```bash
pnpm --filter @workspace/db run push
```

> **Note:** if `CORS_ALLOWED_ORIGINS` is unset in production the API sends no
> CORS headers at all and cross-origin browser requests are rejected. This is
> deliberate — reflecting an arbitrary `Origin` while allowing credentials would
> let any website issue authenticated requests with a user's session.

### 2. Deploy the frontend to Netlify

`netlify.toml` at the repo root already sets the build command, publish
directory (`artifacts/practice-portal/dist/public`), Node/pnpm versions, and the
SPA redirect. Set these build environment variables in the Netlify UI:

| Variable | Purpose |
| --- | --- |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key. **Required** — the app throws on startup without it. |
| `VITE_API_BASE_URL` | Absolute API origin, e.g. `https://your-api.onrender.com`. Setting this switches the client to cross-origin + bearer-token mode. |

Vite inlines `VITE_*` variables at **build** time, so changing either one
requires a redeploy, not just a restart.

---

## Local development

```bash
pnpm install
pnpm --filter @workspace/api-server run dev   # API on :5000
pnpm --filter @workspace/practice-portal run dev   # SPA on :5173
```

`pnpm run typecheck` typechecks every package; `pnpm run build` typechecks then
builds all of them.
