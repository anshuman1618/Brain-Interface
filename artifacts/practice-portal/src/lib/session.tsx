import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth, useSignIn, useSignUp, useUser } from "@clerk/react";
import { useLocation } from "wouter";
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
import { userMessage } from "@/lib/errors";
import { authRedirectBase } from "@/lib/platform";
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
  /** Verified mobile in E.164, or "". Somebody who signed in by SMS has this and no email. */
  phone: string;
  initial: string;
  signOut: () => void;

  /** null until the backend has answered. */
  claims: SessionClaims | null;
  /** Signed in, has asked for access, awaiting an admin decision. */
  isPendingApproval: boolean;
  /** Signed in, but the verified email is on no access list and no request is open. */
  isNotRecognised: boolean;
  /**
   * False when the active workspace's role requires bar registration (admin,
   * senior_advocate, junior_advocate) and it has not been declared yet.
   * Server-computed — see `SessionClaims.profileComplete`. True whenever
   * there is no active workspace, since the other two gates take over first.
   */
  profileComplete: boolean;
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

  /**
   * Begins sign-in with a provider. Establishes identity only — never access.
   *
   * `identifier` is an email address or a mobile number depending on the
   * provider, and is ignored by the redirect providers (Google, Zoho).
   */
  signInWithProvider: (provider: ProviderId, identifier: string, name?: string) => Promise<void>;
  /** Submits the one-time code, from either channel. Passwordless: there is no password path. */
  verifyCode: (code: string) => Promise<void>;
  /** Sends another code to the same identifier, on the leg that issued the first. */
  resendCode: () => Promise<void>;
  /** True once a code has been sent and the UI should ask for it. */
  awaitingCode: boolean;
  /** The address or number a code went to. Survives a refresh; "" when none is outstanding. */
  pendingIdentifier: string;
  /** Which channel that code went by, so the UI can say "inbox" or "SMS". */
  pendingChannel: "email" | "phone";
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
    profileComplete: claims?.profileComplete ?? true,
    authProvider: claims?.authProvider ?? null,
    role: claims?.role ?? null,
    displayRole: claims?.displayRole ?? "",
    activeWorkspace: claims?.activeWorkspace ?? null,
    workspaces: claims?.memberships ?? [],
  };
}

const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * The one-time code flow, across a page load.
 *
 * Which address a code went to — and which Clerk resource issued it — lived in
 * React state alone. Refreshing the tab while reading the code out of an email
 * client dropped both, returning the user to the provider list holding a code
 * with nowhere to type it. sessionStorage rather than localStorage: this is a
 * half-finished sign-in, and it should not outlive the tab.
 */
type PendingCode = {
  /** The address or number the code went to. */
  identifier: string;
  /** Which kind it is — decides `emailCode` vs `phoneCode` on resend and verify. */
  channel: "email" | "phone";
  leg: "signIn" | "signUp";
};

const PENDING_CODE_KEY = "lex.signin.pending-code";

function readPendingCode(): PendingCode | null {
  try {
    const raw = sessionStorage.getItem(PENDING_CODE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { identifier, channel, leg } = parsed as Partial<PendingCode>;
    if (typeof identifier !== "string" || (leg !== "signIn" && leg !== "signUp")) return null;
    // A pending code written by an older build has no channel; it can only have
    // been an email one.
    return { identifier, channel: channel === "phone" ? "phone" : "email", leg };
  } catch {
    // Private-mode Safari throws on sessionStorage. Losing the resume is a
    // worse experience, not a broken one.
    return null;
  }
}

function writePendingCode(value: PendingCode | null): void {
  try {
    if (value) sessionStorage.setItem(PENDING_CODE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(PENDING_CODE_KEY);
  } catch {
    /* see readPendingCode */
  }
}

export function ClerkSessionProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const { signOut } = useAuth();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const [, setLocation] = useLocation();
  const backend = useBackendSession(Boolean(isSignedIn), "clerk");

  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  /**
   * The outstanding one-time code: which address it went to, and which leg of
   * the passwordless flow issued it.
   *
   * Clerk keeps sign-in and sign-up as separate resources, and a code issued by
   * one is not verifiable by the other. The door in this app is single, so the
   * flow picks a leg on the way in and this remembers which, rather than
   * guessing again at verification time. Persisted so a refresh mid-flow does
   * not strand the user.
   */
  const [pendingCode, setPendingCodeState] = useState<PendingCode | null>(() => readPendingCode());

  const setPendingCode = useCallback((value: PendingCode | null) => {
    writePendingCode(value);
    setPendingCodeState(value);
  }, []);

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
    async (provider: ProviderId, identifier: string) => {
      if (!signIn) return;
      setSignInError(null);
      setIsSigningIn(true);
      try {
        if (provider === "email" || provider === "phone") {
          /*
           * Passwordless: a one-time code, to an inbox or by SMS. There is no
           * password field anywhere in this app and no password strategy is
           * attempted.
           *
           * The two channels are the same flow against a different Clerk
           * resource — `emailCode` / `phoneCode` — so they are written once
           * here rather than twice. Sign-in first, because most callers already
           * have an account. An identifier Clerk has never seen cannot be
           * signed in — it has to be signed up — so that failure falls through
           * to creating the account and sending the code from the sign-up leg
           * instead. Without this, the very first person to reach a new
           * deployment could never get in: sign-in needs a user, and nothing
           * here was creating one.
           */
          const channel = provider === "phone" ? "phone" : "email";

          const { error } =
            channel === "phone"
              ? await signIn.phoneCode.sendCode({ phoneNumber: identifier })
              : await signIn.emailCode.sendCode({ emailAddress: identifier });
          if (!error) {
            setPendingCode({ identifier, channel, leg: "signIn" });
            return;
          }

          if (!signUp) throw error;
          const created =
            channel === "phone"
              ? await signUp.create({ phoneNumber: identifier })
              : await signUp.create({ emailAddress: identifier });
          // The identifier is already taken but sign-in refused it — report the
          // original refusal, which is the more informative of the two.
          if (created.error) throw error;
          const sent =
            channel === "phone"
              ? await signUp.verifications.sendPhoneCode()
              : await signUp.verifications.sendEmailCode();
          if (sent.error) throw sent.error;
          setPendingCode({ identifier, channel, leg: "signUp" });
          return;
        }

        const strategy = provider === "google" ? "oauth_google" : "oauth_custom_zoho";
        const urls = {
          // Where the provider round trip finishes. The dashboard layout takes
          // over from there and decides — from the backend session — whether
          // this identity sees the portal, a pending notice, or the refusal.
          //
          // On a native shell these are NOT this origin: the webview is served
          // from capacitor://localhost, which no OAuth provider will redirect
          // to. `authRedirectBase()` returns the app's registered custom scheme
          // there and window.location.origin on the web. See lib/platform.ts.
          redirectUrl: `${authRedirectBase()}${BASE_PATH}/dashboard`,
          // Where Clerk sends the handshake when it needs another step first.
          redirectCallbackUrl: `${authRedirectBase()}${BASE_PATH}/portal/callback`,
        };

        // Same shape as the code legs. A successful sso() navigates away, so
        // reaching the next line at all means it refused — which is what a
        // provider identity with no account looks like. Retry as a sign-up.
        const { error } = await signIn.sso({ strategy, ...urls });
        if (error) {
          if (!signUp) throw error;
          const { error: signUpError } = await signUp.sso({ strategy, ...urls });
          if (signUpError) throw error;
        }
      } catch (err) {
        // A provider that is not enabled in the Clerk dashboard fails here, and
        // saying so beats a silent no-op the user cannot diagnose.
        setSignInError(
          userMessage(
            err,
            `Could not start sign-in with ${provider}. It may not be enabled for this deployment — ask your administrator.`,
          ),
        );
      } finally {
        setIsSigningIn(false);
      }
    },
    [signIn, signUp, setPendingCode],
  );

  /**
   * Another code to the same address, on the leg that issued the first one.
   *
   * Resending used to restart the whole flow at the sign-in leg. For an address
   * that had signed *up* a moment earlier, that failed, fell through to
   * `signUp.create()` — which refuses, the attempt already exists — and showed
   * the original sign-in error on a screen asking for a code. The user was told
   * their sign-in failed while holding a perfectly good code.
   */
  const resendCode = useCallback(async () => {
    if (!pendingCode) return;
    setSignInError(null);
    setIsSigningIn(true);
    try {
      if (pendingCode.leg === "signUp") {
        if (!signUp) throw new Error("Sign-up is not available. Start again.");
        const { error } =
          pendingCode.channel === "phone"
            ? await signUp.verifications.sendPhoneCode()
            : await signUp.verifications.sendEmailCode();
        if (error) throw error;
      } else {
        if (!signIn) throw new Error("Sign-in is not available. Start again.");
        const { error } =
          pendingCode.channel === "phone"
            ? await signIn.phoneCode.sendCode({ phoneNumber: pendingCode.identifier })
            : await signIn.emailCode.sendCode({ emailAddress: pendingCode.identifier });
        if (error) throw error;
      }
    } catch (err) {
      setSignInError(userMessage(err, "Could not send another code. Try again in a moment."));
    } finally {
      setIsSigningIn(false);
    }
  }, [pendingCode, signIn, signUp]);

  /** Second leg of the passwordless flow: verify the code, from either channel. */
  const verifyCode = useCallback(
    async (code: string) => {
      if (!signIn) return;
      setSignInError(null);
      setIsSigningIn(true);
      try {
        const trimmed = code.trim();
        // Verified against whichever leg issued it — see `pendingCode`.
        const usingSignUp = pendingCode?.leg === "signUp" && Boolean(signUp);
        const onPhone = pendingCode?.channel === "phone";
        const { error } =
          usingSignUp && signUp
            ? onPhone
              ? await signUp.verifications.verifyPhoneCode({ code: trimmed })
              : await signUp.verifications.verifyEmailCode({ code: trimmed })
            : onPhone
              ? await signIn.phoneCode.verifyCode({ code: trimmed })
              : await signIn.emailCode.verifyCode({ code: trimmed });
        if (error) throw error;

        // A verified code leaves the attempt `complete` but NOT signed in —
        // Clerk requires this last step to turn it into the active session.
        // Skipping it leaves a verified user with no session, who is then
        // bounced back to the landing page having done everything right.
        const leg = usingSignUp && signUp ? signUp : signIn;

        if (leg.status !== "complete") {
          // Clerk wants something else before it will issue a session —
          // typically an attribute still REQUIRED in the dashboard, such as a
          // username, or an email address on a phone sign-up. Say which,
          // because the alternative is redirecting into a bounce that reads as
          // "the code was wrong".
          //
          // Note this is the failure mode to watch when enabling phone: if
          // phone is marked required rather than optional, every existing email
          // sign-in starts landing here.
          const missing =
            usingSignUp && signUp
              ? [...signUp.missingFields, ...signUp.unverifiedFields].join(", ")
              : "";
          throw new Error(
            missing
              ? `You are verified, but this Clerk instance still requires: ${missing}. ` +
                  `Turn those off under User & Authentication in the Clerk dashboard.`
              : `Verification finished with status "${leg.status}" instead of "complete", ` +
                  `so no session was created. Check the required fields in the Clerk dashboard.`,
          );
        }

        const { error: finalizeError } = await leg.finalize();
        if (finalizeError) throw finalizeError;

        setPendingCode(null);
        // A client-side navigation, not a reload. `finalize()` has just updated
        // the live Clerk client; a full page load restarts from whatever has
        // reached browser storage, and losing that race is what sent a
        // successfully verified user back to the front page.
        setLocation("/dashboard");
      } catch (err) {
        setSignInError(userMessage(err, "That code wasn't accepted. Check it and try again."));
      } finally {
        setIsSigningIn(false);
      }
    },
    [signIn, signUp, pendingCode, setLocation, setPendingCode],
  );

  const cancelCodeEntry = useCallback(() => {
    setPendingCode(null);
    setSignInError(null);
  }, [setPendingCode]);

  const value = useMemo<Session>(() => {
    const email = user?.emailAddresses?.[0]?.emailAddress ?? "";
    const phone = user?.phoneNumbers?.[0]?.phoneNumber ?? "";
    return {
      isLoaded: isLoaded && !backend.claimsLoading,
      isSignedIn: Boolean(isSignedIn),
      // Prefer the backend's copy of the profile — it is the record the rest of
      // the app is authorized against.
      displayName: backend.claims?.displayName || user?.fullName || email || phone,
      email: backend.claims?.email || email,
      // The backend's copy is the canonical E.164 form; Clerk's is only a
      // fallback for the instant before /session answers.
      phone: backend.claims?.phone || phone,
      initial: firstChar(backend.claims?.displayName, user?.firstName, email || phone),
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
      verifyCode,
      resendCode,
      awaitingCode: pendingCode !== null,
      pendingIdentifier: pendingCode?.identifier ?? "",
      pendingChannel: pendingCode?.channel ?? "email",
      cancelCodeEntry,
      isSigningIn,
      signInError,
      previewMode: false,
    };
  }, [
    isLoaded,
    isSignedIn,
    user,
    signOut,
    backend,
    signInWithProvider,
    verifyCode,
    resendCode,
    pendingCode,
    cancelCodeEntry,
    isSigningIn,
    signInError,
  ]);

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
   * Stands in for completing Google/Zoho/email/SMS sign-in.
   *
   * No provider is contacted — there is none configured — so the identifier is
   * taken at face value, exactly as a verified claim from a real provider would
   * be. Everything after this point is the real code path: the backend
   * provisions the user, applies the access list, and refuses the identity if
   * it is not on one.
   *
   * The number is NOT canonicalised here. The server normalises whatever the
   * preview token carries, and doing it in both places would let the two
   * definitions drift — at which point preview would admit identities that
   * production would not.
   */
  const signInWithProvider = useCallback(
    async (provider: ProviderId, identifier: string, name?: string) => {
      const trimmed = identifier.trim();
      const isPhone = provider === "phone";
      if (isPhone) {
        if (!trimmed) return;
        adopt({ provider, email: "", phone: trimmed, name: name?.trim() ?? "" });
        return;
      }
      const email = trimmed.toLowerCase();
      if (!email.includes("@")) return;
      adopt({ provider, email, phone: "", name: name?.trim() ?? "" });
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
      phone: claims?.phone ?? session?.phone ?? "",
      initial: firstChar(claims?.displayName, session?.email || session?.phone),
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
      verifyCode: async () => {},
      resendCode: async () => {},
      awaitingCode: false,
      pendingIdentifier: "",
      pendingChannel: "email" as const,
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
