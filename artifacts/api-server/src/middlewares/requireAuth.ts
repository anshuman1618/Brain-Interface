import type { Request, Response, NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { db, workspacesTable, workspaceMembershipsTable, type Workspace } from "@workspace/db";
import { getOrCreateUser, resolveClerkId, type AppUser } from "../lib/jit";
import {
  capabilitiesForRole,
  caseScopeForRole,
  taskScopeForRole,
  needsBarRegistration,
  type Capability,
  type RowScope,
  isCapabilityAllowedWhenLapsed,
} from "../lib/permissions";
import { verifyWorkspaceToken } from "../lib/workspace-token";
import { planStateFor, type PlanState } from "../lib/quota";

/**
 * The verified request context. Everything downstream reads from here and
 * nowhere else — in particular, no route may read a role, workspace or
 * capability out of the request body, query string or an unverified header.
 */
export type WorkspaceContext = {
  user: AppUser;
  workspace: Workspace;
  workspaceId: number;
  /** Role from the ACTIVE membership row, re-read from the database this request. */
  role: string;
  /** True when this user founded the workspace. Adds the management capabilities. */
  isOwner: boolean;
  capabilities: Capability[];
  caseScope: RowScope;
  taskScope: RowScope;
  planState: PlanState;
  /**
   * Narrows visibility to exactly one matter, on top of whatever `caseScope`
   * already allows. Set only when the membership was created from a client
   * invite carrying a case restriction — see `invites.ts` and
   * `lib/access-list.ts`. Null for everyone else, including an unrestricted
   * client, which is why `lib/scope.ts` intersects rather than replaces.
   */
  restrictedCaseId: number | null;
};

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  ctx?: WorkspaceContext;
}

/** The verified context, or a throw — call only inside a `requireWorkspace` chain. */
export function ctx(req: AuthRequest): WorkspaceContext {
  if (!req.ctx) {
    throw new Error("Route is missing requireWorkspace — no verified workspace context");
  }
  return req.ctx;
}

// Identity comes from resolveClerkId so this works under both Clerk and the
// preview bearer token; it never reads getAuth directly.
export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const userId = resolveClerkId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  next();
};

/**
 * Which workspace is this request for?
 *
 * Three inputs, in order of trust. All three are only ever *claims* — whichever
 * one answers, the membership check below still has to pass.
 *   1. `X-Workspace-Token` — signed by us at switch time.
 *   2. `X-Workspace-Id` — a plain hint.
 *   3. the caller's single active membership, when they have exactly one.
 *
 * A token that is present but does not verify is a hard failure, not something
 * to fall past. Silently ignoring it and serving the fallback workspace would
 * turn a forged or expired token into a successful request against *some*
 * workspace, which is exactly the kind of quiet downgrade that hides an attack.
 */
type WorkspaceSelection = { workspaceId: number | null } | { invalidToken: true };

function requestedWorkspaceId(req: Request): WorkspaceSelection {
  const rawToken = req.header("x-workspace-token");
  if (rawToken) {
    const claims = verifyWorkspaceToken(rawToken);
    if (!claims) return { invalidToken: true };
    return { workspaceId: claims.wsId };
  }

  const header = req.header("x-workspace-id");
  if (header) {
    const parsed = Number(header);
    if (Number.isInteger(parsed) && parsed > 0) return { workspaceId: parsed };
  }

  return { workspaceId: null };
}

export type MembershipLookup = {
  workspace: Workspace;
  role: string;
  isOwner: boolean;
  caseId: number | null;
};

/**
 * Capabilities for a membership.
 *
 * Founding a chamber adds the management capabilities on top of whatever
 * practice role the founder holds — a Senior Advocate who set up their own
 * chamber still has to be able to invite their clerk. Ownership is set once, by
 * the create-workspace endpoint, for the caller creating it; it cannot be
 * requested, granted or edited afterwards, and it means nothing in any other
 * workspace.
 */
export function capabilitiesFor(role: string, isOwner: boolean): Capability[] {
  const base = capabilitiesForRole(role);
  if (!isOwner) return base;
  const owner: Capability[] = [
    "access_control.manage",
    "team.manage",
    "billing.manage",
    "audit.read",
    "privacy.manage",
  ];
  return [...new Set([...base, ...owner])];
}

/** ACTIVE membership only. `pending` and `revoked` grant nothing, by construction. */
export async function findActiveMembership(
  userId: number,
  workspaceId: number,
): Promise<MembershipLookup | null> {
  const [row] = await db
    .select({
      role: workspaceMembershipsTable.role,
      isOwner: workspaceMembershipsTable.isOwner,
      caseId: workspaceMembershipsTable.caseId,
      workspace: workspacesTable,
    })
    .from(workspaceMembershipsTable)
    .innerJoin(workspacesTable, eq(workspacesTable.id, workspaceMembershipsTable.workspaceId))
    .where(
      and(
        eq(workspaceMembershipsTable.userId, userId),
        eq(workspaceMembershipsTable.workspaceId, workspaceId),
        eq(workspaceMembershipsTable.status, "active"),
      ),
    );

  return row
    ? { workspace: row.workspace, role: row.role, isOwner: row.isOwner, caseId: row.caseId }
    : null;
}

export async function listActiveMemberships(userId: number): Promise<MembershipLookup[]> {
  const rows = await db
    .select({
      role: workspaceMembershipsTable.role,
      isOwner: workspaceMembershipsTable.isOwner,
      caseId: workspaceMembershipsTable.caseId,
      workspace: workspacesTable,
    })
    .from(workspaceMembershipsTable)
    .innerJoin(workspacesTable, eq(workspacesTable.id, workspaceMembershipsTable.workspaceId))
    .where(
      and(
        eq(workspaceMembershipsTable.userId, userId),
        eq(workspaceMembershipsTable.status, "active"),
      ),
    );

  return rows.map((r) => ({
    workspace: r.workspace,
    role: r.role,
    isOwner: r.isOwner,
    caseId: r.caseId,
  }));
}

/**
 * The guard every protected endpoint runs through.
 *
 * Resolves identity from the session, resolves the requested workspace, then
 * asks the database whether that user holds an ACTIVE membership of that
 * workspace. No membership, or a workspace that does not exist → 403. There is
 * no path through this function that trusts a client-supplied role.
 */
export const requireWorkspace = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.userId = user.clerkId;

  const memberships = await listActiveMemberships(user.id);
  if (memberships.length === 0) {
    // Signed in, admitted nowhere. This is the Pending Approval state — it is a
    // 403 rather than a 401 because the caller is authenticated, just unauthorised.
    res.status(403).json({
      error: "Forbidden",
      reason: "no_active_membership",
      message: "Your access request is awaiting approval by a workspace admin.",
    });
    return;
  }

  const selection = requestedWorkspaceId(req);
  if ("invalidToken" in selection) {
    res.status(401).json({
      error: "Unauthorized",
      reason: "invalid_workspace_token",
      message: "The workspace token is invalid or has expired. Switch workspace again.",
    });
    return;
  }

  const requested = selection.workspaceId;
  const target =
    requested !== null
      ? memberships.find((m) => m.workspace.id === requested)
      : memberships.length === 1
        ? memberships[0]
        : undefined;

  if (!target) {
    res.status(403).json({
      error: "Forbidden",
      reason: requested === null ? "workspace_not_selected" : "not_a_member",
      message:
        requested === null
          ? "Select a workspace before calling this endpoint."
          : "You are not an active member of this workspace.",
    });
    return;
  }

  // The server-side half of the bar-registration gate. The dashboard blocks
  // the whole shell client-side until this is declared, so nothing in the UI
  // would reach a workspace-scoped endpoint while incomplete — but that gate
  // is a fetch call away from being skipped, and this is what actually stops
  // the request rather than just hiding the button that would have sent it.
  // PUT /users/me/bar-registration sits behind requireAuth, not this guard,
  // so declaring it is never itself blocked by this check.
  if (
    needsBarRegistration(target.role) &&
    !(user.barCouncilState?.trim() && user.barEnrolmentNo?.trim())
  ) {
    res.status(403).json({
      error: "Forbidden",
      reason: "profile_incomplete",
      message: "Declare your bar enrolment before using this workspace.",
    });
    return;
  }

  req.userRole = target.role;
  const planState = await planStateFor(target.workspace.id);
  req.ctx = {
    user,
    workspace: target.workspace,
    workspaceId: target.workspace.id,
    role: target.role,
    isOwner: target.isOwner,
    capabilities: capabilitiesFor(target.role, target.isOwner),
    caseScope: caseScopeForRole(target.role),
    taskScope: taskScopeForRole(target.role),
    planState,
    restrictedCaseId: target.caseId,
  };

  next();
};

/**
 * Capability check, layered on top of `requireWorkspace`. Answers 403 — never
 * 404 or a silent empty list — so a caller learns the boundary exists rather
 * than that the resource does.
 *
 * When the plan is lapsed, only capabilities in CAPABILITIES_WHEN_LAPSED are
 * allowed. A lapsed chamber can read everything and perform a few necessary
 * actions (responding to feedback, completing tasks, responding to document
 * requests), but cannot create new records. Denies with 402 plan_lapsed.
 */
export const requireCapability =
  (...capabilities: Capability[]) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    const context = req.ctx;
    if (!context) {
      res.status(403).json({ error: "Forbidden", reason: "no_workspace_context" });
      return;
    }

    // Check if plan is lapsed and any requested capability is not in the allowlist.
    if (context.planState.lapsed) {
      const notAllowed = capabilities.filter((c) => !isCapabilityAllowedWhenLapsed(c));
      if (notAllowed.length > 0) {
        res.status(402).json({
          error: "plan_lapsed",
          message: `Your ${context.planState.storedPlan || "trial"} plan expired. Records stay readable; new entries need a plan.`,
        });
        return;
      }
    }

    const held = new Set(context.capabilities);
    const missing = capabilities.filter((c) => !held.has(c));
    if (missing.length > 0) {
      res.status(403).json({
        error: "Forbidden",
        reason: "missing_capability",
        required: missing,
        message: `Your role (${context.role}) is not permitted to perform this action in ${context.workspace.name}.`,
      });
      return;
    }

    next();
  };

/** Convenience: workspace membership + a role allow-list, both verified server-side. */
export const requireRole =
  (...roles: string[]) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    const context = req.ctx;
    if (!context) {
      res.status(403).json({ error: "Forbidden", reason: "no_workspace_context" });
      return;
    }
    if (!roles.includes(context.role)) {
      res.status(403).json({ error: "Forbidden", reason: "role_not_permitted" });
      return;
    }
    next();
  };
