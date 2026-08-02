/**
 * Preview mode — the app runs with authentication mocked so the interface can be
 * explored with no Clerk instance configured.
 *
 * It engages only when VITE_CLERK_PUBLISHABLE_KEY is absent at build time. A
 * real deployment always sets that key, so a production bundle can never land in
 * preview mode by accident; the API server enforces the same rule independently
 * and refuses to mock auth when NODE_ENV is "production".
 *
 * What the preview token selects is an *identity*, not a permission. Picking
 * "Firm Admin" here is the same act as signing in as that person with Clerk —
 * their access still comes from their workspace memberships in the database,
 * which is why `unassigned` (signed in, admitted nowhere) is one of the choices.
 */

export const isPreviewMode = !import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

/** Seeded identities, mirroring PREVIEW_USER_IDS in lib/db/src/preview.ts. */
export const PREVIEW_IDENTITIES = [
  "admin",
  "senior_advocate",
  "junior_advocate",
  "clerk_intern",
  "client",
  "unassigned",
  "rival_admin",
] as const;

export type PreviewIdentity = (typeof PREVIEW_IDENTITIES)[number];

const IDENTITY_SET = new Set<string>(PREVIEW_IDENTITIES);

export function isPreviewIdentity(value: unknown): value is PreviewIdentity {
  return typeof value === "string" && IDENTITY_SET.has(value);
}

/** Human labels for the preview identity switcher. */
export const PREVIEW_IDENTITY_LABELS: Record<PreviewIdentity, { name: string; hint: string }> = {
  admin: { name: "Priya Raghavan", hint: "Admin · Raghavan Chambers" },
  senior_advocate: { name: "R. Krishnan", hint: "Senior Advocate · Raghavan Chambers" },
  junior_advocate: { name: "S. Iyer", hint: "Junior Advocate · Raghavan Chambers" },
  clerk_intern: { name: "P. Nair", hint: "Clerk / Intern · Raghavan Chambers" },
  client: { name: "A. Kapoor", hint: "Client · Raghavan Chambers" },
  unassigned: { name: "T. Deshmukh", hint: "Signed up, awaiting approval" },
  rival_admin: { name: "V. Mehta", hint: "Admin · Mehta & Associates" },
};

const PREVIEW_IDENTITY_KEY = "portal:previewIdentity";

export function getPreviewIdentity(): PreviewIdentity | null {
  try {
    const stored = window.localStorage.getItem(PREVIEW_IDENTITY_KEY);
    return isPreviewIdentity(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function setPreviewIdentity(identity: PreviewIdentity): void {
  try {
    window.localStorage.setItem(PREVIEW_IDENTITY_KEY, identity);
  } catch {
    // Storage unavailable (private browsing); the in-memory state still applies
    // for this tab, the choice just will not survive a reload.
  }
}

export function clearPreviewIdentity(): void {
  try {
    window.localStorage.removeItem(PREVIEW_IDENTITY_KEY);
  } catch {
    // Nothing to do — see above.
  }
}

/**
 * The API server identifies preview callers by this token instead of a Clerk
 * session JWT. It carries no secret and no authority: the server only honours it
 * when it is itself running unauthenticated, outside production, and it resolves
 * to a user id whose access is then read from the database like anyone else's.
 */
export function previewToken(identity: PreviewIdentity): string {
  return `preview:${identity}`;
}
