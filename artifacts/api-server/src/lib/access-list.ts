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

/** What a caller proved about themselves. Either half may be absent. */
export type Identity = {
  /** Verified email address, or "" — already normalised or raw, both fine. */
  email: string;
  /** Verified mobile number, or "". */
  phone: string;
};

/**
 * How specific a grant is. A grant naming one person beats a blanket one, so an
 * exact email or phone entry overrides a domain rule for the same workspace.
 */
function specificity(kind: string): number {
  return kind === "domain" ? 0 : 1;
}

/**
 * Finds every workspace whose access list admits this identity.
 *
 * An exact entry wins over a domain entry for the same workspace, so a domain
 * rule can set the default role for a firm while individual addresses are
 * pinned to something else (the founding partner is admin; everyone else at the
 * domain onboards as junior).
 *
 * Both identifiers are matched in ONE query rather than two, because a person
 * holding both may be admitted to one chamber by address and another by number,
 * and the caller wants the union. Where both match the same workspace the more
 * specific grant wins, and email and phone are equally specific — an admin who
 * has written both for one workspace has said the same thing twice.
 */
export async function findAccessListMatches(identity: Identity): Promise<AccessListMatch[]> {
  const email = normaliseEmail(identity.email);
  const phone = normalisePhone(identity.phone);

  // An address without an "@" cannot match an email or domain row; a number
  // that failed to normalise must never be matched against anything, because
  // the stored form is always canonical and a raw string could only collide by
  // accident. Neither identifier usable means no grants, without a query.
  const usableEmail = email.includes("@") ? email : "";
  if (!usableEmail && !phone) return [];

  const domain = usableEmail ? domainOf(usableEmail) : "";

  const clauses = [];
  if (usableEmail) {
    clauses.push(
      and(eq(workspaceAccessListTable.kind, "email"), eq(workspaceAccessListTable.value, email)),
      and(eq(workspaceAccessListTable.kind, "domain"), eq(workspaceAccessListTable.value, domain)),
    );
  }
  if (phone) {
    clauses.push(
      and(eq(workspaceAccessListTable.kind, "phone"), eq(workspaceAccessListTable.value, phone)),
    );
  }

  const rows = await db
    .select({ entry: workspaceAccessListTable, workspace: workspacesTable })
    .from(workspaceAccessListTable)
    .innerJoin(workspacesTable, eq(workspacesTable.id, workspaceAccessListTable.workspaceId))
    .where(and(isNull(workspaceAccessListTable.revokedAt), or(...clauses)));

  const bestByWorkspace = new Map<number, AccessListMatch>();
  for (const row of rows) {
    const existing = bestByWorkspace.get(row.workspace.id);
    // A named grant (email or phone) always replaces a domain grant for the
    // same workspace; between two named grants the first seen stands.
    if (existing && specificity(row.entry.kind) <= specificity(existing.kind)) continue;
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
  // Neither identifier means nothing to match on. A phone-only user used to
  // fall out here on the email check alone and was silently granted nothing,
  // however many phone entries named them.
  if (!user.email && !user.phone) return 0;

  const matches = await findAccessListMatches({ email: user.email, phone: user.phone });
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
