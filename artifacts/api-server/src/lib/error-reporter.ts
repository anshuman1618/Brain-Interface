import { logger } from "./logger";

/**
 * Getting told when production breaks.
 *
 * The failure this closes is not "errors are not logged" — they are. It is that
 * nobody reads logs until a customer complains, so the first signal of a fault
 * is a chamber telling you their filing did not upload.
 *
 * Deliberately a webhook rather than an APM SDK. `ERROR_WEBHOOK_URL` accepts a
 * Slack or Discord incoming webhook, or anything that takes a JSON POST, which
 * covers the "somebody finds out within a minute" requirement without adding a
 * dependency that runs in-process next to privileged data. If you outgrow it,
 * a hosted APM is the upgrade — this is a floor, not a ceiling.
 *
 * Three properties it must have, because a reporter that misbehaves during an
 * incident makes the incident worse:
 *
 *  1. It never throws. A failure to report is logged and dropped.
 *  2. It is rate-limited. A crash loop must not emit thousands of POSTs.
 *  3. It never sends payloads. Messages and stack traces only — no request
 *     bodies, no headers, no chamber content.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
/** Identical errors collapse; the counter is reported when the window rolls. */
const DEDUPE_MS = 300_000;

let windowStart = 0;
let sentInWindow = 0;
let suppressed = 0;
const lastSeen = new Map<string, number>();

export type ErrorContext = {
  /** Where it happened: a route, "uncaughtException", a job name. */
  at: string;
  workspaceId?: number | undefined;
  method?: string | undefined;
  path?: string | undefined;
  statusCode?: number | undefined;
};

function webhookUrl(): string | null {
  const raw = process.env["ERROR_WEBHOOK_URL"]?.trim();
  return raw && /^https:\/\//i.test(raw) ? raw : null;
}

function describe(err: unknown): { name: string; message: string; stack: string | null } {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      // Enough to locate it, not so much that a webhook body becomes a novel.
      stack: err.stack ? err.stack.split("\n").slice(0, 12).join("\n") : null,
    };
  }
  return { name: "NonError", message: String(err).slice(0, 500), stack: null };
}

/** True when this one should go out now. */
function allow(key: string): boolean {
  const now = Date.now();

  const seen = lastSeen.get(key);
  if (seen !== undefined && now - seen < DEDUPE_MS) return false;
  lastSeen.set(key, now);
  // Bounded: a process producing thousands of distinct errors must not also
  // leak memory through the thing meant to tell you about it.
  if (lastSeen.size > 500) {
    for (const [k, t] of lastSeen) if (now - t > DEDUPE_MS) lastSeen.delete(k);
  }

  if (now - windowStart > WINDOW_MS) {
    if (suppressed > 0) {
      logger.warn({ suppressed }, "Error reports suppressed by rate limit in the last window");
      suppressed = 0;
    }
    windowStart = now;
    sentInWindow = 0;
  }
  if (sentInWindow >= MAX_PER_WINDOW) {
    suppressed++;
    return false;
  }
  sentInWindow++;
  return true;
}

/**
 * Report an error. Always logs; forwards when a webhook is configured.
 *
 * Fire-and-forget by design — no caller should await telling somebody about a
 * failure, and none should fail because the reporting did.
 */
export function reportError(err: unknown, context: ErrorContext): void {
  const d = describe(err);
  logger.error({ err, ...context }, `Error at ${context.at}`);

  const url = webhookUrl();
  if (!url) return;
  if (!allow(`${context.at}:${d.name}:${d.message}`)) return;

  const service = process.env["SERVICE_NAME"]?.trim() || "lex-practice";
  const env = process.env["NODE_ENV"] ?? "development";
  const text =
    `[${service}/${env}] ${d.name} at ${context.at}\n` +
    `${d.message}\n` +
    (context.method && context.path ? `${context.method} ${context.path}\n` : "") +
    (context.statusCode ? `status ${context.statusCode}\n` : "") +
    (d.stack ? `\n${d.stack}` : "");

  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // `text` is what Slack and Discord both read; the structured fields are
    // there for anything that prefers them.
    body: JSON.stringify({
      text,
      service,
      environment: env,
      at: context.at,
      error: d,
      request:
        context.method && context.path
          ? { method: context.method, path: context.path, statusCode: context.statusCode }
          : undefined,
      workspaceId: context.workspaceId,
      timestamp: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(5_000),
  }).catch((e: unknown) => {
    logger.warn({ err: e }, "Could not deliver an error report");
  });
}

/**
 * Catch what never reaches a route.
 *
 * An unhandled rejection is reported and the process keeps running; an
 * uncaught exception is reported and then the process exits, because its state
 * is no longer trustworthy and a supervisor restarting it is the safe move.
 * The delay before exiting is only there to give the report a chance to leave.
 */
export function installProcessHandlers(): void {
  process.on("unhandledRejection", (reason) => {
    reportError(reason, { at: "unhandledRejection" });
  });

  process.on("uncaughtException", (err) => {
    reportError(err, { at: "uncaughtException" });
    setTimeout(() => process.exit(1), 1_000).unref();
  });
}
