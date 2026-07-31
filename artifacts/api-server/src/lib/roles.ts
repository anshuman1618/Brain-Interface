// Canonical role groupings for the RBAC matrix (Admin / Advocate / Clerk-Intern / Client).
// senior_advocate and junior_advocate are both "Advocate" tier — neither gets Admin-only
// access (KPI, Billing, Access Control), a mistake the frontend role hook used to make by
// treating senior_advocate as admin.
export const ADMIN_ROLE = "admin";
export const ADVOCATE_ROLES = ["senior_advocate", "junior_advocate"] as const;
export const CLERK_INTERN_ROLE = "clerk_intern";
export const CLIENT_ROLE = "client";
export const STAFF_ROLES = [ADMIN_ROLE, ...ADVOCATE_ROLES, CLERK_INTERN_ROLE] as const;

export function isClientRole(role: string): boolean {
  return role === CLIENT_ROLE;
}

export function isClerkInternRole(role: string): boolean {
  return role === CLERK_INTERN_ROLE;
}
