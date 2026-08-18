import cron from "node-cron";
import { logger } from "../logger";
import { syncAllCourts, upcomingDates } from "./sync";

/**
 * The scheduled read of every court's list.
 *
 * OFF unless `CAUSE_LIST_SYNC=on`. Three reasons, in order of how much they
 * matter:
 *
 *   1. It makes requests to other people's servers, most of them government
 *      ones. A feature that does that should be switched on deliberately by
 *      whoever runs the deployment, and switchable off in one environment
 *      variable if a court's registry ever asks — without a code change or a
 *      deploy.
 *   2. CI has to be deterministic. A tick firing mid-suite would create
 *      proposals nothing asked for. The suites drive the sync explicitly
 *      through POST /cause-list/sync instead, which tests the same code.
 *   3. Render's free plan spins an idle instance down, and a cron inside a
 *      spun-down process does not fire. On that plan this schedule is a lie;
 *      leaving it off by default means nobody is relying on a promise the
 *      hosting cannot keep. See DEPLOYMENT.md.
 *
 * Every six hours rather than once: courts republish lists through the day as
 * items move between benches or are struck off, and the whole point is that
 * the advocate sees the current state. `syncCourt` upserts, so a re-read
 * updates rows rather than accumulating copies.
 */

/** How far ahead to look. Courts publish the next day's list the evening before. */
const LOOKAHEAD_DAYS = 2;

let running = false;

export function startCauseListScheduler(): void {
  if (process.env["CAUSE_LIST_SYNC"]?.trim() !== "on") {
    logger.info("Cause-list sync is off (set CAUSE_LIST_SYNC=on to enable)");
    return;
  }

  cron.schedule("0 */6 * * *", async () => {
    // Same in-process mutex as the reminder scheduler: a tick that overlaps a
    // previous one would double the load on courts we are trying to be a
    // polite visitor to.
    if (running) return;
    running = true;
    try {
      for (const listDate of upcomingDates(LOOKAHEAD_DAYS)) {
        const results = await syncAllCourts(listDate);
        const failed = results.filter((r) => r.status === "failed");
        if (failed.length > 0) {
          logger.warn({ listDate, failed: failed.length }, "Some courts failed to sync");
        }
      }
    } catch (err) {
      logger.error({ err }, "Cause-list scheduler failed");
    } finally {
      running = false;
    }
  });

  logger.info({ lookaheadDays: LOOKAHEAD_DAYS }, "Cause-list sync scheduled (every 6 hours)");
}
