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
 */
function resolveClerkId(req: Request): string | null {
  if (isPreviewAuth()) {
    return previewClerkIdFromRequest(req.headers.authorization);
  }
  return getAuth(req)?.userId ?? null;
}

export async function getOrCreateUser(req: Request): Promise<AppUser | null> {
  const clerkId = resolveClerkId(req);
  if (!clerkId) return null;

  const existing = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (existing.length > 0) return existing[0];

  // Preview users are seeded up front; if one is missing the token named a role
  // we do not provision, so treat it as unauthenticated rather than inventing a
  // user with a role the caller chose for themselves.
  if (isPreviewAuth()) return null;

  // JIT provision — pull the real name/email from Clerk's user profile
  // rather than publicMetadata, which is only ever set by our own admin flows.
  const auth = getAuth(req);
  const meta = (auth?.sessionClaims?.publicMetadata as Record<string, string>) ?? {};
  const role = meta.role ?? "client";

  const clerkUser = await clerkClient.users.getUser(clerkId);
  const nameFromClerk = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim();
  const emailFromClerk = clerkUser.primaryEmailAddress?.emailAddress
    ?? clerkUser.emailAddresses[0]?.emailAddress
    ?? "";

  const displayName = meta.displayName || nameFromClerk || "User";
  const email = meta.email || emailFromClerk;

  const [created] = await db.insert(usersTable).values({ clerkId, role, displayName, email }).returning();
  return created;
}

export { resolveClerkId };
