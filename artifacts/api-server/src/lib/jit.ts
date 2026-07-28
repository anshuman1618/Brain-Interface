import { getAuth, clerkClient } from "@clerk/express";
import type { Request } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function getOrCreateUser(req: Request): Promise<{ id: number; role: string; roleSelected: boolean; displayName: string; email: string; clerkId: string } | null> {
  const auth = getAuth(req);
  const clerkId = auth?.userId;
  if (!clerkId) return null;

  const existing = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (existing.length > 0) return existing[0];

  // JIT provision — pull the real name/email from Clerk's user profile
  // rather than publicMetadata, which is only ever set by our own admin flows.
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
