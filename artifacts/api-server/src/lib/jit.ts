import { getAuth, clerkClient } from "@clerk/express";
import type { Request } from "express";
import { db, usersTable, normaliseEmail } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isPreviewAuth, previewClerkIdForEmail, previewIdentityFromRequest } from "./preview-mode";

export type AppUser = {
  id: number;
  role: string;
  roleSelected: boolean;
  displayName: string;
  email: string;
  authProvider: string;
  clerkId: string;
};

/**
 * Resolves the Clerk user id for a request. In preview mode Clerk is not
 * mounted, so identity comes from the preview bearer token instead.
 *
 * Note this resolves *identity only*. Under both transports, what the caller may
 * reach is decided later, from workspace_memberships.
 */
function resolveClerkId(req: Request): string | null {
  if (isPreviewAuth()) {
    const identity = previewIdentityFromRequest(req.headers.authorization);
    return identity ? previewClerkIdForEmail(identity.email) : null;
  }
  return getAuth(req)?.userId ?? null;
}

/**
 * Which provider vouched for this identity: google | zoho | email.
 *
 * Display only. It is recorded so the UI can say "signed in with Zoho", and it
 * is never consulted for authorization — an address admitted by the access list
 * is admitted however it authenticated, and one that is not, is not.
 */
function providerFromClerk(req: Request): string {
  const auth = getAuth(req);
  const strategy = (auth?.sessionClaims as Record<string, unknown> | undefined)?.strategy;
  if (typeof strategy === "string") {
    if (strategy.includes("google")) return "google";
    if (strategy.includes("zoho")) return "zoho";
  }
  return "email";
}

/**
 * Finds the app user for the request, creating a bare record on first sign-in.
 *
 * A newly provisioned user is deliberately inert: `users.role` is the directory
 * default and grants nothing on its own, and NO workspace membership is created
 * here. Access comes later, and only from the admin-managed access list or an
 * admin approving a request.
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

  if (isPreviewAuth()) {
    const identity = previewIdentityFromRequest(req.headers.authorization);
    if (!identity) return null;

    // Mirrors a real first-time federated sign-in: the provider vouched for an
    // address, so a user record exists. It still reaches nothing until they
    // create a chamber, or the access list / an admin admits them.
    const [created] = await db
      .insert(usersTable)
      .values({
        clerkId,
        role: "client",
        roleSelected: false,
        displayName: identity.displayName || identity.email.split("@")[0],
        email: identity.email,
        authProvider: identity.provider,
      })
      .returning();
    return created;
  }

  const clerkUser = await clerkClient.users.getUser(clerkId);
  const nameFromClerk = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim();
  // Only a *verified* address is trusted. An unverified one is attacker-supplied
  // text, and matching it against the access list would let anyone claim a
  // colleague's address and inherit their role.
  const verified = clerkUser.emailAddresses.find((e) => e.verification?.status === "verified");
  const emailFromClerk = verified?.emailAddress ?? clerkUser.primaryEmailAddress?.emailAddress ?? "";

  const [created] = await db
    .insert(usersTable)
    .values({
      clerkId,
      role: "client",
      roleSelected: false,
      displayName: nameFromClerk || "User",
      email: verified ? normaliseEmail(emailFromClerk) : "",
      authProvider: providerFromClerk(req),
    })
    .returning();

  return created;
}

export { resolveClerkId };
