import { useSession } from "@/lib/session";
import { PREVIEW_IDENTITIES, PREVIEW_IDENTITY_LABELS } from "@/lib/preview";
import { AlertTriangle } from "lucide-react";

/**
 * Preview-mode banner and identity switcher.
 *
 * This switches *who you are signed in as*, exactly like signing out and back in
 * with a different Clerk account. It does not select a role or a workspace —
 * those come from the chosen user's membership rows, resolved server-side. That
 * is why "T. Deshmukh" reaches nothing at all (no approved membership) and
 * "V. Mehta" lands in a different chamber entirely.
 */
export function PreviewBar() {
  const { previewMode, previewIdentity, switchPreviewIdentity } = useSession();

  if (!previewMode) return null;

  return (
    <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Preview — mock auth, sample data
      </span>

      <div className="flex items-center gap-2 ml-auto">
        <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Signed in as
        </span>
        <div className="flex flex-wrap border border-border">
          {PREVIEW_IDENTITIES.map((identity) => (
            <button
              key={identity}
              type="button"
              title={PREVIEW_IDENTITY_LABELS[identity].hint}
              aria-pressed={previewIdentity === identity}
              onClick={() => {
                if (previewIdentity === identity) return;
                switchPreviewIdentity(identity);
              }}
              className={`px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider border-r border-border last:border-r-0 transition-colors ${
                previewIdentity === identity
                  ? "bg-foreground text-background"
                  : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {PREVIEW_IDENTITY_LABELS[identity].name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
