import { Router, type IRouter } from "express";
import { eq, and, asc, inArray } from "drizzle-orm";
import { db, usersTable, workspaceMembershipsTable } from "@workspace/db";
import {
  GetMeResponse,
  UpdateMeBody,
  UpdateMeResponse,
  ListUsersQueryParams,
  ListUsersResponse,
} from "@workspace/api-zod";
import {
  requireAuth,
  requireWorkspace,
  ctx,
  type AuthRequest,
} from "../middlewares/requireAuth";
import { getOrCreateUser } from "../lib/jit";

const router: IRouter = Router();

// Identity only — carries no authorization. What the caller may reach comes from
// GET /session, which is derived from membership rows. Behind requireAuth rather
// than requireWorkspace so a pending user can still see their own name.
router.get("/users/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  res.json(GetMeResponse.parse(user));
});

router.patch("/users/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = UpdateMeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [updated] = await db.update(usersTable)
    .set({ displayName: parsed.data.displayName ?? user.displayName })
    .where(eq(usersTable.id, user.id))
    .returning();

  res.json(UpdateMeResponse.parse(updated));
});

/**
 * The user directory, scoped to the caller's workspace.
 *
 * This used to return every user in the database, which leaked the client list
 * of one chamber to another. Membership rows are the filter: you can only see
 * people who are active members of the workspace you are currently in, and the
 * role reported is their role *there*.
 */
router.get("/users", requireWorkspace, async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);

  const params = ListUsersQueryParams.safeParse(req.query);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const conditions = [
    eq(workspaceMembershipsTable.workspaceId, c.workspaceId),
    eq(workspaceMembershipsTable.status, "active"),
  ];
  if (params.data.role) {
    conditions.push(eq(workspaceMembershipsTable.role, params.data.role));
  }

  const memberships = await db
    .select({ userId: workspaceMembershipsTable.userId, role: workspaceMembershipsTable.role })
    .from(workspaceMembershipsTable)
    .where(and(...conditions));

  if (memberships.length === 0) { res.json([]); return; }

  const roleByUserId = new Map(memberships.map((m) => [m.userId, m.role]));
  const rows = await db
    .select()
    .from(usersTable)
    .where(inArray(usersTable.id, [...roleByUserId.keys()]))
    .orderBy(asc(usersTable.id));

  res.json(
    ListUsersResponse.parse(
      rows.map((u) => ({ ...u, role: roleByUserId.get(u.id) ?? u.role })),
    ),
  );
});

export default router;
