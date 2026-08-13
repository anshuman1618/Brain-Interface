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
