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

/** Who the preview session is signed in as: an address a provider vouched for. */
export type PreviewSession = {
  provider: string;
  email: string;
  name: string;
};

const PREVIEW_SESSION_KEY = "portal:previewSession";

function parse(raw: string | null): PreviewSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PreviewSession;
    if (typeof parsed?.email === "string" && parsed.email.includes("@")) return parsed;
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
  return `preview:email:${session.provider}:${encodeURIComponent(session.email)}:${encodeURIComponent(session.name)}`;
}
