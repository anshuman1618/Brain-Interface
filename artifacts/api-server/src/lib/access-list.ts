import { and, eq, isNull, or } from "drizzle-orm";
import {
  db,
  workspacesTable,
  workspaceAccessListTable,
  workspaceMembershipsTable,
  domainOf,
  normaliseEmail,
  normalisePhone,
  type Workspace,
} from "@workspace/db";
import { isWorkspaceRole } from "./permissions";
import type { AppUser } from "./jit";
import { assertSeatAvailable } from "./quota";

/**
 * The bridge between "who signed in" and "who is allowed in".
 *
 * Google and Zoho authenticate anybody with an account; they tell us an email
 * address and nothing more. This module is what decides whether that address is
 * admitted, and as what — by consulting the admin-managed access list.
 *
 * The separation matters: it means adding a new sign-in provider can never widen
 * access, because the provider only ever supplies an identity that still has to
 * appear on a list an admin wrote.
 */

export type AccessListMatch = {
  workspace: Workspace;
  role: string;
  entryId: number;
  /** 'email' beats 'domain' — a specific grant overrides a blanket one. */
  kind: string;
  /** Carried onto the membership at reconcile. Only ever set on a client entry. */
  caseId: number | null;
};

/**
 * Finds every workspace whose access list admits this address.
 *
 * An exact-email entry wins over a domain entry for the same workspace, so a
 * domain rule can set the default role for a firm while individual addresses are
 * pinned to something else (the founding partner is admin; everyone else at the
 * domain onboards as junior).
 */
export async function findAccessListMatches(identity: {
  email?: string | null;
  phone?: string | null;
}): Promise<AccessListMatch[]> {
  const normalised = normaliseEmail(identity.email ?? "");
  const hasEmail = Boolean(normalised) && normalised.includes("@");
  // Already E.164 on the user row, but normalise again: this is the read side
  // of normalise-on-write and it must not assume the write side ran.
  const phone = normalisePhone(identity.phone ?? "");
  if (!hasEmail && !phone) return [];

  const domain = hasEmail ? domainOf(normalised) : "";

  const rows = await db
    .select({ entry: workspaceAccessListTable, workspace: workspacesTable })
    .from(workspaceAccessListTable)
    .innerJoin(workspacesTable, eq(workspacesTable.id, workspaceAccessListTable.workspaceId))
    .where(
      and(
        isNull(workspaceAccessListTable.revokedAt),
        // Only the arms we actually have an identifier for. Including an arm
        // with an empty value would match any entry somebody managed to store
        // as "", which is exactly the sort of thing normalisation is meant to
        // stop rather than rely on.
        or(
          ...(hasEmail
            ? [
                and(
                  eq(workspaceAccessListTable.kind, "email"),
                  eq(workspaceAccessListTable.value, normalised),
                ),
                and(
                  eq(workspaceAccessListTable.kind, "domain"),
                  eq(workspaceAccessListTable.value, domain),
                ),
              ]
            : []),
          ...(phone
            ? [
                and(
                  eq(workspaceAccessListTable.kind, "phone"),
                  eq(workspaceAccessListTable.value, phone),
                ),
              ]
            : []),
        ),
      ),
    );

  // Email beats phone beats domain, per workspace.
  //
  // Exact identifiers beat a blanket domain rule for the reason above. Email
  // beats phone because an address is never reassigned to a stranger and an
  // Indian mobile is, after about ninety days — so where a chamber has recorded
  // both for one person, the more durable one decides their role.
  const PRECEDENCE: Record<string, number> = { email: 3, phone: 2, domain: 1 };
  const bestByWorkspace = new Map<number, AccessListMatch>();
  for (const row of rows) {
    const existing = bestByWorkspace.get(row.workspace.id);
    if (existing && (PRECEDENCE[row.entry.kind] ?? 0) <= (PRECEDENCE[existing.kind] ?? 0)) continue;
    bestByWorkspace.set(row.workspace.id, {
      workspace: row.workspace,
      role: isWorkspaceRole(row.entry.role) ? row.entry.role : "client",
      entryId: row.entry.id,
      kind: row.entry.kind,
      caseId: row.entry.caseId,
    });
  }

  return [...bestByWorkspace.values()];
}

/**
 * Turns access-list entries into real memberships on sign-in.
 *
 * Idempotent and safe to call on every session read: it only ever creates a
 * membership that an admin already authorised by adding the address, and it
 * never touches a membership that already exists — so a revoked or demoted user
 * is not silently restored by their address still being on the list.
 *
 * Returns the number of memberships created.
 */
export async function reconcileAccessList(user: AppUser): Promise<number> {
  // Either identifier will do. Before phone existed this was `if (!user.email)`
  // and a phone-only user reached nothing at all, however correctly they had
  // authenticated.
  if (!user.email && !user.phone) return 0;

  const matches = await findAccessListMatches(user);
  if (matches.length === 0) return 0;

  const existing = await db
    .select({ workspaceId: workspaceMembershipsTable.workspaceId })
    .from(workspaceMembershipsTable)
    .where(eq(workspaceMembershipsTable.userId, user.id));
  const alreadyKnown = new Set(existing.map((r) => r.workspaceId));

  let created = 0;
  for (const match of matches) {
    if (alreadyKnown.has(match.workspace.id)) continue;

    // Check if adding this seat exceeds the plan limit. If so, create as
    // "pending" rather than "active", routing them to the admin approval queue.
    const seatBreach = await assertSeatAvailable(match.workspace.id);
    const status = seatBreach ? "pending" : "active";
    const decidedBy = seatBreach ? "seat unavailable" : "access list";

    await db.insert(workspaceMembershipsTable).values({
      workspaceId: match.workspace.id,
      userId: user.id,
      clerkId: user.clerkId,
      role: match.role,
      caseId: match.caseId,
      status,
      decidedBy,
      decidedAt: new Date(),
    });

    await db
      .update(workspaceAccessListTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(workspaceAccessListTable.id, match.entryId));

    created += 1;
  }

  return created;
}
