import { randomUUID } from "node:crypto";
import { complete } from "./client";
import { recordSpend } from "./budget";
import { UTILITY_MODEL } from "./models";
import { ANONYMISE_RULES } from "./prompts";

/**
 * Strip identifying detail out of a past filing, so it can be kept as an
 * example of how a chamber writes.
 *
 * The cheap model, because the task is mechanical: find the names and replace
 * them. It is also the task where the expensive model's instinct to improve
 * things is actively harmful — an exemplar is kept for its FORM, and a model
 * that tidies the prose has destroyed the only reason to keep it.
 *
 * ── Why this is not the last line of defence ────────────────────────────
 *
 * It is a first pass, and it is named accordingly. An automatic redaction
 * nobody read is a redaction you cannot rely on: the model will catch every
 * name and miss "the Kanpur consignment", which identifies the client to anyone
 * in the chamber and to the model on every future draft. The advocate reviewing
 * the result is the control; this is what makes reviewing it a two-minute job
 * instead of an hour's.
 *
 * The spend is recorded like any other, against the same budget. It is small —
 * a few paise per document — but a call that spent nothing traceable would be a
 * hole in the meter.
 */

/** Redaction runs on the whole document, so it needs room for all of it back. */
const MAX_OUTPUT = 32_000;

export async function anonymise(input: {
  workspaceId: number;
  text: string;
  actorClerkId: string;
}): Promise<{ text: string; costMinor: number }> {
  const result = await complete({
    model: UTILITY_MODEL,
    system: ANONYMISE_RULES,
    user: input.text,
    maxTokens: MAX_OUTPUT,
    effort: "medium",
  });

  await recordSpend({
    workspaceId: input.workspaceId,
    draftId: null,
    purpose: "anonymise",
    model: result.model,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cacheReadTokens: result.usage.cacheReadTokens,
    cacheWriteTokens: result.usage.cacheWriteTokens,
    webSearches: 0,
    costMinor: result.costMinor,
    dedupeKey: `anonymise:${input.workspaceId}:${randomUUID()}`,
    actorClerkId: input.actorClerkId,
  });

  return { text: result.text, costMinor: result.costMinor };
}
