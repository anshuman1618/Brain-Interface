/**
 * Preview mode — the app runs with authentication mocked so the platform is
 * usable with no Clerk instance configured.
 *
 * It engages only when VITE_CLERK_PUBLISHABLE_KEY is absent at build time. A
 * real deployment always sets that key, so a production bundle can never land in
 * preview mode by accident; the API server enforces the same rule independently
 * and refuses to mock auth when NODE_ENV is "production".
 *
 * There are no sample identities. The platform starts empty, so the only way in
 * is to sign in with an address and either create a chamber or be admitted to
 * one — the same path a real sign-in takes. A preview token names an identity
 * and grants nothing.
 */

export const isPreviewMode = !import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

/**
 * Who the preview session is signed in as: an identifier a provider vouched for.
 *
 * Exactly one of `email` / `phone` is set, mirroring the server's
 * `PreviewIdentity`. A chamber's clerks and most of its clients have a mobile
 * and no work address, so the preview has to be able to represent them too —
 * otherwise the one path that can be exercised without Clerk is the one path
 * that excludes them.
 */
export type PreviewSession = {
  provider: string;
  email: string;
  phone?: string;
  name: string;
};

const PREVIEW_SESSION_KEY = "portal:previewSession";

function parse(raw: string | null): PreviewSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PreviewSession;
    if (typeof parsed?.email === "string" && parsed.email.includes("@")) return parsed;
    // A phone-only session, stored by a later build than the one that wrote
    // the email-only shape above.
    if (typeof parsed?.phone === "string" && parsed.phone.startsWith("+")) {
      return { ...parsed, email: parsed.email ?? "" };
    }
  } catch {
    // Corrupt or from an older build — treat as signed out.
  }
  return null;
}

export function getPreviewSession(): PreviewSession | null {
  try {
    return parse(window.localStorage.getItem(PREVIEW_SESSION_KEY));
  } catch {
    return null;
  }
}

export function setPreviewSession(session: PreviewSession): void {
  try {
    window.localStorage.setItem(PREVIEW_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable (private browsing); the in-memory state still applies
    // for this tab, the choice just will not survive a reload.
  }
}

export function clearPreviewSession(): void {
  try {
    window.localStorage.removeItem(PREVIEW_SESSION_KEY);
  } catch {
    // Nothing to do — see above.
  }
}

/**
 * The API server identifies preview callers by this token instead of a Clerk
 * session JWT. It carries no secret and no authority: the server only honours it
 * when it is itself running unauthenticated, outside production, and it resolves
 * to a user whose access is then read from the database like anyone else's.
 */
export function previewToken(session: PreviewSession): string {
  // Two forms, one per identifier — see `previewIdentityFromRequest` on the
  // server. The email form is unchanged, deliberately: every CI suite builds
  // tokens with it and they must keep passing untouched.
  if (session.phone) {
    return `preview:phone:phone:${encodeURIComponent(session.phone)}:${encodeURIComponent(session.name)}`;
  }
  return `preview:email:${session.provider}:${encodeURIComponent(session.email)}:${encodeURIComponent(session.name)}`;
}
