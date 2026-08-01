import app from "./app";
import { initDatabase, isPreviewDatabase } from "@workspace/db";
import { logger } from "./lib/logger";
import { startReminderScheduler } from "./lib/reminder-scheduler";

// The db client is a lazy proxy, so the connection must be established before
// anything can query it — including the reminder scheduler below.
await initDatabase();

if (isPreviewDatabase()) {
  logger.warn(
    "PREVIEW MODE — using an in-memory database seeded with sample matters. All data is discarded when this process exits.",
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

app.listen(port, host, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ host, port }, "Server listening");
});
