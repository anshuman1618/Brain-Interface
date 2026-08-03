import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth, useSignIn, useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSession,
  useSwitchWorkspace,
  useCreateWorkspace,
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
  setPreviewSession,
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
  /** Submits the one-time code sent to the address. Passwordless: there is no password path. */
  verifyEmailCode: (code: string) => Promise<void>;
  /** True once a code has been sent and the UI should ask for it. */
  awaitingCode: boolean;
  cancelCodeEntry: () => void;
  isSigningIn: boolean;
  signInError: string | null;

  /** Founds a new chamber and becomes its owner. The self-serve sign-up path. */
  createWorkspace: (name: string, role: "admin" | "senior_advocate") => Promise<void>;
  isCreatingWorkspace: boolean;
  /** True when the caller founded the active workspace. */
  isOwner: boolean;

  /** True when auth is mocked. Drives the preview banner. */
  previewMode: boolean;
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

  const createMutation = useCreateWorkspace();

  const createWorkspace = useCallback(
    async (name: string, role: "admin" | "senior_advocate") => {
      const next = await createMutation.mutateAsync({ data: { name, role } });
      // The backend has already made us a member and minted the token; adopt it
      // so the very next request is scoped to the chamber we just founded.
      setWorkspaceContext(next.activeWorkspace?.id ?? null, next.workspaceToken ?? null);
      queryClient.clear();
    },
    [createMutation, queryClient],
  );

  const capabilities = useMemo(() => new Set(claims?.capabilities ?? []), [claims]);
  const can = useCallback((capability: string) => capabilities.has(capability), [capabilities]);

  return {
    claims: claims ?? null,
    claimsLoading: enabled && isLoading,
    can,
    switchWorkspace,
    isSwitchingWorkspace: switchMutation.isPending,
    refreshSession,
    createWorkspace,
    isCreatingWorkspace: createMutation.isPending,
  };
}

function baseSessionFields(claims: SessionClaims | null) {
  return {
    claims,
    isOwner: claims?.isOwner ?? false,
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
  const [awaitingCode, setAwaitingCode] = useState(false);

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
          // Passwordless: a one-time code to the inbox. There is no password
          // field anywhere in this app and no password strategy is attempted.
          const { error } = await signIn.emailCode.sendCode({ emailAddress });
          if (error) throw error;
          setAwaitingCode(true);
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

  /** Second leg of the passwordless email flow: verify the emailed code. */
  const verifyEmailCode = useCallback(
    async (code: string) => {
      if (!signIn) return;
      setSignInError(null);
      setIsSigningIn(true);
      try {
        const { error } = await signIn.emailCode.verifyCode({ code: code.trim() });
        if (error) throw error;
        setAwaitingCode(false);
        // Clerk has established the session; the app then asks the backend what
        // this identity may reach.
        window.location.href = `${BASE_PATH}/dashboard`;
      } catch (err) {
        const message =
          err && typeof err === "object" && "message" in err
            ? String((err as { message?: unknown }).message ?? "")
            : "";
        setSignInError(message || "That code wasn't accepted. Check it and try again.");
      } finally {
        setIsSigningIn(false);
      }
    },
    [signIn],
  );

  const cancelCodeEntry = useCallback(() => {
    setAwaitingCode(false);
    setSignInError(null);
  }, []);

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
      createWorkspace: backend.createWorkspace,
      isCreatingWorkspace: backend.isCreatingWorkspace,
      signInWithProvider,
      verifyEmailCode,
      awaitingCode,
      cancelCodeEntry,
      isSigningIn,
      signInError,
      previewMode: false,
    };
  }, [isLoaded, isSignedIn, user, signOut, backend, signInWithProvider, verifyEmailCode,
      awaitingCode, cancelCodeEntry, isSigningIn, signInError]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function PreviewSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PreviewSession | null>(() => getPreviewSession());
  const queryClient = useQueryClient();
  const backend = useBackendSession(session !== null, session ? session.email : "none");

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
      adopt({ provider, email: trimmed, name: name?.trim() ?? "" });
    },
    [adopt],
  );

  const signOut = useCallback(() => adopt(null), [adopt]);

  const value = useMemo<Session>(() => {
    const claims = backend.claims;
    return {
      isLoaded: session === null || !backend.claimsLoading,
      isSignedIn: session !== null,
      displayName: claims?.displayName ?? session?.name ?? "",
      email: claims?.email ?? session?.email ?? "",
      initial: firstChar(claims?.displayName, session?.email),
      signOut,
      ...baseSessionFields(claims),
      can: backend.can,
      switchWorkspace: backend.switchWorkspace,
      isSwitchingWorkspace: backend.isSwitchingWorkspace,
      refreshSession: backend.refreshSession,
      createWorkspace: backend.createWorkspace,
      isCreatingWorkspace: backend.isCreatingWorkspace,
      signInWithProvider,
      // No provider is connected in preview, so there is no code to verify.
      verifyEmailCode: async () => {},
      awaitingCode: false,
      cancelCodeEntry: () => {},
      isSigningIn: false,
      signInError: null,
      previewMode: true,
    };
  }, [session, backend, signOut, signInWithProvider]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export { ROLE_OPTIONS };
export type { RoleValue };
