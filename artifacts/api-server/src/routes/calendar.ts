import { guardIdParams, parseId } from "../lib/validation";
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, calendarEntriesTable, casesTable, usersTable, audienceIncludes } from "@workspace/db";
import {
  ListCalendarEntriesResponse,
  CreateCalendarEntryBody,
  CreateCalendarEntryResponse,
  UpdateCalendarEntryBody,
  UpdateCalendarEntryResponse,
} from "@workspace/api-zod";
import {
  requireWorkspace,
  requireCapability,
  findActiveMembership,
  ctx,
  type AuthRequest,
  type WorkspaceContext,
} from "../middlewares/requireAuth";
import { caseInWorkspace, visibleCaseIds } from "../lib/scope";
import { displayRole, isWorkspaceRole } from "../lib/permissions";

const router: IRouter = Router();

// Every :id on this router must be a real int4 before it reaches a query.
guardIdParams(router, "id");

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

/**
 * Reject an audience that `audienceIncludes` would silently hide from everyone.
 *
 * `audienceIncludes` fails closed by design — an unrecognised value matches
 * nobody, rather than defaulting to visible. That is the right default for a
 * READ, but on a WRITE it turned an admin's typo (`"firm"` instead of `"all"`)
 * into a 201 for an entry nobody would ever see: no error, no warning, just a
 * hearing that silently existed for no one.
 *
 * `role:` and `user:` are checked against real data, not just their shape —
 * `role:advocate` (not a role; the real ones are `senior_advocate` /
 * `junior_advocate`) and `user:` naming someone outside the workspace are the
 * same failure mode as the typo that motivated this.
 *
 * Returns null when the audience is fine, or the message to show otherwise.
 */
async function audienceError(c: WorkspaceContext, audience: string): Promise<string | null> {
  if (audience === "all" || audience === "staff") return null;

  if (audience.startsWith("role:")) {
    const role = audience.slice(5);
    if (!isWorkspaceRole(role)) {
      return `"${role}" is not a role in this chamber.`;
    }
    return null;
  }

  if (audience.startsWith("user:")) {
    const clerkId = audience.slice(5);
    const [target] = clerkId
      ? await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId))
      : [];
    if (!target || !(await findActiveMembership(target.id, c.workspaceId))) {
      return "That person is not an active member of this workspace.";
    }
    return null;
  }

  return 'Audience must be "all", "staff", "role:<role>", or "user:<id>".';
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

router.get(
  "/calendar",
  requireWorkspace,
  requireCapability("calendar.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const rows = await db
      .select()
      .from(calendarEntriesTable)
      .where(eq(calendarEntriesTable.workspaceId, c.workspaceId));

    /*
     * Two filters, and they answer different questions.
     *
     * `audienceIncludes` asks who an entry was addressed to. Row scope asks
     * which matters this member may see at all — and until case-access grants
     * existed the two never disagreed, because everybody who could read the
     * calendar could also read every matter. Now they do disagree: a junior
     * narrowed to two matters was still served every hearing in the chamber,
     * with the matter's name in the title.
     *
     * An entry with no `caseId` is chamber-wide — a firm meeting, a holiday —
     * and belongs to nobody's matter, so it stays. Only entries pinned to a
     * matter are scoped by it.
     */
    const allowed = new Set(await visibleCaseIds(c));
    const visible = rows.filter(
      (r) =>
        audienceIncludes(r.audience, c.role, c.user.clerkId) &&
        (r.caseId === null || allowed.has(r.caseId)),
    );
    res.json(ListCalendarEntriesResponse.parse(await Promise.all(visible.map(view))));
  },
);

/**
 * Posting an update is `calendar.write` — held by Admin and Senior Advocate
 * only, the same pair that may assign work. Everyone else reads.
 */
router.post(
  "/calendar",
  requireWorkspace,
  requireCapability("calendar.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const parsed = CreateCalendarEntryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    if (parsed.data.caseId != null && !(await caseInWorkspace(c, parsed.data.caseId))) {
      res.status(404).json({ error: "Matter not found" });
      return;
    }

    const audience = parsed.data.audience ?? "all";
    const audienceProblem = await audienceError(c, audience);
    if (audienceProblem) {
      res.status(400).json({ error: "invalid_audience", message: audienceProblem });
      return;
    }

    const [created] = await db
      .insert(calendarEntriesTable)
      .values({
        // From the verified context, never the body — otherwise an entry could be
        // planted on another chamber's calendar.
        workspaceId: c.workspaceId,
        title: parsed.data.title,
        notes: parsed.data.notes ?? null,
        kind: parsed.data.kind ?? "note",
        entryDate: String(parsed.data.entryDate).slice(0, 10),
        entryTime: parsed.data.entryTime ?? null,
        caseId: parsed.data.caseId ?? null,
        audience,
        createdBy: c.user.displayName,
        createdByRole: c.role,
        createdByClerkId: c.user.clerkId,
      })
      .returning();

    res.status(201).json(CreateCalendarEntryResponse.parse(await view(created)));
  },
);

/**
 * Edit or move an entry — this is what a drag on the calendar grid becomes.
 * Scoped to the workspace on the WHERE clause, so an id from another chamber
 * matches nothing rather than being edited.
 */
router.patch(
  "/calendar/:id",
  requireWorkspace,
  requireCapability("calendar.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const id = parseId(req.params["id"]);
    if (id === null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const parsed = UpdateCalendarEntryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [existing] = await db
      .select()
      .from(calendarEntriesTable)
      .where(
        and(eq(calendarEntriesTable.id, id), eq(calendarEntriesTable.workspaceId, c.workspaceId)),
      );
    if (!existing) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }

    if (parsed.data.caseId != null && !(await caseInWorkspace(c, parsed.data.caseId))) {
      res.status(404).json({ error: "Matter not found" });
      return;
    }

    if (parsed.data.audience != null) {
      const audienceProblem = await audienceError(c, parsed.data.audience);
      if (audienceProblem) {
        res.status(400).json({ error: "invalid_audience", message: audienceProblem });
        return;
      }
    }

    const update: Partial<typeof calendarEntriesTable.$inferSelect> = {};
    if (parsed.data.title != null) update.title = parsed.data.title;
    if (parsed.data.notes != null) update.notes = parsed.data.notes;
    if (parsed.data.kind != null) update.kind = parsed.data.kind;
    if (parsed.data.entryDate != null)
      update.entryDate = String(parsed.data.entryDate).slice(0, 10);
    // An explicit empty time clears it, turning a timed entry back into all-day.
    if (parsed.data.entryTime !== undefined) update.entryTime = parsed.data.entryTime || null;
    if (parsed.data.caseId != null) update.caseId = parsed.data.caseId;
    if (parsed.data.audience != null) update.audience = parsed.data.audience;

    const [updated] = await db
      .update(calendarEntriesTable)
      .set(update)
      .where(eq(calendarEntriesTable.id, id))
      .returning();

    res.json(UpdateCalendarEntryResponse.parse(await view(updated)));
  },
);

router.delete(
  "/calendar/:id",
  requireWorkspace,
  requireCapability("calendar.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const id = parseId(req.params["id"]);
    if (id === null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [deleted] = await db
      .delete(calendarEntriesTable)
      .where(
        and(eq(calendarEntriesTable.id, id), eq(calendarEntriesTable.workspaceId, c.workspaceId)),
      )
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    res.sendStatus(204);
  },
);

export default router;
