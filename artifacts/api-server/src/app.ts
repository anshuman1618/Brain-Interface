import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import healthRouter from "./routes/health";
import previewRouter from "./routes/preview";
import { mountStaticClient } from "./middlewares/staticClient";
import legalRouter from "./routes/legal";
import billingRouter, { handleRazorpayWebhook } from "./routes/billing";
import { reportError } from "./lib/error-reporter";
import { isPreviewAuth } from "./lib/preview-mode";
import { logger } from "./lib/logger";
import { securityHeaders } from "./middlewares/securityHeaders";
import { rateLimit } from "./middlewares/rateLimit";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(securityHeaders());

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Comma-separated list of browser origins allowed to call this API, e.g.
// "https://app.example.com,https://staging.example.com". Required once the
// frontend is hosted separately from the API (static host + API host).
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (allowedOrigins.length > 0) {
  app.use(cors({ credentials: true, origin: allowedOrigins }));
} else if (process.env.NODE_ENV === "production") {
  // Reflecting an arbitrary Origin while allowing credentials lets any site
  // issue authenticated requests with the user's session cookie. Same-origin
  // deployments (the Replit router serves app and API together) need no CORS
  // at all, so production defaults to sending no CORS headers.
  logger.warn(
    "CORS_ALLOWED_ORIGINS is not set — cross-origin browser requests will be rejected. Set it if the frontend is hosted on a different origin.",
  );
} else {
  app.use(cors({ credentials: true, origin: true }));
}
// BEFORE the JSON parser, and with a raw body on purpose: the payment webhook
// signature covers the exact bytes the provider sent. Parsing and re-serialising
// changes key order and whitespace, the digest stops matching, and the usual
// "fix" is to skip verification — which is how these integrations end up
// authenticating nothing. Mounted here so the ordering is visible rather than
// buried in a router.
app.post("/api/billing/webhook", express.raw({ type: "*/*", limit: "1mb" }), (req, res, next) => {
  void handleRazorpayWebhook(req, res).catch(next);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mounted ahead of clerkMiddleware: a health check must not depend on auth.
// Behind it, a missing/invalid Clerk key makes /api/healthz return 500, and
// hosts that gate a release on the health check (Render, Railway, Fly, ECS)
// would fail the deploy with an error that points at the wrong subsystem.
app.use("/api", healthRouter);
app.use("/api", previewRouter);

// Scoped to /api, not mounted globally. This process also serves the SPA, and
// clerkMiddleware answers an unauthenticated request lacking Clerk's dev-browser
// cookie with a handshake redirect to the Clerk domain. Applied globally that
// redirect hits the HTML document request, so loading the site bounced to Clerk
// instead of rendering. The SPA must be served unauthenticated — it runs its own
// Clerk client and decides what to show.
//
// Skipped entirely in preview mode: with no CLERK_SECRET_KEY the middleware
// throws on every request, so identity comes from the preview bearer token
// instead (see lib/preview-mode.ts, which cannot engage in production).
if (isPreviewAuth()) {
  logger.warn(
    "PREVIEW MODE — authentication is mocked and every caller may choose their own role. Never expose this to real client data.",
  );
} else {
  app.use(
    "/api",
    clerkMiddleware((req) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    })),
  );
}

/**
 * Rate limits, strictest first.
 *
 * /session is the sign-in path: it is what an attacker hits to enumerate
 * addresses or spam one-time codes, so it gets the tightest budget. Writes get
 * a moderate one keyed per user where we know who they are.
 *
 * Reads used to be exempt entirely, on the reasoning that a busy chamber
 * refreshing a cause list is not an attack. That reasoning stopped holding when
 * two genuinely expensive GETs arrived: /kpi/performance runs eight SQL
 * aggregates with percentile_cont over full tables, and /invoices/:id/pdf
 * renders a document with pdfkit on every call, uncached. Neither is reachable
 * without an admin session, so the threat is an authenticated user (or a leaked
 * session) looping a request, not an anonymous flood — but on a single small
 * instance either one in a loop is enough to starve everybody else.
 *
 * So reads now have a generous ceiling, and the two costly ones have their own
 * tighter bucket on top of it. A named bucket does not draw from another's
 * budget, so the specific limit binds first and the general one still catches
 * anything cheap being hammered.
 */
app.use("/api/session", rateLimit({ name: "auth", max: 30, windowMs: 60_000 }));
app.use("/api/workspaces", rateLimit({ name: "auth", max: 30, windowMs: 60_000 }));
app.use("/api/access-requests", rateLimit({ name: "auth", max: 20, windowMs: 60_000 }));
app.use("/api/privacy", rateLimit({ name: "privacy", max: 20, windowMs: 60_000, perUser: true }));
app.use(
  "/api/service-enquiries",
  rateLimit({ name: "service-enquiries", max: 10, windowMs: 60_000, perUser: true }),
);

/**
 * The expensive reads. 20/min is far above any human use — opening every
 * invoice in a chamber one after another does not approach it — and far below
 * what it takes to hold the event loop down.
 */
const expensiveRead = rateLimit({ name: "expensive", max: 20, windowMs: 60_000, perUser: true });
app.use("/api/kpi/performance", expensiveRead);
app.use("/api/invoices/:id/pdf", expensiveRead);

app.use("/api", (req, res, next) =>
  req.method === "GET" || req.method === "HEAD"
    ? rateLimit({ name: "read", max: 300, windowMs: 60_000, perUser: true })(req, res, next)
    : rateLimit({ name: "write", max: 120, windowMs: 60_000, perUser: true })(req, res, next),
);

app.use("/api", billingRouter);
app.use("/api", router);

// Unmatched API paths must answer in JSON. Without this they fall through to
// Express's default HTML error page, which an API client parsing JSON cannot
// read — and once the SPA is mounted below they would otherwise return
// index.html with a 200, turning a typo'd endpoint into a silent success.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Terms, privacy and the processing agreement, as plain pages. Before the SPA
// fallback so they resolve as documents rather than being swallowed by the app
// shell, and outside /api because someone who has not signed in — and may never
// sign in — has to be able to read them.
app.use(legalRouter);

// Mounted last so the SPA fallback can never shadow an /api route.
mountStaticClient(app);

// Terminal error handler. Without it an unhandled throw reaches Express's
// default handler, which answers with an HTML page (and a stack trace outside
// production) — unparseable by the API client and a leak besides. Four
// parameters are required for Express to treat this as an error handler.
app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  // Logged AND forwarded. The log is for the investigation; the report is so
  // somebody knows there is one to do.
  reportError(err, {
    at: "express",
    method: req.method,
    path: req.path,
    statusCode: 500,
  });

  const isApi = req.path === "/api" || req.path.startsWith("/api/");
  if (isApi) {
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  // A document request that got this far means the SPA never loaded, so there is
  // no client-side boundary to catch it — this is the page a person actually
  // sees. It was `text/plain` "Internal server error", which reads like the
  // server is broken beyond repair rather than like something to retry.
  //
  // Deliberately self-contained: no stylesheet, no script, no bundle. Whatever
  // just failed might be what serves those.
  res.status(500).type("text/html").send(FIVE_HUNDRED_PAGE);
});

/**
 * The 500 page, as a constant so the error handler cannot itself throw while
 * building it. Carries no error detail of any kind: this is served to whoever
 * asked, including strangers and crawlers, and a stack trace in an HTML comment
 * is still a stack trace.
 */
const FIVE_HUNDRED_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Something went wrong &middot; LEX Practice</title>
<style>
  body { margin:0; min-height:100dvh; display:flex; align-items:center; justify-content:center;
         padding:2rem 1rem; background:#e6ded2; color:#241708;
         font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; }
  main { max-width:32rem; text-align:center; }
  .eyebrow { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.6875rem;
             text-transform:uppercase; letter-spacing:.15em; color:#6b5942; margin-bottom:.75rem; }
  h1 { font-size:1.5rem; letter-spacing:-.02em; margin:0 0 .75rem; }
  p { line-height:1.6; color:#6b5942; margin:0 0 1.75rem; }
  a { display:inline-block; background:#5b3a1c; color:#fff; text-decoration:none;
      border-radius:.875rem; padding:.625rem 1.25rem; font-size:.875rem; font-weight:500; }
</style>
</head>
<body>
<main>
  <div class="eyebrow">Something went wrong</div>
  <h1>We could not load the portal</h1>
  <p>The fault is ours, not yours. Nothing you had open has been lost. Try again in a moment &mdash;
     if it keeps happening, tell us what you were doing and we will fix it.</p>
  <a href="/">Try again</a>
</main>
</body>
</html>`;

export default app;
