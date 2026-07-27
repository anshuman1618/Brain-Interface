import { Router, type IRouter } from "express";
import { db, invitesTable } from "@workspace/db";
import { randomBytes } from "crypto";
import {
  ListInvitesResponse,
  CreateInviteBody,
  CreateInviteResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/invites", requireAuth, async (_req, res): Promise<void> => {
  const invites = await db.select().from(invitesTable);
  res.json(ListInvitesResponse.parse(invites));
});

router.post("/invites", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateInviteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const [invite] = await db.insert(invitesTable).values({
    email: parsed.data.email,
    token,
    role: parsed.data.role,
    caseId: parsed.data.caseId ?? null,
    expiresAt,
  }).returning();

  res.status(201).json(CreateInviteResponse.parse(invite));
});

export default router;
