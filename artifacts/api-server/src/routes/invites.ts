import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, invitesTable } from "@workspace/db";
import { randomBytes } from "crypto";
import {
  ListInvitesResponse,
  CreateInviteBody,
  CreateInviteResponse,
} from "@workspace/api-zod";
import { requireWorkspace, requireCapability, ctx, type AuthRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

// Access Control is admin-of-this-workspace only, and every invite belongs to
// the workspace it was issued from — an admin cannot mint access to a chamber
// they are not an admin of.
router.get("/invites", requireWorkspace, requireCapability("access_control.manage"), async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);
  const invites = await db.select().from(invitesTable).where(eq(invitesTable.workspaceId, c.workspaceId));
  res.json(ListInvitesResponse.parse(invites));
});

router.post("/invites", requireWorkspace, requireCapability("access_control.manage"), async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);

  const parsed = CreateInviteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const [invite] = await db.insert(invitesTable).values({
    workspaceId: c.workspaceId,
    email: parsed.data.email,
    token,
    role: parsed.data.role,
    caseId: parsed.data.caseId ?? null,
    expiresAt,
  }).returning();

  res.status(201).json(CreateInviteResponse.parse(invite));
});

export default router;
