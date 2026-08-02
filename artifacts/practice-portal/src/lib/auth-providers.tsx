import type { ReactNode } from "react";

/**
 * The sign-in providers offered by the chamber portal.
 *
 * A provider establishes *who you are* and nothing else. Whether that identity
 * may enter a workspace is decided afterwards, server-side, against the
 * admin-managed access list — so adding a provider here can never widen access.
 *
 * Clerk strategy names: built-in providers are `oauth_<name>`; a custom OAuth
 * connection configured in the Clerk dashboard is `oauth_custom_<slug>`. Zoho is
 * not one of Clerk's built-ins, so it is wired as a custom OIDC connection with
 * the slug `zoho` (see README → Sign-in providers).
 */

export type ProviderId = "google" | "zoho" | "email";

export type AuthProvider = {
  id: ProviderId;
  label: string;
  /** Clerk `authenticateWithRedirect` strategy. Null for the email route. */
  strategy: string | null;
  hint: string;
  icon: ReactNode;
};

// Inlined marks rather than remote images: the artifact/CSP rules block external
// hosts, and a sign-in button that silently loses its logo looks broken.
const GoogleMark = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
    <path fill="#4285F4" d="M23.06 12.25c0-.85-.08-1.67-.22-2.45H12v4.63h6.2a5.3 5.3 0 0 1-2.3 3.48v2.89h3.72c2.18-2 3.44-4.96 3.44-8.55Z" />
    <path fill="#34A853" d="M12 24c3.11 0 5.72-1.03 7.62-2.8l-3.72-2.89c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.55-2.03-6.46-4.76H1.7v2.98A11.5 11.5 0 0 0 12 24Z" />
    <path fill="#FBBC05" d="M5.54 14.65a6.9 6.9 0 0 1 0-4.42V7.25H1.7a11.5 11.5 0 0 0 0 10.38l3.84-2.98Z" />
    <path fill="#EA4335" d="M12 4.75c1.69 0 3.2.58 4.4 1.72l3.3-3.3C17.72 1.2 15.11 0 12 0 7.44 0 3.5 2.62 1.7 6.44l3.84 2.98C6.45 6.7 9 4.75 12 4.75Z" />
  </svg>
);

const ZohoMark = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
    <rect x="1" y="4" width="22" height="16" rx="2" fill="none" stroke="#E42527" strokeWidth="1.8" />
    <path d="M2.5 6.2 12 13l9.5-6.8" fill="none" stroke="#E42527" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const EmailMark = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
    <rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <path d="M3 7l9 6 9-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const AUTH_PROVIDERS: AuthProvider[] = [
  {
    id: "google",
    label: "Continue with Google",
    strategy: "oauth_google",
    hint: "Google Workspace or Gmail",
    icon: GoogleMark,
  },
  {
    id: "zoho",
    label: "Continue with Zoho Mail",
    strategy: "oauth_custom_zoho",
    hint: "Zoho Mail / Zoho One",
    icon: ZohoMark,
  },
  {
    id: "email",
    label: "Continue with email",
    strategy: null,
    hint: "One-time code to your inbox",
    icon: EmailMark,
  },
];

export function providerLabel(id: string | null | undefined): string {
  switch (id) {
    case "google":
      return "Google";
    case "zoho":
      return "Zoho Mail";
    case "email":
      return "email";
    default:
      return "";
  }
}
