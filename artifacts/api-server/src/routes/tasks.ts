import { Router, type IRouter } from "express";
import { eq, and, lte, ne, inArray, SQL } from "drizzle-orm";
import { db, tasksTable, usersTable, delayLogsTable, casesTable } from "@workspace/db";
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
import { isClientRole, isClerkInternRole } from "../lib/roles";

// Whether `user` is allowed to view/act on `task` — clients only on tasks belonging to
// their own cases, Clerk/Intern only on tasks assigned to them ("blocked: unassigned
// cases"); Admin/Advocate can act on any task.
async function canAccessTask(
  user: NonNullable<Awaited<ReturnType<typeof getOrCreateUser>>>,
  task: typeof tasksTable.$inferSelect,
): Promise<boolean> {
  if (isClientRole(user.role)) {
    const [c] = await db.select().from(casesTable).where(eq(casesTable.id, task.caseId));
    return !!c && c.clientId === user.id;
  }
  if (isClerkInternRole(user.role)) {
    return task.assigneeId === user.clerkId;
  }
  return true;
}

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

// Normalize any date value (Date instance, ISO string, or date-only string) to YYYY-MM-DD
function toDateOnly(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

router.get("/tasks", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const params = ListTasksQueryParams.safeParse(req.query);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const conditions: SQL[] = [];
  if (params.data.status) conditions.push(eq(tasksTable.status, params.data.status));
  if (params.data.assigneeId) conditions.push(eq(tasksTable.assigneeId, params.data.assigneeId));
  if (params.data.caseId) conditions.push(eq(tasksTable.caseId, params.data.caseId));

  // Clients only see tasks on their own cases
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (isClientRole(user.role)) {
    const ownCases = await db.select({ id: casesTable.id }).from(casesTable).where(eq(casesTable.clientId, user.id));
    const ids = ownCases.map(c => c.id);
    if (ids.length === 0) { res.json([]); return; }
    conditions.push(inArray(tasksTable.caseId, ids));
  }
  // Clerk/Intern are blocked from unassigned cases — only see tasks assigned to them.
  if (isClerkInternRole(user.role)) {
    conditions.push(eq(tasksTable.assigneeId, user.clerkId));
  }

  const tasks = conditions.length > 0
    ? await db.select().from(tasksTable).where(and(...conditions))
    : await db.select().from(tasksTable);

  const enriched = await Promise.all(tasks.map(enrichTask));
  res.json(ListTasksResponse.parse(enriched));
});

router.get("/tasks/overdue", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const today = new Date().toISOString().split("T")[0];
  const conditions: SQL[] = [lte(tasksTable.deadline, today), ne(tasksTable.status, "completed")];
  if (isClientRole(user.role)) {
    const ownCases = await db.select({ id: casesTable.id }).from(casesTable).where(eq(casesTable.clientId, user.id));
    const ids = ownCases.map(c => c.id);
    if (ids.length === 0) { res.json([]); return; }
    conditions.push(inArray(tasksTable.caseId, ids));
  }
  if (isClerkInternRole(user.role)) {
    conditions.push(eq(tasksTable.assigneeId, user.clerkId));
  }

  const tasks = await db.select().from(tasksTable).where(and(...conditions));
  const enriched = await Promise.all(tasks.map(enrichTask));
  res.json(ListOverdueTasksResponse.parse(enriched));
});

router.post("/tasks", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  // Task creation/assignment is a staff action, not a client capability.
  if (isClientRole(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [task] = await db.insert(tasksTable).values({
    caseId: parsed.data.caseId,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    priority: parsed.data.priority ?? "medium",
    assigneeId: parsed.data.assigneeId ?? null,
    deadline: toDateOnly(parsed.data.deadline),
    status: "pending",
  }).returning();

  await addTimelineEvent(task.caseId, "task_assigned", `Task "${task.title}" assigned`, user.displayName);

  res.status(201).json(CreateTaskResponse.parse(await enrichTask(task)));
});

router.get("/tasks/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, params.data.id));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  if (!(await canAccessTask(user, task))) { res.status(404).json({ error: "Task not found" }); return; }

  res.json(GetTaskResponse.parse(await enrichTask(task)));
});

router.patch("/tasks/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  // Clients have read-only access to tasks.
  if (isClientRole(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const pathParams = UpdateTaskParams.safeParse(req.params);
  if (!pathParams.success) { res.status(400).json({ error: pathParams.error.message }); return; }

  const body = UpdateTaskBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, pathParams.data.id));
  if (!existing) { res.status(404).json({ error: "Task not found" }); return; }
  if (!(await canAccessTask(user, existing))) { res.status(404).json({ error: "Task not found" }); return; }

  const updateData: Partial<typeof tasksTable.$inferSelect> = {};
  if (body.data.title != null) updateData.title = body.data.title;
  if (body.data.description != null) updateData.description = body.data.description;
  if (body.data.status != null) updateData.status = body.data.status;
  if (body.data.priority != null) updateData.priority = body.data.priority;
  if (body.data.assigneeId != null) updateData.assigneeId = body.data.assigneeId;
  if (body.data.deadline != null) updateData.deadline = toDateOnly(body.data.deadline);

  const [updated] = await db.update(tasksTable).set(updateData).where(eq(tasksTable.id, pathParams.data.id)).returning();

  res.json(UpdateTaskResponse.parse(await enrichTask(updated)));
});

// Deletion is reserved for Admin/Advocate — Clerk/Intern work assigned tasks but don't
// remove them, and Clients are read-only.
router.delete("/tasks/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (isClientRole(user.role) || isClerkInternRole(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [t] = await db.delete(tasksTable).where(eq(tasksTable.id, params.data.id)).returning();
  if (!t) { res.status(404).json({ error: "Task not found" }); return; }

  res.sendStatus(204);
});

router.post("/tasks/:id/complete", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  // Clients don't complete tasks.
  if (isClientRole(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const pathParams = CompleteTaskParams.safeParse(req.params);
  if (!pathParams.success) { res.status(400).json({ error: pathParams.error.message }); return; }

  const body = CompleteTaskBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, pathParams.data.id));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  if (!(await canAccessTask(user, task))) { res.status(404).json({ error: "Task not found" }); return; }

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
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (isClientRole(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

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
