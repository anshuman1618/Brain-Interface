import { ShieldCheck, Scale, Gavel, ClipboardList, User } from "lucide-react";

/**
 * The roles a visitor can *apply for*.
 *
 * Choosing one here is an access-request intent and nothing more. It is never
 * granted on sign-up: the backend stores it as `requestedRole` on a `pending`
 * membership, where no authorization path reads it, and an admin decides what
 * role — if any — is actually issued.
 */
export const ROLE_OPTIONS = [
  {
    value: "admin",
    label: "Firm Admin",
    description: "Manage the team, billing, and every matter in the chamber.",
    icon: ShieldCheck,
  },
  {
    value: "senior_advocate",
    label: "Senior Advocate",
    description: "Lead matters, oversee junior advocates, run consultations.",
    icon: Scale,
  },
  {
    value: "junior_advocate",
    label: "Junior Advocate",
    description: "Manage assigned matters, tasks, and client consultations.",
    icon: Gavel,
  },
  {
    value: "clerk_intern",
    label: "Clerk / Intern",
    description: "Support the team with assigned tasks, scheduling and filings.",
    icon: ClipboardList,
  },
  {
    value: "client",
    label: "Client",
    description: "View your matter status, documents, and consultations.",
    icon: User,
  },
] as const;

export type RoleValue = (typeof ROLE_OPTIONS)[number]["value"];

const REQUEST_INTENT_KEY = "portal:accessRequestIntent";

const VALID_ROLE_VALUES = new Set<string>(ROLE_OPTIONS.map((opt) => opt.value));

export function isRoleValue(value: unknown): value is RoleValue {
  return typeof value === "string" && VALID_ROLE_VALUES.has(value);
}

export function roleLabel(role: string | null | undefined): string {
  return ROLE_OPTIONS.find((o) => o.value === role)?.label ?? "";
}

/**
 * The role a visitor selected before creating their account.
 *
 * Stored in localStorage purely so the request form can be pre-filled after
 * Clerk's sign-up round trip. It is a UI convenience: the value is submitted to
 * `POST /access-requests` as an application, and reading or writing this key has
 * no effect on what the API will serve.
 */
export function setAccessRequestIntent(role: RoleValue): void {
  try {
    window.localStorage.setItem(REQUEST_INTENT_KEY, role);
  } catch {
    // localStorage unavailable (private browsing) — the request form simply
    // starts empty and the user picks again.
  }
}

export function getAccessRequestIntent(): RoleValue | null {
  try {
    const value = window.localStorage.getItem(REQUEST_INTENT_KEY);
    return isRoleValue(value) ? value : null;
  } catch {
    return null;
  }
}

export function clearAccessRequestIntent(): void {
  try {
    window.localStorage.removeItem(REQUEST_INTENT_KEY);
  } catch {
    // no-op
  }
}
