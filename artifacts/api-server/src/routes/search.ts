import { Router, type IRouter } from "express";
import { and, ilike, or, inArray, eq } from "drizzle-orm";
import {
  db,
  casesTable,
  consultationsTable,
  usersTable,
  workspaceMembershipsTable,
} from "@workspace/db";
import { requireWorkspace, ctx, type AuthRequest } from "../middlewares/requireAuth";
import { visibleCaseIds, visibleTasks } from "../lib/scope";
import { roleHasCapability } from "../lib/permissions";

const router: IRouter = Router();

/**
 * Global search, bounded by the same scope as the collections it searches.
 *
 * Search is an easy place to leak a tenant: an unscoped ILIKE over every table
 * happily returns another chamber's case titles and staff directory. Everything
 * here starts from the caller's visible case ids and, for people, from active
 * membership rows in the current workspace.
 */
router.get("/search", requireWorkspace, async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);

  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) {
    res.json({ cases: [], tasks: [], consultations: [], clients: [] });
    return;
  }
  const pattern = `%${q}%`;

  const allowedCaseIds = await visibleCaseIds(c);
  if (allowedCaseIds.length === 0) {
    res.json({ cases: [], tasks: [], consultations: [], clients: [] });
    return;
  }

  const caseRows = await db
    .select()
    .from(casesTable)
    .where(
      and(
        inArray(casesTable.id, allowedCaseIds),
        or(ilike(casesTable.title, pattern), ilike(casesTable.description, pattern)),
      ),
    )
    .limit(6);

  const scopedTasks = await visibleTasks(c);
  const taskRows = scopedTasks
    .filter((t) => matches(t.title, q) || matches(t.description ?? "", q))
    .slice(0, 6);

  const consultRows = await db
    .select()
    .from(consultationsTable)
    .where(
      and(
        inArray(consultationsTable.caseId, allowedCaseIds),
        ilike(consultationsTable.title, pattern),
      ),
    )
    .limit(6);

  // People search is a directory read — gated on the same capability as the
  // directory endpoint, and restricted to members of this workspace.
  const canSeeDirectory = roleHasCapability(c.role, "cases.write");
  const userRows = canSeeDirectory
    ? await db
        .select({ user: usersTable, role: workspaceMembershipsTable.role })
        .from(workspaceMembershipsTable)
        .innerJoin(usersTable, eq(usersTable.id, workspaceMembershipsTable.userId))
        .where(
          and(
            eq(workspaceMembershipsTable.workspaceId, c.workspaceId),
            eq(workspaceMembershipsTable.status, "active"),
            or(ilike(usersTable.displayName, pattern), ilike(usersTable.email, pattern)),
          ),
        )
        .limit(6)
    : [];

  res.json({
    cases: caseRows.map((row) => ({
      id: row.id,
      title: row.title,
      subtitle: `Case · ${row.status}`,
    })),
    tasks: taskRows.map((t) => ({
      id: t.id,
      title: t.title,
      subtitle: `Task · due ${t.deadline}`,
    })),
    consultations: consultRows.map((row) => ({
      id: row.id,
      title: row.title,
      subtitle: `Consultation · ${row.status}`,
    })),
    clients: userRows.map((r) => ({ id: r.user.id, title: r.user.displayName, subtitle: r.role })),
  });
});

function matches(value: string, q: string): boolean {
  return value.toLowerCase().includes(q.toLowerCase());
}

export default router;
