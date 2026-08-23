import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, subscriptionsTable, isPreviewDatabase } from "@workspace/db";
import { isPreviewAuth } from "../lib/preview-mode";
import { emitReminders } from "../lib/reminder-scheduler";
import { requireWorkspace, ctx, type AuthRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

/**
 * Lets the SPA discover, at runtime, that it is talking to a preview backend so
 * it can mock auth to match and show a preview banner. Unauthenticated by
 * design — it reveals only whether external services are configured, never any
 * key material or data.
 */
router.get("/preview-status", (_req, res): void => {
  res.json({
    previewAuth: isPreviewAuth(),
    previewDatabase: isPreviewDatabase(),
  });
});

/**
 * Move this workspace's subscription period to an arbitrary point.
 *
 * Where the period ends is the one input to enforcement that no public API can
 * set — the only way a plan lapses, or comes close to renewing, is for time to
 * pass, and a test cannot wait two months. Negative `daysFromNow` puts it in
 * the past (lapsed); positive puts it in the future, which is what makes the
 * "renews in N days" state reachable at all.
 *
 * Three things keep it out of production:
 *
 *   1. `isPreviewAuth()` is hard-false when NODE_ENV=production, and the server
 *      refuses to boot into preview mode there at all. This route 404s rather
 *      than 403s in that case, so it does not even advertise its own existence.
 *   2. It is behind `requireWorkspace`, so it can only ever touch the caller's
 *      own workspace — the id comes from the verified context, never the body.
 *   3. It moves a date. It cannot grant a plan, change a status or add a seat,
 *      so the worst it can do to a preview database is misdate one row.
 */
router.post(
  "/preview/set-period-end",
  requireWorkspace,
  async (req: AuthRequest, res): Promise<void> => {
    if (!isPreviewAuth() || !isPreviewDatabase()) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const c = ctx(req);
    const daysFromNow = Number(req.body?.daysFromNow ?? -1);
    if (!Number.isFinite(daysFromNow)) {
      res.status(400).json({ error: "daysFromNow must be a number" });
      return;
    }

    const when = new Date(Date.now() + daysFromNow * 86_400_000);
    const [updated] = await db
      .update(subscriptionsTable)
      .set({ currentPeriodEnd: when })
      .where(eq(subscriptionsTable.workspaceId, c.workspaceId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "This workspace has no subscription row to move." });
      return;
    }

    res.json({ workspaceId: c.workspaceId, currentPeriodEnd: when.toISOString() });
  },
);

/**
 * Run the reminder sweep now, instead of waiting for the half-hour cron.
 *
 * The sweep is the only place hearing, deadline and consultation reminders are
 * produced, and it is driven entirely by wall-clock time — which makes it the
 * one behaviour a test cannot reach by calling the public API. Everything it
 * does is idempotent (`notify()` refuses a message it has already sent), so
 * running it early only ever brings work forward.
 *
 * Guarded exactly like `set-period-end` above: 404 outside preview, behind
 * `requireWorkspace`, and it creates nothing a caller could not have caused by
 * waiting thirty minutes.
 */
router.post(
  "/preview/run-reminders",
  requireWorkspace,
  async (_req: AuthRequest, res): Promise<void> => {
    if (!isPreviewAuth() || !isPreviewDatabase()) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await emitReminders();
    res.json({ ran: true });
  },
);

export default router;
