import { useSession } from "@/lib/session";

/**
 * Convenience view over the verified session.
 *
 * Every field here is derived from `GET /session` — the backend's answer, built
 * from the caller's ACTIVE membership row. Nothing is read from localStorage,
 * Clerk metadata, or a role the client chose for itself.
 *
 * Prefer `can("capability")` for gating: the role booleans are for wording and
 * layout ("you are the admin here"), while `can` is the thing that matches what
 * the server will actually permit.
 */
export function useUserRole() {
  const session = useSession();
  const { claims, role, isLoaded, isSignedIn, can } = session;

  const isAdmin = role === "admin";
  const isSenior = role === "senior_advocate";
  const isJunior = role === "junior_advocate";
  const isAdvocate = isSenior || isJunior;
  const isClerk = role === "clerk_intern";
  const isClient = role === "client";
  const isStaff = Boolean(role) && !isClient;

  return {
    role,
    isLoaded,
    isSignedIn,
    isPendingApproval: session.isPendingApproval,
    can,
    capabilities: claims?.capabilities ?? [],
    activeWorkspace: session.activeWorkspace,
    isAdmin,
    isSenior,
    isJunior,
    isAdvocate,
    isClerk,
    isClient,
    isStaff,
    displayRole: session.displayRole,
    profile: claims,
    // Identity for assignee matching — the clerkId the backend authorized us as.
    user: { id: claims?.clerkId, displayName: session.displayName },
  };
}
