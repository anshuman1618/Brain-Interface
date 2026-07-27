import { Router, type IRouter } from "express";
import { eq, and, lte, ne, SQL } from "drizzle-orm";
import { db, tasksTable, usersTable, delayLogsTable } from "@workspace/db";
import {
  ListTasksQueryParams,
  ListTasksResponse,
  CreateTaskBody,
  CreateTaskResponse,
  GetTaskParams,
  GetTaskResponse,
  UpdateTaskParams,
  UpdateTaskBody,
  UpdateTaskResponse,
  DeleteTaskParams,
  CompleteTaskParams,
  CompleteTaskBody,
  CompleteTaskResponse,
  CreateDelayLogParams,
  CreateDelayLogBody,
  CreateDelayLogResponse,
  ListOverdueTasksResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { getOrCreateUser } from "../lib/jit";
import { addTimelineEvent } from "../lib/timeline";

const router: IRouter = Router();

async function enrichTask(t: typeof tasksTable.$inferSelect) {
  let assigneeName: string | null = null;
  if (t.assigneeId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.clerkId, t.assigneeId));
    assigneeName = u?.displayName ?? null;
  }
  const today = new Date().toISOString().split("T")[0];
  const isOverdue = !t.completedAt && t.deadline < today;
  const [dl] = await db.select().from(delayLogsTable).where(eq(delayLogsTable.taskId, t.id));
  return {
    ...t,
    assigneeName,
    isOverdue,
    hasDelayLog: !!dl,
    completedAt: t.completedAt?.toISOString() ?? null,
  };
}

router.get("/tasks", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const params = ListTasksQueryParams.safeParse(req.query);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const conditions: SQL[] = [];
  if (params.data.status) conditions.push(eq(tasksTable.status, params.data.status));
  if (params.data.assigneeId) conditions.push(eq(tasksTable.assigneeId, params.data.assigneeId));
  if (params.data.caseId) conditions.push(eq(tasksTable.caseId, params.data.caseId));

  const tasks = conditions.length > 0
    ? await db.select().from(tasksTable).where(and(...conditions))
    : await db.select().from(tasksTable);

  const enriched = await Promise.all(tasks.map(enrichTask));
  res.json(ListTasksResponse.parse(enriched));
});

router.get("/tasks/overdue", requireAuth, async (_req, res): Promise<void> => {
  const today = new Date().toISOString().split("T")[0];
  const tasks = await db.select().from(tasksTable).where(
    and(lte(tasksTable.deadline, today), ne(tasksTable.status, "completed"))
  );
  const enriched = await Promise.all(tasks.map(enrichTask));
  res.json(ListOverdueTasksResponse.parse(enriched));
});

router.post("/tasks", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [task] = await db.insert(tasksTable).values({
    caseId: parsed.data.caseId,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    priority: parsed.data.priority ?? "medium",
    assigneeId: parsed.data.assigneeId ?? null,
    deadline: String(parsed.data.deadline),
    status: "pending",
  }).returning();

  await addTimelineEvent(task.caseId, "task_assigned", `Task "${task.title}" assigned`, user.displayName);

  res.status(201).json(CreateTaskResponse.parse(await enrichTask(task)));
});

router.get("/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, params.data.id));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  res.json(GetTaskResponse.parse(await enrichTask(task)));
});

router.patch("/tasks/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const pathParams = UpdateTaskParams.safeParse(req.params);
  if (!pathParams.success) { res.status(400).json({ error: pathParams.error.message }); return; }

  const body = UpdateTaskBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, pathParams.data.id));
  if (!existing) { res.status(404).json({ error: "Task not found" }); return; }

  const updateData: Partial<typeof tasksTable.$inferSelect> = {};
  if (body.data.title != null) updateData.title = body.data.title;
  if (body.data.description != null) updateData.description = body.data.description;
  if (body.data.status != null) updateData.status = body.data.status;
  if (body.data.priority != null) updateData.priority = body.data.priority;
  if (body.data.assigneeId != null) updateData.assigneeId = body.data.assigneeId;
  if (body.data.deadline != null) updateData.deadline = String(body.data.deadline);

  const [updated] = await db.update(tasksTable).set(updateData).where(eq(tasksTable.id, pathParams.data.id)).returning();

  res.json(UpdateTaskResponse.parse(await enrichTask(updated)));
});

router.delete("/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [t] = await db.delete(tasksTable).where(eq(tasksTable.id, params.data.id)).returning();
  if (!t) { res.status(404).json({ error: "Task not found" }); return; }

  res.sendStatus(204);
});

router.post("/tasks/:id/complete", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const pathParams = CompleteTaskParams.safeParse(req.params);
  if (!pathParams.success) { res.status(400).json({ error: pathParams.error.message }); return; }

  const body = CompleteTaskBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, pathParams.data.id));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  const today = new Date().toISOString().split("T")[0];
  const isLate = task.deadline < today;

  // If overdue, require delay reason
  if (isLate && !body.data.delayReason) {
    res.status(422).json({ error: "Delay reason is required for overdue tasks" });
    return;
  }

  const completedAt = new Date();
  const [updated] = await db.update(tasksTable)
    .set({ status: "completed", completedAt })
    .where(eq(tasksTable.id, pathParams.data.id))
    .returning();

  // Create delay log if needed
  if (isLate && body.data.delayReason) {
    await db.insert(delayLogsTable).values({
      taskId: task.id,
      reason: body.data.delayReason,
      notes: body.data.delayNotes ?? null,
      proofFileName: body.data.proofFileName ?? null,
    });
  }

  await addTimelineEvent(task.caseId, "task_completed", `Task "${task.title}" completed${isLate ? " (late)" : ""}`, user.displayName);

  res.json(CompleteTaskResponse.parse(await enrichTask(updated)));
});

router.post("/tasks/:id/delay-log", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const pathParams = CreateDelayLogParams.safeParse(req.params);
  if (!pathParams.success) { res.status(400).json({ error: pathParams.error.message }); return; }

  const body = CreateDelayLogBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [log] = await db.insert(delayLogsTable).values({
    taskId: pathParams.data.id,
    reason: body.data.reason,
    notes: body.data.notes ?? null,
    proofFileName: body.data.proofFileName ?? null,
  }).returning();

  res.status(201).json(CreateDelayLogResponse.parse(log));
});

export default router;
