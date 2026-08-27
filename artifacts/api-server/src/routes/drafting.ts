import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  casesTable,
  courtsTable,
  documentsTable,
  draftsTable,
  draftSourcesTable,
  chamberInsightsTable,
  styleExemplarsTable,
  workspacesTable,
  courtLabel,
  normaliseCaseType,
  isDraftKind,
  isExemplarKind,
} from "@workspace/db";
import {
  GetAiBudgetResponse,
  SetDraftingEnabledBody,
  ListInsightsQueryParams,
  ListInsightsResponse,
  CreateInsightBody,
  UpdateInsightBody,
  ListExemplarsResponse,
  CreateExemplarBody,
  UpdateExemplarBody,
  ListDraftsResponse,
  CreateDraftBody,
  UpdateDraftBody,
} from "@workspace/api-zod";
import {
  requireWorkspace,
  requireCapability,
  ctx,
  type AuthRequest,
} from "../middlewares/requireAuth";
import { zodMessage } from "../lib/validation";
import { recordAudit } from "../lib/audit";
import { logger } from "../lib/logger";
import { budgetFor, checkBudget } from "../lib/ai/budget";
import { aiConfigured, estimateTokens, usingStubModel } from "../lib/ai/client";
import { estimateMinor, UTILITY_MODEL } from "../lib/ai/models";
import { runDraft } from "../lib/ai/drafting";
import { anonymise, ANONYMISE_MAX_OUTPUT } from "../lib/ai/anonymise";
import { getVisibleCase, mayDraftOnCase } from "../lib/scope";
import { roleHasCapability } from "../lib/permissions";
import { extractText } from "../lib/ai/extract";
import * as blobStore from "../lib/blob-store";

const router: IRouter = Router();

/**
 * AI drafting, review, and the chamber's own knowledge.
 *
 * Every route here passes the same three gates, in this order, and the order
 * matters:
 *
 *   1. `requireWorkspace`               — membership, re-read from the database
 *   2. `requireCapability("drafting.use")` — practice roles only, never a client
 *   3. `draftingEnabled` on the workspace — the chamber's own opt-in
 *
 * The third is the one that is easy to treat as decoration. It is not a feature
 * flag: this feature sends privileged material to a third party, and a chamber
 * that has not said yes to that has not said yes to that. Hiding the button
 * would not be a control; refusing the request is.
 */

/** The chamber's opt-in, checked on every route that can reach a model. */
async function draftingIsOn(workspaceId: number): Promise<boolean> {
  const [row] = await db
    .select({ on: workspacesTable.draftingEnabled })
    .from(workspacesTable)
    .where(eq(workspacesTable.id, workspaceId));
  return row?.on === true;
}

const NOT_ENABLED = {
  error: "drafting_not_enabled",
  message:
    "AI drafting is not switched on for this chamber. An admin can enable it from " +
    "the plan screen, after reading what is sent and to whom.",
};

/**
 * The per-task grant, refused.
 *
 * Deliberately names the mechanism rather than saying "forbidden": the person
 * reading this can have the access, and the sentence tells them how to ask for
 * it. A 403 that does not say what would change it is a support ticket.
 */
const NO_TASK_GRANT = {
  error: "drafting_not_granted",
  message:
    "AI drafting is granted per task for a junior advocate. Ask whoever assigns " +
    "your work to tick “allow AI drafting” on a task on this matter.",
};

/** Chamber-level AI writes — setting the chamber's voice, not doing the work. */
const CHAMBER_WIDE_ONLY = {
  error: "drafting_not_granted",
  message:
    "Style examples set the whole chamber's drafting voice and cost money to " +
    "redact, so an admin or senior advocate adds them.",
};

/* ── The budget meter ────────────────────────────────────────────────────── */

router.get(
  "/ai/budget",
  requireWorkspace,
  requireCapability("drafting.use"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const state = await budgetFor(c.workspaceId);
    res.json(
      GetAiBudgetResponse.parse({
        plan: state.plan,
        allowanceMinor: state.allowanceMinor,
        topupMinor: state.topupMinor,
        spentMinor: state.spentMinor,
        remainingMinor: state.remainingMinor,
        resetsAt: state.resetsAt?.toISOString() ?? null,
        tier: state.tier,
        draftingEnabled: await draftingIsOn(c.workspaceId),
        // Said plainly rather than inferred from odd-looking output: without a
        // key every draft is served by the preview stub.
        configured: aiConfigured() && !usingStubModel(),
      }),
    );
  },
);

/* ── The chamber's opt-in ────────────────────────────────────────────────── */

router.post(
  "/workspace/drafting",
  requireWorkspace,
  // Admin only. Turning this on is a decision about the practice's obligations
  // to its clients, not about how an individual advocate likes to work.
  requireCapability("access_control.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const body = SetDraftingEnabledBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(body.error) });
      return;
    }
    const c = ctx(req);

    const [row] = await db
      .update(workspacesTable)
      .set({
        draftingEnabled: body.data.enabled,
        draftingEnabledBy: body.data.enabled ? c.user.displayName : null,
        draftingEnabledAt: body.data.enabled ? new Date() : null,
      })
      .where(eq(workspacesTable.id, c.workspaceId))
      .returning();

    await recordAudit(req, c, {
      action: body.data.enabled ? "drafting.enabled" : "drafting.disabled",
      entityType: "workspace",
      entityId: String(c.workspaceId),
      summary: body.data.enabled
        ? "Switched AI drafting on for this chamber"
        : "Switched AI drafting off",
    });

    res.json({
      draftingEnabled: row.draftingEnabled,
      draftingEnabledBy: row.draftingEnabledBy,
      draftingEnabledAt: row.draftingEnabledAt?.toISOString() ?? null,
    });
  },
);

/* ── Insights ────────────────────────────────────────────────────────────── */

const insightVector = sql`to_tsvector('simple', coalesce(${chamberInsightsTable.title}, '') || ' ' || coalesce(${chamberInsightsTable.body}, '') || ' ' || coalesce(${chamberInsightsTable.tags}, ''))`;

function insightJson(row: typeof chamberInsightsTable.$inferSelect, courtName: string | null) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    tags: row.tags,
    courtId: row.courtId,
    courtName,
    caseTypeNorm: row.caseTypeNorm,
    authorName: row.authorName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get(
  "/insights",
  requireWorkspace,
  requireCapability("drafting.use"),
  async (req: AuthRequest, res): Promise<void> => {
    const query = ListInsightsQueryParams.safeParse(req.query);
    const c = ctx(req);
    // `q` is optional, and a missing one must not become the string
    // "undefined" — orval emits zod.coerce.string(), which happily coerces it.
    const term = typeof req.query["q"] === "string" ? (query.success ? query.data.q : "") : "";

    const rows = await db
      .select({ insight: chamberInsightsTable, court: courtsTable })
      .from(chamberInsightsTable)
      .leftJoin(courtsTable, eq(courtsTable.id, chamberInsightsTable.courtId))
      .where(
        and(
          eq(chamberInsightsTable.workspaceId, c.workspaceId),
          term && term.length >= 2
            ? sql`${insightVector} @@ plainto_tsquery('simple', ${term})`
            : undefined,
        ),
      )
      .orderBy(desc(chamberInsightsTable.updatedAt))
      .limit(200);

    res.json(
      ListInsightsResponse.parse(
        rows.map(({ insight, court }) => insightJson(insight, court ? courtLabel(court) : null)),
      ),
    );
  },
);

router.post(
  "/insights",
  requireWorkspace,
  requireCapability("drafting.use"),
  async (req: AuthRequest, res): Promise<void> => {
    const body = CreateInsightBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(body.error) });
      return;
    }
    const c = ctx(req);

    const [row] = await db
      .insert(chamberInsightsTable)
      .values({
        workspaceId: c.workspaceId,
        title: body.data.title,
        body: body.data.body ?? "",
        tags: (body.data.tags ?? "").toLowerCase(),
        courtId: body.data.courtId ?? null,
        // Normalised on write, so retrieval compares as plain equality — the
        // same rule the cause-list matcher uses.
        caseTypeNorm: body.data.caseType ? normaliseCaseType(body.data.caseType) : null,
        authorClerkId: c.user.clerkId,
        authorName: c.user.displayName,
        authorRole: c.role,
      })
      .returning();

    res.status(201).json(insightJson(row, null));
  },
);

router.patch(
  "/insights/:id",
  requireWorkspace,
  requireCapability("drafting.use"),
  async (req: AuthRequest, res): Promise<void> => {
    const body = UpdateInsightBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(body.error) });
      return;
    }
    const c = ctx(req);

    const [row] = await db
      .update(chamberInsightsTable)
      .set({
        title: body.data.title,
        body: body.data.body ?? "",
        tags: (body.data.tags ?? "").toLowerCase(),
        courtId: body.data.courtId ?? null,
        caseTypeNorm: body.data.caseType ? normaliseCaseType(body.data.caseType) : null,
      })
      // Scoped in the WHERE clause, not checked afterwards: another chamber's
      // insight is not found rather than found-and-refused.
      .where(
        and(
          eq(chamberInsightsTable.id, Number(req.params["id"])),
          eq(chamberInsightsTable.workspaceId, c.workspaceId),
        ),
      )
      .returning();

    if (!row) {
      res.status(404).json({ error: "No such insight in this chamber." });
      return;
    }
    res.json(insightJson(row, null));
  },
);

router.delete(
  "/insights/:id",
  requireWorkspace,
  requireCapability("drafting.use"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const [row] = await db
      .delete(chamberInsightsTable)
      .where(
        and(
          eq(chamberInsightsTable.id, Number(req.params["id"])),
          eq(chamberInsightsTable.workspaceId, c.workspaceId),
        ),
      )
      .returning({ id: chamberInsightsTable.id });

    if (!row) {
      res.status(404).json({ error: "No such insight in this chamber." });
      return;
    }
    res.status(204).end();
  },
);

/* ── Style exemplars ─────────────────────────────────────────────────────── */

function exemplarJson(row: typeof styleExemplarsTable.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    // Only the redacted copy is ever returned. `sourceText` stays on the server:
    // it is the un-redacted original and nothing outside this file needs it.
    body: row.body,
    sourceDocumentId: row.sourceDocumentId,
    anonymisedAt: row.anonymisedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewedBy: row.reviewedBy,
    active: row.active,
    addedByName: row.addedByName,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get(
  "/exemplars",
  requireWorkspace,
  requireCapability("drafting.use"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const rows = await db
      .select()
      .from(styleExemplarsTable)
      .where(eq(styleExemplarsTable.workspaceId, c.workspaceId))
      .orderBy(desc(styleExemplarsTable.updatedAt));
    res.json(ListExemplarsResponse.parse(rows.map(exemplarJson)));
  },
);

router.post(
  "/exemplars",
  requireWorkspace,
  requireCapability("drafting.use"),
  async (req: AuthRequest, res): Promise<void> => {
    const body = CreateExemplarBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(body.error) });
      return;
    }
    const c = ctx(req);
    if (!isExemplarKind(body.data.kind)) {
      res.status(400).json({ error: "invalid_request", message: "Unknown document kind." });
      return;
    }
    if (!(await draftingIsOn(c.workspaceId))) {
      res.status(403).json(NOT_ENABLED);
      return;
    }
    // Adding an example runs the redaction model, so it spends the chamber's
    // budget — and unlike a draft it is not tied to a matter, so the per-task
    // grant has nothing to hang on. `tasks.write` is the chamber-wide tier
    // (admin and senior advocate); a junior with a task grant may draft, not
    // set the house style everyone else's drafts are then written in.
    if (!roleHasCapability(c.role, "tasks.write")) {
      res.status(403).json(CHAMBER_WIDE_ONLY);
      return;
    }

    let sourceText = body.data.text ?? "";
    let sourceDocumentId: number | null = null;

    if (body.data.documentId) {
      // Re-checked against this chamber through the matter, exactly as the
      // drafting context does. A document id is not proof of anything.
      const [row] = await db
        .select({ doc: documentsTable })
        .from(documentsTable)
        .innerJoin(casesTable, eq(casesTable.id, documentsTable.caseId))
        .where(
          and(
            eq(documentsTable.id, body.data.documentId),
            eq(casesTable.workspaceId, c.workspaceId),
          ),
        );

      if (!row?.doc.storagePath) {
        res.status(404).json({ error: "No such document in this chamber." });
        return;
      }
      const bytes = await blobStore.read(row.doc.storagePath);
      const extracted = await extractText(bytes, row.doc.fileType ?? "");
      if (extracted.empty) {
        res.status(400).json({
          error: "unreadable_document",
          message:
            extracted.note ??
            "No readable text could be taken from that document, so it cannot be used as an example.",
        });
        return;
      }
      sourceText = extracted.text;
      sourceDocumentId = row.doc.id;
    }

    if (sourceText.trim().length < 200) {
      res.status(400).json({
        error: "invalid_request",
        message: "An example needs to be long enough to show a drafting style.",
      });
      return;
    }

    /*
     * The budget, checked HERE and not only on the drafting route.
     *
     * Adding an example calls a model — the redaction pass — so it spends real
     * money, and for a while this path did that with no budget check at all. A
     * chamber whose allowance was exhausted could keep spending by uploading
     * examples instead of drafting, which made "strict limit" untrue on the one
     * route nobody thinks of as a drafting route.
     *
     * Estimated the same pessimistic way as a draft: whole source text in,
     * output assumed to run to the redaction ceiling. A redaction returns
     * roughly what it was given, so that assumption is close rather than
     * merely safe.
     */
    const estimate = estimateMinor(UTILITY_MODEL, estimateTokens(sourceText), ANONYMISE_MAX_OUTPUT);
    const allowed = await checkBudget(c.workspaceId, estimate);
    if (!allowed.ok) {
      res.status(402).json({ error: "budget_exhausted", message: allowed.reason });
      return;
    }

    const [row] = await db
      .insert(styleExemplarsTable)
      .values({
        workspaceId: c.workspaceId,
        kind: body.data.kind,
        title: body.data.title,
        sourceDocumentId,
        sourceText,
        body: "",
        addedByClerkId: c.user.clerkId,
        addedByName: c.user.displayName,
      })
      .returning();

    // The redaction runs now, so the advocate has something to review rather
    // than a job to wait for. It is cheap — a Haiku pass over one document.
    const redacted = await anonymise({
      workspaceId: c.workspaceId,
      text: sourceText,
      actorClerkId: c.user.clerkId,
    });

    const [updated] = await db
      .update(styleExemplarsTable)
      .set({ body: redacted.text, anonymisedAt: new Date() })
      .where(eq(styleExemplarsTable.id, row.id))
      .returning();

    await recordAudit(req, c, {
      action: "drafting.exemplar_added",
      entityType: "style_exemplar",
      entityId: String(row.id),
      summary: `Added "${body.data.title}" as a ${body.data.kind} example, awaiting review`,
    });

    res.status(201).json(exemplarJson(updated));
  },
);

router.patch(
  "/exemplars/:id",
  requireWorkspace,
  requireCapability("drafting.use"),
  async (req: AuthRequest, res): Promise<void> => {
    const body = UpdateExemplarBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(body.error) });
      return;
    }
    const c = ctx(req);

    const [row] = await db
      .update(styleExemplarsTable)
      .set({
        ...(body.data.title !== undefined ? { title: body.data.title } : {}),
        ...(body.data.body !== undefined ? { body: body.data.body } : {}),
        ...(body.data.active !== undefined ? { active: body.data.active } : {}),
        // Approval is what makes an exemplar usable at all. Recorded with a
        // name, because "a person checked this" is only meaningful if you can
        // say which person.
        ...(body.data.approve ? { reviewedAt: new Date(), reviewedBy: c.user.displayName } : {}),
      })
      .where(
        and(
          eq(styleExemplarsTable.id, Number(req.params["id"])),
          eq(styleExemplarsTable.workspaceId, c.workspaceId),
        ),
      )
      .returning();

    if (!row) {
      res.status(404).json({ error: "No such example in this chamber." });
      return;
    }
    res.json(exemplarJson(row));
  },
);

router.delete(
  "/exemplars/:id",
  requireWorkspace,
  requireCapability("drafting.use"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const [row] = await db
      .delete(styleExemplarsTable)
      .where(
        and(
          eq(styleExemplarsTable.id, Number(req.params["id"])),
          eq(styleExemplarsTable.workspaceId, c.workspaceId),
        ),
      )
      .returning({ id: styleExemplarsTable.id });
    if (!row) {
      res.status(404).json({ error: "No such example in this chamber." });
      return;
    }
    res.status(204).end();
  },
);

/* ── Drafts ──────────────────────────────────────────────────────────────── */

async function draftJson(row: typeof draftsTable.$inferSelect) {
  const sources = await db
    .select()
    .from(draftSourcesTable)
    .where(eq(draftSourcesTable.draftId, row.id));
  return {
    id: row.id,
    caseId: row.caseId,
    kind: row.kind,
    title: row.title,
    instruction: row.instruction,
    body: row.body,
    status: row.status,
    error: row.error,
    model: row.model,
    parentDraftId: row.parentDraftId,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    sources: sources.map((s) => ({
      kind: s.kind,
      sourceId: s.sourceId,
      label: s.label,
      tokens: s.tokens,
    })),
    unreadable: [],
  };
}

router.get(
  "/cases/:id/drafts",
  requireWorkspace,
  requireCapability("drafting.use"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    // Row scope, not just the workspace. A draft's body is the matter's facts
    // written out in full, so this list is the richest thing in the chamber to
    // leak — and `drafting.use` is held by a junior advocate, who may have been
    // narrowed to named matters. 404 rather than 403: a member should not be
    // able to confirm that a matter they cannot see exists.
    if (!(await getVisibleCase(c, Number(req.params["id"])))) {
      res.status(404).json({ error: "No such matter in this chamber." });
      return;
    }
    const rows = await db
      .select()
      .from(draftsTable)
      .where(
        and(
          eq(draftsTable.caseId, Number(req.params["id"])),
          eq(draftsTable.workspaceId, c.workspaceId),
        ),
      )
      .orderBy(desc(draftsTable.createdAt));
    res.json(ListDraftsResponse.parse(await Promise.all(rows.map(draftJson))));
  },
);

router.post(
  "/cases/:id/drafts",
  requireWorkspace,
  requireCapability("drafting.use"),
  async (req: AuthRequest, res): Promise<void> => {
    const body = CreateDraftBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(body.error) });
      return;
    }
    const c = ctx(req);
    if (!isDraftKind(body.data.kind)) {
      res.status(400).json({ error: "invalid_request", message: "Unknown document kind." });
      return;
    }
    if (!(await draftingIsOn(c.workspaceId))) {
      res.status(403).json(NOT_ENABLED);
      return;
    }

    // Row scope, checked here rather than left to `assemble()` — that only
    // verifies the matter belongs to the workspace. Without this a member
    // narrowed to named matters could commission a brief on a matter they
    // cannot open, pulling its facts into a draft they CAN read and spending
    // the chamber's budget to do it.
    if (!(await getVisibleCase(c, Number(req.params["id"])))) {
      res.status(404).json({ error: "No such matter in this chamber." });
      return;
    }

    // The per-task grant. Checked AFTER row scope so a member who cannot see
    // the matter is told it does not exist rather than that they lack a grant
    // on it — the weaker answer would confirm the matter is there.
    if (!(await mayDraftOnCase(c, Number(req.params["id"])))) {
      res.status(403).json(NO_TASK_GRANT);
      return;
    }

    const budget = await budgetFor(c.workspaceId);

    const outcome = await runDraft({
      workspaceId: c.workspaceId,
      caseId: Number(req.params["id"]),
      kind: body.data.kind,
      instruction: body.data.instruction,
      documentIds: body.data.documentIds ?? [],
      parentDraftId: body.data.parentDraftId ?? null,
      tier: budget.tier,
      actor: { clerkId: c.user.clerkId, name: c.user.displayName },
    });

    if (!outcome.ok) {
      res.status(outcome.status).json({ error: "drafting_failed", message: outcome.error });
      return;
    }

    // Audited because this is the moment privileged material left the server.
    // The source rows say exactly what; this says who and when.
    await recordAudit(req, c, {
      action: "drafting.generated",
      entityType: "draft",
      entityId: String(outcome.draftId),
      summary: `Prepared a ${body.data.kind} for matter ${req.params["id"]}`,
    });

    const [row] = await db.select().from(draftsTable).where(eq(draftsTable.id, outcome.draftId));
    res.status(202).json({ ...(await draftJson(row)), unreadable: outcome.unreadable });
  },
);

router.get(
  "/drafts/:id",
  requireWorkspace,
  requireCapability("drafting.use"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const [row] = await db
      .select()
      .from(draftsTable)
      .where(
        and(
          eq(draftsTable.id, Number(req.params["id"])),
          eq(draftsTable.workspaceId, c.workspaceId),
        ),
      );
    if (!row || !(await getVisibleCase(c, row.caseId))) {
      res.status(404).json({ error: "No such draft in this chamber." });
      return;
    }
    res.json(await draftJson(row));
  },
);

router.patch(
  "/drafts/:id",
  requireWorkspace,
  requireCapability("drafting.use"),
  async (req: AuthRequest, res): Promise<void> => {
    const body = UpdateDraftBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(body.error) });
      return;
    }
    const c = ctx(req);
    // Read before write. The previous version updated first and checked the
    // result, which meant a draft on a matter outside the caller's row scope
    // was already overwritten by the time it answered 404.
    const [existing] = await db
      .select()
      .from(draftsTable)
      .where(
        and(
          eq(draftsTable.id, Number(req.params["id"])),
          eq(draftsTable.workspaceId, c.workspaceId),
        ),
      );
    if (!existing || !(await getVisibleCase(c, existing.caseId))) {
      res.status(404).json({ error: "No such draft in this chamber." });
      return;
    }
    const [row] = await db
      .update(draftsTable)
      .set({
        ...(body.data.body !== undefined ? { body: body.data.body } : {}),
        ...(body.data.title !== undefined ? { title: body.data.title } : {}),
        ...(body.data.keep ? { status: "kept" as const } : {}),
      })
      .where(eq(draftsTable.id, existing.id))
      .returning();
    res.json(await draftJson(row));
  },
);

router.delete(
  "/drafts/:id",
  requireWorkspace,
  requireCapability("drafting.use"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    // Checked before the delete, for the same reason as the patch above: a
    // refusal that fires after the row is gone is not a refusal.
    const [existing] = await db
      .select()
      .from(draftsTable)
      .where(
        and(
          eq(draftsTable.id, Number(req.params["id"])),
          eq(draftsTable.workspaceId, c.workspaceId),
        ),
      );
    if (!existing || !(await getVisibleCase(c, existing.caseId))) {
      res.status(404).json({ error: "No such draft in this chamber." });
      return;
    }
    const [row] = await db
      .delete(draftsTable)
      .where(eq(draftsTable.id, existing.id))
      .returning({ id: draftsTable.id });
    if (!row) {
      res.status(404).json({ error: "No such draft in this chamber." });
      return;
    }
    // The source rows go with it; `ai_usage_events` deliberately does NOT. The
    // tokens were spent whether or not the output was kept, and a budget
    // derived from rows a chamber can delete would not be a budget.
    await db.delete(draftSourcesTable).where(eq(draftSourcesTable.draftId, row.id));
    logger.info({ draftId: row.id }, "Draft discarded; its spend record stands");
    res.status(204).end();
  },
);

export default router;
