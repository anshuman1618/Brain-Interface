/**
 * Preview mode — runs the app without Clerk or Postgres so the UI is fully
 * explorable with no external services configured.
 *
 * SAFETY: this bypasses authentication entirely. It is therefore refused
 * whenever NODE_ENV is "production", regardless of any other setting, and can
 * only engage when CLERK_SECRET_KEY is genuinely absent. There is no env var
 * that turns it on in production — that is deliberate.
 */

import { PREVIEW_USER_IDS, type PreviewRole } from "@workspace/db";

const VALID_ROLES = Object.keys(PREVIEW_USER_IDS) as PreviewRole[];

/** Auth is mocked only when Clerk is unconfigured AND we are not in production. */
export function isPreviewAuth(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return !process.env.CLERK_SECRET_KEY;
}

/**
 * The frontend identifies itself as `Authorization: Bearer preview:<role>`,
 * reusing the API client's existing bearer-token hook rather than inventing a
 * second transport. Returns null when the header is absent or the role is not
 * one we seed, which the caller treats as unauthenticated.
 */
export function previewClerkIdFromRequest(authorization: string | undefined): string | null {
  const raw = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!raw?.startsWith("preview:")) return null;

  const role = raw.slice("preview:".length) as PreviewRole;
  if (!VALID_ROLES.includes(role)) return null;

  return PREVIEW_USER_IDS[role];
}
