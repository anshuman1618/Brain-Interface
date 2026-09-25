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
 *  3. It redacts. See below — this was the one that was not true.
 *
 * ── What it sends, and what it used to ────────────────────────────────────
 *
 * This docblock claimed "no request bodies, no headers, no chamber content"
 * for a long time while forwarding both a matter id and, intermittently, a
 * client's email address. Bodies and headers were never read — that half held.
 * The other half did not:
 *
 *   - `req.path` went out verbatim, so a fault on `/api/cases/42` named the
 *     matter, twice: in `text` and in `request.path`.
 *   - `err.message` went out untruncated and unfiltered. A Postgres unique
 *     violation reads `Key (email)=(partner@chamber.in) already exists`; an R2
 *     failure carries the object key; Razorpay carries the provider's own
 *     description. None of that is the chamber's to leak.
 *
 * It matters more here than the general case because `breach-runbook.md` §1
 * names whatever reached this webhook as incident evidence. A Slack workspace
 * holding matter ids is then itself in scope when it is compromised, and the
 * six-hour CERT-In clock applies to that too.
 *
 * So `redactPath`, `redactMessage` and `redactStack` below run on everything
 * before it is serialised, and `scripts/ci/suites/error-reporting.mjs` asserts
 * the negative — that the address and the id are NOT in the delivered payload.
 * A redaction claim that nothing tests is exactly how this drifted, and the
 * suite earned its place on its first run: it caught the scrubbed message
 * going out unscrubbed a second time in the stack's header line.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
/** Identical errors collapse; the counter is reported when the window rolls. */
const DEDUPE_MS = 300_000;
/** The crash path trades a slower restart for a report that actually lands. */
const UNCAUGHT_TIMEOUT_MS = 2_500;

let windowStart = 0;
let sentInWindow = 0;
let suppressed = 0;
const lastSeen = new Map<string, number>();

export type ErrorContext = {
  /** Where it happened: a route, "uncaughtException", a job name. */
  at: string;
  method?: string | undefined;
  /**
   * The request path, which is REDACTED to its route shape before sending.
   *
   * Pass `req.path`, never `req.originalUrl`. `path` excludes the query string
   * and `originalUrl` does not — `/api/search?q=<a client's name>` would go
   * straight out. That distinction used to be undocumented, which made it one
   * careless edit from a leak; the suite now pins it.
   */
  path?: string | undefined;
  statusCode?: number | undefined;
};

function webhookUrl(): string | null {
  const raw = process.env["ERROR_WEBHOOK_URL"]?.trim();
  return raw && /^https:\/\//i.test(raw) ? raw : null;
}

/**
 * A path reduced to its route shape: `/api/cases/42` becomes `/api/cases/:id`.
 *
 * Knowing WHICH route failed is the whole diagnostic value of the path; knowing
 * which row it failed on is the chamber's business. So every segment that looks
 * like an identifier is replaced, and the rest is left alone.
 *
 * Deliberately over-broad. Express does not expose the matched route pattern to
 * a terminal error handler — `req.route` is undefined there — so this cannot
 * look up the real shape and has to recognise ids by their form. A route
 * segment that is all digits, a UUID, a long opaque token, or one of Clerk's
 * prefixed ids is replaced. The cost of over-matching is a slightly vaguer
 * path in an alert; the cost of under-matching is a matter id in somebody's
 * Slack channel, so it errs the first way on purpose.
 */
export function redactPath(path: string): string {
  return path
    .split("/")
    .map((seg) => {
      if (!seg) return seg;
      if (/^\d+$/.test(seg)) return ":id";
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ":id";
      // Clerk and preview identities: user_2ab…, preview_email_…, sess_…
      if (/^(user|sess|org|preview|wsp)_/i.test(seg)) return ":id";
      // Anything long and opaque — a token, a hash, a blob key.
      if (seg.length >= 24 && /^[A-Za-z0-9_-]+$/.test(seg)) return ":id";
      return seg;
    })
    .join("/");
}

/**
 * An error message with the things that are not ours taken out.
 *
 * Every pattern here is one this codebase has actually been observed to
 * produce, not a generic list:
 *
 *   - Postgres unique violations quote the offending value —
 *     `Key (email)=(partner@chamber.in) already exists`.
 *   - `r2.ts` builds its failure message around the object key, and blob keys
 *     are derived from workspace and case identity.
 *   - A connection string in a driver error carries the database password.
 *
 * Replaced with a marker rather than deleted, so the SHAPE of the error
 * survives: "duplicate key … [redacted:email] already exists" is still a
 * diagnosis, where a blank is not.
 */
function scrub(text: string): string {
  return (
    text
      // Credentials inside any URL, before the host. FIRST, and the order is
      // load-bearing: `postgres://lex:pw@db.internal.example/lex` also matches
      // the email pattern below (`pw@db.internal.example`), so running that one
      // first redacts the password but labels it `[redacted:email]` and leaves
      // the scheme and user dangling. Both orders are safe; only this one is
      // legible in an alert.
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[redacted:credentials]@")
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[redacted:email]")
      // Postgres: Key (col)=(value)
      .replace(/Key \(([^)]*)\)=\([^)]*\)/g, "Key ($1)=([redacted])")
      .replace(/\b(bearer|token|secret|password|api[_-]?key)\b\s*[:=]?\s*\S+/gi, "$1 [redacted]")
      // Blob keys: the store's own path shape.
      .replace(/\b[0-9a-f]{32,}\b/gi, "[redacted:key]")
  );
}

export function redactMessage(message: string): string {
  return scrub(message).slice(0, 300);
}

/**
 * A stack the same patterns have been run over, capped at twelve frames.
 *
 * **`err.stack` begins with the message.** That is the whole reason this
 * function exists, and it is the mistake the first attempt at this redaction
 * made: `message` was scrubbed, `stack` was passed through as "this codebase's
 * own file paths, no argument values", and the unredacted message went out in
 * the stack's header line anyway. `scripts/ci/suites/error-reporting.mjs`
 * caught it on its first run, which is the argument for the suite in one line.
 *
 * So the whole stack — header line included — goes through the same scrub as
 * the message, rather than the header being trusted because the frames below it
 * are. Scrubbing the frames as well is close to free, and a frame can carry a
 * data URL or an eval'd source.
 */
function redactStack(stack: string): string {
  return scrub(stack).split("\n").slice(0, 12).join("\n");
}

function describe(err: unknown): { name: string; message: string; stack: string | null } {
  if (err instanceof Error) {
    return {
      name: err.name,
      // Capped as well as scrubbed. The NonError branch below always capped;
      // this one did not, so a driver error could run to thousands of
      // characters of somebody's data.
      message: redactMessage(err.message),
      // Twelve frames: enough to locate it, not so much that a webhook body
      // becomes a novel. Scrubbed, not capped — a 300-character cap here would
      // leave two frames and no diagnosis.
      stack: err.stack ? redactStack(err.stack) : null,
    };
  }
  return { name: "NonError", message: redactMessage(String(err)), stack: null };
}

/**
 * True when this one should go out now.
 *
 * Note what this does NOT do: record the key. That happens in `reportError`
 * after a delivery actually succeeds. It used to happen here, which meant a
 * failed POST — a 500 from Slack, a DNS blip, the 5s timeout — still consumed
 * the dedupe slot and blackholed that error for the next five minutes. The
 * fault you never hear about because telling you about it failed is the worst
 * available behaviour for this module.
 */
function allow(key: string): boolean {
  const now = Date.now();

  const seen = lastSeen.get(key);
  if (seen !== undefined && now - seen < DEDUPE_MS) return false;
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
export function reportError(err: unknown, context: ErrorContext, timeoutMs = 5_000): void {
  const d = describe(err);
  // The LOG keeps everything. It stays on the host, inside the trust boundary,
  // and an investigation needs the unredacted message. Only what crosses to a
  // third party is scrubbed.
  logger.error({ err, ...context }, `Error at ${context.at}`);

  const url = webhookUrl();
  if (!url) return;

  const key = `${context.at}:${d.name}:${d.message}`;
  if (!allow(key)) return;

  const service = process.env["SERVICE_NAME"]?.trim() || "lex-practice";
  const env = process.env["NODE_ENV"] ?? "development";
  const path = context.path ? redactPath(context.path) : undefined;
  const text =
    `[${service}/${env}] ${d.name} at ${context.at}\n` +
    `${d.message}\n` +
    (context.method && path ? `${context.method} ${path}\n` : "") +
    (context.statusCode ? `status ${context.statusCode}\n` : "") +
    (d.stack ? `\n${d.stack}` : "");

  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // `text` is what Slack and Discord both read; the structured fields are
    // there for anything that prefers them. Both carry the REDACTED path —
    // there is no unredacted copy anywhere in this body.
    body: JSON.stringify({
      text,
      service,
      environment: env,
      at: context.at,
      error: d,
      request:
        context.method && path
          ? { method: context.method, path, statusCode: context.statusCode }
          : undefined,
      timestamp: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
    .then((res) => {
      // Only a delivered report starts the dedupe clock. A refused one leaves
      // the key absent so the next occurrence is reported rather than swallowed.
      if (res.ok) {
        lastSeen.set(key, Date.now());
      } else {
        logger.warn({ status: res.status }, "Error report refused by the webhook endpoint");
      }
    })
    .catch((e: unknown) => {
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
 *
 * THE EXIT CODE IS LOAD-BEARING and easy to lose here. Registering this handler
 * suppresses Node's default behaviour, which was to exit non-zero. Two things
 * keep that guarantee:
 *
 *   - `process.exitCode` is set immediately, so if the event loop drains before
 *     the timer below fires — exactly what happens when the exception is thrown
 *     during startup and nothing else is scheduled — the process still exits 1.
 *   - The timer is NOT unref'd. It has to hold the process open long enough for
 *     the report to be delivered.
 *
 * Get this wrong and a failed deploy exits 0, which a host reads as a clean
 * shutdown and a successful release.
 */
export function installProcessHandlers(): void {
  process.on("unhandledRejection", (reason) => {
    reportError(reason, { at: "unhandledRejection" });
  });

  process.on("uncaughtException", (err) => {
    // The two budgets have to agree, and they did not: the default 5s fetch
    // timeout outlived a 1s exit timer, so the single report you most want —
    // the one about the crash — was the one most likely to be cut off midway.
    // A shorter timeout on this path, and an exit held just past it.
    reportError(err, { at: "uncaughtException" }, UNCAUGHT_TIMEOUT_MS);
    process.exitCode = 1;
    setTimeout(() => process.exit(1), UNCAUGHT_TIMEOUT_MS + 500);
  });
}
