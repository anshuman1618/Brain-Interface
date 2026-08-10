/**
 * Preview mode — runs the app without Clerk or Postgres so the platform is
 * usable with no external services configured.
 *
 * SAFETY: this bypasses authentication entirely. It is therefore refused
 * whenever NODE_ENV is "production", regardless of any other setting, and can
 * only engage when CLERK_SECRET_KEY is genuinely absent. There is no env var
 * that turns it on in production — that is deliberate.
 */

import { normaliseEmail } from "@workspace/db";

/** Auth is mocked only when Clerk is unconfigured AND we are not in production. */
export function isPreviewAuth(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return !process.env.CLERK_SECRET_KEY;
}

/**
 * Stands in for "somebody completed Google/Zoho/email sign-in and this is the
 * address the provider vouched for".
 *
 * There are no seeded identities any more — the platform starts empty, so the
 * only way in is to sign in with an address and either create a chamber or be
 * admitted to one. That is the same path a real Clerk sign-in takes.
 */
export type PreviewIdentity = {
  email: string;
  provider: string;
  displayName: string;
};

/**
 * The frontend identifies preview callers by a bearer token instead of a Clerk
 * session JWT:
 *
 *   preview:email:<provider>:<email>[:<display name>]
 *
 * Returns null when the header is absent or malformed, which the caller treats
 * as unauthenticated. The token carries no authority — it only names an
 * identity, and access is still read from the database afterwards.
 */
export function previewIdentityFromRequest(
  authorization: string | undefined,
): PreviewIdentity | null {
  const raw = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!raw?.startsWith("preview:email:")) return null;

  const [provider, email, ...nameParts] = raw.slice("preview:email:".length).split(":");
  const normalised = normaliseEmail(decodeURIComponent(email ?? ""));
  if (!normalised.includes("@")) return null;
  if (!["google", "zoho", "email"].includes(provider)) return null;

  return {
    email: normalised,
    provider,
    displayName: decodeURIComponent(nameParts.join(":") || "").trim(),
  };
}

/** Stable synthetic Clerk-style id for a preview user identified by email. */
export function previewClerkIdForEmail(email: string): string {
  return `preview_email_${normaliseEmail(email).replace(/[^a-z0-9]/g, "_")}`;
}
