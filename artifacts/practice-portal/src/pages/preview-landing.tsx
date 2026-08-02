import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";
import { PREVIEW_IDENTITIES, PREVIEW_IDENTITY_LABELS, type PreviewIdentity } from "@/lib/preview";
import { AlertTriangle, Check, Clock, Building2 } from "lucide-react";

/**
 * Pre-auth entry point for preview mode: choose which seeded person to sign in
 * as, then explore what *their* memberships allow. Nothing here touches Clerk,
 * and nothing here grants access — the identity is resolved server-side and the
 * workspaces it reaches come from the database.
 */
export function PreviewLanding() {
  const { switchPreviewIdentity } = useSession();
  const [selected, setSelected] = useState<PreviewIdentity | null>(null);

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
            Choose an identity
          </p>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Sign in as someone</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            You are picking a person, not a permission level. What each one reaches comes from
            their workspace memberships in the database — including the applicant who has none
            yet. Switch at any time from the bar at the top.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mb-8">
          {PREVIEW_IDENTITIES.map((identity) => {
            const meta = PREVIEW_IDENTITY_LABELS[identity];
            const isSelected = selected === identity;
            const isApplicant = identity === "unassigned";
            const isOtherTenant = identity === "rival_admin";
            return (
              <button
                key={identity}
                type="button"
                onClick={() => setSelected(identity)}
                className={`text-left border p-4 transition-colors relative ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border bg-background hover:border-primary/50"
                }`}
              >
                {isSelected && (
                  <div className="absolute top-3 right-3 h-5 w-5 bg-primary text-primary-foreground flex items-center justify-center">
                    <Check className="h-3.5 w-3.5" />
                  </div>
                )}
                <div className="font-semibold mb-1">{meta.name}</div>
                <div className="text-sm text-muted-foreground flex items-center gap-1.5">
                  {isApplicant && <Clock className="h-3.5 w-3.5 shrink-0" />}
                  {isOtherTenant && <Building2 className="h-3.5 w-3.5 shrink-0" />}
                  {meta.hint}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex justify-end">
          <Button
            className="rounded-none px-8"
            disabled={!selected}
            onClick={() => selected && switchPreviewIdentity(selected)}
          >
            Enter portal
          </Button>
        </div>
      </div>
    </div>
  );
}
