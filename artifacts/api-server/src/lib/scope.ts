import { and, eq, inArray } from "drizzle-orm";
import { db, casesTable, tasksTable, caseAccessGrantsTable } from "@workspace/db";
import { roleHasCapability } from "./permissions";
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

/**
 * Matters an admin has explicitly opened to this member.
 *
 * Empty for everybody whose membership is not marked restricted, which is
 * everybody by default — so this costs one indexed lookup on the path that
 * uses it and nothing at all on the path that does not.
 */
async function grantedCaseIds(ctx: WorkspaceContext): Promise<number[]> {
  if (!ctx.caseAccessRestricted || ctx.membershipId === null) return [];
  const rows = await db
    .select({ caseId: caseAccessGrantsTable.caseId })
    .from(caseAccessGrantsTable)
    .innerJoin(casesTable, eq(casesTable.id, caseAccessGrantsTable.caseId))
    .where(
      and(
        eq(caseAccessGrantsTable.membershipId, ctx.membershipId),
        // Joined through `cases` and filtered by workspace, so a grant naming a
        // matter in another chamber resolves to nothing rather than to that
        // matter. A grant cannot reach across the tenant boundary even if a row
        // somehow named an id from the other side of it.
        eq(casesTable.workspaceId, ctx.workspaceId),
      ),
    );
  return rows.map((r) => r.caseId);
}

/** The case ids the caller may see. Always workspace-filtered first. */
export async function visibleCaseIds(ctx: WorkspaceContext): Promise<number[]> {
  let ids: number[];

  if (ctx.caseScope === "own") {
    const rows = await db
      .select({ id: casesTable.id })
      .from(casesTable)
      .where(
        and(eq(casesTable.workspaceId, ctx.workspaceId), eq(casesTable.clientId, ctx.user.id)),
      );
    ids = rows.map((r) => r.id);
  } else if (ctx.caseAccessRestricted) {
    /*
     * A junior or clerk an admin has narrowed: assigned matters, plus the ones
     * granted explicitly.
     *
     * Handled before the role's own scope rather than after it, because it
     * REPLACES that scope rather than filtering it. A restricted junior's role
     * says `all`; intersecting with `all` would be a no-op and the restriction
     * would do nothing at all — which is the obvious way to write this and the
     * reason it is written this way instead.
     */
    const assigned = await db
      .select({ id: casesTable.id })
      .from(casesTable)
      .innerJoin(tasksTable, eq(tasksTable.caseId, casesTable.id))
      .where(
        and(
          eq(casesTable.workspaceId, ctx.workspaceId),
          eq(tasksTable.assigneeId, ctx.user.clerkId),
        ),
      );
    ids = [...new Set([...assigned.map((r) => r.id), ...(await grantedCaseIds(ctx))])];
  } else if (ctx.caseScope === "assigned") {
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
    ids = [...new Set(rows.map((r) => r.id))];
  } else {
    const rows = await db
      .select({ id: casesTable.id })
      .from(casesTable)
      .where(eq(casesTable.workspaceId, ctx.workspaceId));
    ids = rows.map((r) => r.id);
  }

  // An invite pinned to one matter narrows visibility to exactly that matter,
  // on top of whatever the role's own scope already computed. Intersected
  // rather than substituted: a restricted caller still cannot see a case
  // their scope would not otherwise permit, even if the ids happened to match.
  // In practice this only ever fires for a client ("own" scope, see
  // invites.ts), but checking it here rather than only where "own" is handled
  // means the guarantee holds regardless of what role ends up carrying one.
  if (ctx.restrictedCaseId != null) {
    ids = ids.filter((id) => id === ctx.restrictedCaseId);
  }

  return ids;
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
  // Same intersection as visibleCaseIds, checked here too since this is a
  // separate entry point (GET /cases/:id, and every write that loads the
  // existing row first) rather than a filter over that function's result.
  if (ctx.restrictedCaseId != null && caseId !== ctx.restrictedCaseId) return null;

  const [row] = await db
    .select()
    .from(casesTable)
    .where(and(eq(casesTable.id, caseId), eq(casesTable.workspaceId, ctx.workspaceId)));
  if (!row) return null;

  // Same rule as visibleCaseIds, and checked here too because this is a
  // separate entry point — GET /cases/:id and every write that loads the row
  // first come through here, not through the list.
  if (ctx.caseAccessRestricted) {
    const [assigned] = await db
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(and(eq(tasksTable.caseId, caseId), eq(tasksTable.assigneeId, ctx.user.clerkId)));
    if (assigned) return row;
    return (await grantedCaseIds(ctx)).includes(caseId) ? row : null;
  }

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

/**
 * May this caller use AI drafting on this matter?
 *
 * A THIRD gate, on top of `drafting.use` and the chamber's own opt-in, and it
 * is about money as much as confidentiality: a drafting request spends the
 * chamber's AI budget, and the budget is per chamber rather than per seat.
 *
 *   admin, senior advocate   chamber-wide. They direct the practice and answer
 *                            for what it spends, so the opt-in is their
 *                            decision and this adds nothing.
 *   junior advocate          only on a matter where they hold a task that was
 *                            assigned WITH drafting — `tasks.ai_allowed`.
 *                            Whoever hands out the work decides whether it
 *                            comes with AI, task by task.
 *   clerk, client            never. Neither holds `drafting.use`, so this is
 *                            belt and braces rather than the control itself.
 *
 * Row scope is checked separately and first: `getVisibleCase` decides whether
 * the matter is theirs to see at all. This decides only whether they may spend
 * on it. A restricted junior granted a matter they may READ still cannot draft
 * on it until a task on it says so.
 */
export async function mayDraftOnCase(ctx: WorkspaceContext, caseId: number): Promise<boolean> {
  if (!roleHasCapability(ctx.role, "drafting.use")) return false;

  // Chamber-wide tiers. Checked by capability rather than by naming the roles,
  // so a matrix change moves this with it instead of leaving a second list to
  // keep in step.
  if (roleHasCapability(ctx.role, "tasks.write")) return true;

  const [granted] = await db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .innerJoin(casesTable, eq(casesTable.id, tasksTable.caseId))
    .where(
      and(
        eq(tasksTable.caseId, caseId),
        eq(tasksTable.assigneeId, ctx.user.clerkId),
        eq(tasksTable.aiAllowed, true),
        // Joined through `cases` so a task naming a matter in another chamber
        // grants nothing, the same discipline as `grantedCaseIds` above.
        eq(casesTable.workspaceId, ctx.workspaceId),
      ),
    );
  return Boolean(granted);
}
