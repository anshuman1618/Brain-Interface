import { getAuth, clerkClient } from "@clerk/express";
import type { Request } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isPreviewAuth, previewClerkIdFromRequest } from "./preview-mode";

export type AppUser = {
  id: number;
  role: string;
  roleSelected: boolean;
  displayName: string;
  email: string;
  clerkId: string;
};

/**
 * Resolves the Clerk user id for a request. In preview mode Clerk is not
 * mounted, so identity comes from the `preview:<role>` bearer token instead.
 *
 * Note this resolves *identity only*. Under both transports, what the caller may
 * reach is decided later, from workspace_memberships.
 */
function resolveClerkId(req: Request): string | null {
  if (isPreviewAuth()) {
    return previewClerkIdFromRequest(req.headers.authorization);
  }
  return getAuth(req)?.userId ?? null;
}

/**
 * Finds the app user for the request, creating a bare record on first sign-in.
 *
 * A newly provisioned user is deliberately inert: `users.role` is the directory
 * default and grants nothing on its own, and NO workspace membership is created.
 * Until an admin approves an access request the user has zero active
 * memberships, so `requireWorkspace` refuses every protected endpoint.
 *
 * Clerk's publicMetadata is not consulted. It used to seed the role here, which
 * meant anything that could write metadata — including a sign-up flow driven by
 * a frontend selection — could hand itself `admin`.
 */
export async function getOrCreateUser(req: Request): Promise<AppUser | null> {
  const clerkId = resolveClerkId(req);
  if (!clerkId) return null;

  const existing = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (existing.length > 0) return existing[0];

  // Preview users are seeded up front; if one is missing the token named an
  // identity we do not provision, so treat it as unauthenticated.
  if (isPreviewAuth()) return null;

  const clerkUser = await clerkClient.users.getUser(clerkId);
  const nameFromClerk = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim();
  const emailFromClerk =
    clerkUser.primaryEmailAddress?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress ?? "";

  const [created] = await db
    .insert(usersTable)
    .values({
      clerkId,
      role: "client",
      roleSelected: false,
      displayName: nameFromClerk || "User",
      email: emailFromClerk,
    })
    .returning();

  return created;
}

export { resolveClerkId };
