import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth, useSignIn, useUser } from "@clerk/react";
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
import type { ProviderId } from "@/lib/auth-providers";
import {
  clearPreviewSession,
  getPreviewSession,
  previewIdentityOf,
  setPreviewSession,
  type PreviewIdentity,
  type PreviewSession,
} from "@/lib/preview";
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
  /** Signed in, has asked for access, awaiting an admin decision. */
  isPendingApproval: boolean;
  /** Signed in, but the verified email is on no access list and no request is open. */
  isNotRecognised: boolean;
  /** How they signed in: google | zoho | email. Display only. */
  authProvider: string | null;
  role: string | null;
  displayRole: string;
  activeWorkspace: Workspace | null;
  /** Only workspaces the backend says this user is mapped to. */
  workspaces: WorkspaceMembershipSummary[];
  can: (capability: string) => boolean;
  switchWorkspace: (workspaceId: number) => void;
  isSwitchingWorkspace: boolean;
  refreshSession: () => void;

  /** Begins sign-in with a provider. Establishes identity only — never access. */
  signInWithProvider: (provider: ProviderId, email: string, name?: string) => Promise<void>;
  isSigningIn: boolean;
  signInError: string | null;

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
    isNotRecognised: claims ? claims.accessStatus === "not_recognised" : false,
    authProvider: claims?.authProvider ?? null,
    role: claims?.role ?? null,
    displayRole: claims?.displayRole ?? "",
    activeWorkspace: claims?.activeWorkspace ?? null,
    workspaces: claims?.memberships ?? [],
  };
}

const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "");

export function ClerkSessionProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const { signOut } = useAuth();
  const { signIn } = useSignIn();
  const backend = useBackendSession(Boolean(isSignedIn), "clerk");

  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  /**
   * Hands off to the identity provider.
   *
   * Google and Zoho redirect out to the provider; the email route sends a
   * one-time code. All three end at the same place — an address the provider has
   * verified — and none of them decides anything about access. What happens next
   * is `GET /session`, which checks that address against the workspace access
   * list and either admits it or refuses it.
   *
   * `oauth_custom_zoho` is a custom OAuth connection configured in the Clerk
   * dashboard with the slug `zoho`; Clerk has no built-in Zoho provider. See
   * README → Sign-in providers.
   */
  const signInWithProvider = useCallback(
    async (provider: ProviderId, emailAddress: string) => {
      if (!signIn) return;
      setSignInError(null);
      setIsSigningIn(true);
      try {
        if (provider === "email") {
          const { error } = await signIn.emailCode.sendCode({ emailAddress });
          if (error) throw error;
          // Clerk's hosted component owns code entry from here.
          window.location.href = `${BASE_PATH}/sign-in`;
          return;
        }

        const { error } = await signIn.sso({
          strategy: provider === "google" ? "oauth_google" : "oauth_custom_zoho",
          // Where the provider round trip finishes. The dashboard layout takes
          // over from there and decides — from the backend session — whether
          // this identity sees the portal, a pending notice, or the refusal.
          redirectUrl: `${window.location.origin}${BASE_PATH}/dashboard`,
          // Where Clerk sends the handshake when it needs another step first.
          redirectCallbackUrl: `${window.location.origin}${BASE_PATH}/portal/callback`,
        });
        if (error) throw error;
      } catch (err) {
        // A provider that is not enabled in the Clerk dashboard fails here, and
        // saying so beats a silent no-op the user cannot diagnose.
        const message =
          err && typeof err === "object" && "message" in err
            ? String((err as { message?: unknown }).message ?? "")
            : "";
        setSignInError(
          message ||
            `Could not start sign-in with ${provider}. It may not be enabled for this deployment — ask your administrator.`,
        );
      } finally {
        setIsSigningIn(false);
      }
    },
    [signIn],
  );

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
      signInWithProvider,
      isSigningIn,
      signInError,
      previewMode: false,
      previewIdentity: null,
      switchPreviewIdentity: () => {},
    };
  }, [isLoaded, isSignedIn, user, signOut, backend, signInWithProvider, isSigningIn, signInError]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** A stable cache key for whichever preview identity is signed in. */
function previewKey(session: PreviewSession | null): string {
  if (!session) return "none";
  return session.kind === "seeded" ? session.identity : `email:${session.email}`;
}

export function PreviewSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PreviewSession | null>(() => getPreviewSession());
  const queryClient = useQueryClient();
  const backend = useBackendSession(session !== null, previewKey(session));

  // Signing in as somebody else. Drop the old workspace pointer and every cached
  // response with it — the new identity's memberships decide anew.
  const adopt = useCallback(
    (next: PreviewSession | null) => {
      clearWorkspaceContext();
      if (next) setPreviewSession(next);
      else clearPreviewSession();
      setSession(next);
      queryClient.clear();
    },
    [queryClient],
  );

  const switchPreviewIdentity = useCallback(
    (next: PreviewIdentity) => adopt({ kind: "seeded", identity: next }),
    [adopt],
  );

  /**
   * Stands in for completing Google/Zoho/email sign-in.
   *
   * No provider is contacted — there is none configured — so the address is
   * taken at face value, exactly as a verified claim from a real provider would
   * be. Everything after this point is the real code path: the backend
   * provisions the user, applies the access list, and refuses the address if it
   * is not on one.
   */
  const signInWithProvider = useCallback(
    async (provider: ProviderId, emailAddress: string, name?: string) => {
      const trimmed = emailAddress.trim().toLowerCase();
      if (!trimmed.includes("@")) return;
      adopt({ kind: "email", provider, email: trimmed, name: name?.trim() ?? "" });
    },
    [adopt],
  );

  const signOut = useCallback(() => adopt(null), [adopt]);

  const value = useMemo<Session>(() => {
    const claims = backend.claims;
    return {
      isLoaded: session === null || !backend.claimsLoading,
      isSignedIn: session !== null,
      displayName: claims?.displayName ?? "",
      email: claims?.email ?? "",
      initial: firstChar(claims?.displayName),
      signOut,
      ...baseSessionFields(claims),
      can: backend.can,
      switchWorkspace: backend.switchWorkspace,
      isSwitchingWorkspace: backend.isSwitchingWorkspace,
      refreshSession: backend.refreshSession,
      signInWithProvider,
      isSigningIn: false,
      signInError: null,
      previewMode: true,
      previewIdentity: previewIdentityOf(session),
      switchPreviewIdentity,
    };
  }, [session, backend, signOut, switchPreviewIdentity, signInWithProvider]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export { ROLE_OPTIONS };
export type { RoleValue };
