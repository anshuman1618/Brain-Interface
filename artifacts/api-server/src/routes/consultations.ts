import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, consultationsTable } from "@workspace/db";
import {
  ListConsultationsQueryParams,
  ListConsultationsResponse,
  CreateConsultationBody,
  CreateConsultationResponse,
  GetConsultationParams,
  GetConsultationResponse,
  UpdateConsultationParams,
  UpdateConsultationBody,
  UpdateConsultationResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { getOrCreateUser } from "../lib/jit";
import { addTimelineEvent } from "../lib/timeline";

const router: IRouter = Router();

router.get("/consultations", requireAuth, async (req, res): Promise<void> => {
  const params = ListConsultationsQueryParams.safeParse(req.query);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const consultations = params.data.caseId
    ? await db.select().from(consultationsTable).where(eq(consultationsTable.caseId, params.data.caseId))
    : await db.select().from(consultationsTable);

  res.json(ListConsultationsResponse.parse(consultations));
});

router.post("/consultations", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = CreateConsultationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [consultation] = await db.insert(consultationsTable).values({
    caseId: parsed.data.caseId,
    title: parsed.data.title,
    notes: parsed.data.notes ?? null,
    consentGiven: parsed.data.consentGiven,
    scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
    status: "scheduled",
  }).returning();

  await addTimelineEvent(consultation.caseId, "consultation_scheduled", `Consultation "${consultation.title}" scheduled`, user.displayName);

  res.status(201).json(CreateConsultationResponse.parse(consultation));
});

router.get("/consultations/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetConsultationParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [c] = await db.select().from(consultationsTable).where(eq(consultationsTable.id, params.data.id));
  if (!c) { res.status(404).json({ error: "Consultation not found" }); return; }

  res.json(GetConsultationResponse.parse(c));
});

router.patch("/consultations/:id", requireAuth, async (req, res): Promise<void> => {
  const pathParams = UpdateConsultationParams.safeParse(req.params);
  if (!pathParams.success) { res.status(400).json({ error: pathParams.error.message }); return; }

  const body = UpdateConsultationBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [existing] = await db.select().from(consultationsTable).where(eq(consultationsTable.id, pathParams.data.id));
  if (!existing) { res.status(404).json({ error: "Consultation not found" }); return; }

  const updateData: Partial<typeof consultationsTable.$inferSelect> = {};
  if (body.data.title != null) updateData.title = body.data.title;
  if (body.data.notes != null) updateData.notes = body.data.notes;
  if (body.data.audioUrl != null) updateData.audioUrl = body.data.audioUrl;
  if (body.data.transcriptPlaceholder != null) updateData.transcriptPlaceholder = body.data.transcriptPlaceholder;
  if (body.data.status != null) updateData.status = body.data.status;
  if (body.data.scheduledAt != null) updateData.scheduledAt = new Date(body.data.scheduledAt);

  const [updated] = await db.update(consultationsTable).set(updateData).where(eq(consultationsTable.id, pathParams.data.id)).returning();

  res.json(UpdateConsultationResponse.parse(updated));
});

export default router;
