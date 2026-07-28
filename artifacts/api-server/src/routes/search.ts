import { Router, type IRouter } from "express";
import { ilike, or, eq, inArray } from "drizzle-orm";
import { db, casesTable, tasksTable, consultationsTable, usersTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { getOrCreateUser } from "../lib/jit";

const router: IRouter = Router();

router.get("/search", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) {
    res.json({ cases: [], tasks: [], consultations: [], clients: [] });
    return;
  }
  const pattern = `%${q}%`;
  const isClient = user.role === "client";

  // Clients only search their own matters; never other users.
  let caseIds: number[] | null = null;
  if (isClient) {
    const ownCases = await db.select({ id: casesTable.id }).from(casesTable).where(eq(casesTable.clientId, user.id));
    caseIds = ownCases.map(c => c.id);
    if (caseIds.length === 0) {
      res.json({ cases: [], tasks: [], consultations: [], clients: [] });
      return;
    }
  }

  const caseRows = await db.select().from(casesTable)
    .where(
      isClient
        ? inArray(casesTable.id, caseIds!)
        : or(ilike(casesTable.title, pattern), ilike(casesTable.description, pattern))
    )
    .limit(6);

  const filteredCases = isClient
    ? caseRows.filter(c => ilikeMatch(c.title, q) || ilikeMatch(c.description ?? "", q))
    : caseRows;

  const taskRows = await db.select().from(tasksTable)
    .where(
      isClient
        ? inArray(tasksTable.caseId, caseIds!)
        : or(ilike(tasksTable.title, pattern), ilike(tasksTable.description, pattern))
    )
    .limit(6);

  const filteredTasks = isClient
    ? taskRows.filter(t => ilikeMatch(t.title, q) || ilikeMatch(t.description ?? "", q))
    : taskRows;

  const consultRows = await db.select().from(consultationsTable)
    .where(
      isClient
        ? inArray(consultationsTable.caseId, caseIds!)
        : ilike(consultationsTable.title, pattern)
    )
    .limit(6);

  const filteredConsults = isClient
    ? consultRows.filter(c => ilikeMatch(c.title, q))
    : consultRows;

  const userRows = isClient
    ? []
    : await db.select().from(usersTable)
        .where(or(ilike(usersTable.displayName, pattern), ilike(usersTable.email, pattern)))
        .limit(6);

  res.json({
    cases: filteredCases.map(c => ({ id: c.id, title: c.title, subtitle: `Case · ${c.status}` })),
    tasks: filteredTasks.map(t => ({ id: t.id, title: t.title, subtitle: `Task · due ${t.deadline}` })),
    consultations: filteredConsults.map(c => ({ id: c.id, title: c.title, subtitle: `Consultation · ${c.status}` })),
    clients: userRows.map(u => ({ id: u.id, title: u.displayName, subtitle: u.role })),
  });
});

function ilikeMatch(value: string, q: string): boolean {
  return value.toLowerCase().includes(q.toLowerCase());
}

export default router;
