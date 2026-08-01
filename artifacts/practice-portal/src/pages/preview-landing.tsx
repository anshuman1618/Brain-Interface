import { useState } from "react";
import { RoleOptionsGrid } from "@/components/auth/role-options-grid";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";
import type { RoleValue } from "@/lib/role-options";
import { AlertTriangle } from "lucide-react";

/**
 * Pre-auth entry point for preview mode: pick a role, then explore the
 * role-scoped interface without signing in. Nothing here touches Clerk.
 */
export function PreviewLanding() {
  const { switchPreviewRole } = useSession();
  const [selected, setSelected] = useState<RoleValue | null>(null);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-12 overflow-y-auto">
      <div className="w-full max-w-3xl">
        <div className="border border-amber-500/40 bg-amber-500/10 px-4 py-3 mb-8 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            <strong className="font-semibold">Preview build.</strong> Authentication is
            mocked and the data below is sample chamber data held in memory — it resets
            when the server restarts. No real client information is present.
          </p>
        </div>

        <div className="mb-8 text-center">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
            Choose a vantage point
          </p>
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            Explore the chamber portal by role
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Each role sees a different portal. Pick one to explore what it can reach —
            and what it cannot. You can switch at any time from the bar at the top.
          </p>
        </div>

        <div className="mb-8">
          <RoleOptionsGrid selected={selected} onSelect={setSelected} />
        </div>

        <div className="flex justify-end">
          <Button
            className="rounded-none px-8"
            disabled={!selected}
            onClick={() => selected && switchPreviewRole(selected)}
          >
            Enter portal
          </Button>
        </div>
      </div>
    </div>
  );
}
