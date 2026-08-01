import { isRoleValue, type RoleValue } from "@/lib/role-options";

/**
 * Preview mode — the app runs with authentication mocked so the interface can be
 * explored with no Clerk instance configured.
 *
 * It engages only when VITE_CLERK_PUBLISHABLE_KEY is absent at build time. A
 * real deployment always sets that key, so a production bundle can never land in
 * preview mode by accident; the API server enforces the same rule independently
 * and refuses to mock auth when NODE_ENV is "production".
 */
export const isPreviewMode = !import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const PREVIEW_ROLE_KEY = "portal:previewRole";

/** The role a visitor is currently exploring as. Null until they pick one. */
export function getPreviewRole(): RoleValue | null {
  try {
    const stored = window.localStorage.getItem(PREVIEW_ROLE_KEY);
    return isRoleValue(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function setPreviewRole(role: RoleValue): void {
  try {
    window.localStorage.setItem(PREVIEW_ROLE_KEY, role);
  } catch {
    // Storage unavailable (private browsing); the in-memory state still applies
    // for this tab, the choice just will not survive a reload.
  }
}

export function clearPreviewRole(): void {
  try {
    window.localStorage.removeItem(PREVIEW_ROLE_KEY);
  } catch {
    // Nothing to do — see above.
  }
}

/**
 * The API server identifies preview callers by this token instead of a Clerk
 * session JWT. It carries no secret: the server only honours it when it is
 * itself running unauthenticated, outside production.
 */
export function previewToken(role: RoleValue): string {
  return `preview:${role}`;
}
