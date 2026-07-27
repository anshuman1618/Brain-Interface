import { Router, type IRouter } from "express";
import { eq, and, SQL } from "drizzle-orm";
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
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { getOrCreateUser } from "../lib/jit";
import { addTimelineEvent } from "../lib/timeline";

const router: IRouter = Router();

async function enrichCase(c: typeof casesTable.$inferSelect) {
  let clientName: string | null = null;
  if (c.clientId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, c.clientId));
    clientName = u?.displayName ?? null;
  }
  return { ...c, clientName };
}

router.get("/cases", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const params = ListCasesQueryParams.safeParse(req.query);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const conditions: SQL[] = [];
  if (params.data.status) conditions.push(eq(casesTable.status, params.data.status));
  if (params.data.clientId) conditions.push(eq(casesTable.clientId, Number(params.data.clientId)));
  if (user.role === "client") conditions.push(eq(casesTable.clientId, user.id));

  const cases = conditions.length > 0
    ? await db.select().from(casesTable).where(and(...conditions))
    : await db.select().from(casesTable);

  const enriched = await Promise.all(cases.map(enrichCase));
  res.json(ListCasesResponse.parse(enriched));
});

router.post("/cases", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = CreateCaseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [newCase] = await db.insert(casesTable).values({
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    status: parsed.data.status ?? "open",
    clientId: parsed.data.clientId ?? null,
    filingRef: parsed.data.filingRef ?? null,
    priority: parsed.data.priority ?? "medium",
  }).returning();

  await addTimelineEvent(newCase.id, "case_created", `Case "${newCase.title}" created`, user.displayName);

  res.status(201).json(CreateCaseResponse.parse(await enrichCase(newCase)));
});

router.get("/cases/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const params = GetCaseParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [c] = await db.select().from(casesTable).where(eq(casesTable.id, params.data.id));
  if (!c) { res.status(404).json({ error: "Case not found" }); return; }

  res.json(GetCaseResponse.parse(await enrichCase(c)));
});

router.patch("/cases/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const pathParams = UpdateCaseParams.safeParse(req.params);
  if (!pathParams.success) { res.status(400).json({ error: pathParams.error.message }); return; }

  const body = UpdateCaseBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [existing] = await db.select().from(casesTable).where(eq(casesTable.id, pathParams.data.id));
  if (!existing) { res.status(404).json({ error: "Case not found" }); return; }

  const updateData: Partial<typeof casesTable.$inferSelect> = {};
  if (body.data.title != null) updateData.title = body.data.title;
  if (body.data.description != null) updateData.description = body.data.description;
  if (body.data.status != null) updateData.status = body.data.status;
  if (body.data.clientId != null) updateData.clientId = body.data.clientId;
  if (body.data.filingRef != null) updateData.filingRef = body.data.filingRef;
  if (body.data.priority != null) updateData.priority = body.data.priority;

  const [updated] = await db.update(casesTable).set(updateData).where(eq(casesTable.id, pathParams.data.id)).returning();

  if (body.data.status && body.data.status !== existing.status) {
    await addTimelineEvent(updated.id, "status_changed", `Status changed to "${body.data.status}"`, user.displayName);
  }

  res.json(UpdateCaseResponse.parse(await enrichCase(updated)));
});

router.delete("/cases/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const params = DeleteCaseParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [c] = await db.delete(casesTable).where(eq(casesTable.id, params.data.id)).returning();
  if (!c) { res.status(404).json({ error: "Case not found" }); return; }

  res.sendStatus(204);
});

router.get("/cases/:id/timeline", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const params = GetCaseTimelineParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const events = await db.select().from(timelineEventsTable)
    .where(eq(timelineEventsTable.caseId, params.data.id))
    .orderBy(timelineEventsTable.createdAt);

  res.json(GetCaseTimelineResponse.parse(events));
});

export default router;
