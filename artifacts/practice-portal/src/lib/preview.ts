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
 * Exactly one of `email` / `phone` carries a value, mirroring the real model
 * where somebody who signed up by SMS holds no address at all.
 */
export type PreviewSession = {
  provider: string;
  email: string;
  phone: string;
  name: string;
};

const PREVIEW_SESSION_KEY = "portal:previewSession";

function parse(raw: string | null): PreviewSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PreviewSession>;
    const email = typeof parsed?.email === "string" ? parsed.email : "";
    // `phone` is absent in sessions stored by an older build; treat it as "".
    const phone = typeof parsed?.phone === "string" ? parsed.phone : "";
    if (!email.includes("@") && !phone) return null;
    return {
      provider: parsed.provider ?? "email",
      email,
      phone,
      name: parsed.name ?? "",
    };
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
  // Two channels, one per kind of identifier — see lib/preview-mode.ts on the
  // server. The `preview:email:` form is unchanged: every integration suite in
  // scripts/ci builds it by hand.
  const channel = session.phone ? "phone" : "email";
  const identifier = session.phone || session.email;
  return `preview:${channel}:${session.provider}:${encodeURIComponent(identifier)}:${encodeURIComponent(session.name)}`;
}
