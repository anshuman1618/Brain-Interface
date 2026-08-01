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
import { isPreviewAuth } from "./lib/preview-mode";
import { logger } from "./lib/logger";

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

app.use("/api", router);

// Unmatched API paths must answer in JSON. Without this they fall through to
// Express's default HTML error page, which an API client parsing JSON cannot
// read — and once the SPA is mounted below they would otherwise return
// index.html with a 200, turning a typo'd endpoint into a silent success.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

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

  req.log?.error({ err }, "Unhandled error");

  const isApi = req.path === "/api" || req.path.startsWith("/api/");
  if (isApi) {
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.status(500).type("text/plain").send("Internal server error");
});

export default app;
