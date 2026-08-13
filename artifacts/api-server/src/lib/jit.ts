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
  if (existing.length > 0) {
    // A row with an address is the common case and answers from the database
    // alone — no Clerk round trip on the hot path.
    if (existing[0].email) return existing[0];
    // An empty address means the first sign-in happened before the provider had
    // a verified one. Nothing re-read it afterwards, so the user stayed on the
    // access-denied screen for good even once they had verified. Try again now.
    return (await resyncEmail(req, existing[0])) ?? existing[0];
  }

  if (isPreviewAuth()) {
    const identity = previewIdentityFromRequest(req.headers.authorization);
    if (!identity) return null;

    // Mirrors a real first-time federated sign-in: the provider vouched for an
    // address, so a user record exists. It still reaches nothing until they
    // create a chamber, or the access list / an admin admits them.
    return insertUser(clerkId, {
      displayName: identity.displayName || identity.email.split("@")[0],
      email: identity.email,
      authProvider: identity.provider,
    });
  }

  const identity = await identityFromClerk(clerkId);
  return insertUser(clerkId, { ...identity, authProvider: providerFromClerk(req) });
}

type Identity = { displayName: string; email: string };

/** The verified address and name Clerk holds for this id, normalised. */
async function identityFromClerk(clerkId: string): Promise<Identity> {
  const clerkUser = await clerkClient.users.getUser(clerkId);
  const nameFromClerk = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim();
  // Only a *verified* address is trusted. An unverified one is attacker-supplied
  // text, and matching it against the access list would let anyone claim a
  // colleague's address and inherit their role.
  const verified = clerkUser.emailAddresses.find((e) => e.verification?.status === "verified");

  return {
    displayName: nameFromClerk || "User",
    email: verified ? normaliseEmail(verified.emailAddress) : "",
  };
}

/**
 * Insert, tolerating a concurrent insert of the same identity.
 *
 * `users.clerk_id` is unique, and the dashboard fires several queries at once on
 * first load. Two of them racing through the select above both missed, both
 * inserted, and the loser's unique violation surfaced as a 500 on the very first
 * request a new user ever makes. The conflict is now the expected outcome for
 * the loser, which re-reads the winner's row.
 */
async function insertUser(
  clerkId: string,
  fields: Identity & { authProvider: string },
): Promise<AppUser | null> {
  const [created] = await db
    .insert(usersTable)
    .values({ clerkId, role: "client", roleSelected: false, ...fields })
    .onConflictDoNothing({ target: usersTable.clerkId })
    .returning();

  if (created) return created;

  const [winner] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  return winner ?? null;
}

/** Fills in an address that was empty at first sign-in. No-op when still empty. */
async function resyncEmail(req: Request, user: AppUser): Promise<AppUser | null> {
  if (isPreviewAuth()) {
    const identity = previewIdentityFromRequest(req.headers.authorization);
    if (!identity?.email) return null;
    const [updated] = await db
      .update(usersTable)
      .set({ email: identity.email, displayName: user.displayName || identity.displayName })
      .where(eq(usersTable.id, user.id))
      .returning();
    return updated ?? null;
  }

  const identity = await identityFromClerk(user.clerkId);
  if (!identity.email) return null;

  const [updated] = await db
    .update(usersTable)
    .set({ email: identity.email, displayName: user.displayName || identity.displayName })
    .where(eq(usersTable.id, user.id))
    .returning();

  return updated ?? null;
}

export { resolveClerkId };
