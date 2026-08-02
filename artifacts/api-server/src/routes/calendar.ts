import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, calendarEntriesTable, casesTable, audienceIncludes } from "@workspace/db";
import {
  ListCalendarEntriesResponse,
  CreateCalendarEntryBody,
  CreateCalendarEntryResponse,
} from "@workspace/api-zod";
import { requireWorkspace, requireCapability, ctx, type AuthRequest } from "../middlewares/requireAuth";
import { caseInWorkspace } from "../lib/scope";
import { displayRole } from "../lib/permissions";

const router: IRouter = Router();

/**
 * The master calendar.
 *
 * One table serves every portal, because an entry carries an audience rather
 * than being duplicated per role. The filter is applied here, server-side, on
 * the caller's verified role and id — a client asking for the calendar simply
 * does not receive staff notices, rather than receiving them and being trusted
 * to hide them.
 */
function audienceLabel(audience: string): string {
  if (audience === "all") return "Everyone";
  if (audience === "staff") return "Chamber staff";
  if (audience.startsWith("role:")) return displayRole(audience.slice(5));
  if (audience.startsWith("user:")) return "One person";
  return audience;
}

async function view(entry: typeof calendarEntriesTable.$inferSelect) {
  let caseTitle: string | null = null;
  if (entry.caseId) {
    const [c] = await db.select().from(casesTable).where(eq(casesTable.id, entry.caseId));
    caseTitle = c?.title ?? null;
  }
  return {
    ...entry,
    caseTitle,
    audienceLabel: audienceLabel(entry.audience),
    createdByRole: entry.createdByRole ? displayRole(entry.createdByRole) : null,
  };
}

router.get("/calendar", requireWorkspace, requireCapability("calendar.read"), async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);

  const rows = await db
    .select()
    .from(calendarEntriesTable)
    .where(eq(calendarEntriesTable.workspaceId, c.workspaceId));

  const visible = rows.filter((r) => audienceIncludes(r.audience, c.role, c.user.clerkId));
  res.json(ListCalendarEntriesResponse.parse(await Promise.all(visible.map(view))));
});

/**
 * Posting an update is `calendar.write` — held by Admin and Senior Advocate
 * only, the same pair that may assign work. Everyone else reads.
 */
router.post("/calendar", requireWorkspace, requireCapability("calendar.write"), async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);

  const parsed = CreateCalendarEntryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  if (parsed.data.caseId != null && !(await caseInWorkspace(c, parsed.data.caseId))) {
    res.status(404).json({ error: "Matter not found" });
    return;
  }

  const [created] = await db.insert(calendarEntriesTable).values({
    // From the verified context, never the body — otherwise an entry could be
    // planted on another chamber's calendar.
    workspaceId: c.workspaceId,
    title: parsed.data.title,
    notes: parsed.data.notes ?? null,
    kind: parsed.data.kind ?? "note",
    entryDate: String(parsed.data.entryDate).slice(0, 10),
    entryTime: parsed.data.entryTime ?? null,
    caseId: parsed.data.caseId ?? null,
    audience: parsed.data.audience ?? "all",
    createdBy: c.user.displayName,
    createdByRole: c.role,
    createdByClerkId: c.user.clerkId,
  }).returning();

  res.status(201).json(CreateCalendarEntryResponse.parse(await view(created)));
});

router.delete("/calendar/:id", requireWorkspace, requireCapability("calendar.write"), async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [deleted] = await db
    .delete(calendarEntriesTable)
    .where(and(eq(calendarEntriesTable.id, id), eq(calendarEntriesTable.workspaceId, c.workspaceId)))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Entry not found" }); return; }
  res.sendStatus(204);
});

export default router;
