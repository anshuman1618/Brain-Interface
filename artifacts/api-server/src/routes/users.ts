import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import {
  GetMeResponse,
  UpdateMeBody,
  UpdateMeResponse,
  ListUsersQueryParams,
  ListUsersResponse,
  SelectRoleBody,
  SelectRoleResponse,
  UpdateUserRoleBody,
  UpdateUserRoleResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/requireAuth";
import { getOrCreateUser } from "../lib/jit";

const router: IRouter = Router();

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

// Self-service, one-time role selection shown right after sign-up. Once
// roleSelected is true, only an admin can change the role (see PATCH below).
router.post("/users/me/role", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (user.roleSelected) {
    res.status(409).json({ error: "Role already selected. Ask an admin to change it." });
    return;
  }

  const parsed = SelectRoleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [updated] = await db.update(usersTable)
    .set({ role: parsed.data.role, roleSelected: true })
    .where(eq(usersTable.id, user.id))
    .returning();

  await clerkClient.users.updateUserMetadata(user.clerkId, {
    publicMetadata: { role: parsed.data.role },
  });

  res.json(SelectRoleResponse.parse(updated));
});

// Admin-only: change any user's role after the fact.
router.patch("/users/:id/role", requireRole("admin"), async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid user id" }); return; }

  const parsed = UpdateUserRoleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!existing) { res.status(404).json({ error: "User not found" }); return; }

  const [updated] = await db.update(usersTable)
    .set({ role: parsed.data.role, roleSelected: true })
    .where(eq(usersTable.id, id))
    .returning();

  await clerkClient.users.updateUserMetadata(existing.clerkId, {
    publicMetadata: { role: parsed.data.role },
  });

  res.json(UpdateUserRoleResponse.parse(updated));
});

router.get("/users", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const params = ListUsersQueryParams.safeParse(req.query);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  let query = db.select().from(usersTable).$dynamic();
  if (params.data.role) {
    query = query.where(eq(usersTable.role, params.data.role));
  }
  const users = await query.orderBy(asc(usersTable.id));
  res.json(ListUsersResponse.parse(users));
});

export default router;
