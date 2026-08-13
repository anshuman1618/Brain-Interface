import { Router, type IRouter } from "express";
import { eq, and, inArray, SQL } from "drizzle-orm";
import { db, casesTable, usersTable, timelineEventsTable } from "@workspace/db";
import {
  ListCasesQueryParams,
  ListCasesResponse,
  CreateCaseBody,
  CreateCaseResponse,
  GetCaseParams,
  GetCaseResponse,
  UpdateCaseParams,
  UpdateCaseBody,
  UpdateCaseResponse,
  DeleteCaseParams,
  GetCaseTimelineParams,
  GetCaseTimelineResponse,
} from "@workspace/api-zod";
import {
  requireWorkspace,
  requireCapability,
  ctx,
  type AuthRequest,
} from "../middlewares/requireAuth";
import { addTimelineEvent } from "../lib/timeline";
import { getVisibleCase, visibleCaseIds } from "../lib/scope";
import { checkQuota, quotaMessage, usageFor } from "../lib/quota";
import { screenForConflicts } from "../lib/conflicts";
import { recordAudit } from "../lib/audit";
import { CheckConflictsBody } from "@workspace/api-zod";
import { zodMessage } from "../lib/validation";

const router: IRouter = Router();

/**
 * Screen a party before committing to a matter, so the advocate sees the
 * conflict while they are still filling the form rather than on submit.
 * The POST /cases check is the authoritative one; this is the courtesy.
 */
router.post(
  "/cases/conflict-check",
  requireWorkspace,
  requireCapability("cases.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const body = CheckConflictsBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    res.json({ hits: await screenForConflicts(c.workspaceId, body.data.opposingParty) });
  },
);

async function enrichCase(c: typeof casesTable.$inferSelect) {
  let clientName: string | null = null;
  if (c.clientId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, c.clientId));
    clientName = u?.displayName ?? null;
  }
  return { ...c, clientName };
}

router.get(
  "/cases",
  requireWorkspace,
  requireCapability("cases.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const params = ListCasesQueryParams.safeParse(req.query);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    // The id list is computed from the verified workspace and the caller's row
    // scope, so no query parameter can widen it.
    const allowedIds = await visibleCaseIds(c);
    if (allowedIds.length === 0) {
      res.json([]);
      return;
    }

    const conditions: SQL[] = [inArray(casesTable.id, allowedIds)];
    if (params.data.status) conditions.push(eq(casesTable.status, params.data.status));
    if (params.data.clientId)
      conditions.push(eq(casesTable.clientId, Number(params.data.clientId)));

    const cases = await db
      .select()
      .from(casesTable)
      .where(and(...conditions));

    const enriched = await Promise.all(cases.map(enrichCase));
    res.json(ListCasesResponse.parse(enriched));
  },
);

/**
 * A sentence per field, because the generated validator's own wording is
 * "Too small: expected string to have >=3 characters" against a path of
 * `filingRef` — accurate, and no help to the advocate who left it blank.
 *
 * Falls back to the generic field-prefixed message for anything not named here.
 */
const CASE_FIELD_MESSAGES: Record<string, string> = {
  filingRef:
    "A filing reference is required — for example CV-2026-118. It must be at least 3 characters.",
  title: "Give the matter a title.",
};

function caseFieldMessage(error: { issues?: ReadonlyArray<{ path?: ReadonlyArray<unknown> }> }) {
  const field = error.issues?.[0]?.path?.[0];
  if (typeof field === "string" && CASE_FIELD_MESSAGES[field]) return CASE_FIELD_MESSAGES[field];
  return zodMessage(error);
}

router.post(
  "/cases",
  requireWorkspace,
  requireCapability("cases.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const parsed = CreateCaseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", message: caseFieldMessage(parsed.error) });
      return;
    }

    /**
     * `.min(3)` counts characters, so "   " satisfies the generated validator
     * and then trims to nothing. The stored value is the trimmed one, so the
     * trimmed one is what has to pass.
     */
    const filingRef = parsed.data.filingRef.trim();
    if (filingRef.length < 3) {
      res.status(400).json({ error: "invalid_request", message: CASE_FIELD_MESSAGES["filingRef"] });
      return;
    }

    // The plan is a real limit, not a line on the pricing page.
    const breach = await checkQuota(c.workspaceId, "matters");
    if (breach) {
      const usage = await usageFor(c.workspaceId);
      res.status(402).json({
        error: "plan_limit",
        reason: "matters",
        message: quotaMessage(breach, usage.plan),
        usage,
      });
      return;
    }

    /**
     * Conflict screening happens before the matter exists, not after.
     *
     * If the other side is already a client, or already appears on another
     * matter, the request is refused with the specific hits. The advocate can
     * re-submit with `conflictAcknowledged` and a note explaining their
     * judgement — which is recorded, because the decision is theirs to make
     * and the chamber's to be able to show later.
     */
    const opposing = parsed.data.opposingParty?.trim() ?? "";
    let conflictHits: Awaited<ReturnType<typeof screenForConflicts>> = [];
    if (opposing) {
      conflictHits = await screenForConflicts(c.workspaceId, opposing);
      if (conflictHits.length && !parsed.data.conflictAcknowledged) {
        res.status(409).json({
          error: "conflict_of_interest",
          message: `${opposing} may already be connected to this chamber. Review before opening the matter.`,
          hits: conflictHits,
        });
        return;
      }
      if (conflictHits.length && !parsed.data.conflictNote?.trim()) {
        res.status(400).json({
          error: "conflict_note_required",
          message: "Record why this conflict does not apply before proceeding.",
        });
        return;
      }
    }

    const acknowledged = conflictHits.length > 0;

    const [newCase] = await db
      .insert(casesTable)
      .values({
        // Taken from the verified context, never from the request body — otherwise a
        // caller could plant a case inside another tenant.
        workspaceId: c.workspaceId,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        status: parsed.data.status ?? "open",
        clientId: parsed.data.clientId ?? null,
        filingRef,
        opposingParty: opposing || null,
        conflictAcknowledgedBy: acknowledged ? c.user.clerkId : null,
        conflictNote: acknowledged ? (parsed.data.conflictNote?.trim() ?? null) : null,
        priority: parsed.data.priority ?? "medium",
      })
      .returning();

    await addTimelineEvent(
      newCase.id,
      "case_created",
      `Case "${newCase.title}" created`,
      c.user.displayName,
    );
    await recordAudit(req, c, {
      action: "case.created",
      entityType: "case",
      entityId: newCase.id,
      summary: `Opened "${newCase.title}"${opposing ? ` against ${opposing}` : ""}`,
    });
    if (acknowledged) {
      await recordAudit(req, c, {
        action: "case.conflict_acknowledged",
        entityType: "case",
        entityId: newCase.id,
        summary: `Proceeded despite ${conflictHits.length} possible conflict(s) on "${newCase.title}": ${parsed.data.conflictNote?.trim()}`,
      });
    }

    res.status(201).json(CreateCaseResponse.parse(await enrichCase(newCase)));
  },
);

router.get(
  "/cases/:id",
  requireWorkspace,
  requireCapability("cases.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const params = GetCaseParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const found = await getVisibleCase(c, params.data.id);
    if (!found) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    res.json(GetCaseResponse.parse(await enrichCase(found)));
  },
);

router.patch(
  "/cases/:id",
  requireWorkspace,
  requireCapability("cases.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const pathParams = UpdateCaseParams.safeParse(req.params);
    if (!pathParams.success) {
      res.status(400).json({ error: pathParams.error.message });
      return;
    }

    const body = UpdateCaseBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid_request", message: caseFieldMessage(body.error) });
      return;
    }

    const existing = await getVisibleCase(c, pathParams.data.id);
    if (!existing) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const updateData: Partial<typeof casesTable.$inferSelect> = {};
    if (body.data.title != null) updateData.title = body.data.title;
    if (body.data.description != null) updateData.description = body.data.description;
    if (body.data.status != null) updateData.status = body.data.status;
    if (body.data.clientId != null) updateData.clientId = body.data.clientId;
    if (body.data.filingRef != null) {
      const trimmed = body.data.filingRef.trim();
      if (trimmed.length < 3) {
        res
          .status(400)
          .json({ error: "invalid_request", message: CASE_FIELD_MESSAGES["filingRef"] });
        return;
      }
      updateData.filingRef = trimmed;
    }
    if (body.data.priority != null) updateData.priority = body.data.priority;

    const [updated] = await db
      .update(casesTable)
      .set(updateData)
      .where(eq(casesTable.id, pathParams.data.id))
      .returning();

    if (body.data.status && body.data.status !== existing.status) {
      await addTimelineEvent(
        updated.id,
        "status_changed",
        `Status changed to "${body.data.status}"`,
        c.user.displayName,
      );
    }

    res.json(UpdateCaseResponse.parse(await enrichCase(updated)));
  },
);

// Destructive and workspace-wide — admin of *this* workspace only.
router.delete(
  "/cases/:id",
  requireWorkspace,
  requireCapability("cases.delete"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const params = DeleteCaseParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [deleted] = await db
      .delete(casesTable)
      .where(and(eq(casesTable.id, params.data.id), eq(casesTable.workspaceId, c.workspaceId)))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    res.sendStatus(204);
  },
);

router.get(
  "/cases/:id/timeline",
  requireWorkspace,
  requireCapability("cases.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const params = GetCaseTimelineParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const found = await getVisibleCase(c, params.data.id);
    if (!found) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const events = await db
      .select()
      .from(timelineEventsTable)
      .where(eq(timelineEventsTable.caseId, params.data.id))
      .orderBy(timelineEventsTable.createdAt);

    res.json(GetCaseTimelineResponse.parse(events));
  },
);

export default router;
