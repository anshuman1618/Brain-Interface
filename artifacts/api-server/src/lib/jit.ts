import { getAuth, clerkClient } from "@clerk/express";
import type { Request } from "express";
import { db, usersTable, normaliseEmail, normalisePhone } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isPreviewAuth, previewClerkId, previewIdentityFromRequest } from "./preview-mode";

export type AppUser = {
  id: number;
  role: string;
  roleSelected: boolean;
  displayName: string;
  email: string;
  /** Verified mobile in E.164, or "". Admits by itself — see lib/access-list.ts. */
  phone: string;
  authProvider: string;
  clerkId: string;
  /** Self-declared, see `needsBarRegistration()` in lib/permissions.ts. */
  barCouncilState: string | null;
  barEnrolmentNo: string | null;
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
    return identity ? previewClerkId(identity) : null;
  }
  return getAuth(req)?.userId ?? null;
}

/**
 * The preview bearer token, as an Identity.
 *
 * Preview tokens carry one identifier — an address or a number — so the other
 * side is always "". A display name is derived from whichever was given, since
 * a phone identity has no local part to fall back on and
 * `identity.email.split("@")[0]` would have produced "" for it.
 */
function identityFromPreview(req: Request): Identity | null {
  const identity = previewIdentityFromRequest(req.headers.authorization);
  if (!identity) return null;
  return {
    displayName: identity.displayName || identity.email.split("@")[0] || identity.phone || "User",
    email: identity.email,
    phone: identity.phone,
  };
}

function previewProvider(req: Request): string {
  return previewIdentityFromRequest(req.headers.authorization)?.provider ?? "email";
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
    // phone_code — signed in with an SMS one-time code.
    if (strategy.includes("phone")) return "phone";
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
    // A row with EITHER identifier is the common case and answers from the
    // database alone — no Clerk round trip on the hot path.
    //
    // Testing `email` alone was correct while an address was the only way to be
    // somebody. It is not any more: a phone-only account has email = "" as its
    // finished state, so that test sent it down the resync path on every single
    // request, fetching from Clerk each time and never succeeding.
    if (existing[0].email || existing[0].phone) return existing[0];
    // Neither identifier means the first sign-in happened before the provider
    // had verified anything. Nothing re-read it afterwards, so the user stayed
    // on the access-denied screen for good even once they had verified. Try
    // again now.
    return (await resyncIdentity(req, existing[0])) ?? existing[0];
  }

  if (isPreviewAuth()) {
    const identity = identityFromPreview(req);
    if (!identity) return null;

    // Mirrors a real first-time federated sign-in: the provider vouched for an
    // identifier, so a user record exists. It still reaches nothing until they
    // create a chamber, or the access list / an admin admits them.
    return insertUser(clerkId, { ...identity, authProvider: previewProvider(req) });
  }

  const identity = await identityFromClerk(clerkId);
  return insertUser(clerkId, { ...identity, authProvider: providerFromClerk(req) });
}

type Identity = { displayName: string; email: string; phone: string };

/** The verified address, number and name Clerk holds for this id, normalised. */
async function identityFromClerk(clerkId: string): Promise<Identity> {
  const clerkUser = await clerkClient.users.getUser(clerkId);
  const nameFromClerk = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim();
  // Only a *verified* identifier is trusted, for both of these. An unverified
  // one is attacker-supplied text, and matching it against the access list
  // would let anyone claim a colleague's address or number and inherit their
  // role. Clerk marks each one it has actually challenged.
  const verifiedEmail = clerkUser.emailAddresses.find((e) => e.verification?.status === "verified");
  const verifiedPhone = clerkUser.phoneNumbers.find((p) => p.verification?.status === "verified");

  return {
    displayName: nameFromClerk || "User",
    email: verifiedEmail ? normaliseEmail(verifiedEmail.emailAddress) : "",
    // Re-normalised rather than trusted: Clerk stores E.164 already, but this
    // value is about to become an authorization key and the canonical form has
    // exactly one definition in this codebase.
    phone: verifiedPhone ? normalisePhone(verifiedPhone.phoneNumber) : "",
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

/**
 * Fills in an identifier that was empty at first sign-in. No-op when still empty.
 *
 * Called only for a row holding NEITHER an address nor a number, which is the
 * state left by a provider that had not verified anything yet. It must not run
 * for a user who legitimately has only one of the two — a phone-only account is
 * complete, and treating it as unfinished would re-read it from Clerk on every
 * single request forever.
 */
async function resyncIdentity(req: Request, user: AppUser): Promise<AppUser | null> {
  const identity = isPreviewAuth()
    ? identityFromPreview(req)
    : await identityFromClerk(user.clerkId);

  if (!identity || (!identity.email && !identity.phone)) return null;

  const [updated] = await db
    .update(usersTable)
    .set({
      email: identity.email,
      phone: identity.phone,
      displayName: user.displayName || identity.displayName,
    })
    .where(eq(usersTable.id, user.id))
    .returning();

  return updated ?? null;
}

export { resolveClerkId };
