import { Router, type IRouter } from "express";
import { eq, inArray, and, SQL } from "drizzle-orm";
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
import {
  requireWorkspace,
  requireCapability,
  ctx,
  type AuthRequest,
} from "../middlewares/requireAuth";
import { addTimelineEvent } from "../lib/timeline";
import { getVisibleCase, visibleCaseIds } from "../lib/scope";

const router: IRouter = Router();

// Consultations are reachable only through cases the caller can already see, so
// the visible-case list is the tenant *and* row boundary in one.
router.get(
  "/consultations",
  requireWorkspace,
  requireCapability("consultations.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const params = ListConsultationsQueryParams.safeParse(req.query);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const allowedCaseIds = await visibleCaseIds(c);
    if (allowedCaseIds.length === 0) {
      res.json([]);
      return;
    }

    const conditions: SQL[] = [inArray(consultationsTable.caseId, allowedCaseIds)];
    if (params.data.caseId) conditions.push(eq(consultationsTable.caseId, params.data.caseId));

    const consultations = await db
      .select()
      .from(consultationsTable)
      .where(and(...conditions));

    res.json(ListConsultationsResponse.parse(consultations));
  },
);

router.post(
  "/consultations",
  requireWorkspace,
  requireCapability("consultations.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const parsed = CreateConsultationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    if (!(await getVisibleCase(c, parsed.data.caseId))) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const [consultation] = await db
      .insert(consultationsTable)
      .values({
        caseId: parsed.data.caseId,
        title: parsed.data.title,
        notes: parsed.data.notes ?? null,
        consentGiven: parsed.data.consentGiven,
        category: parsed.data.category,
        scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
        status: "scheduled",
      })
      .returning();

    await addTimelineEvent(
      consultation.caseId,
      "consultation_scheduled",
      `Consultation "${consultation.title}" scheduled`,
      c.user.displayName,
    );

    res.status(201).json(CreateConsultationResponse.parse(consultation));
  },
);

router.get(
  "/consultations/:id",
  requireWorkspace,
  requireCapability("consultations.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const params = GetConsultationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [found] = await db
      .select()
      .from(consultationsTable)
      .where(eq(consultationsTable.id, params.data.id));
    if (!found) {
      res.status(404).json({ error: "Consultation not found" });
      return;
    }
    if (!(await getVisibleCase(c, found.caseId))) {
      res.status(404).json({ error: "Consultation not found" });
      return;
    }

    res.json(GetConsultationResponse.parse(found));
  },
);

// Staff-side only: a client cannot reschedule or close their own consultation.
router.patch(
  "/consultations/:id",
  requireWorkspace,
  requireCapability("consultations.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const pathParams = UpdateConsultationParams.safeParse(req.params);
    if (!pathParams.success) {
      res.status(400).json({ error: pathParams.error.message });
      return;
    }

    const body = UpdateConsultationBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const [existing] = await db
      .select()
      .from(consultationsTable)
      .where(eq(consultationsTable.id, pathParams.data.id));
    if (!existing) {
      res.status(404).json({ error: "Consultation not found" });
      return;
    }
    if (!(await getVisibleCase(c, existing.caseId))) {
      res.status(404).json({ error: "Consultation not found" });
      return;
    }

    const updateData: Partial<typeof consultationsTable.$inferSelect> = {};
    if (body.data.title != null) updateData.title = body.data.title;
    if (body.data.notes != null) updateData.notes = body.data.notes;
    if (body.data.status != null) updateData.status = body.data.status;
    if (body.data.category != null) updateData.category = body.data.category;
    if (body.data.scheduledAt != null) updateData.scheduledAt = new Date(body.data.scheduledAt);

    const [updated] = await db
      .update(consultationsTable)
      .set(updateData)
      .where(eq(consultationsTable.id, pathParams.data.id))
      .returning();

    res.json(UpdateConsultationResponse.parse(updated));
  },
);

export default router;
