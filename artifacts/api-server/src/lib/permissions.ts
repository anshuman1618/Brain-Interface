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
  // Logging your own effort against a matter, and reading what has been logged
  // on one. Deliberately separate from kpi.read: recording your hours is part of
  // doing the work, while seeing the chamber's performance figures is not.
  "time.write",
  "time.read",
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
  /**
   * Draft and review documents with AI, and write chamber insights.
   *
   * A practice capability, held by admin and both advocate tiers. Deliberately
   * NOT held by clerk_intern: settling a pleading is not clerical work, and a
   * drafting request spends the chamber's money — a clerk who can burn the
   * month's budget on Tuesday is a support call, not a feature.
   *
   * Never held by a client. It reads across the whole matter file.
   */
  "drafting.use",
  /**
   * Buy more drafting budget when the allowance runs out.
   *
   * A SEPARATE capability rather than `billing.manage`, and that is the point.
   * `billing.manage` is admin-only on purpose — senior_advocate is a practice
   * tier, not a management one, and handing it billing to enable a top-up would
   * also hand it the plan, the payment methods and the subscription. This grants
   * exactly one power: spend a bounded amount on drafting for this chamber.
   */
  "ai_topup.purchase",
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
 * Shared by both advocate tiers. Assignment is NOT in here — see below, and
 * neither is `feedback.read`: client ratings are visible to the people who
 * answer for them, which is Admin and Senior Advocate. A junior sees the
 * matters and the tasks, not the scorecard.
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
  "time.write",
  "time.read",
  // Drafting is practice work, so both advocate tiers hold it. A junior who
  // cannot produce a first draft is a junior who cannot do the job they were
  // hired for; the budget is what bounds the cost, not the role.
  "drafting.use",
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
      // Reads AND answers client ratings. This is granted here rather than in
      // the shared advocate list precisely so the junior tier does not inherit
      // it — you cannot sensibly reply to a review you were never shown.
      "feedback.read",
      "feedback.respond",
      // Buying drafting budget, and nothing else billing-shaped. See the note
      // on the capability itself: this exists precisely so a senior advocate
      // can keep the chamber drafting mid-month without being handed the plan
      // and the payment methods along with it.
      "ai_topup.purchase",
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
      "time.write",
      "time.read",
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

/**
 * Capabilities allowed when a plan has lapsed.
 *
 * A lapsed chamber can read everything and perform a few necessary actions
 * (responding to feedback, completing tasks, responding to document requests),
 * but cannot create new records. billing.manage and privacy.manage stay
 * allowed because they are how the chamber upgrades or fulfills legal obligations.
 */
const CAPABILITIES_WHEN_LAPSED: readonly Capability[] = [
  // Reads
  "workspace.view",
  "cases.read",
  "tasks.read",
  "consultations.read",
  "documents.read",
  "document_requests.read",
  "calendar.read",
  "time.read",
  "feedback.read",
  "kpi.read",
  "audit.read",
  // Writes
  "tasks.complete",
  "document_requests.respond",
  "feedback.respond",
  "billing.manage",
  "privacy.manage",
];

export function isCapabilityAllowedWhenLapsed(capability: Capability): boolean {
  return (CAPABILITIES_WHEN_LAPSED as readonly string[]).includes(capability);
}

/**
 * Roles required to declare bar registration before reaching the dashboard.
 *
 * Practice-tier roles only: `clerk_intern` and `client` never appear in front
 * of a bench and are exempt. `admin` is included even though it is a
 * management role here, not a practice one elsewhere in this matrix — a firm
 * admin in this product is assumed to be a practicing advocate running their
 * own chamber, not a pure back-office role.
 */
export function needsBarRegistration(role: string): boolean {
  return role === ADMIN_ROLE || (ADVOCATE_ROLES as readonly string[]).includes(role);
}

/** How long an advocate has to supply an All India Bar number after declaring. */
export const ALL_INDIA_BAR_GRACE_MONTHS = 6;

/**
 * What an advocate must have declared, and by when.
 *
 * Two tiers, because the credentials are not all obtainable on the same day.
 *
 * **Now:** the state bar council and the enrolment number. Every enrolled
 * advocate has both from the day they are enrolled; without them we cannot say
 * who is practising here at all.
 *
 * **Within six months:** the All India Bar Examination certificate number. It
 * is deliberately not required at declaration — an advocate enrolled before the
 * examination existed may hold no certificate, and a newly enrolled one has a
 * window in which to sit it. Blocking on day one would keep out exactly the
 * people the window exists for.
 *
 * Everything else — Certificate of Practice, AoR at a High Court, AoR at the
 * Supreme Court — is recorded and never required. Most advocates hold none of
 * them, and a field that is demanded of somebody who cannot have it is a field
 * that gets filled with nonsense.
 *
 * The deadline is read from the user's own `allIndiaBarDueAt`, not computed
 * from today, so extending it for one person whose examination was postponed
 * is an update to a row rather than a change that moves it for everybody.
 */
export type CredentialGap =
  | { ok: true }
  | { ok: false; reason: "bar_registration"; message: string }
  | { ok: false; reason: "all_india_bar_overdue"; message: string };

export function barCredentialsComplete(
  role: string,
  user: {
    barCouncilState: string | null;
    barEnrolmentNo: string | null;
    allIndiaBarNo: string | null;
    allIndiaBarDueAt: Date | null;
  },
  now: Date = new Date(),
): CredentialGap {
  if (!needsBarRegistration(role)) return { ok: true };

  if (!(user.barCouncilState?.trim() && user.barEnrolmentNo?.trim())) {
    return {
      ok: false,
      reason: "bar_registration",
      message: "Declare your bar enrolment before using this workspace.",
    };
  }

  if (
    !user.allIndiaBarNo?.trim() &&
    user.allIndiaBarDueAt !== null &&
    user.allIndiaBarDueAt <= now
  ) {
    return {
      ok: false,
      reason: "all_india_bar_overdue",
      message:
        "Your All India Bar Examination certificate number was due within six months of " +
        "declaring your enrolment. Add it to continue.",
    };
  }

  return { ok: true };
}

/** Days until the All India Bar number is required. Null when it is not pending. */
export function allIndiaBarDaysLeft(
  user: { allIndiaBarNo: string | null; allIndiaBarDueAt: Date | null },
  now: Date = new Date(),
): number | null {
  if (user.allIndiaBarNo?.trim()) return null;
  if (user.allIndiaBarDueAt === null) return null;
  return Math.ceil((user.allIndiaBarDueAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
