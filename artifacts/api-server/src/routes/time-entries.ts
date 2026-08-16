import { Router, type IRouter } from "express";
import { and, desc, eq, isNotNull, isNull, inArray } from "drizzle-orm";
import { db, timeEntriesTable, casesTable } from "@workspace/db";
import {
  CreateTimeEntryBody,
  ListTimeEntriesQueryParams,
  DeleteTimeEntryParams,
  StartTimerBody,
} from "@workspace/api-zod";
import {
  requireWorkspace,
  requireCapability,
  ctx,
  type AuthRequest,
} from "../middlewares/requireAuth";
import { getVisibleCase, visibleCaseIds } from "../lib/scope";
import { zodMessage } from "../lib/validation";

const router: IRouter = Router();

/** Whole minutes elapsed since a timer started. Never negative. */
function elapsedMinutes(startedAt: Date): number {
  return Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 60_000));
}

type EntryRow = typeof timeEntriesTable.$inferSelect;

/** The wire shape. Carries the matter title so a list needs no second request. */
function view(entry: EntryRow, caseTitle: string) {
  return {
    id: entry.id,
    caseId: entry.caseId,
    caseTitle,
    userId: entry.userId,
    userName: entry.userName,
    workDate: entry.workDate,
    minutes: entry.minutes,
    description: entry.description,
    billable: entry.billable,
    startedAt: entry.startedAt ? entry.startedAt.toISOString() : null,
    createdAt: entry.createdAt.toISOString(),
  };
}

async function titlesFor(caseIds: number[]): Promise<Map<number, string>> {
  if (caseIds.length === 0) return new Map();
  const rows = await db
    .select({ id: casesTable.id, title: casesTable.title })
    .from(casesTable)
    .where(inArray(casesTable.id, caseIds));
  return new Map(rows.map((r) => [r.id, r.title]));
}

/**
 * Time logged on matters the caller can see.
 *
 * Scoped twice: `visibleCaseIds` applies the caller's row scope (a clerk sees
 * only matters they hold a task on), and the workspace filter is applied on top.
 * A time entry is never readable across a tenant boundary.
 */
router.get(
  "/time-entries",
  requireWorkspace,
  requireCapability("time.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const params = ListTimeEntriesQueryParams.safeParse(req.query);
    if (!params.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(params.error) });
      return;
    }

    const allowed = await visibleCaseIds(c);
    if (allowed.length === 0) {
      res.json([]);
      return;
    }

    const caseFilter = params.data.caseId
      ? allowed.filter((id) => id === Number(params.data.caseId))
      : allowed;
    if (caseFilter.length === 0) {
      res.json([]);
      return;
    }

    const rows = await db
      .select()
      .from(timeEntriesTable)
      .where(
        and(
          eq(timeEntriesTable.workspaceId, c.workspaceId),
          inArray(timeEntriesTable.caseId, caseFilter),
          // A running timer is not a logged entry yet — it has no minutes.
          isNull(timeEntriesTable.startedAt),
        ),
      )
      .orderBy(desc(timeEntriesTable.workDate), desc(timeEntriesTable.id));

    const titles = await titlesFor([...new Set(rows.map((r) => r.caseId))]);
    res.json(rows.map((r) => view(r, titles.get(r.caseId) ?? "")));
  },
);

/** Log time after the fact. The common path — most people write it up later. */
router.post(
  "/time-entries",
  requireWorkspace,
  requireCapability("time.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const parsed = CreateTimeEntryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(parsed.error) });
      return;
    }

    // Membership of the matter is re-checked here, not taken from the body.
    const matter = await getVisibleCase(c, parsed.data.caseId);
    if (!matter) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const [row] = await db
      .insert(timeEntriesTable)
      .values({
        workspaceId: c.workspaceId,
        caseId: matter.id,
        userId: c.user.id,
        clerkId: c.user.clerkId,
        userName: c.user.displayName,
        workDate: parsed.data.workDate,
        minutes: parsed.data.minutes,
        description: parsed.data.description?.trim() || null,
        billable: parsed.data.billable ?? true,
      })
      .returning();

    res.status(201).json(view(row, matter.title));
  },
);

/** The caller's running timer, or null. */
router.get(
  "/time-entries/timer",
  requireWorkspace,
  requireCapability("time.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const [running] = await db
      .select()
      .from(timeEntriesTable)
      .where(
        and(
          eq(timeEntriesTable.workspaceId, c.workspaceId),
          eq(timeEntriesTable.userId, c.user.id),
          isNotNull(timeEntriesTable.startedAt),
        ),
      );

    if (!running?.startedAt) {
      res.json(null);
      return;
    }

    const titles = await titlesFor([running.caseId]);
    res.json({
      id: running.id,
      caseId: running.caseId,
      caseTitle: titles.get(running.caseId) ?? "",
      startedAt: running.startedAt.toISOString(),
      elapsedMinutes: elapsedMinutes(running.startedAt),
    });
  },
);

/**
 * Start a timer.
 *
 * One per person, enforced by banking any timer already running before opening
 * the new one. The alternative — refusing, or allowing two — either blocks
 * somebody who forgot to stop yesterday's, or double-counts their day.
 */
router.post(
  "/time-entries/timer",
  requireWorkspace,
  requireCapability("time.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const parsed = StartTimerBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(parsed.error) });
      return;
    }

    const matter = await getVisibleCase(c, parsed.data.caseId);
    if (!matter) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const started = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(timeEntriesTable)
        .where(
          and(
            eq(timeEntriesTable.workspaceId, c.workspaceId),
            eq(timeEntriesTable.userId, c.user.id),
            isNotNull(timeEntriesTable.startedAt),
          ),
        );

      if (existing?.startedAt) {
        const banked = elapsedMinutes(existing.startedAt);
        if (banked > 0) {
          await tx
            .update(timeEntriesTable)
            .set({ minutes: banked, startedAt: null })
            .where(eq(timeEntriesTable.id, existing.id));
        } else {
          // Started and stopped inside the same minute — nothing worth keeping.
          await tx.delete(timeEntriesTable).where(eq(timeEntriesTable.id, existing.id));
        }
      }

      const [row] = await tx
        .insert(timeEntriesTable)
        .values({
          workspaceId: c.workspaceId,
          caseId: matter.id,
          userId: c.user.id,
          clerkId: c.user.clerkId,
          userName: c.user.displayName,
          // Local calendar day, so an entry started at 23:50 is not filed as
          // tomorrow for a reader in a different offset.
          workDate: new Date().toISOString().slice(0, 10),
          minutes: 0,
          billable: true,
          startedAt: new Date(),
        })
        .returning();
      return row;
    });

    res.status(201).json({
      id: started.id,
      caseId: started.caseId,
      caseTitle: matter.title,
      startedAt: started.startedAt!.toISOString(),
      elapsedMinutes: 0,
    });
  },
);

/** Stop the running timer and bank its minutes. */
router.delete(
  "/time-entries/timer",
  requireWorkspace,
  requireCapability("time.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const [running] = await db
      .select()
      .from(timeEntriesTable)
      .where(
        and(
          eq(timeEntriesTable.workspaceId, c.workspaceId),
          eq(timeEntriesTable.userId, c.user.id),
          isNotNull(timeEntriesTable.startedAt),
        ),
      );

    if (!running?.startedAt) {
      res.status(404).json({ error: "No timer running" });
      return;
    }

    // Floor, but never zero: stopping after 40 seconds should record a minute of
    // work rather than silently discarding it.
    const minutes = Math.max(1, elapsedMinutes(running.startedAt));
    const [stopped] = await db
      .update(timeEntriesTable)
      .set({ minutes, startedAt: null })
      .where(eq(timeEntriesTable.id, running.id))
      .returning();

    const titles = await titlesFor([stopped.caseId]);
    res.json(view(stopped, titles.get(stopped.caseId) ?? ""));
  },
);

/**
 * Delete an entry.
 *
 * Only your own, unless you are an admin. Someone else's record of their work is
 * not yours to remove, and this feeds the chamber's performance figures.
 */
router.delete(
  "/time-entries/:id",
  requireWorkspace,
  requireCapability("time.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const params = DeleteTimeEntryParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(params.error) });
      return;
    }

    const [row] = await db
      .select()
      .from(timeEntriesTable)
      .where(
        and(
          eq(timeEntriesTable.id, params.data.id),
          eq(timeEntriesTable.workspaceId, c.workspaceId),
        ),
      );

    if (!row) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    if (row.userId !== c.user.id && c.role !== "admin") {
      res.status(403).json({
        error: "Forbidden",
        reason: "not_your_entry",
        message: "You can only delete time you logged yourself.",
      });
      return;
    }

    await db.delete(timeEntriesTable).where(eq(timeEntriesTable.id, row.id));
    res.status(204).end();
  },
);

export default router;
