import { HEAVY_KINDS, type DraftKind } from "@workspace/db";

/**
 * Which model does what, and what it costs.
 *
 * The only place in this codebase that knows a token price. Everything else
 * asks for a cost in paise and gets one — the same discipline as `plans.ts`
 * being the only place a plan becomes an amount, and for the same reason: a
 * price copied into two files is a price that will be wrong in one of them.
 */

/**
 * Model ids, spelled exactly.
 *
 * Never append a date suffix. `claude-opus-5` is complete as it stands; a
 * dated variant is a different string and the API will reject it.
 */
export const HEAVY_MODEL = "claude-opus-5";
export const LIGHT_MODEL = "claude-sonnet-5";
/** Redaction and other mechanical passes. Cheap, and the task is not subtle. */
export const UTILITY_MODEL = "claude-haiku-4-5";

export type ModelId = typeof HEAVY_MODEL | typeof LIGHT_MODEL | typeof UTILITY_MODEL;

/**
 * List prices, in **US cents per million tokens**, as published.
 *
 * Cents rather than dollars so the arithmetic stays in integers all the way to
 * paise. Money never touches a float here, and a price like $2.50 written as a
 * float would be the one place it did.
 *
 * Checked against the published price list on 2026-08-23. When these change,
 * change them here and nowhere else — and note that historic
 * `ai_usage_events.cost_minor` rows are NOT recomputed, deliberately: what a
 * chamber was charged against their budget in June must not move in July.
 */
type Price = {
  /** Uncached input. */
  input: number;
  output: number;
  /** A 5-minute cache write: 1.25x input. */
  cacheWrite: number;
  /** A cache hit: 0.1x input. */
  cacheRead: number;
};

const PRICES: Record<ModelId, Price> = {
  // $5 / $25 per MTok
  [HEAVY_MODEL]: { input: 500, output: 2_500, cacheWrite: 625, cacheRead: 50 },
  // $2 / $10 per MTok
  [LIGHT_MODEL]: { input: 200, output: 1_000, cacheWrite: 250, cacheRead: 20 },
  // $1 / $5 per MTok
  [UTILITY_MODEL]: { input: 100, output: 500, cacheWrite: 125, cacheRead: 10 },
};

/** Server-side web search, in US cents per search. $10 per 1,000. */
const WEB_SEARCH_CENTS = 1;

/**
 * Paise to the US cent.
 *
 * A single constant rather than a live rate. A drafting budget that moved with
 * the exchange rate every morning would mean a chamber's allowance quietly
 * shrinking on a bad day, which is not something anyone would think to look
 * for. Set slightly above the market so a weakening rupee does not silently
 * turn a 24% cost share into a 30% one before anybody notices.
 *
 * Overridable, because it will need to move eventually and a redeploy is a
 * poor way to react to it.
 */
export function paisePerCent(): number {
  const raw = Number(process.env["AI_PAISE_PER_CENT"]?.trim());
  return Number.isFinite(raw) && raw > 0 ? raw : 95;
}

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
};

export const NO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  webSearches: 0,
};

/**
 * What one call cost, in integer paise.
 *
 * Rounded **up**. A fractional paisa dropped a few thousand times is a budget
 * that never quite empties, and the error only ever runs one way — against the
 * platform. Rounding up costs a chamber at most one paisa a call.
 *
 * Note that cache reads are billed at a tenth of input and cache writes at
 * 1.25x, so a request that hits cache is genuinely cheaper here and not merely
 * faster; `usage.cache_read_input_tokens` is reported separately by the API and
 * must not be added to `input_tokens` or the saving disappears in the maths.
 */
export function costMinor(model: string, usage: Usage): number {
  const price = PRICES[model as ModelId] ?? PRICES[HEAVY_MODEL];
  const cents =
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheWriteTokens * price.cacheWrite) /
      1_000_000 +
    usage.webSearches * WEB_SEARCH_CENTS;
  return Math.ceil(cents * paisePerCent());
}

/**
 * Which model writes this, given what the chamber's plan allows.
 *
 * Petitions, written statements, appeals and reviews get the reasoning-heavy
 * model: they are long, structured, and a mistake in one is a mistake that
 * reaches a judge. Applications, replies, notices and letters get the lighter
 * one — they are short and formulaic, and the difference is not worth six times
 * the price.
 *
 * `economy` overrides all of that and sends everything to the light model. It
 * is what the ₹99 trial runs on: an evaluation should see the feature work end
 * to end without being able to spend ₹30 a draft doing it.
 */
export function modelFor(kind: DraftKind, tier: "full" | "economy"): ModelId {
  if (tier === "economy") return LIGHT_MODEL;
  return HEAVY_KINDS.includes(kind) ? HEAVY_MODEL : LIGHT_MODEL;
}

/**
 * How hard to think about it.
 *
 * `high` is the default and what the heavy work gets. Short mechanical
 * documents run at `medium` — the structure is fixed and the extra reasoning
 * buys nothing but tokens.
 */
export function effortFor(kind: DraftKind): "medium" | "high" {
  return HEAVY_KINDS.includes(kind) ? "high" : "medium";
}

/**
 * A worst-case estimate, for refusing a request BEFORE spending anything.
 *
 * Deliberately pessimistic: it assumes the output runs to the cap. A budget
 * check that used an average would let the last draft of the month overshoot,
 * and "we stopped you at ₹610 of your ₹600" is a support conversation nobody
 * wants to have. Being wrong in the chamber's favour costs them one draft they
 * could have had; being wrong the other way costs real money.
 */
export function estimateMinor(model: string, inputTokens: number, maxOutputTokens: number): number {
  return costMinor(model, {
    ...NO_USAGE,
    inputTokens,
    outputTokens: maxOutputTokens,
  });
}
