import type { AppUser } from "./jit";

/**
 * What to call a person in text a human will read, or in an attribution stored
 * on a record.
 *
 * `users.display_name` is now empty whenever the identity provider had no name
 * — Clerk is passwordless, and an email one-time code establishes an address
 * and nothing else. It used to be the literal string "User", which was worse:
 * a placeholder is indistinguishable from a real answer, so "requested by
 * User" and `createdBy: "User"` went onto matters permanently and nothing ever
 * repaired them. See `identityFromClerk` in jit.ts.
 *
 * Blank is the honest storage, but blank is not a thing to print. This is the
 * one place that decides what to print instead, so every ledger row, audit
 * entry and notification answers "who" the same way.
 *
 * **The order is deliberate.** The name they gave, then the address that
 * admitted them — an address identifies a person to their own chamber, which
 * is the only audience for any of these strings — and only then the provider
 * id, which identifies nobody but is never blank. The last step matters: an
 * audit row reading "" is a record that cannot be read back, and an
 * unreadable record is worse than an ugly one.
 *
 * **Not for API fields the interface interprets.** `SessionClaims.displayName`
 * and `GET /users/me` return the stored value unchanged, because the portal
 * uses empty to decide whether to ask for a name. Filling it in there would
 * mean nobody is ever asked.
 */
export function personName(user: Pick<AppUser, "displayName" | "email" | "clerkId">): string {
  return user.displayName?.trim() || user.email?.trim() || user.clerkId;
}

/**
 * The same question for somebody who may not be loaded at all.
 *
 * Returns null rather than inventing anything, for response fields that are
 * genuinely optional — a task with no assignee, a document request naming no
 * one. A caller that has a user should use `personName`.
 */
export function personNameOrNull(
  user: Pick<AppUser, "displayName" | "email" | "clerkId"> | null | undefined,
): string | null {
  return user ? personName(user) : null;
}
