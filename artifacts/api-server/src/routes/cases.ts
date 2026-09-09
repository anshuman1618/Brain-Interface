import { Router, type IRouter } from "express";
import { eq, and, inArray, SQL } from "drizzle-orm";
import {
  db,
  casesTable,
  caseStageLabelsTable,
  usersTable,
  timelineEventsTable,
  courtsTable,
  courtLabel,
  normaliseCaseType,
} from "@workspace/db";
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
  ListCaseStagesParams,
  ListCaseStagesResponse,
  AddCaseStageParams,
  AddCaseStageBody,
  AddCaseStageResponse,
} from "@workspace/api-zod";
import {
  requireWorkspace,
  requireCapability,
  ctx,
  type AuthRequest,
  type WorkspaceContext,
} from "../middlewares/requireAuth";
import { addTimelineEvent } from "../lib/timeline";
import {
  FORUM_GROUP_LABELS,
  forumGroupFor,
  isForumGroup,
  stageKey,
  stageLabelFor,
  stageOptions,
} from "../lib/case-stages";
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
  // Resolved for display rather than stored on the matter: the court's name is
  // the court's, and a matter holding a stale copy of it is a bug waiting for
  // the day a bench is renamed.
  let courtName: string | null = null;
  if (c.courtId) {
    const [court] = await db.select().from(courtsTable).where(eq(courtsTable.id, c.courtId));
    courtName = court ? courtLabel(court) : null;
  }
  // Same reasoning as courtName: the stage key is what is stored, the heading
  // is what a person reads, and resolving it here saves a list page fetching a
  // stage vocabulary per matter to render one word. Costs nothing on a matter
  // with no stage, which is most of them.
  const stageLabel = await stageLabelFor(c.workspaceId, forumGroupFor(c), c.stage);
  return { ...c, clientName, courtName, stageLabel };
}

/**
 * Validate and normalise the four court-identity fields.
 *
 * They travel together: a case number with no court matches nothing, and a
 * court with no number matches everything the parser could not read. Either
 * all four are given or none is, which is also what stops a half-filled
 * matter from looking matchable on the case screen when it is not.
 *
 * On a patch, an explicit `courtId: null` clears all five columns. That is the
 * only way back out of being proposed somebody else's listings after a typo,
 * so it is worth the one nullable field in the schema; `undefined` still means
 * "leave it alone", which is what every other field on a patch means.
 *
 * Returns the columns to write, or a message explaining what is missing.
 */
async function courtIdentity(
  c: WorkspaceContext,
  input: { courtId?: number | null; caseType?: string; caseNumber?: number; caseYear?: number },
): Promise<
  | { ok: true; values: Partial<typeof casesTable.$inferSelect> }
  | { ok: false; status: number; message: string }
> {
  if (input.courtId === null) {
    return {
      ok: true,
      values: {
        courtId: null,
        caseType: null,
        caseTypeNorm: null,
        caseNumber: null,
        caseYear: null,
      },
    };
  }

  const given = [input.courtId, input.caseType, input.caseNumber, input.caseYear].filter(
    (v) => v !== undefined && v !== null && v !== "",
  ).length;

  if (given === 0) return { ok: true, values: {} };
  if (given < 4) {
    return {
      ok: false,
      status: 400,
      message:
        "Court, case type, number and year go together — give all four, or none. " +
        "A partial reference cannot be matched against a cause list.",
    };
  }

  const [court] = await db
    .select()
    .from(courtsTable)
    .where(and(eq(courtsTable.id, input.courtId!), eq(courtsTable.active, true)));
  if (!court) {
    return { ok: false, status: 404, message: "That court was not found." };
  }

  // Sanity, not schema: a year outside this range is a typo, and a matter
  // carrying one silently never matches.
  const year = input.caseYear!;
  if (year < 1900 || year > new Date().getFullYear() + 1) {
    return { ok: false, status: 400, message: `${year} does not look like a filing year.` };
  }
  if (input.caseNumber! <= 0) {
    return { ok: false, status: 400, message: "A case number is a positive whole number." };
  }

  const caseType = input.caseType!.trim();
  return {
    ok: true,
    values: {
      courtId: court.id,
      caseType,
      // Normalised by the same function the scraped row goes through, which is
      // what lets matching be a plain equality. See schema/courts.ts.
      caseTypeNorm: normaliseCaseType(caseType),
      caseNumber: input.caseNumber!,
      caseYear: year,
    },
  };
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

    const identity = await courtIdentity(c, parsed.data);
    if (!identity.ok) {
      res.status(identity.status).json({ error: "invalid_request", message: identity.message });
      return;
    }

    const [newCase] = await db
      .insert(casesTable)
      .values({
        ...identity.values,
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
        // Left null when not given, deliberately: null means "read it off the
        // case type", and a matter whose type later gets corrected then picks
        // up the right stage list instead of keeping a group derived from the
        // wrong one.
        forumGroup: parsed.data.forumGroup ?? null,
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

    // If reopening a closed matter, check the matters quota. The matter being
    // reopened is already counted as closed, so it is not in openMatters yet.
    if (body.data.status && body.data.status !== "closed" && existing.status === "closed") {
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
    }

    const updateData: Partial<typeof casesTable.$inferSelect> = {};
    if (body.data.title != null) updateData.title = body.data.title;
    if (body.data.description != null) updateData.description = body.data.description;
    if (body.data.status != null) {
      updateData.status = body.data.status;
      // Cycle time is measured to this column, so it has to move with the
      // status rather than being written once and forgotten. Reopening a closed
      // matter clears it — a matter that is open again has not finished a cycle.
      if (body.data.status === "closed" && existing.status !== "closed") {
        updateData.closedAt = new Date();
      } else if (body.data.status !== "closed") {
        updateData.closedAt = null;
      }
    }
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

    if (body.data.forumGroup != null) updateData.forumGroup = body.data.forumGroup;

    // The stage the MATTER is in. Validated against the list the matter will
    // have AFTER this patch, not before it — re-grouping a matter and setting
    // its stage in one call is a reasonable thing to do, and checking against
    // the old group would refuse it for no reason a reader could see.
    if (body.data.stage !== undefined) {
      if (body.data.stage === null) {
        updateData.stage = null;
      } else {
        const group = forumGroupFor({
          forumGroup: updateData.forumGroup ?? existing.forumGroup,
          caseTypeNorm: existing.caseTypeNorm,
        });
        const options = await stageOptions(c.workspaceId, group);
        if (!options.some((s) => s.key === body.data.stage)) {
          res.status(400).json({
            error: "unknown_stage",
            message: `"${body.data.stage}" is not a stage on this matter's list.`,
          });
          return;
        }
        updateData.stage = body.data.stage;
      }
    }

    // Court identity is patched as a unit, like it is created — see
    // courtIdentity(). Omitting all four leaves whatever the matter already
    // had; giving a partial set is refused rather than half-applied; an
    // explicit null court clears it.
    const identity = await courtIdentity(c, body.data);
    if (!identity.ok) {
      res.status(identity.status).json({ error: "invalid_request", message: identity.message });
      return;
    }
    Object.assign(updateData, identity.values);

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

/* ── Stages ───────────────────────────────────────────────────────────────
   The headings a matter's papers file under.

   Read is gated on `cases.read`, not on `documents.write`: a client opening
   their own matter in the portal sees the same headings the chamber does, and
   the vocabulary is not confidential — it is "counter affidavit" and
   "rejoinder". Write is gated on `cases.write`, because adding to a chamber's
   controlled vocabulary is a chamber decision and a client uploading a file
   should not be able to invent a heading for it. ────────────────────────── */

/** The list, the matter's own stage, and whether the group was a guess. */
async function stagesView(c: WorkspaceContext, matter: typeof casesTable.$inferSelect) {
  const group = forumGroupFor(matter);
  return {
    caseId: matter.id,
    forumGroup: group,
    forumGroupLabel: FORUM_GROUP_LABELS[group],
    forumGroupInferred: !isForumGroup(matter.forumGroup),
    stage: matter.stage,
    options: await stageOptions(c.workspaceId, group),
  };
}

router.get(
  "/cases/:caseId/stages",
  requireWorkspace,
  requireCapability("cases.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const params = ListCaseStagesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    // Row scope, not just the workspace: a junior without a grant on this
    // matter must not be able to read anything off it, headings included.
    const matter = await getVisibleCase(c, params.data.caseId);
    if (!matter) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    res.json(ListCaseStagesResponse.parse(await stagesView(c, matter)));
  },
);

router.post(
  "/cases/:caseId/stages",
  requireWorkspace,
  requireCapability("cases.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const params = AddCaseStageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const body = AddCaseStageBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(body.error) });
      return;
    }

    const matter = await getVisibleCase(c, params.data.caseId);
    if (!matter) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const label = body.data.label.trim();
    const key = stageKey(label);
    if (!key) {
      res.status(400).json({
        error: "invalid_request",
        message: "A stage name needs at least one letter or number.",
      });
      return;
    }

    const group = forumGroupFor(matter);

    // Saved against the workspace and the forum group, NOT the matter: a
    // chamber that adds "Caveat" to its writ list wants it on the next writ
    // petition too. Per-matter additions are how a controlled vocabulary decays
    // back into free text.
    //
    // onConflictDoNothing rather than an existence check: two advocates adding
    // the same stage at the same moment is a race the unique constraint already
    // settles, and re-adding an existing stage is not an error worth showing.
    await db
      .insert(caseStageLabelsTable)
      .values({
        workspaceId: c.workspaceId,
        forumGroup: group,
        key,
        label,
        createdBy: c.user.displayName,
      })
      .onConflictDoNothing();

    res.status(201).json(AddCaseStageResponse.parse(await stagesView(c, matter)));
  },
);

export default router;
