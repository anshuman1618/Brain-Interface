import { Router, type IRouter } from "express";
import { eq, inArray, and, SQL } from "drizzle-orm";
import {
  db,
  consultationsTable,
  notificationsTable,
  workspaceMembershipsTable,
} from "@workspace/db";
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
  RequestConsultationBody,
  RequestConsultationResponse,
} from "@workspace/api-zod";
import {
  requireWorkspace,
  requireCapability,
  ctx,
  type AuthRequest,
} from "../middlewares/requireAuth";
import { addTimelineEvent } from "../lib/timeline";
import { getVisibleCase, visibleCaseIds } from "../lib/scope";
import { zodMessage } from "../lib/validation";
import { roleHasCapability } from "../lib/permissions";

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
/**
 * A client asking for a consultation.
 *
 * Its own route and its own capability, not `POST /consultations` with a
 * looser gate. Writing a consultation sets the time, the category and the
 * consent flag; a request sets none of those. The chamber turns it into an
 * appointment by patching `status` and `scheduledAt`, which still needs
 * `consultations.write`.
 *
 * `getVisibleCase` is what confines a client to their own matters — the same
 * check every other client-reachable write uses, rather than a second rule
 * about clients written here.
 */
router.post(
  "/consultation-requests",
  requireWorkspace,
  requireCapability("consultations.request"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const parsed = RequestConsultationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(parsed.error) });
      return;
    }

    const matter = await getVisibleCase(c, parsed.data.caseId);
    if (!matter) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    // A preferred time goes in the notes, not in `scheduledAt`. The column is
    // what the calendar draws and what everyone treats as settled; a client's
    // preference is neither, and writing it there would put an appointment
    // nobody agreed to in front of the whole chamber.
    const preferred = parsed.data.preferredAt
      ? `Client would prefer: ${new Date(parsed.data.preferredAt).toISOString()}`
      : "";
    const notes = [parsed.data.notes?.trim(), preferred].filter(Boolean).join("\n\n") || null;

    const [created] = await db
      .insert(consultationsTable)
      .values({
        caseId: matter.id,
        title: parsed.data.title.trim(),
        notes,
        // Not given, and not assumed. Consent is recorded when the chamber
        // holds the consultation, by the person who took it.
        consentGiven: false,
        scheduledAt: null,
        status: "requested",
      })
      .returning();

    await addTimelineEvent(
      matter.id,
      "consultation_scheduled",
      `Consultation requested by ${c.user.displayName}: "${created!.title}"`,
      c.user.displayName,
    );

    /*
     * Somebody has to see it, or a request sits in a list nobody has a reason
     * to open. But only the people who can act on it.
     *
     * The first version of this selected every ACTIVE MEMBERSHIP, which
     * includes other clients — so one client asking for a consultation would
     * have pushed their matter's title to every other client in the chamber.
     * Every membership in a workspace is not a colleague; that is the same
     * mistake as trusting a user id, one table along. Filtered by the
     * capability that describes who can answer: `consultations.write`.
     */
    const members = await db
      .select({
        clerkId: workspaceMembershipsTable.clerkId,
        role: workspaceMembershipsTable.role,
      })
      .from(workspaceMembershipsTable)
      .where(
        and(
          eq(workspaceMembershipsTable.workspaceId, c.workspaceId),
          eq(workspaceMembershipsTable.status, "active"),
        ),
      );
    const recipients = members.filter(
      (m) =>
        m.clerkId &&
        m.clerkId !== c.user.clerkId &&
        roleHasCapability(m.role, "consultations.write"),
    );
    if (recipients.length > 0) {
      await db.insert(notificationsTable).values(
        recipients.map((m) => ({
          userId: m.clerkId,
          type: "consultation_request",
          message: `${c.user.displayName} has asked for a consultation on ${matter.title}: "${created!.title}".`,
          link: "/consultations",
        })),
      );
    }

    res.status(201).json(RequestConsultationResponse.parse(created));
  },
);

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
