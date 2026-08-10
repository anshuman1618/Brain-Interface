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
}: {
  capability: string;
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

  if (!can(capability)) {
    return <Redirect to={`/unauthorized?required=${encodeURIComponent(capability)}`} />;
  }

  return <>{children}</>;
}
