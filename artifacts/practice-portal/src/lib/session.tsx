import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth, useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSession,
  useSwitchWorkspace,
  getGetSessionQueryKey,
  type SessionClaims,
  type WorkspaceMembershipSummary,
  type Workspace,
} from "@workspace/api-client-react";
import { ROLE_OPTIONS, type RoleValue } from "@/lib/role-options";
import { clearPreviewIdentity, getPreviewIdentity, setPreviewIdentity, type PreviewIdentity } from "@/lib/preview";
import {
  clearWorkspaceContext,
  getActiveWorkspaceId,
  setWorkspaceContext,
} from "@/lib/workspace-context";

/**
 * The one session shape the UI reads from.
 *
 * Everything authorization-shaped on it — `capabilities`, `role`,
 * `activeWorkspace`, `workspaces` — comes from `GET /session`, which the backend
 * derives from membership rows. None of it is computed in the browser, read from
 * localStorage, or inferred from which identity the user picked at sign-up.
 * `can()` is a lookup in the server-issued list, not a rule the client evaluates.
 */
export type Session = {
  isLoaded: boolean;
  isSignedIn: boolean;
  displayName: string;
  email: string;
  initial: string;
  signOut: () => void;

  /** null until the backend has answered. */
  claims: SessionClaims | null;
  /** True when the user holds no ACTIVE membership anywhere. */
  isPendingApproval: boolean;
  role: string | null;
  displayRole: string;
  activeWorkspace: Workspace | null;
  /** Only workspaces the backend says this user is mapped to. */
  workspaces: WorkspaceMembershipSummary[];
  can: (capability: string) => boolean;
  switchWorkspace: (workspaceId: number) => void;
  isSwitchingWorkspace: boolean;
  refreshSession: () => void;

  /** True when auth is mocked. Drives the preview banner and identity switcher. */
  previewMode: boolean;
  /** Only set in preview mode: which seeded identity is signed in. */
  previewIdentity: PreviewIdentity | null;
  switchPreviewIdentity: (identity: PreviewIdentity) => void;
};

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}

function firstChar(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    const t = c?.trim();
    if (t) return t.charAt(0).toUpperCase();
  }
  return "U";
}

/**
 * Shared between the Clerk and preview providers: fetches the verified session,
 * keeps the workspace pointer in step with it, and exposes the switch action.
 */
function useBackendSession(enabled: boolean, identityKey: string) {
  const queryClient = useQueryClient();
  const { data: claims, isLoading } = useGetSession({
    query: { queryKey: [...getGetSessionQueryKey(), identityKey], enabled },
  });
  const switchMutation = useSwitchWorkspace();

  // Mirror whatever the backend settled on. When it resolves an active
  // workspace (e.g. the user has exactly one), adopt its id and freshly minted
  // token so subsequent requests carry them.
  useEffect(() => {
    if (!claims) return;
    if (claims.activeWorkspace) {
      setWorkspaceContext(claims.activeWorkspace.id, claims.workspaceToken ?? null);
    } else if (getActiveWorkspaceId() !== null) {
      clearWorkspaceContext();
    }
  }, [claims]);

  const switchWorkspace = useCallback(
    (workspaceId: number) => {
      switchMutation.mutate(
        { data: { workspaceId } },
        {
          onSuccess: (next) => {
            // The token only exists because the backend verified membership.
            setWorkspaceContext(next.activeWorkspace?.id ?? null, next.workspaceToken ?? null);
            // Every cached list belongs to the old tenant — drop all of it.
            queryClient.clear();
          },
        },
      );
    },
    [switchMutation, queryClient],
  );

  const refreshSession = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
  }, [queryClient]);

  const capabilities = useMemo(() => new Set(claims?.capabilities ?? []), [claims]);
  const can = useCallback((capability: string) => capabilities.has(capability), [capabilities]);

  return {
    claims: claims ?? null,
    claimsLoading: enabled && isLoading,
    can,
    switchWorkspace,
    isSwitchingWorkspace: switchMutation.isPending,
    refreshSession,
  };
}

function baseSessionFields(claims: SessionClaims | null) {
  return {
    claims,
    isPendingApproval: claims ? claims.accessStatus === "pending_approval" : false,
    role: claims?.role ?? null,
    displayRole: claims?.displayRole ?? "",
    activeWorkspace: claims?.activeWorkspace ?? null,
    workspaces: claims?.memberships ?? [],
  };
}

export function ClerkSessionProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const { signOut } = useAuth();
  const backend = useBackendSession(Boolean(isSignedIn), "clerk");

  const value = useMemo<Session>(() => {
    const email = user?.emailAddresses?.[0]?.emailAddress ?? "";
    return {
      isLoaded: isLoaded && !backend.claimsLoading,
      isSignedIn: Boolean(isSignedIn),
      // Prefer the backend's copy of the profile — it is the record the rest of
      // the app is authorized against.
      displayName: backend.claims?.displayName || user?.fullName || email,
      email: backend.claims?.email || email,
      initial: firstChar(backend.claims?.displayName, user?.firstName, email),
      signOut: () => {
        clearWorkspaceContext();
        void signOut();
      },
      ...baseSessionFields(backend.claims),
      can: backend.can,
      switchWorkspace: backend.switchWorkspace,
      isSwitchingWorkspace: backend.isSwitchingWorkspace,
      refreshSession: backend.refreshSession,
      previewMode: false,
      previewIdentity: null,
      switchPreviewIdentity: () => {},
    };
  }, [isLoaded, isSignedIn, user, signOut, backend]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function PreviewSessionProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<PreviewIdentity | null>(() => getPreviewIdentity());
  const queryClient = useQueryClient();
  const backend = useBackendSession(identity !== null, identity ?? "none");

  const switchPreviewIdentity = useCallback(
    (next: PreviewIdentity) => {
      // Signing in as somebody else. Drop the old workspace pointer and every
      // cached response with it — the new identity's memberships decide anew.
      clearWorkspaceContext();
      setPreviewIdentity(next);
      setIdentity(next);
      queryClient.clear();
    },
    [queryClient],
  );

  const signOut = useCallback(() => {
    clearWorkspaceContext();
    clearPreviewIdentity();
    setIdentity(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<Session>(() => {
    const claims = backend.claims;
    return {
      isLoaded: identity === null || !backend.claimsLoading,
      isSignedIn: identity !== null,
      displayName: claims?.displayName ?? "",
      email: claims?.email ?? "",
      initial: firstChar(claims?.displayName),
      signOut,
      ...baseSessionFields(claims),
      can: backend.can,
      switchWorkspace: backend.switchWorkspace,
      isSwitchingWorkspace: backend.isSwitchingWorkspace,
      refreshSession: backend.refreshSession,
      previewMode: true,
      previewIdentity: identity,
      switchPreviewIdentity,
    };
  }, [identity, backend, signOut, switchPreviewIdentity]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export { ROLE_OPTIONS };
export type { RoleValue };
