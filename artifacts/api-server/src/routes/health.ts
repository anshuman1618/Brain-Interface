import { Router, type IRouter } from "express";
import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";
import { resolveClientDist } from "../middlewares/staticClient";
import { encryptionKey } from "../lib/blob-store";
import { paymentsEnabled } from "../lib/razorpay";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** The innermost message in an error chain, which is the one worth reading. */
function describeCause(err: unknown, depth = 0): string {
  if (!(err instanceof Error)) return "unknown";
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error && depth < 4) return describeCause(cause, depth + 1);
  const code = (err as NodeJS.ErrnoException).code;
  return `${code ? `${code}: ` : ""}${err.message}`.slice(0, 200);
}

/**
 * Liveness. Deliberately trivial and deliberately not touching the database:
 * a host that gates a release on this must not fail the deploy because the
 * database was slow to accept the first connection.
 */
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * Readiness, and the answer to "why is my deployment broken".
 *
 * Every subsystem that can be misconfigured without stopping the process
 * reports here, because the alternative is reading logs on a host you may not
 * have a shell on. Written after a deployment returned 500 on `/` and the only
 * available evidence was an access-log line.
 *
 * Booleans and paths only — no secret, and no value derived from one. The
 * commit sha is here because the first question when a deployment behaves like
 * an older version is "which code is actually running", and that should take
 * one request to answer rather than an afternoon.
 */
router.get("/readyz", async (_req, res) => {
  const clientDist = resolveClientDist();
  const indexHtml = `${clientDist}/index.html`;
  const spaFound = existsSync(indexHtml);

  let database: "ok" | "unreachable" = "unreachable";
  let databaseError: string | null = null;
  try {
    await db.execute(sql`select 1`);
    database = "ok";
  } catch (err) {
    // Drizzle wraps the driver error, so the outer message is only ever
    // "Failed query: select 1" — which says nothing. The cause is where
    // ECONNREFUSED, ENOTFOUND and "password authentication failed" live, and
    // that string is the entire reason this endpoint exists.
    databaseError = describeCause(err);
    logger.error({ err }, "Readiness check could not reach the database");
  }

  // Anything false here is a thing to fix, and the name matches the variable
  // that fixes it.
  const checks = {
    database,
    databaseError,
    /** False means `/` will 404: the API is running without a frontend. */
    frontendBuilt: spaFound,
    frontendPath: clientDist,
    /** Required in production; the process refuses to start without it. */
    filesEncrypted: encryptionKey() !== null,
    paymentsConfigured: paymentsEnabled(),
    emailConfigured: Boolean(process.env["SMTP_HOST"]?.trim()),
    errorReportingConfigured: Boolean(process.env["ERROR_WEBHOOK_URL"]?.trim()),
    /** Unset in production means every restart signs everyone out. */
    workspaceTokenSecretSet: Boolean(process.env["WORKSPACE_TOKEN_SECRET"]?.trim()),
    nodeEnv: process.env["NODE_ENV"] ?? "development",
    // Render, Railway and Fly all expose the deployed commit under their own
    // name; whichever is present is the one that answers the question.
    commit:
      process.env["RENDER_GIT_COMMIT"] ??
      process.env["GIT_COMMIT"] ??
      process.env["SOURCE_VERSION"] ??
      null,
  };

  const ready = checks.database === "ok" && checks.frontendBuilt;
  res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "degraded", checks });
});

export default router;
