import { and, eq, inArray } from "drizzle-orm";
import { db, casesTable, tasksTable } from "@workspace/db";
import type { WorkspaceContext } from "../middlewares/requireAuth";

/**
 * Row-level scoping inside an already-verified workspace.
 *
 * `requireWorkspace` answers "may this user be here at all". These helpers answer
 * "which rows, of the ones in here, are theirs". Both layers are needed: a clerk
 * is a legitimate member of the chamber but must not see unassigned matters, and
 * a client is a legitimate member but must see only their own.
 *
 * Every query starts from `cases.workspace_id`, so no helper can return a row
 * from another tenant even if a caller supplies an id from one.
 */

/** The case ids the caller may see. Always workspace-filtered first. */
export async function visibleCaseIds(ctx: WorkspaceContext): Promise<number[]> {
  if (ctx.caseScope === "own") {
    const rows = await db
      .select({ id: casesTable.id })
      .from(casesTable)
      .where(
        and(eq(casesTable.workspaceId, ctx.workspaceId), eq(casesTable.clientId, ctx.user.id)),
      );
    return rows.map((r) => r.id);
  }

  if (ctx.caseScope === "assigned") {
    // Clerk/Intern: only matters they hold a task on. The join is constrained to
    // this workspace's cases so a task row can never drag in a foreign case.
    const rows = await db
      .select({ id: casesTable.id })
      .from(casesTable)
      .innerJoin(tasksTable, eq(tasksTable.caseId, casesTable.id))
      .where(
        and(
          eq(casesTable.workspaceId, ctx.workspaceId),
          eq(tasksTable.assigneeId, ctx.user.clerkId),
        ),
      );
    return [...new Set(rows.map((r) => r.id))];
  }

  const rows = await db
    .select({ id: casesTable.id })
    .from(casesTable)
    .where(eq(casesTable.workspaceId, ctx.workspaceId));
  return rows.map((r) => r.id);
}

/**
 * Fetches a case only if it is in the caller's workspace AND within their row
 * scope. Returns null otherwise — callers answer 404 so an outsider cannot use
 * the response to confirm that an id exists in another tenant.
 */
export async function getVisibleCase(
  ctx: WorkspaceContext,
  caseId: number,
): Promise<typeof casesTable.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(casesTable)
    .where(and(eq(casesTable.id, caseId), eq(casesTable.workspaceId, ctx.workspaceId)));
  if (!row) return null;

  if (ctx.caseScope === "own") {
    return row.clientId === ctx.user.id ? row : null;
  }

  if (ctx.caseScope === "assigned") {
    const [assigned] = await db
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(and(eq(tasksTable.caseId, caseId), eq(tasksTable.assigneeId, ctx.user.clerkId)));
    return assigned ? row : null;
  }

  return row;
}

/** True when the case exists inside the caller's workspace, ignoring row scope. */
export async function caseInWorkspace(ctx: WorkspaceContext, caseId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: casesTable.id })
    .from(casesTable)
    .where(and(eq(casesTable.id, caseId), eq(casesTable.workspaceId, ctx.workspaceId)));
  return !!row;
}

/** All case ids in the workspace, ignoring row scope — for admin/advocate aggregates. */
export async function workspaceCaseIds(ctx: WorkspaceContext): Promise<number[]> {
  const rows = await db
    .select({ id: casesTable.id })
    .from(casesTable)
    .where(eq(casesTable.workspaceId, ctx.workspaceId));
  return rows.map((r) => r.id);
}

/** Tasks the caller may see, already scoped by workspace and row scope. */
export async function visibleTasks(
  ctx: WorkspaceContext,
): Promise<(typeof tasksTable.$inferSelect)[]> {
  const caseIds = await visibleCaseIds(ctx);
  if (caseIds.length === 0) return [];

  const conditions = [inArray(tasksTable.caseId, caseIds)];
  if (ctx.taskScope === "assigned") {
    conditions.push(eq(tasksTable.assigneeId, ctx.user.clerkId));
  }

  return db
    .select()
    .from(tasksTable)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions));
}
