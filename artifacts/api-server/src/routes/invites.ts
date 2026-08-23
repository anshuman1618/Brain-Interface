import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  invitesTable,
  workspaceAccessListTable,
  normaliseEmail,
  normalisePhone,
} from "@workspace/db";
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

    /*
     * Addressed to exactly one identifier.
     *
     * Both would be ambiguous — it would have to mean "admit whoever holds
     * either", which is two grants wearing one invite and impossible to revoke
     * as a unit. Neither is simply an invite to nobody. The unused column is
     * stored as "" rather than NULL, matching how users.email already spells
     * "no address".
     */
    const email = normaliseEmail(parsed.data.email ?? "");
    const phone = normalisePhone(parsed.data.phone ?? "");
    const rawPhone = (parsed.data.phone ?? "").trim();

    if (rawPhone && !phone) {
      res.status(400).json({
        error: "invalid_request",
        message: "That does not look like a mobile number. Use 10 digits, or +country code.",
      });
      return;
    }
    if (email && phone) {
      res.status(400).json({
        error: "invalid_request",
        message: "Invite an address or a mobile number, not both.",
      });
      return;
    }
    if (!email && !phone) {
      res.status(400).json({
        error: "invalid_request",
        message: "An invite needs an email address or a mobile number.",
      });
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({
        error: "invalid_request",
        message: "That does not look like an email address.",
      });
      return;
    }

    // Which access-list row this invite writes. One name for both branches so
    // the lookup, the un-revoke and the insert below cannot disagree about
    // which grant they are talking about.
    const grantKind = phone ? "phone" : "email";
    const grantValue = phone || email;

    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const caseId = parsed.data.caseId ?? null;

    const [invite] = await db
      .insert(invitesTable)
      .values({
        workspaceId: c.workspaceId,
        email,
        phone,
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
          eq(workspaceAccessListTable.kind, grantKind),
          eq(workspaceAccessListTable.value, grantValue),
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
        kind: grantKind,
        value: grantValue,
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
