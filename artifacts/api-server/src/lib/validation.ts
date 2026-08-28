/**
 * Turns a Zod failure into one sentence a person can act on.
 *
 * `error.message` is a serialised array of issue objects. Returning it to the
 * browser means the user reads JSON, and the client has nothing better to show
 * than the whole blob — which is what every 400 on the sign-up path did.
 *
 * The first issue is the one reported: a form with two bad fields is a form the
 * user fixes one field at a time, and naming all of them in a single sentence
 * reads worse than naming the first.
 *
 * Typed structurally rather than against `zod` — this package does not depend on
 * it directly, and the shape below is all that is read. Any ZodError satisfies it.
 */
/**
 * A path parameter that is safe to compare against an `integer` column.
 *
 * Every id in this API is a Postgres `integer` — signed 32-bit. Anything that is
 * not one has to be refused *here*, because the alternative is that it reaches
 * the driver and Postgres raises `invalid input syntax for type integer`, which
 * surfaces as a 500. A 500 is the wrong answer twice over: it tells a prober
 * that their input reached the database, and it buries a real fault among
 * failures that are only ever malformed URLs.
 *
 * `Number.isInteger` was the guard in most places and is not enough:
 * `Number("9007199254740993")` is an integer as far as JavaScript is concerned,
 * and is still eleven digits past what an `integer` column can hold. The range
 * check below is the half that was missing.
 *
 * Digits only, by regular expression rather than by `Number`. `Number` accepts
 * "1e9", " 1", "0x10", "+1" and "" — all of which are either a different number
 * from the one written or not a number at all, and none of which any client of
 * this API has a reason to send.
 *
 * Ids start at 1: every table uses a generated identity, so 0 and negatives can
 * only ever be a probe.
 */
const MAX_INT4 = 2147483647;

export function parseId(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^[0-9]+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_INT4 ? n : null;
}

/**
 * Refuse a malformed id before the route handler runs.
 *
 * For the routers whose path parameters are validated by the GENERATED zod
 * schemas rather than by `parseId`. Those schemas come from `openapi.yaml`,
 * where the parameter is declared `type: integer` — but orval renders that as
 * `zod.coerce.number()`, which drops both the integer constraint and any bound.
 * "1.5" and "9007199254740993" therefore pass validation and reach Postgres,
 * which is where they become a 500. The spec cannot express the fix (adding
 * `minimum` yields `.min()`, and nothing yields `.int()`), so the check has to
 * live here.
 *
 * `router.param` rather than a blanket middleware, because it fires only when a
 * route carrying that parameter actually matches. A literal segment in the same
 * position — `/cases/conflict-check`, `/invoices/unbilled`, `/tasks/overdue` —
 * matches its own route first and never reaches this.
 *
 * 404, not 400: an id that cannot exist and an id that does not exist should be
 * indistinguishable, or the difference between them enumerates the table.
 */
export function guardIdParams(router: import("express").IRouter, ...names: string[]): void {
  for (const name of names) {
    router.param(name, (_req, res, next, value) => {
      if (parseId(value) === null) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      next();
    });
  }
}

type ValidationFailure = {
  issues?: ReadonlyArray<{ path?: ReadonlyArray<unknown>; message?: string }>;
};

export function zodMessage(
  error: ValidationFailure,
  fallback = "That request was not valid.",
): string {
  const issue = error.issues?.[0];
  if (!issue?.message) return fallback;

  // `path` is empty when the whole body failed (e.g. it was not an object), in
  // which case the issue message stands on its own.
  const field = (issue.path ?? [])
    .filter((segment): segment is string | number => {
      return typeof segment === "string" || typeof segment === "number";
    })
    .join(".");

  return field ? `${field}: ${issue.message}` : issue.message;
}
