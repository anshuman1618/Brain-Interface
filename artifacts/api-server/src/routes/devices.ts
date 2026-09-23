import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, deviceTokensTable, DEVICE_PLATFORMS } from "@workspace/db";
import { RegisterDeviceBody } from "@workspace/api-zod";
import { requireWorkspace, ctx, type AuthRequest } from "../middlewares/requireAuth";
import { zodMessage } from "../lib/validation";

const router: IRouter = Router();

/**
 * Handsets registered for push.
 *
 * ── No capability gate, and that is deliberate ──────────────────────────────
 *
 * Every other write in this API sits behind `requireCapability`. This one sits
 * behind `requireWorkspace` alone, because registering a device grants nothing:
 * it says "send what I am ALREADY entitled to see to this handset as well".
 * A clerk who registers a phone still receives only what a clerk receives, and
 * `notify()` re-checks their membership at send time. Gating it on a capability
 * would mean the most junior members — the ones whose work is most deadline-
 * driven — could not be reminded of anything.
 *
 * ── The workspace comes from the session ────────────────────────────────────
 *
 * Never from the body. That is what stops a device being attached to a chamber
 * the caller does not belong to, which would put another chamber's matters on
 * their lock screen.
 */

router.post("/devices", requireWorkspace, async (req: AuthRequest, res): Promise<void> => {
  const body = RegisterDeviceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "invalid_request", message: zodMessage(body.error) });
    return;
  }
  // The generated schema already constrains this, but the enum lives in the
  // database package and the two must not be able to disagree.
  if (!(DEVICE_PLATFORMS as readonly string[]).includes(body.data.platform)) {
    res.status(400).json({ error: "invalid_request", message: "Unknown platform." });
    return;
  }

  const c = ctx(req);

  /*
   * Upsert, not insert.
   *
   * The app registers on every launch, because the OS reissues the token on
   * reinstall and on restore to a new handset. Inserting would add a row per
   * launch and send every reminder N times, which is how a push integration
   * becomes the thing people switch off.
   *
   * `revokedAt: null` on conflict is what makes switching notifications back
   * on work: the row is revoked rather than deleted, so re-registering has to
   * clear that rather than find a fresh row.
   */
  const [row] = await db
    .insert(deviceTokensTable)
    .values({
      userId: c.user.id,
      workspaceId: c.workspaceId,
      token: body.data.token,
      platform: body.data.platform,
    })
    .onConflictDoUpdate({
      target: [deviceTokensTable.workspaceId, deviceTokensTable.token],
      set: {
        userId: c.user.id,
        platform: body.data.platform,
        lastSeenAt: new Date(),
        revokedAt: null,
      },
    })
    .returning();

  res.status(201).json({ id: row!.id, platform: row!.platform });
});

router.delete("/devices/:id", requireWorkspace, async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id < 1) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  /*
   * Scoped in the WHERE clause, not checked afterwards.
   *
   * The update matches only a device this user owns in this workspace, so a
   * member guessing a colleague's device id changes nothing and is told
   * nothing. 404 rather than 403 for the same reason every other refusal
   * here is: which ids exist is not something to confirm.
   */
  const [row] = await db
    .update(deviceTokensTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(deviceTokensTable.id, id),
        eq(deviceTokensTable.userId, c.user.id),
        eq(deviceTokensTable.workspaceId, c.workspaceId),
      ),
    )
    .returning({ id: deviceTokensTable.id });

  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.status(204).end();
});

export default router;
