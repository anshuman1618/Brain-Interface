/**
 * Preview mode — runs the app without Clerk or Postgres so the UI is fully
 * explorable with no external services configured.
 *
 * SAFETY: this bypasses authentication entirely. It is therefore refused
 * whenever NODE_ENV is "production", regardless of any other setting, and can
 * only engage when CLERK_SECRET_KEY is genuinely absent. There is no env var
 * that turns it on in production — that is deliberate.
 */

import { PREVIEW_USER_IDS, normaliseEmail, type PreviewRole } from "@workspace/db";

const VALID_ROLES = Object.keys(PREVIEW_USER_IDS) as PreviewRole[];

/** Auth is mocked only when Clerk is unconfigured AND we are not in production. */
export function isPreviewAuth(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return !process.env.CLERK_SECRET_KEY;
}

export type PreviewIdentity =
  | { kind: "seeded"; clerkId: string }
  /**
   * Stands in for "somebody just completed Google/Zoho/email sign-in and this is
   * the address the provider vouched for". The user is provisioned on the fly,
   * exactly as a real first-time Clerk sign-in would be, and then has to clear
   * the access list like anyone else — which is how an unrecognised address can
   * be demonstrated end to end without a real identity provider.
   */
  | { kind: "email"; email: string; provider: string; displayName: string };

/**
 * The frontend identifies preview callers by a bearer token instead of a Clerk
 * session JWT:
 *
 *   preview:<seeded-identity>
 *   preview:email:<provider>:<email>[:<display name>]
 *
 * Returns null when the header is absent or malformed, which the caller treats
 * as unauthenticated. Neither form carries authority — both only name an
 * identity, and access is still read from the database afterwards.
 */
export function previewIdentityFromRequest(authorization: string | undefined): PreviewIdentity | null {
  const raw = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!raw?.startsWith("preview:")) return null;

  const rest = raw.slice("preview:".length);

  if (rest.startsWith("email:")) {
    const [provider, email, ...nameParts] = rest.slice("email:".length).split(":");
    const normalised = normaliseEmail(decodeURIComponent(email ?? ""));
    if (!normalised.includes("@")) return null;
    if (!["google", "zoho", "email"].includes(provider)) return null;
    return {
      kind: "email",
      email: normalised,
      provider,
      displayName: decodeURIComponent(nameParts.join(":") || "").trim(),
    };
  }

  const role = rest as PreviewRole;
  if (!VALID_ROLES.includes(role)) return null;
  return { kind: "seeded", clerkId: PREVIEW_USER_IDS[role] };
}

/** Back-compat helper for callers that only need the seeded-identity form. */
export function previewClerkIdFromRequest(authorization: string | undefined): string | null {
  const identity = previewIdentityFromRequest(authorization);
  return identity?.kind === "seeded" ? identity.clerkId : null;
}
