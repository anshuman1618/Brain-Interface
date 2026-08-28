import { guardIdParams, parseId } from "../lib/validation";
import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

// Every :id on this router must be a real int4 before it reaches a query.
guardIdParams(router, "id");

router.get("/notifications", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, req.userId!))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);
  res.json(rows);
});

router.post(
  "/notifications/:id/read",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const id = parseId(req.params["id"]);
    if (id === null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [row] = await db
      .update(notificationsTable)
      .set({ read: true })
      .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, req.userId!)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json(row);
  },
);

router.post(
  "/notifications/read-all",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const rows = await db
      .update(notificationsTable)
      .set({ read: true })
      .where(and(eq(notificationsTable.userId, req.userId!), eq(notificationsTable.read, false)))
      .returning();
    res.json({ updated: rows.length });
  },
);

export default router;
