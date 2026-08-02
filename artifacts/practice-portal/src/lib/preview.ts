/**
 * Preview mode — the app runs with authentication mocked so the interface can be
 * explored with no Clerk instance configured.
 *
 * It engages only when VITE_CLERK_PUBLISHABLE_KEY is absent at build time. A
 * real deployment always sets that key, so a production bundle can never land in
 * preview mode by accident; the API server enforces the same rule independently
 * and refuses to mock auth when NODE_ENV is "production".
 *
 * What a preview token selects is an *identity*, not a permission. Signing in as
 * "Priya Raghavan" is the same act as authenticating as her with Clerk — her
 * access still comes from her workspace memberships in the database, which is
 * why `unassigned` (signed in, admitted nowhere) is one of the choices.
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
export const PREVIEW_IDENTITY_LABELS: Record<PreviewIdentity, { name: string; hint: string; email: string }> = {
  admin: { name: "Priya Raghavan", hint: "Admin · Raghavan Chambers", email: "priya@raghavanchambers.in" },
  senior_advocate: { name: "R. Krishnan", hint: "Senior Advocate · Raghavan Chambers", email: "krishnan@raghavanchambers.in" },
  junior_advocate: { name: "S. Iyer", hint: "Junior Advocate · Raghavan Chambers", email: "iyer@raghavanchambers.in" },
  clerk_intern: { name: "P. Nair", hint: "Clerk / Intern · Raghavan Chambers", email: "nair@raghavanchambers.in" },
  client: { name: "A. Kapoor", hint: "Client · Raghavan Chambers", email: "a.kapoor@gmail.com" },
  unassigned: { name: "T. Deshmukh", hint: "Not on any access list", email: "deshmukh@applicant.example" },
  rival_admin: { name: "V. Mehta", hint: "Admin · Mehta & Associates", email: "mehta@mehta-associates.in" },
};

/**
 * Who the preview session is signed in as.
 *
 * `seeded` picks one of the sample people directly (the switcher in the preview
 * bar). `email` stands in for a real federated sign-in: a provider vouched for
 * an address, and the backend then provisions a user and applies the access list
 * to it exactly as it would for Clerk — which is what makes the "this address
 * isn't recognised" path demonstrable without a real Google or Zoho tenant.
 */
export type PreviewSession =
  | { kind: "seeded"; identity: PreviewIdentity }
  | { kind: "email"; provider: string; email: string; name: string };

const PREVIEW_SESSION_KEY = "portal:previewSession";

function parse(raw: string | null): PreviewSession | null {
  if (!raw) return null;
  // Older builds stored a bare identity string; treat it as the seeded form.
  if (isPreviewIdentity(raw)) return { kind: "seeded", identity: raw };
  try {
    const parsed = JSON.parse(raw) as PreviewSession;
    if (parsed?.kind === "seeded" && isPreviewIdentity(parsed.identity)) return parsed;
    if (parsed?.kind === "email" && typeof parsed.email === "string" && parsed.email.includes("@")) {
      return parsed;
    }
  } catch {
    // Corrupt value — fall through to signed out.
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

/** The seeded identity, when that is what is signed in. */
export function previewIdentityOf(session: PreviewSession | null): PreviewIdentity | null {
  return session?.kind === "seeded" ? session.identity : null;
}

/**
 * The API server identifies preview callers by this token instead of a Clerk
 * session JWT. It carries no secret and no authority: the server only honours it
 * when it is itself running unauthenticated, outside production, and it resolves
 * to a user whose access is then read from the database like anyone else's.
 */
export function previewToken(session: PreviewSession): string {
  if (session.kind === "seeded") return `preview:${session.identity}`;
  return `preview:email:${session.provider}:${encodeURIComponent(session.email)}:${encodeURIComponent(session.name)}`;
}
