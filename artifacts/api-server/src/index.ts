import app from "./app";
import { logger } from "./lib/logger";
import { startReminderScheduler } from "./lib/reminder-scheduler";

startReminderScheduler();

// Most Node hosts (Render, Railway, Fly, Heroku, Replit) inject PORT; fall back
// to the documented local port so `pnpm dev` works without extra setup.
const DEFAULT_PORT = 5000;

const rawPort = process.env["PORT"];
const port = rawPort ? Number(rawPort) : DEFAULT_PORT;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
