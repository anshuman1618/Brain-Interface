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

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

export default app;
