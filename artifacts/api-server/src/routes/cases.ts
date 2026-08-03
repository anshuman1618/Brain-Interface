import { Router, type IRouter } from "express";
import { eq, and, inArray, SQL } from "drizzle-orm";
import { db, casesTable, usersTable, timelineEventsTable } from "@workspace/db";
import {
  ListCasesQueryParams,
  ListCasesResponse,
  CreateCaseBody,
  CreateCaseResponse,
  GetCaseParams,
  GetCaseResponse,
  UpdateCaseParams,
  UpdateCaseBody,
  UpdateCaseResponse,
  DeleteCaseParams,
  GetCaseTimelineParams,
  GetCaseTimelineResponse,
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

async function enrichCase(c: typeof casesTable.$inferSelect) {
  let clientName: string | null = null;
  if (c.clientId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, c.clientId));
    clientName = u?.displayName ?? null;
  }
  return { ...c, clientName };
}

router.get(
  "/cases",
  requireWorkspace,
  requireCapability("cases.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const params = ListCasesQueryParams.safeParse(req.query);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    // The id list is computed from the verified workspace and the caller's row
    // scope, so no query parameter can widen it.
    const allowedIds = await visibleCaseIds(c);
    if (allowedIds.length === 0) {
      res.json([]);
      return;
    }

    const conditions: SQL[] = [inArray(casesTable.id, allowedIds)];
    if (params.data.status) conditions.push(eq(casesTable.status, params.data.status));
    if (params.data.clientId)
      conditions.push(eq(casesTable.clientId, Number(params.data.clientId)));

    const cases = await db
      .select()
      .from(casesTable)
      .where(and(...conditions));

    const enriched = await Promise.all(cases.map(enrichCase));
    res.json(ListCasesResponse.parse(enriched));
  },
);

router.post(
  "/cases",
  requireWorkspace,
  requireCapability("cases.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const parsed = CreateCaseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [newCase] = await db
      .insert(casesTable)
      .values({
        // Taken from the verified context, never from the request body — otherwise a
        // caller could plant a case inside another tenant.
        workspaceId: c.workspaceId,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        status: parsed.data.status ?? "open",
        clientId: parsed.data.clientId ?? null,
        filingRef: parsed.data.filingRef ?? null,
        priority: parsed.data.priority ?? "medium",
      })
      .returning();

    await addTimelineEvent(
      newCase.id,
      "case_created",
      `Case "${newCase.title}" created`,
      c.user.displayName,
    );

    res.status(201).json(CreateCaseResponse.parse(await enrichCase(newCase)));
  },
);

router.get(
  "/cases/:id",
  requireWorkspace,
  requireCapability("cases.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const params = GetCaseParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const found = await getVisibleCase(c, params.data.id);
    if (!found) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    res.json(GetCaseResponse.parse(await enrichCase(found)));
  },
);

router.patch(
  "/cases/:id",
  requireWorkspace,
  requireCapability("cases.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const pathParams = UpdateCaseParams.safeParse(req.params);
    if (!pathParams.success) {
      res.status(400).json({ error: pathParams.error.message });
      return;
    }

    const body = UpdateCaseBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const existing = await getVisibleCase(c, pathParams.data.id);
    if (!existing) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const updateData: Partial<typeof casesTable.$inferSelect> = {};
    if (body.data.title != null) updateData.title = body.data.title;
    if (body.data.description != null) updateData.description = body.data.description;
    if (body.data.status != null) updateData.status = body.data.status;
    if (body.data.clientId != null) updateData.clientId = body.data.clientId;
    if (body.data.filingRef != null) updateData.filingRef = body.data.filingRef;
    if (body.data.priority != null) updateData.priority = body.data.priority;

    const [updated] = await db
      .update(casesTable)
      .set(updateData)
      .where(eq(casesTable.id, pathParams.data.id))
      .returning();

    if (body.data.status && body.data.status !== existing.status) {
      await addTimelineEvent(
        updated.id,
        "status_changed",
        `Status changed to "${body.data.status}"`,
        c.user.displayName,
      );
    }

    res.json(UpdateCaseResponse.parse(await enrichCase(updated)));
  },
);

// Destructive and workspace-wide — admin of *this* workspace only.
router.delete(
  "/cases/:id",
  requireWorkspace,
  requireCapability("cases.delete"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const params = DeleteCaseParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [deleted] = await db
      .delete(casesTable)
      .where(and(eq(casesTable.id, params.data.id), eq(casesTable.workspaceId, c.workspaceId)))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    res.sendStatus(204);
  },
);

router.get(
  "/cases/:id/timeline",
  requireWorkspace,
  requireCapability("cases.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const params = GetCaseTimelineParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const found = await getVisibleCase(c, params.data.id);
    if (!found) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const events = await db
      .select()
      .from(timelineEventsTable)
      .where(eq(timelineEventsTable.caseId, params.data.id))
      .orderBy(timelineEventsTable.createdAt);

    res.json(GetCaseTimelineResponse.parse(events));
  },
);

export default router;
