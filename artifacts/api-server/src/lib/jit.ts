import { getAuth } from "@clerk/express";
import type { Request } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function getOrCreateUser(req: Request): Promise<{ id: number; role: string; displayName: string; email: string; clerkId: string } | null> {
  const auth = getAuth(req);
  const clerkId = auth?.userId;
  if (!clerkId) return null;

  const existing = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId));
  if (existing.length > 0) return existing[0];

  // JIT provision
  const meta = (auth?.sessionClaims?.publicMetadata as Record<string, string>) ?? {};
  const role = meta.role ?? "client";
  const displayName = meta.displayName ?? "User";
  const email = meta.email ?? "";

  const [created] = await db.insert(usersTable).values({ clerkId, role, displayName, email }).returning();
  return created;
}
