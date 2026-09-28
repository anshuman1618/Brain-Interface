import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  invitesTable,
  workspaceAccessListTable,
  accessListCasesTable,
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
import { resolveCasePin } from "../lib/case-pin";
import { personName } from "../lib/person-name";

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

    // The pin rule lives in `lib/case-pin.ts` because the other admission
    // door applies the identical rule, and the two drifted once already.
    const pin = await resolveCasePin(c, parsed.data.role, parsed.data);
    if (!pin.ok) {
      res.status(pin.status).json({ error: pin.error, message: pin.message });
      return;
    }

    /**
     * Exactly one identifier, and it has to be a real one.
     *
     * An invite may name an address or a mobile number — a chamber's clerks and
     * most of its clients have a phone and no work address, and requiring one
     * excluded exactly the people the chamber needs on the system.
     *
     * The shape check is new on this path, not just the phone half. This route
     * previously applied NO format validation at all while
     * `POST /workspace/access-list` applied a regex, so garbage could be
     * written through one of the two admission doors and not the other, and it
     * would then sit on the access list matching nothing forever.
     */
    const email = parsed.data.email ? normaliseEmail(parsed.data.email) : "";
    const phone = parsed.data.phone ? normalisePhone(parsed.data.phone) : "";

    if (parsed.data.email && parsed.data.phone) {
      res.status(400).json({
        error: "invalid_request",
        message: "Invite an email address or a mobile number — one, not both.",
      });
      return;
    }
    if (!parsed.data.email && !parsed.data.phone) {
      res.status(400).json({
        error: "invalid_request",
        message: "An invite needs an email address or a mobile number.",
      });
      return;
    }
    if (parsed.data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({
        error: "invalid_request",
        message: "That does not look like an email address.",
      });
      return;
    }
    if (parsed.data.phone && !phone) {
      res.status(400).json({
        error: "invalid_request",
        message: "That does not look like a mobile number, e.g. +91 98765 43210",
      });
      return;
    }

    const kind = phone ? "phone" : "email";
    const value = phone || email;

    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // The invite row keeps one matter — it is a link, and the set that governs
    // is the access-list entry's. First of the set, for the same
    // fail-narrower reason the legacy columns are still written.
    const caseId = pin.caseIds[0] ?? null;

    const [invite] = await db
      .insert(invitesTable)
      .values({
        workspaceId: c.workspaceId,
        email: email || null,
        phone: phone || null,
        token,
        role: parsed.data.role,
        caseId,
        expiresAt,
      })
      .returning();

    // The invite record is the audit trail and the shareable link; the access list
    // is what actually admits them. Writing both here means an invited colleague
    // simply signs in with that identifier and is let in at the invited role — there
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
          eq(workspaceAccessListTable.kind, kind),
          eq(workspaceAccessListTable.value, value),
        ),
      );

    let entryId: number;
    if (existing) {
      await db
        .update(workspaceAccessListTable)
        .set({
          revokedAt: null,
          role: parsed.data.role,
          caseId,
          addedBy: personName(c.user),
        })
        .where(eq(workspaceAccessListTable.id, existing.id));
      entryId = existing.id;
    } else {
      const [inserted] = await db
        .insert(workspaceAccessListTable)
        .values({
          workspaceId: c.workspaceId,
          kind,
          value,
          role: parsed.data.role,
          caseId,
          note: "Invited",
          addedBy: personName(c.user),
        })
        .returning();
      entryId = inserted!.id;
    }

    // Replaced rather than merged. Re-inviting somebody with a different set
    // of matters is a correction, and leaving the old rows would quietly widen
    // the access the admin just narrowed.
    await db.delete(accessListCasesTable).where(eq(accessListCasesTable.entryId, entryId));
    if (pin.caseIds.length > 0) {
      await db
        .insert(accessListCasesTable)
        .values(pin.caseIds.map((id) => ({ entryId, caseId: id })))
        .onConflictDoNothing();
    }

    res.status(201).json(CreateInviteResponse.parse(invite));
  },
);

export default router;
