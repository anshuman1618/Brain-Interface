import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useAuth, useUser } from "@clerk/react";
import { ROLE_OPTIONS, type RoleValue } from "@/lib/role-options";
import { clearPreviewRole, getPreviewRole, setPreviewRole } from "@/lib/preview";

/**
 * A single session shape the UI reads from, so components never talk to Clerk
 * directly. Two providers implement it: one backed by Clerk, one by preview
 * mode. Without this the app could not render at all when Clerk is
 * unconfigured — every Clerk hook throws outside a ClerkProvider.
 */
export type Session = {
  isLoaded: boolean;
  isSignedIn: boolean;
  displayName: string;
  email: string;
  initial: string;
  signOut: () => void;
  /** True when auth is mocked. Drives the preview banner and role switcher. */
  previewMode: boolean;
  /** Only set in preview mode: the role being explored. */
  previewRole: RoleValue | null;
  switchPreviewRole: (role: RoleValue) => void;
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

export function ClerkSessionProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const { signOut } = useAuth();

  const value = useMemo<Session>(() => {
    const email = user?.emailAddresses?.[0]?.emailAddress ?? "";
    return {
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
      displayName: user?.fullName || email,
      email,
      initial: firstChar(user?.firstName, email),
      signOut: () => void signOut(),
      previewMode: false,
      previewRole: null,
      switchPreviewRole: () => {},
    };
  }, [isLoaded, isSignedIn, user, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Seeded preview identities, matching the sample users in lib/db/src/preview.ts. */
const PREVIEW_IDENTITIES: Record<RoleValue, { name: string; email: string }> = {
  admin: { name: "Priya Raghavan", email: "admin@chambers.preview" },
  senior_advocate: { name: "R. Krishnan", email: "krishnan@chambers.preview" },
  junior_advocate: { name: "S. Iyer", email: "iyer@chambers.preview" },
  clerk_intern: { name: "P. Nair", email: "nair@chambers.preview" },
  client: { name: "A. Kapoor", email: "kapoor@client.preview" },
};

export function PreviewSessionProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<RoleValue | null>(() => getPreviewRole());

  const switchPreviewRole = useCallback((next: RoleValue) => {
    setPreviewRole(next);
    setRole(next);
  }, []);

  const signOut = useCallback(() => {
    clearPreviewRole();
    setRole(null);
  }, []);

  const value = useMemo<Session>(() => {
    const identity = role ? PREVIEW_IDENTITIES[role] : null;
    return {
      isLoaded: true,
      isSignedIn: role !== null,
      displayName: identity?.name ?? "",
      email: identity?.email ?? "",
      initial: firstChar(identity?.name),
      signOut,
      previewMode: true,
      previewRole: role,
      switchPreviewRole,
    };
  }, [role, signOut, switchPreviewRole]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export { ROLE_OPTIONS };
