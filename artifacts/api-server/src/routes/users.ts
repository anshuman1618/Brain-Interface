import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  GetMeResponse,
  UpdateMeBody,
  UpdateMeResponse,
  ListUsersQueryParams,
  ListUsersResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
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

router.get("/users", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const params = ListUsersQueryParams.safeParse(req.query);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  let query = db.select().from(usersTable).$dynamic();
  if (params.data.role) {
    query = query.where(eq(usersTable.role, params.data.role));
  }
  const users = await query;
  res.json(ListUsersResponse.parse(users));
});

export default router;
