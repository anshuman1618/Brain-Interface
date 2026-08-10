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
    <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Preview — sign-in is mocked; data is stored on disk and survives restarts
      </span>

      {email && (
        <div className="flex items-center gap-2 sm:gap-3 sm:ml-auto min-w-0 max-w-full">
          <span className="text-xs font-mono text-muted-foreground truncate min-w-0 max-w-[160px] sm:max-w-[280px]">
            {email}
            {authProvider ? ` · ${providerLabel(authProvider)}` : ""}
          </span>
          <button
            type="button"
            onClick={() => signOut()}
            className="text-[11px] font-mono uppercase tracking-wider border border-border bg-background px-2.5 py-1 hover:bg-accent transition-colors"
          >
            Switch account
          </button>
        </div>
      )}
    </div>
  );
}
