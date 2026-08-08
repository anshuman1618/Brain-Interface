import type { Server } from "node:http";
import app from "./app";
import { initDatabase, isPreviewDatabase, previewDataDir } from "@workspace/db";
import { logger } from "./lib/logger";
import { startReminderScheduler } from "./lib/reminder-scheduler";
import { assertEncryptionConfigured } from "./lib/blob-store";
import { installProcessHandlers } from "./lib/error-reporter";

// First, so a crash during the rest of startup is still reported.
installProcessHandlers();

// Before anything can accept an upload. In production a missing key throws and
// the process never listens, which is the intended outcome: writing privileged
// client files in the clear is worse than not starting.
assertEncryptionConfigured((msg) => logger.warn(msg));

// The db client is a lazy proxy, so the connection must be established before
// anything can query it — including the reminder scheduler below.
await initDatabase();

if (isPreviewDatabase()) {
  logger.warn(
    { dataDir: previewDataDir() },
    "PREVIEW MODE — running against a local file-backed database. Data persists across restarts; delete the data directory to start over.",
  );
}

startReminderScheduler();

// Most Node hosts (Render, Railway, Fly, Heroku, Replit) inject PORT; fall back
// to the documented local port so `pnpm dev` works without extra setup.
const DEFAULT_PORT = 5000;

const rawPort = process.env["PORT"];
const port = rawPort ? Number(rawPort) : DEFAULT_PORT;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Bind all interfaces by default: containers and preview environments reach the
// process from outside the loopback device, where a 127.0.0.1 bind is unreachable.
const host = process.env["HOST"]?.trim() || "0.0.0.0";

const server: Server = app.listen(port, host, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ host, port }, "Server listening");
});

/**
 * Graceful shutdown.
 *
 * Hosts send SIGTERM and then SIGKILL a short while later, so a process that
 * ignores it is killed mid-request. Draining first lets in-flight writes finish
 * before the database closes — which matters more now that preview data is
 * durable rather than thrown away on exit.
 *
 * The timer is unref'd so it never itself keeps the process alive.
 */
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");

  const force = setTimeout(() => {
    logger.warn("Shutdown timed out with connections still open — exiting anyway");
    process.exit(1);
  }, 10_000);
  force.unref();

  server.close((err) => {
    clearTimeout(force);
    if (err) {
      logger.error({ err }, "Error while closing the server");
      process.exit(1);
    }
    logger.info("Closed cleanly");
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
