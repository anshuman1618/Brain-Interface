/**
 * Preview mode — runs the app without Clerk or Postgres so the platform is
 * usable with no external services configured.
 *
 * SAFETY: this bypasses authentication entirely. It is therefore refused
 * whenever NODE_ENV is "production", regardless of any other setting, and can
 * only engage when CLERK_SECRET_KEY is genuinely absent. There is no env var
 * that turns it on in production — that is deliberate.
 */

import { normaliseEmail, normalisePhone } from "@workspace/db";

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
  /** E.164, or "". Exactly one of email / phone is set. */
  phone: string;
  provider: string;
  displayName: string;
};

/**
 * The frontend identifies preview callers by a bearer token instead of a Clerk
 * session JWT. Two channels, one per kind of identifier:
 *
 *   preview:email:<provider>:<email>[:<display name>]
 *   preview:phone:<provider>:<e164>[:<display name>]
 *
 * The `preview:email:` form is unchanged and must stay that way — every
 * integration suite in scripts/ci constructs it by hand.
 *
 * Returns null when the header is absent or malformed, which the caller treats
 * as unauthenticated. The token carries no authority — it only names an
 * identity, and access is still read from the database afterwards.
 */
export function previewIdentityFromRequest(
  authorization: string | undefined,
): PreviewIdentity | null {
  const raw = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!raw) return null;

  const channel = raw.startsWith("preview:email:")
    ? "email"
    : raw.startsWith("preview:phone:")
      ? "phone"
      : null;
  if (!channel) return null;

  const [provider, identifier, ...nameParts] = raw.slice(`preview:${channel}:`.length).split(":");
  const displayName = decodeURIComponent(nameParts.join(":") || "").trim();
  const decoded = decodeURIComponent(identifier ?? "");

  if (channel === "phone") {
    const phone = normalisePhone(decoded);
    // Same rule as production: a number that will not normalise is not an
    // identity. Accepting the raw string would put a value in users.phone that
    // no canonical access-list row could ever match.
    if (!phone) return null;
    if (!["phone", "email"].includes(provider)) return null;
    return { email: "", phone, provider, displayName };
  }

  const normalised = normaliseEmail(decoded);
  if (!normalised.includes("@")) return null;
  if (!["google", "zoho", "email"].includes(provider)) return null;

  return { email: normalised, phone: "", provider, displayName };
}

/**
 * Stable synthetic Clerk-style id for a preview identity.
 *
 * The id must be a pure function of the identifier: it is the only thing tying
 * a preview caller to their row in `users`, so the same address or number has
 * to produce the same id on every request and across restarts.
 *
 * Email and phone ids are namespaced apart so they cannot collide, and the
 * phone form is built from the normalised E.164 — two spellings of one number
 * are one person.
 */
export function previewClerkId(identity: Pick<PreviewIdentity, "email" | "phone">): string {
  if (identity.phone) {
    return `preview_phone_${normalisePhone(identity.phone).replace(/[^0-9]/g, "")}`;
  }
  return `preview_email_${normaliseEmail(identity.email).replace(/[^a-z0-9]/g, "_")}`;
}
