import { useSession } from "@/lib/session";
import { AlertTriangle } from "lucide-react";
import { providerLabel } from "@/lib/auth-providers";

/**
 * Preview-mode banner.
 *
 * There is no identity switcher any more: the platform starts empty and you get
 * in by signing in with an address, so switching identity means signing out and
 * signing back in as someone else — the same as production. The banner exists to
 * say plainly that auth is mocked and the data is not durable.
 */
export function PreviewBar() {
  const { previewMode, email, authProvider, signOut } = useSession();

  if (!previewMode) return null;

  return (
    <div className="bg-warning px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-warning-foreground">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Preview — sign-in is mocked; data is stored on disk and survives restarts
      </span>

      {email && (
        <div className="flex items-center gap-2 sm:gap-3 sm:ml-auto min-w-0 max-w-full">
          {/* The paired foreground for this surface. `text-muted-foreground` is
              keyed to the page ground, not to the warning band, and on the dark
              warning band it measured 3.94:1 — the app's only AA failure. */}
          <span className="text-xs font-mono text-warning-foreground/90 truncate min-w-0 max-w-[160px] sm:max-w-[280px]">
            {email}
            {authProvider ? ` · ${providerLabel(authProvider)}` : ""}
          </span>
          <button
            type="button"
            onClick={() => signOut()}
            className="text-2xs font-mono uppercase tracking-wider rounded-lg bg-card shadow-sm px-2.5 min-h-9 inline-flex items-center hover:bg-accent transition-colors"
          >
            Switch account
          </button>
        </div>
      )}
    </div>
  );
}
