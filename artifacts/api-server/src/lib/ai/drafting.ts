import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, draftsTable, draftSourcesTable, type DraftKind } from "@workspace/db";
import { logger } from "../logger";
import { assemble } from "./context";
import { complete } from "./client";
import { checkBudget, recordSpend } from "./budget";
import { costMinor, effortFor, estimateMinor, modelFor } from "./models";
import { rulesFor, VERIFY_BANNER } from "./prompts";

/**
 * One drafting run, start to finish.
 *
 * The order of operations here is the whole safety story, and it is worth
 * stating because every step is there because the obvious alternative is worse:
 *
 *   1. assemble the context      — fails early if the matter is not the caller's
 *   2. estimate the cost         — pessimistically, assuming full output
 *   3. check the budget          — the ONLY place a limit can be enforced
 *   4. write the draft row       — BEFORE the call, so a crash leaves a trace
 *   5. write the source rows     — the record of what left the server
 *   6. call the model
 *   7. record the spend          — always, even when the call then failed
 *   8. update the draft row
 *
 * Steps 4 and 7 are the ones people get wrong. Writing the draft row after the
 * call means a request that dies mid-stream leaves nothing behind, though the
 * tokens were spent; recording spend only on success means a chamber can fail
 * repeatedly for free, which is a way to spend the platform's money in a loop.
 */

/** Output ceilings by kind. Petitions are long; a covering letter is not. */
const MAX_OUTPUT: Record<DraftKind, number> = {
  petition: 16_000,
  written_statement: 16_000,
  appeal: 14_000,
  brief: 12_000,
  application: 6_000,
  reply: 8_000,
  notice: 4_000,
  letter: 3_000,
};

export type DraftRequest = {
  workspaceId: number;
  caseId: number;
  kind: DraftKind;
  instruction: string;
  documentIds: number[];
  parentDraftId?: number | null;
  tier: "full" | "economy";
  actor: { clerkId: string; name: string };
};

export type DraftOutcome =
  | { ok: true; draftId: number; body: string; costMinor: number; unreadable: unknown[] }
  | { ok: false; status: number; error: string; draftId?: number };

export async function runDraft(
  req: DraftRequest,
  onDelta?: (chunk: string) => void,
): Promise<DraftOutcome> {
  const context = await assemble({
    workspaceId: req.workspaceId,
    caseId: req.caseId,
    kind: req.kind,
    instruction: req.instruction,
    documentIds: req.documentIds,
    rules: rulesFor(req.kind),
  });

  // Null means the matter is not this chamber's. 404, not 403 — a chamber
  // should not be able to learn that a matter id exists elsewhere.
  if (!context) return { ok: false, status: 404, error: "No such matter in this chamber." };

  const model = modelFor(req.kind, req.tier);
  const maxTokens = MAX_OUTPUT[req.kind];
  const estimate = estimateMinor(model, context.estimatedInputTokens, maxTokens);

  const budget = await checkBudget(req.workspaceId, estimate);
  if (!budget.ok) return { ok: false, status: 402, error: budget.reason };

  // Written before the call. A draft row in `generating` that never completes
  // is visible evidence that something was attempted and spent — which is what
  // a chamber is owed when their budget moved.
  const [draft] = await db
    .insert(draftsTable)
    .values({
      workspaceId: req.workspaceId,
      caseId: req.caseId,
      kind: req.kind,
      instruction: req.instruction,
      status: "generating",
      model,
      parentDraftId: req.parentDraftId ?? null,
      createdByClerkId: req.actor.clerkId,
      createdByName: req.actor.name,
    })
    .returning();

  if (context.sources.length > 0) {
    await db.insert(draftSourcesTable).values(
      context.sources.map((s) => ({
        draftId: draft.id,
        workspaceId: req.workspaceId,
        kind: s.kind,
        sourceId: s.sourceId,
        label: s.label,
        tokens: s.tokens,
      })),
    );
  }

  const dedupeKey = `draft:${draft.id}:${randomUUID()}`;

  try {
    const result = await complete(
      {
        model,
        system: context.system,
        user: context.user,
        maxTokens,
        effort: effortFor(req.kind),
        // Only the brief asks the model to name authorities, so only the brief
        // pays for searches. A drafting call with search enabled would wander
        // off to look things up nobody asked about.
        webSearch: req.kind === "brief" ? { maxUses: 8 } : undefined,
      },
      onDelta,
    );

    await recordSpend({
      workspaceId: req.workspaceId,
      draftId: draft.id,
      purpose: req.kind === "brief" ? "brief" : "draft",
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      cacheWriteTokens: result.usage.cacheWriteTokens,
      webSearches: result.usage.webSearches,
      costMinor: result.costMinor,
      dedupeKey,
      actorClerkId: req.actor.clerkId,
    });

    // The banner is prepended here rather than trusted to the model. It is the
    // one line that must be on every draft, and an instruction the model
    // usually follows is not the same as a guarantee.
    const body = result.text.trimStart().startsWith(VERIFY_BANNER.slice(0, 40))
      ? result.text
      : `${VERIFY_BANNER}\n\n${result.text}`;

    await db
      .update(draftsTable)
      .set({
        body,
        status: "ready",
        model: result.model,
        title: titleFor(req.kind, req.instruction),
      })
      .where(eq(draftsTable.id, draft.id));

    return {
      ok: true,
      draftId: draft.id,
      body,
      costMinor: result.costMinor,
      unreadable: context.unreadable,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // A failure still costs the input tokens, which the provider has already
    // billed. Charging a nominal amount is more honest than pretending nothing
    // happened, and it stops a failing loop being free to run.
    await recordSpend({
      workspaceId: req.workspaceId,
      draftId: draft.id,
      purpose: req.kind === "brief" ? "brief" : "draft",
      model,
      inputTokens: context.estimatedInputTokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      webSearches: 0,
      costMinor: costMinor(model, {
        inputTokens: context.estimatedInputTokens,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        webSearches: 0,
      }),
      dedupeKey,
      actorClerkId: req.actor.clerkId,
    }).catch(() => {});

    await db
      .update(draftsTable)
      .set({ status: "failed", error: message.slice(0, 1000) })
      .where(eq(draftsTable.id, draft.id));

    logger.error({ workspaceId: req.workspaceId, caseId: req.caseId, err }, "Drafting failed");
    return { ok: false, status: 502, error: message, draftId: draft.id };
  }
}

/** A short label for the list view, derived rather than asked for. */
function titleFor(kind: DraftKind, instruction: string): string {
  const first = instruction.replace(/\s+/g, " ").trim().slice(0, 70);
  const label = kind === "brief" ? "Case brief" : kind.replace(/_/g, " ");
  return first ? `${label}: ${first}` : label;
}
