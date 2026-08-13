import { ApiError } from "@workspace/api-client-react";

/**
 * The sentence to put in front of a user when a request fails.
 *
 * `ApiError.message` is built for a developer reading a console: it leads with
 * `HTTP 404 Not Found:` and only then says what went wrong. That string was
 * going straight into toasts and inline banners, so a user who mistyped an
 * address was told about a status code.
 *
 * The server's own `message` field is preferred — every route in this API that
 * refuses something explains why in it. Codes like `invalid_request` in `error`
 * are skipped: they are for logs, not for people.
 */

/** Machine-readable values that must never be shown as prose. */
const CODE_LIKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

function fromPayload(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;

  const message = typeof record["message"] === "string" ? record["message"].trim() : "";
  if (message) return message;

  const error = typeof record["error"] === "string" ? record["error"].trim() : "";
  // "Give the chamber a name." is a message; "invalid_request" is a code.
  if (error && !CODE_LIKE.test(error)) return error;

  return null;
}

function fromStatus(status: number): string {
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 403) return "You do not have access to that.";
  if (status === 404) return "That was not found.";
  if (status === 409) return "That conflicts with something that already exists.";
  if (status === 429) return "Too many attempts. Wait a moment and try again.";
  if (status >= 500) return "Something went wrong at our end. Try again in a moment.";
  return "That request could not be completed.";
}

export function userMessage(err: unknown, fallback = "Something went wrong. Try again."): string {
  if (err instanceof ApiError) {
    return fromPayload(err.data) ?? fromStatus(err.status);
  }

  // A network failure never reaches the server, so there is no payload to read
  // and `fetch` only ever says "Failed to fetch".
  if (err instanceof TypeError) {
    return "Could not reach the server. Check your connection and try again.";
  }

  if (err instanceof Error && err.message.trim()) return err.message.trim();

  return fallback;
}
