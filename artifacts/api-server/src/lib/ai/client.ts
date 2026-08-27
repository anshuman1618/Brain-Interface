import Anthropic from "@anthropic-ai/sdk";
import { isPreviewDatabase } from "@workspace/db";
import { logger } from "../logger";
import { NO_USAGE, costMinor, type Usage } from "./models";

/**
 * The one place this server talks to a model.
 *
 * Everything above it — drafting, review, redaction — hands over a system
 * prompt, some messages and a model id, and gets back text plus what it cost.
 * Nothing else imports the SDK, which is what keeps "how do we call the API"
 * a single decision rather than five slightly different ones.
 *
 * **Server-side only.** The SDK must never reach the SPA bundle: it would put
 * an API key in a browser, and there is no arrangement of environment
 * variables that makes that safe.
 *
 * ── Off unless configured ───────────────────────────────────────────────
 *
 * No `ANTHROPIC_API_KEY` means the feature is off, exactly like Razorpay and
 * SMTP — not a refusal to start. A chamber that has not bought drafting should
 * not be prevented from running the rest of the product, and an operator
 * should be able to deploy without deciding about AI first.
 */

/** Roughly four characters to the token. Only ever used to size a guess. */
const CHARS_PER_TOKEN = 4;

export function aiConfigured(): boolean {
  return Boolean(process.env["ANTHROPIC_API_KEY"]?.trim());
}

/**
 * Whether this process may call the real API at all.
 *
 * Preview mode never does. CI runs thirteen suites against a preview server,
 * and a single accidental live call in a loop is a bill nobody budgeted for —
 * so the stub is selected by the same `isPreviewDatabase()` guard that keeps
 * fixture courts out of production, rather than by a separate flag somebody
 * could forget to set.
 */
export function usingStubModel(): boolean {
  return isPreviewDatabase() || !aiConfigured();
}

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export type Block =
  | { type: "text"; text: string; cache?: boolean }
  | { type: "document"; title: string; text: string };

export type CompletionRequest = {
  model: string;
  /** The stable prefix. Cached — put nothing volatile in here. */
  system: string;
  /** The volatile part: this matter, this instruction. */
  user: string;
  maxTokens: number;
  effort: "medium" | "high";
  /** Turns on the server-side web search tool, for citation checking. */
  webSearch?: { maxUses: number } | undefined;
};

/**
 * The only hosts a search from this server may reach.
 *
 * Search is enabled for one job — confirming an Indian citation exists — and
 * these are the sources that answer it. Restricting the tool is not about
 * result quality; it is the containment for a specific attack.
 *
 * A review prompt contains documents the chamber did not write: an opposing
 * party's filing is exactly the sort of thing an advocate ticks for a review,
 * and it is attacker-controlled text sitting in the same context as a tool that
 * makes outbound requests. Text inside it can try to instruct the model to
 * search for a string assembled from the matter's own facts, which turns the
 * search box into a way to carry privileged information out of the server.
 *
 * An allowlist does not stop the model being told to do that. It stops the
 * telling from being worth anything: a query that can only ever be sent to
 * three court and case-law sites carries data to nobody who is listening.
 *
 * Extending this list widens that channel. Add a host only when a citation
 * genuinely cannot be confirmed without it.
 */
const SEARCH_ALLOWED_DOMAINS = [
  "indiankanoon.org",
  "main.sci.gov.in",
  "allahabadhighcourt.in",
  "judgments.ecourts.gov.in",
];

export type CompletionResult = {
  text: string;
  model: string;
  usage: Usage;
  costMinor: number;
};

/**
 * A deterministic stand-in for the model.
 *
 * Not a mock of the API — a substitute for the model, in the same sense the
 * fixture court adapter substitutes for a real court. Everything around it runs
 * for real: the budget check, the spend record, the streaming, the draft row,
 * the source record. Only the text is invented, and it is invented the same way
 * every time so a suite can assert on it.
 *
 * The synthetic usage numbers are plausible rather than zero, deliberately:
 * zero-cost calls would let the budget suite pass without the budget working.
 */
function stubCompletion(req: CompletionRequest): CompletionResult {
  const inputTokens = Math.ceil((req.system.length + req.user.length) / CHARS_PER_TOKEN);
  // NOTHING from the prompt is echoed back, and that is not a stylistic
  // choice. An earlier version quoted the instruction, which meant the stub's
  // output contained whatever it had been given — so a redaction pass appeared
  // to leak its own input, and any test asserting "this client's name must not
  // appear in the output" failed for a reason that had nothing to do with the
  // code under test. A stub that reflects its input cannot be used to check
  // that something was removed.
  const text =
    `## Prepared from the chamber's record\n\n` +
    `_Produced by the preview stub, not by a model. It exists so that drafting can be ` +
    `exercised end to end without a network call, and it deliberately reproduces ` +
    `nothing it was given._\n\n` +
    `1. The matter is set out above.\n` +
    `2. The relief sought follows from it.\n` +
    `3. The chamber's earlier filings supplied the structure.\n`;
  // Output is reported as a plausible FRACTION OF THE CEILING rather than as the
  // length of the placeholder above, and that is deliberate.
  //
  // Output tokens dominate what a draft actually costs. A stub reporting the
  // ~100 tokens of its own placeholder makes every preview draft cost a third
  // of a paisa, which means the budget — the control that stops a chamber
  // spending more than it has — can never be exhausted in any test, and so is
  // never actually exercised. A stub whose usage is unrealistic quietly makes
  // the thing it is standing in for untestable.
  //
  // 0.6 of the ceiling is roughly what a real petition returns against a 16k
  // cap. It is an estimate, and it is the honest kind: it makes preview spend
  // resemble production spend instead of flattering it.
  const outputTokens = Math.round(req.maxTokens * 0.6);
  const usage: Usage = { ...NO_USAGE, inputTokens, outputTokens };
  return { text, model: `stub:${req.model}`, usage, costMinor: costMinor(req.model, usage) };
}

/**
 * Ask for a completion, streamed.
 *
 * Streamed rather than awaited whole for a practical reason: a petition runs to
 * tens of thousands of tokens and takes a minute or more, which is past the
 * point where an HTTP request survives a proxy. `onDelta` also lets the page
 * show text as it arrives, which is the difference between a feature that feels
 * fast and one that looks broken.
 *
 * Adaptive thinking is on. It costs output tokens and it is what makes the
 * difference on a long structured document — the estimate in `models.ts`
 * already assumes it.
 */
export async function complete(
  req: CompletionRequest,
  onDelta?: (chunk: string) => void,
): Promise<CompletionResult> {
  if (usingStubModel()) {
    const result = stubCompletion(req);
    // Delivered in pieces so the streaming path is exercised in CI too, rather
    // than only in production where nobody is watching for it.
    if (onDelta) for (const part of result.text.split("\n")) onDelta(`${part}\n`);
    return result;
  }

  const stream = anthropic().messages.stream({
    model: req.model,
    max_tokens: req.maxTokens,
    thinking: { type: "adaptive" },
    output_config: { effort: req.effort },
    // The stable prefix, cached. Everything volatile is in the user turn, after
    // this breakpoint — a byte changed here invalidates the whole cache, which
    // is why the matter and the instruction are deliberately not in it.
    system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: req.user }],
    ...(req.webSearch
      ? {
          tools: [
            {
              type: "web_search_20260209",
              name: "web_search",
              max_uses: req.webSearch.maxUses,
              // See SEARCH_ALLOWED_DOMAINS. This is the containment for prompt
              // injection carried in a document the chamber did not write.
              allowed_domains: SEARCH_ALLOWED_DOMAINS,
            },
          ],
        }
      : {}),
  });

  if (onDelta) {
    stream.on("text", (chunk) => onDelta(chunk));
  }

  const message = await stream.finalMessage();

  const usage: Usage = {
    inputTokens: message.usage.input_tokens ?? 0,
    outputTokens: message.usage.output_tokens ?? 0,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    webSearches: message.usage.server_tool_use?.web_search_requests ?? 0,
  };

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  // A safety decline arrives as a 200 with no useful content. Reported rather
  // than returned as an empty draft, which would look like a bug in the app.
  if (message.stop_reason === "refusal") {
    logger.warn(
      { model: req.model, category: message.stop_details?.category },
      "The model declined a drafting request",
    );
    throw new Error(
      "The model declined to produce this document. Rephrasing the instruction " +
        "usually resolves it; if it does not, the matter may need a different approach.",
    );
  }

  return {
    text,
    model: message.model,
    usage,
    costMinor: costMinor(req.model, usage),
  };
}

/** A rough token count for sizing a request before it is sent. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
