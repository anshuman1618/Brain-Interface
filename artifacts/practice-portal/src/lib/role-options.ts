import { ShieldCheck, Scale, Gavel, ClipboardList, User } from "lucide-react";

export const ROLE_OPTIONS = [
  {
    value: "admin",
    label: "Firm Admin",
    description: "Full control: manage the team, billing, and every case in the firm.",
    icon: ShieldCheck,
  },
  {
    value: "senior_advocate",
    label: "Senior Advocate",
    description: "Lead cases, oversee junior advocates, and access KPI reporting.",
    icon: Scale,
  },
  {
    value: "junior_advocate",
    label: "Junior Advocate",
    description: "Manage assigned cases, tasks, and client consultations.",
    icon: Gavel,
  },
  {
    value: "clerk_intern",
    label: "Clerk / Intern",
    description: "Support the team with tasks, scheduling, and document handling.",
    icon: ClipboardList,
  },
  {
    value: "client",
    label: "Client",
    description: "View your case status, documents, and upcoming consultations.",
    icon: User,
  },
] as const;

export type RoleValue = (typeof ROLE_OPTIONS)[number]["value"];

const PENDING_ROLE_STORAGE_KEY = "portal:pendingWorkspaceRole";

const VALID_ROLE_VALUES = new Set<string>(ROLE_OPTIONS.map((opt) => opt.value));

export function isRoleValue(value: unknown): value is RoleValue {
  return typeof value === "string" && VALID_ROLE_VALUES.has(value);
}

// The role a visitor picks *before* creating their account. Stored in
// localStorage (not sessionStorage) so it survives Clerk's sign-up flow even
// if a verification step opens in a new tab/window.
export function setPendingRoleSelection(role: RoleValue): void {
  try {
    window.localStorage.setItem(PENDING_ROLE_STORAGE_KEY, role);
  } catch {
    // localStorage may be unavailable (private browsing, etc.) -- the
    // post-auth role picker still catches this case as a fallback.
  }
}

export function getPendingRoleSelection(): RoleValue | null {
  try {
    const value = window.localStorage.getItem(PENDING_ROLE_STORAGE_KEY);
    return isRoleValue(value) ? value : null;
  } catch {
    return null;
  }
}

export function clearPendingRoleSelection(): void {
  try {
    window.localStorage.removeItem(PENDING_ROLE_STORAGE_KEY);
  } catch {
    // no-op
  }
}
