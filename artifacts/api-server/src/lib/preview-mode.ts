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
  /** E.164, or null. Exactly one of `email` / `phone` is ever set. */
  phone: string | null;
  provider: string;
  displayName: string;
};

/**
 * The frontend identifies preview callers by a bearer token instead of a Clerk
 * session JWT. Two forms, one per kind of identifier:
 *
 *   preview:email:<provider>:<url-encoded email>[:<display name>]
 *   preview:phone:<provider>:<url-encoded E.164>[:<display name>]
 *
 * The email form is byte-identical to what it has always been. That is
 * deliberate and load-bearing: every CI suite and both browser suites build
 * tokens with it, and they must keep passing untouched — that is the evidence
 * the email path was extended rather than altered.
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

  if (raw.startsWith("preview:email:")) {
    const [provider, email, ...nameParts] = raw.slice("preview:email:".length).split(":");
    const normalised = normaliseEmail(decodeURIComponent(email ?? ""));
    if (!normalised.includes("@")) return null;
    if (!["google", "zoho", "email"].includes(provider)) return null;

    return {
      email: normalised,
      phone: null,
      provider,
      displayName: decodeURIComponent(nameParts.join(":") || "").trim(),
    };
  }

  if (raw.startsWith("preview:phone:")) {
    const [provider, phone, ...nameParts] = raw.slice("preview:phone:".length).split(":");
    // normalisePhone returns "" for anything unusable, so this one check covers
    // absent, malformed and out-of-range alike.
    const normalised = normalisePhone(decodeURIComponent(phone ?? ""));
    if (!normalised) return null;
    if (provider !== "phone") return null;

    return {
      email: "",
      phone: normalised,
      provider,
      displayName: decodeURIComponent(nameParts.join(":") || "").trim(),
    };
  }

  return null;
}

/**
 * Stable synthetic Clerk-style id for a preview identity.
 *
 * The email form is lossy on purpose-by-accident: every non-alphanumeric
 * becomes `_`, so `a.b@x.com` and `a-b@x.com` collapse to one id. Preview only,
 * and long-standing, so it is left alone rather than changed underneath the
 * suites. The phone form has no such problem — E.164 is a plus and digits — and
 * is injective, which is worth having rather than copying the flaw for symmetry.
 */
export function previewClerkId(identity: Pick<PreviewIdentity, "email" | "phone">): string {
  if (identity.phone) return `preview_phone_${identity.phone.replace(/\D/g, "")}`;
  return previewClerkIdForEmail(identity.email);
}

export function previewClerkIdForEmail(email: string): string {
  return `preview_email_${normaliseEmail(email).replace(/[^a-z0-9]/g, "_")}`;
}
