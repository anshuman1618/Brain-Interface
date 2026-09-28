import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db, caseProceedingsTable, isProceedingKind } from "@workspace/db";
import {
  ListCaseProceedingsParams,
  ListCaseProceedingsResponse,
  CreateCaseProceedingParams,
  CreateCaseProceedingBody,
  CreateCaseProceedingResponse,
  UpdateCaseProceedingParams,
  UpdateCaseProceedingBody,
  UpdateCaseProceedingResponse,
  DeleteCaseProceedingParams,
} from "@workspace/api-zod";
import {
  requireWorkspace,
  requireCapability,
  ctx,
  type AuthRequest,
} from "../middlewares/requireAuth";
import type { WorkspaceContext } from "../middlewares/requireAuth";
import { getVisibleCase } from "../lib/scope";
import { addTimelineEvent } from "../lib/timeline";
import { zodMessage } from "../lib/validation";
import { isKnownStatus, statusLabelFor, DEFAULT_STATUS } from "../lib/case-statuses";
import { forumGroupFor, isKnownStage, stageLabelFor } from "../lib/case-stages";
import { recordAudit } from "../lib/audit";
import { personName } from "../lib/person-name";

/**
 * Proceedings under a matter.
 *
 * ── The one security rule, and it is inherited ────────────────────────────
 *
 * A proceeding has no visibility of its own. Every handler here loads the
 * MATTER through `getVisibleCase` first and answers 404 if that returns null —
 * so a junior narrowed away from a matter, or a client pinned elsewhere,
 * cannot reach its proceedings either, and does not learn one exists.
 *
 * Nothing in this file filters on `case_proceedings.id` to establish access.
 * The id is used only to find the row once the matter has already been proved
 * visible, and every query is additionally bounded by `caseId` so a
 * proceeding id belonging to another matter cannot be steered into this one.
 */

const router: IRouter = Router();

/** Resolve the two vocabularies for display, the same way `enrichCase` does. */
async function enrich(c: WorkspaceContext, row: typeof caseProceedingsTable.$inferSelect) {
  const matter = await getVisibleCase(c, row.caseId);
  const statusLabel = await statusLabelFor(c.workspaceId, row.status);
  const stageLabel = matter
    ? await stageLabelFor(c.workspaceId, forumGroupFor(matter), row.stage)
    : row.stage;
  return { ...row, statusLabel, stageLabel };
}

/**
 * Validate the status and stage against the chamber's own lists.
 *
 * Shared by create and update because both accept them, and because a
 * proceeding carrying a status no chip will ever show is exactly the failure
 * the matter-level check exists to prevent.
 */
async function checkVocabulary(
  c: WorkspaceContext,
  matter: NonNullable<Awaited<ReturnType<typeof getVisibleCase>>>,
  input: {
    kind?: string | undefined;
    status?: string | undefined;
    stage?: string | null | undefined;
  },
): Promise<{ ok: true } | { ok: false; error: string; message: string }> {
  if (input.kind != null && !isProceedingKind(input.kind)) {
    return {
      ok: false,
      error: "invalid_request",
      message: `"${input.kind}" is not a kind of proceeding.`,
    };
  }
  if (input.status != null && !(await isKnownStatus(c.workspaceId, input.status))) {
    return {
      ok: false,
      error: "unknown_status",
      message: `"${input.status}" is not a status on this chamber's list.`,
    };
  }
  if (
    input.stage != null &&
    !(await isKnownStage(c.workspaceId, forumGroupFor(matter), input.stage))
  ) {
    return {
      ok: false,
      error: "unknown_stage",
      message: `"${input.stage}" is not a stage on this matter's list.`,
    };
  }
  return { ok: true };
}

router.get(
  "/cases/:caseId/proceedings",
  requireWorkspace,
  requireCapability("cases.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const params = ListCaseProceedingsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const matter = await getVisibleCase(c, params.data.caseId);
    if (!matter) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const rows = await db
      .select()
      .from(caseProceedingsTable)
      .where(
        and(
          eq(caseProceedingsTable.caseId, matter.id),
          eq(caseProceedingsTable.workspaceId, c.workspaceId),
        ),
      )
      .orderBy(asc(caseProceedingsTable.createdAt), asc(caseProceedingsTable.id));

    res.json(ListCaseProceedingsResponse.parse(await Promise.all(rows.map((r) => enrich(c, r)))));
  },
);

router.post(
  "/cases/:caseId/proceedings",
  requireWorkspace,
  requireCapability("cases.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const params = CreateCaseProceedingParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = CreateCaseProceedingBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(body.error) });
      return;
    }

    const matter = await getVisibleCase(c, params.data.caseId);
    if (!matter) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const bad = await checkVocabulary(c, matter, body.data);
    if (!bad.ok) {
      res.status(400).json({ error: bad.error, message: bad.message });
      return;
    }

    const [created] = await db
      .insert(caseProceedingsTable)
      .values({
        // From the verified context and the matter, never the body — the same
        // discipline as every other create in this codebase.
        workspaceId: c.workspaceId,
        caseId: matter.id,
        title: body.data.title.trim(),
        kind: body.data.kind ?? "application",
        status: body.data.status ?? DEFAULT_STATUS,
        stage: body.data.stage ?? null,
        filingRef: body.data.filingRef?.trim() || null,
        filedOn: body.data.filedOn ?? null,
        note: body.data.note?.trim() || null,
        createdBy: personName(c.user),
      })
      .returning();

    await addTimelineEvent(
      matter.id,
      "proceeding_opened",
      `${created!.kind} opened: "${created!.title}"${created!.filingRef ? ` (${created!.filingRef})` : ""}`,
      personName(c.user),
    );

    res.status(201).json(CreateCaseProceedingResponse.parse(await enrich(c, created!)));
  },
);

router.patch(
  "/cases/:caseId/proceedings/:proceedingId",
  requireWorkspace,
  requireCapability("cases.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const params = UpdateCaseProceedingParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = UpdateCaseProceedingBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(body.error) });
      return;
    }

    const matter = await getVisibleCase(c, params.data.caseId);
    if (!matter) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    // Bounded by caseId as well as id: a proceeding id from another matter —
    // one this caller may not see — must not be reachable by naming a matter
    // they may.
    const [existing] = await db
      .select()
      .from(caseProceedingsTable)
      .where(
        and(
          eq(caseProceedingsTable.id, params.data.proceedingId),
          eq(caseProceedingsTable.caseId, matter.id),
          eq(caseProceedingsTable.workspaceId, c.workspaceId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Proceeding not found" });
      return;
    }

    const bad = await checkVocabulary(c, matter, body.data);
    if (!bad.ok) {
      res.status(400).json({ error: bad.error, message: bad.message });
      return;
    }

    const update: Partial<typeof caseProceedingsTable.$inferSelect> = {};
    if (body.data.title != null) update.title = body.data.title.trim();
    if (body.data.kind != null) update.kind = body.data.kind;
    if (body.data.status != null) update.status = body.data.status;
    if (body.data.stage !== undefined) update.stage = body.data.stage;
    if (body.data.filingRef != null) update.filingRef = body.data.filingRef.trim() || null;
    if (body.data.filedOn !== undefined) update.filedOn = body.data.filedOn;
    if (body.data.decidedOn !== undefined) update.decidedOn = body.data.decidedOn;
    if (body.data.note != null) update.note = body.data.note.trim() || null;

    const [updated] = await db
      .update(caseProceedingsTable)
      .set(update)
      .where(eq(caseProceedingsTable.id, existing.id))
      .returning();

    /*
     * One ledger row naming what actually moved.
     *
     * Not one row per field: an advocate correcting a title and a date in the
     * same save should read as one edit, not two. And not a bare "updated",
     * which is the kind of entry that makes a ledger unreadable — the whole
     * reason proceedings are a first-class object rather than a note in the
     * matter's title is that their movement can be traced.
     */
    const changes: string[] = [];
    if (update.title != null && update.title !== existing.title)
      changes.push(`renamed to "${update.title}"`);
    if (update.kind != null && update.kind !== existing.kind)
      changes.push(`recorded as ${update.kind}`);
    if (update.status != null && update.status !== existing.status) {
      changes.push(`status ${await statusLabelFor(c.workspaceId, update.status)}`);
    }
    if (update.stage !== undefined && (update.stage ?? null) !== (existing.stage ?? null)) {
      const label = update.stage
        ? await stageLabelFor(c.workspaceId, forumGroupFor(matter), update.stage)
        : null;
      changes.push(label ? `stage ${label}` : "stage cleared");
    }
    if (
      update.filingRef !== undefined &&
      (update.filingRef ?? null) !== (existing.filingRef ?? null)
    ) {
      changes.push(update.filingRef ? `numbered ${update.filingRef}` : "number cleared");
    }
    if (update.filedOn !== undefined && (update.filedOn ?? null) !== (existing.filedOn ?? null)) {
      changes.push(update.filedOn ? `filed ${update.filedOn}` : "filing date cleared");
    }

    const closing =
      update.decidedOn !== undefined &&
      (update.decidedOn ?? null) !== (existing.decidedOn ?? null) &&
      update.decidedOn != null;
    if (
      update.decidedOn !== undefined &&
      (update.decidedOn ?? null) !== (existing.decidedOn ?? null)
    ) {
      changes.push(update.decidedOn ? `decided ${update.decidedOn}` : "decision date cleared");
    }

    if (changes.length > 0) {
      await addTimelineEvent(
        matter.id,
        // A proceeding gaining a decision date is its ending, and reads
        // differently in a filtered ledger from an ordinary correction.
        closing ? "proceeding_closed" : "proceeding_updated",
        `${updated!.kind} "${updated!.title}": ${changes.join(", ")}`,
        personName(c.user),
      );
    }

    res.json(UpdateCaseProceedingResponse.parse(await enrich(c, updated!)));
  },
);

router.delete(
  "/cases/:caseId/proceedings/:proceedingId",
  requireWorkspace,
  requireCapability("cases.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const params = DeleteCaseProceedingParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const matter = await getVisibleCase(c, params.data.caseId);
    if (!matter) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const [existing] = await db
      .select()
      .from(caseProceedingsTable)
      .where(
        and(
          eq(caseProceedingsTable.id, params.data.proceedingId),
          eq(caseProceedingsTable.caseId, matter.id),
          eq(caseProceedingsTable.workspaceId, c.workspaceId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Proceeding not found" });
      return;
    }

    await db.delete(caseProceedingsTable).where(eq(caseProceedingsTable.id, existing.id));

    // Deleting a proceeding does not delete the fact that it existed. The
    // ledger is append-only and this is the only record left of it.
    await addTimelineEvent(
      matter.id,
      "proceeding_deleted",
      `${existing.kind} removed: "${existing.title}"`,
      personName(c.user),
    );
    await recordAudit(req, c, {
      action: "case.updated",
      entityType: "case",
      entityId: matter.id,
      summary: `Removed the ${existing.kind} "${existing.title}" from ${matter.title}`,
    });

    res.status(204).end();
  },
);

export default router;
