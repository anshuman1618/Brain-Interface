import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
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
import {
  requireWorkspace,
  requireCapability,
  findActiveMembership,
  ctx,
  type AuthRequest,
  type WorkspaceContext,
} from "../middlewares/requireAuth";
import { addTimelineEvent } from "../lib/timeline";
import { caseInWorkspace, visibleCaseIds, visibleTasks } from "../lib/scope";

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

/**
 * Fetches a task only if its case is inside the caller's workspace and within
 * their row scope. Everything about task access is derived from the case, so a
 * task id from another tenant resolves to nothing.
 */
async function getVisibleTask(
  c: WorkspaceContext,
  taskId: number,
): Promise<typeof tasksTable.$inferSelect | null> {
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) return null;
  if (!(await caseInWorkspace(c, task.caseId))) return null;

  if (c.taskScope === "assigned") {
    return task.assigneeId === c.user.clerkId ? task : null;
  }
  if (c.taskScope === "own") {
    const allowed = await visibleCaseIds(c);
    return allowed.includes(task.caseId) ? task : null;
  }
  return task;
}

// Normalize any date value (Date instance, ISO string, or date-only string) to YYYY-MM-DD
function toDateOnly(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

router.get("/tasks", requireWorkspace, requireCapability("tasks.read"), async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);

  const params = ListTasksQueryParams.safeParse(req.query);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const scoped = await visibleTasks(c);
  const filtered = scoped.filter((t) => {
    if (params.data.status && t.status !== params.data.status) return false;
    if (params.data.assigneeId && t.assigneeId !== params.data.assigneeId) return false;
    if (params.data.caseId && t.caseId !== params.data.caseId) return false;
    return true;
  });

  const enriched = await Promise.all(filtered.map(enrichTask));
  res.json(ListTasksResponse.parse(enriched));
});

router.get("/tasks/overdue", requireWorkspace, requireCapability("tasks.read"), async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);

  const today = new Date().toISOString().split("T")[0];
  const scoped = await visibleTasks(c);
  const overdue = scoped.filter((t) => t.status !== "completed" && t.deadline <= today);

  const enriched = await Promise.all(overdue.map(enrichTask));
  res.json(ListOverdueTasksResponse.parse(enriched));
});

router.post("/tasks", requireWorkspace, requireCapability("tasks.write"), async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);

  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // The case must be in this workspace, or a caller could attach work to another
  // tenant's matter by guessing an id.
  if (!(await caseInWorkspace(c, parsed.data.caseId))) {
    res.status(404).json({ error: "Case not found" });
    return;
  }

  // An assignee must be an active member of this workspace too — otherwise a
  // task could be pushed onto someone in a different chamber.
  if (parsed.data.assigneeId) {
    const [assignee] = await db.select().from(usersTable).where(eq(usersTable.clerkId, parsed.data.assigneeId));
    if (!assignee || !(await findActiveMembership(assignee.id, c.workspaceId))) {
      res.status(400).json({ error: "Assignee is not a member of this workspace" });
      return;
    }
  }

  const [task] = await db.insert(tasksTable).values({
    caseId: parsed.data.caseId,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    priority: parsed.data.priority ?? "medium",
    assigneeId: parsed.data.assigneeId ?? null,
    deadline: toDateOnly(parsed.data.deadline),
    status: "pending",
  }).returning();

  await addTimelineEvent(task.caseId, "task_assigned", `Task "${task.title}" assigned`, c.user.displayName);

  res.status(201).json(CreateTaskResponse.parse(await enrichTask(task)));
});

router.get("/tasks/:id", requireWorkspace, requireCapability("tasks.read"), async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);

  const params = GetTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const task = await getVisibleTask(c, params.data.id);
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  res.json(GetTaskResponse.parse(await enrichTask(task)));
});

router.patch("/tasks/:id", requireWorkspace, requireCapability("tasks.write"), async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);

  const pathParams = UpdateTaskParams.safeParse(req.params);
  if (!pathParams.success) { res.status(400).json({ error: pathParams.error.message }); return; }

  const body = UpdateTaskBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const existing = await getVisibleTask(c, pathParams.data.id);
  if (!existing) { res.status(404).json({ error: "Task not found" }); return; }

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

router.delete("/tasks/:id", requireWorkspace, requireCapability("tasks.delete"), async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);

  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const existing = await getVisibleTask(c, params.data.id);
  if (!existing) { res.status(404).json({ error: "Task not found" }); return; }

  await db.delete(tasksTable).where(eq(tasksTable.id, params.data.id));
  res.sendStatus(204);
});

router.post("/tasks/:id/complete", requireWorkspace, requireCapability("tasks.complete"), async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);

  const pathParams = CompleteTaskParams.safeParse(req.params);
  if (!pathParams.success) { res.status(400).json({ error: pathParams.error.message }); return; }

  const body = CompleteTaskBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const task = await getVisibleTask(c, pathParams.data.id);
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

  await addTimelineEvent(task.caseId, "task_completed", `Task "${task.title}" completed${isLate ? " (late)" : ""}`, c.user.displayName);

  res.json(CompleteTaskResponse.parse(await enrichTask(updated)));
});

router.post("/tasks/:id/delay-log", requireWorkspace, requireCapability("tasks.complete"), async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);

  const pathParams = CreateDelayLogParams.safeParse(req.params);
  if (!pathParams.success) { res.status(400).json({ error: pathParams.error.message }); return; }

  const body = CreateDelayLogBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const task = await getVisibleTask(c, pathParams.data.id);
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }

  const [log] = await db.insert(delayLogsTable).values({
    taskId: pathParams.data.id,
    reason: body.data.reason,
    notes: body.data.notes ?? null,
    proofFileName: body.data.proofFileName ?? null,
  }).returning();

  res.status(201).json(CreateDelayLogResponse.parse(log));
});

export default router;
