import { guardIdParams, parseId } from "../lib/validation";
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, deviceTokensTable } from "@workspace/db";
import { RegisterDeviceBody } from "@workspace/api-zod";
import { requireWorkspace, ctx, type AuthRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

// Every :id on this router must be a real int4 before it reaches a query.
guardIdParams(router, "id");

/**
 * Where a phone says "notifications for this chamber can reach me here".
 *
 * Behind `requireWorkspace` rather than `requireAuth`, and that is the whole
 * tenant story: the row is written against the caller's ACTIVE workspace, read
 * from their membership on this request. A client cannot register a device
 * against a chamber they do not belong to, because there is no field in which
 * to name one — the workspace comes from the session, never from the body.
 *
 * No capability check. Every member of a chamber may be reminded of their own
 * work, including a client waiting on a document request; there is no role for
 * which "receives notifications" would be a privilege.
 */

router.post("/devices", requireWorkspace, async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);
  const parsed = RegisterDeviceBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "invalid_request", message: "A device token and platform are required." });
    return;
  }

  /*
   * Upsert, because the token is not stable.
   *
   * The OS reissues it on reinstall, on restore to a new handset, and
   * occasionally unprompted, so the app re-registers on every launch. Inserting
   * blindly would accumulate a row per launch and send every notification
   * several times over.
   *
   * `revokedAt: null` matters as much as the timestamp: re-registering is how
   * somebody turns notifications back on after switching them off, and a row
   * that stayed revoked would silently ignore them.
   */
  const [row] = await db
    .insert(deviceTokensTable)
    .values({
      workspaceId: c.workspaceId,
      userId: c.user.id,
      clerkId: c.user.clerkId,
      token: parsed.data.token,
      platform: parsed.data.platform,
    })
    .onConflictDoUpdate({
      target: [deviceTokensTable.workspaceId, deviceTokensTable.token],
      set: {
        // Re-asserted rather than left alone: a handset handed to a colleague
        // keeps its token, and the row must follow the person now signed in.
        userId: c.user.id,
        clerkId: c.user.clerkId,
        platform: parsed.data.platform,
        lastSeenAt: new Date(),
        revokedAt: null,
      },
    })
    .returning();

  res.status(201).json({ id: row!.id, platform: row!.platform });
});

/**
 * Stop notifying this device.
 *
 * Revoked, never deleted, so "they had notifications switched off" stays
 * answerable — the same rule the access list follows.
 */
router.delete("/devices/:id", requireWorkspace, async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);
  const id = parseId(req.params["id"]);
  if (id === null) {
    res.status(400).json({ error: "invalid_request", message: "Invalid id." });
    return;
  }

  // Scoped to the caller's own row in their own workspace. Without the userId
  // clause a member could silence a colleague's phone by guessing an id.
  const [row] = await db
    .update(deviceTokensTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(deviceTokensTable.id, id),
        eq(deviceTokensTable.workspaceId, c.workspaceId),
        eq(deviceTokensTable.userId, c.user.id),
      ),
    )
    .returning();

  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.status(204).end();
});

export default router;
