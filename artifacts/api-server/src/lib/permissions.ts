/**
 * The capability matrix.
 *
 * This is the only place a role is turned into permissions, and it is consulted
 * server-side on every request. The frontend renders from a *copy* of the
 * resolved capability list that the backend hands it in the session payload —
 * it never computes its own, and a client that lies about its role or edits the
 * copy changes nothing, because the guard re-derives capabilities here from the
 * role stored on the ACTIVE membership row.
 *
 * A role is scoped to one workspace. "admin" means admin *of that workspace*;
 * there is no firm-wide or cross-tenant rank.
 */

export const ADMIN_ROLE = "admin";
export const ADVOCATE_ROLES = ["senior_advocate", "junior_advocate"] as const;
export const CLERK_INTERN_ROLE = "clerk_intern";
export const CLIENT_ROLE = "client";
export const STAFF_ROLES = [ADMIN_ROLE, ...ADVOCATE_ROLES, CLERK_INTERN_ROLE] as const;

export const WORKSPACE_ROLES = [
  ADMIN_ROLE,
  ...ADVOCATE_ROLES,
  CLERK_INTERN_ROLE,
  CLIENT_ROLE,
] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export const CAPABILITIES = [
  "workspace.view",
  "cases.read",
  "cases.write",
  "cases.delete",
  "tasks.read",
  "tasks.write",
  "tasks.complete",
  "tasks.delete",
  "consultations.read",
  "consultations.write",
  "documents.read",
  "documents.write",
  "document_requests.read",
  "document_requests.create",
  "document_requests.respond",
  "calendar.read",
  "calendar.write",
  "feedback.read",
  "feedback.write",
  "feedback.respond",
  "kpi.read",
  "billing.manage",
  "access_control.manage",
  "team.manage",
  /** Read the workspace's audit log. Management, not practice. */
  "audit.read",
  /** Decide erasure requests. Sits with access control, not billing. */
  "privacy.manage",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * Row scope for the collections a role can read.
 *  all      — every record in the workspace
 *  assigned — only records assigned to them (Clerk/Intern: no unassigned matters)
 *  own      — only records belonging to them (Client)
 */
export type RowScope = "all" | "assigned" | "own";

type RoleDefinition = {
  capabilities: readonly Capability[];
  caseScope: RowScope;
  taskScope: RowScope;
};

/**
 * Shared by both advocate tiers. Assignment is NOT in here — see below.
 */
const ADVOCATE_CAPABILITIES = [
  "workspace.view",
  "cases.read",
  "cases.write",
  "tasks.read",
  "tasks.complete",
  "consultations.read",
  "consultations.write",
  "documents.read",
  "documents.write",
  "document_requests.read",
  "document_requests.create",
  "calendar.read",
  "feedback.read",
] as const satisfies readonly Capability[];

/**
 * Capabilities that are NOT "everything an admin can do".
 *
 * `feedback.write` is the client's side of the review — leaving a rating on a
 * matter. Handing it to admin along with the rest would let a chamber post
 * five-star reviews of itself, which makes the whole module worthless. Admin
 * still reads every rating and may reply; it simply cannot author one.
 */
const CLIENT_ONLY_CAPABILITIES: readonly Capability[] = ["feedback.write"];

const ROLE_DEFINITIONS: Record<WorkspaceRole, RoleDefinition> = {
  admin: {
    capabilities: CAPABILITIES.filter((c) => !CLIENT_ONLY_CAPABILITIES.includes(c)),
    caseScope: "all",
    taskScope: "all",
  },
  senior_advocate: {
    // Directs work: assigns tasks, deletes them, and posts calendar updates the
    // rest of the chamber sees. Still explicitly NOT kpi.read / billing.manage /
    // access_control.manage — advocate is a practice tier, not a management one,
    // and conflating senior_advocate with admin is the exact leak this matrix
    // exists to prevent.
    capabilities: [
      ...ADVOCATE_CAPABILITIES,
      "tasks.write",
      "tasks.delete",
      "calendar.write",
      "feedback.respond",
    ],
    caseScope: "all",
    taskScope: "all",
  },
  junior_advocate: {
    // Does the work, does not hand it out. Assignment is reserved to Admin and
    // Senior Advocate; a junior can complete and update their own tasks but
    // cannot create one or push it onto somebody else.
    capabilities: ADVOCATE_CAPABILITIES,
    caseScope: "all",
    taskScope: "all",
  },
  clerk_intern: {
    capabilities: [
      "workspace.view",
      "cases.read",
      "tasks.read",
      "tasks.complete",
      "documents.read",
      "document_requests.read",
      "document_requests.create",
      "documents.write",
      "calendar.read",
    ],
    // Blocked from unassigned matters: a clerk sees only what they hold a task on.
    caseScope: "assigned",
    taskScope: "assigned",
  },
  client: {
    // No calendar. A client's portal is their own matters, the firm's shared
    // files, the requests addressed to them, and their feedback — the chamber's
    // listing schedule is not theirs to browse.
    capabilities: [
      "workspace.view",
      "cases.read",
      "documents.read",
      "documents.write",
      "consultations.read",
      "document_requests.read",
      "document_requests.respond",
      "feedback.write",
      "feedback.read",
    ],
    caseScope: "own",
    taskScope: "own",
  },
};

export function capabilitiesForRole(role: string): Capability[] {
  if (!isWorkspaceRole(role)) return [];
  return [...ROLE_DEFINITIONS[role].capabilities];
}

export function roleHasCapability(role: string, capability: Capability): boolean {
  return capabilitiesForRole(role).includes(capability);
}

export function caseScopeForRole(role: string): RowScope {
  return isWorkspaceRole(role) ? ROLE_DEFINITIONS[role].caseScope : "own";
}

export function taskScopeForRole(role: string): RowScope {
  return isWorkspaceRole(role) ? ROLE_DEFINITIONS[role].taskScope : "own";
}

export function isClientRole(role: string): boolean {
  return role === CLIENT_ROLE;
}

export function isClerkInternRole(role: string): boolean {
  return role === CLERK_INTERN_ROLE;
}

export function displayRole(role: string): string {
  switch (role) {
    case "admin":
      return "Firm Admin";
    case "senior_advocate":
      return "Senior Advocate";
    case "junior_advocate":
      return "Junior Advocate";
    case "clerk_intern":
      return "Clerk / Intern";
    case "client":
      return "Client";
    default:
      return role;
  }
}
