import { type ReactNode } from "react";
import { Redirect } from "wouter";
import { Loader2 } from "lucide-react";
import { useSession } from "@/lib/session";

/**
 * Layout guard for restricted routes.
 *
 * The check is a lookup in the capability list the backend issued for this
 * session — not a role comparison the browser makes for itself. Typing `/kpi`
 * into the address bar therefore lands on /unauthorized unless the server said
 * the capability is held, and even if this component were bypassed entirely the
 * page would render empty: every endpoint behind it re-runs the same check.
 */
export function RequireCapability({
  capability,
  children,
  quiet = false,
}: {
  capability: string;
  children: ReactNode;
  /**
   * Render nothing instead of redirecting when the capability is absent.
   *
   * For a SECTION of a shared page rather than a whole route. Access Control
   * and Team Roles live on one page under one nav entry but are gated
   * separately, so a team manager who lacks `access_control.manage` should
   * see the half they can manage — not be bounced off the page by the half
   * they cannot. Redirecting out of a page the person was legitimately shown
   * is the wrong answer; omitting the section is the right one.
   *
   * Safe because it is cosmetic either way: every endpoint behind both
   * sections re-runs the same check, so a section rendered by mistake would
   * be an empty one.
   */
  quiet?: boolean;
}) {
  const { isLoaded, isSignedIn, claims, can } = useSession();

  if (!isLoaded || (isSignedIn && !claims)) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!can(capability)) {
    if (quiet) return null;
    return <Redirect to={`/unauthorized?required=${encodeURIComponent(capability)}`} />;
  }

  return <>{children}</>;
}

/**
 * The same gate, satisfied by ANY of several capabilities.
 *
 * A merged page needs this: its sections are gated individually and quietly,
 * so without an outer check somebody holding none of them would be shown a
 * page that renders nothing at all — which looks like a bug rather than a
 * refusal. The redirect names the first capability, since that is the one the
 * nav entry is primarily for.
 */
export function RequireAnyCapability({
  capabilities,
  children,
}: {
  capabilities: string[];
  children: ReactNode;
}) {
  const { isLoaded, isSignedIn, claims, can } = useSession();

  if (!isLoaded || (isSignedIn && !claims)) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!capabilities.some((c) => can(c))) {
    return <Redirect to={`/unauthorized?required=${encodeURIComponent(capabilities[0] ?? "")}`} />;
  }

  return <>{children}</>;
}
