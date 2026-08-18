import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, invitesTable, workspaceAccessListTable, normaliseEmail } from "@workspace/db";
import { randomBytes } from "crypto";
import { ListInvitesResponse, CreateInviteBody, CreateInviteResponse } from "@workspace/api-zod";
import {
  requireWorkspace,
  requireCapability,
  ctx,
  type AuthRequest,
} from "../middlewares/requireAuth";
import { caseInWorkspace } from "../lib/scope";

const router: IRouter = Router();

// Access Control is admin-of-this-workspace only, and every invite belongs to
// the workspace it was issued from — an admin cannot mint access to a chamber
// they are not an admin of.
router.get(
  "/invites",
  requireWorkspace,
  requireCapability("access_control.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const invites = await db
      .select()
      .from(invitesTable)
      .where(eq(invitesTable.workspaceId, c.workspaceId));
    res.json(ListInvitesResponse.parse(invites));
  },
);

router.post(
  "/invites",
  requireWorkspace,
  requireCapability("access_control.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const parsed = CreateInviteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    /**
     * A case restriction only means anything for a client — every other role
     * reaches the whole workspace regardless, so a caseId on them would sit
     * on the row unread. Rejecting it here rather than silently ignoring it
     * catches the mistake at the point someone made it, not later when they
     * wonder why "restricting" a clerk did nothing.
     *
     * For a client it is mandatory, not merely encouraged: an unrestricted
     * client sees every matter their `clientId` is attached to, which is
     * rarely what an admin handing out one invite link intended.
     */
    if (parsed.data.role !== "client") {
      if (parsed.data.caseId != null) {
        res.status(400).json({
          error: "invalid_request",
          message: "Restrict to Case ID only applies to the Client role.",
        });
        return;
      }
    } else if (parsed.data.caseId == null) {
      res.status(400).json({
        error: "invalid_request",
        message: "A client invite must be restricted to a matter.",
      });
      return;
    } else if (!(await caseInWorkspace(c, parsed.data.caseId))) {
      res.status(404).json({ error: "That matter was not found in this chamber." });
      return;
    }

    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const email = normaliseEmail(parsed.data.email);
    const caseId = parsed.data.caseId ?? null;

    const [invite] = await db
      .insert(invitesTable)
      .values({
        workspaceId: c.workspaceId,
        email,
        token,
        role: parsed.data.role,
        caseId,
        expiresAt,
      })
      .returning();

    // The invite record is the audit trail and the shareable link; the access list
    // is what actually admits them. Writing both here means an invited colleague
    // simply signs in with that address and is let in at the invited role — there
    // is no separate "redeem" step to get wrong, and no window where a link is
    // circulating that grants more than the admin intended.
    //
    // caseId travels with it: the access-list row is what `reconcileAccessList`
    // reads to seed the membership, and the membership is what `lib/scope.ts`
    // actually checks. Without this, a link restricted to one matter would
    // stop restricting anything the moment the invitee signed in.
    const [existing] = await db
      .select()
      .from(workspaceAccessListTable)
      .where(
        and(
          eq(workspaceAccessListTable.workspaceId, c.workspaceId),
          eq(workspaceAccessListTable.kind, "email"),
          eq(workspaceAccessListTable.value, email),
        ),
      );

    if (existing) {
      await db
        .update(workspaceAccessListTable)
        .set({
          revokedAt: null,
          role: parsed.data.role,
          caseId,
          addedBy: c.user.displayName,
        })
        .where(eq(workspaceAccessListTable.id, existing.id));
    } else {
      await db.insert(workspaceAccessListTable).values({
        workspaceId: c.workspaceId,
        kind: "email",
        value: email,
        role: parsed.data.role,
        caseId,
        note: "Invited",
        addedBy: c.user.displayName,
      });
    }

    res.status(201).json(CreateInviteResponse.parse(invite));
  },
);

export default router;
