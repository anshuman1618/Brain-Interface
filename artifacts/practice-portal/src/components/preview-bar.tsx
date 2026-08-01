import { ROLE_OPTIONS } from "@/lib/role-options";
import { useSession } from "@/lib/session";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

/**
 * Preview-mode banner and role switcher.
 *
 * Switching role changes who the API believes you are, so every cached response
 * belongs to the previous identity and must be discarded — otherwise the new
 * role briefly renders the old role's data, which would misrepresent the access
 * rules this switcher exists to demonstrate.
 */
export function PreviewBar() {
  const { previewMode, previewRole, switchPreviewRole } = useSession();
  const queryClient = useQueryClient();

  if (!previewMode) return null;

  return (
    <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Preview — mock auth, sample data
      </span>

      <div className="flex items-center gap-2 ml-auto">
        <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Viewing as
        </span>
        <div className="flex flex-wrap border border-border">
          {ROLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={previewRole === opt.value}
              onClick={() => {
                if (previewRole === opt.value) return;
                switchPreviewRole(opt.value);
                queryClient.clear();
              }}
              className={`px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider border-r border-border last:border-r-0 transition-colors ${
                previewRole === opt.value
                  ? "bg-foreground text-background"
                  : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
