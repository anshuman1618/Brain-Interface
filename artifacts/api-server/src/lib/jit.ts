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
  /** A verified mobile in E.164, or null. The second admissible identifier. */
  phone: string | null;
  authProvider: string;
  clerkId: string;
  /** Self-declared, see `needsBarRegistration()` in lib/permissions.ts. */
  barCouncilState: string | null;
  barEnrolmentNo: string | null;
  /** The rest of an Indian advocate's credentials. All optional at declaration. */
  aorNo: string | null;
  aorHighCourtNo: string | null;
  copNo: string | null;
  /**
   * All India Bar Examination certificate number, and when it stops being
   * optional. See `barCredentialsComplete()` in lib/permissions.ts — it is
   * requested from the start and enforced only once the date has passed.
   */
  allIndiaBarNo: string | null;
  allIndiaBarDueAt: Date | null;
  /** When bar registration was first declared. The six-month window runs from here. */
  barDeclaredAt: Date | null;
  /** When this person last claimed the two-month trial pack, in any chamber. */
  trialClaimedAt: Date | null;
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
 * Which provider vouched for this identity: google | zoho | phone | email.
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
    // Before this existed a phone sign-in fell through to the "email" catch-all
    // and the UI told people they had signed in with an address they may not
    // have. Display only, like the rest of this function.
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
    // A row already carrying an identifier is the common case and answers from
    // the database alone — no Clerk round trip on the hot path. Either one will
    // do: the access list matches on whichever the person actually has.
    if (existing[0].email || existing[0].phone) return existing[0];
    // Neither means the first sign-in happened before the provider had a
    // verified anything. Nothing re-read it afterwards, so the user stayed on
    // the access-denied screen for good even once they had verified. Try again.
    return (await resyncIdentity(req, existing[0])) ?? existing[0];
  }

  if (isPreviewAuth()) {
    const identity = previewIdentityFromRequest(req.headers.authorization);
    if (!identity) return null;

    // Mirrors a real first-time federated sign-in: the provider vouched for an
    // address or a number, so a user record exists. It still reaches nothing
    // until they create a chamber, or the access list / an admin admits them.
    return insertUser(clerkId, {
      displayName:
        identity.displayName ||
        (identity.email ? identity.email.split("@")[0] : identity.phone) ||
        "User",
      email: identity.email,
      phone: identity.phone,
      authProvider: identity.provider,
    });
  }

  const identity = await identityFromClerk(clerkId);
  return insertUser(clerkId, { ...identity, authProvider: providerFromClerk(req) });
}

type Identity = { displayName: string; email: string; phone: string | null };

/** The verified address, number and name Clerk holds for this id, normalised. */
async function identityFromClerk(clerkId: string): Promise<Identity> {
  const clerkUser = await clerkClient.users.getUser(clerkId);
  const nameFromClerk = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim();
  // Only a *verified* identifier is trusted, address or number alike. An
  // unverified one is attacker-supplied text, and matching it against the
  // access list would let anyone claim a colleague's address — or their mobile
  // — and inherit their role.
  const verified = clerkUser.emailAddresses.find((e) => e.verification?.status === "verified");
  const verifiedPhone = clerkUser.phoneNumbers?.find((p) => p.verification?.status === "verified");
  const phone = verifiedPhone ? normalisePhone(verifiedPhone.phoneNumber) : "";

  return {
    displayName: nameFromClerk || "User",
    email: verified ? normaliseEmail(verified.emailAddress) : "",
    // Null rather than "" so the column reads as absent in the database; the
    // access-list matcher treats both as no-identifier either way.
    phone: phone || null,
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
 * Repairs either field: somebody who signed up by phone and later verified an
 * address, or the original case of an address that was not yet verified when
 * they first arrived. Only ever fills a blank — it never overwrites an
 * identifier that is already stored, because that identifier is what the access
 * list matched to admit them.
 */
async function resyncIdentity(req: Request, user: AppUser): Promise<AppUser | null> {
  const identity = isPreviewAuth()
    ? previewIdentityFromRequest(req.headers.authorization)
    : await identityFromClerk(user.clerkId);
  if (!identity) return null;

  const fills: { email?: string; phone?: string; displayName?: string } = {};
  if (!user.email && identity.email) fills.email = identity.email;
  if (!user.phone && identity.phone) fills.phone = identity.phone;
  if (!user.displayName && identity.displayName) fills.displayName = identity.displayName;
  if (Object.keys(fills).length === 0) return null;

  const [updated] = await db
    .update(usersTable)
    .set(fills)
    .where(eq(usersTable.id, user.id))
    .returning();

  return updated ?? null;
}

export { resolveClerkId };
