import { useEffect, useRef, useState } from "react";
import { useSelectRole, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { RoleOptionsGrid } from "@/components/auth/role-options-grid";
import { ROLE_OPTIONS, clearPendingRoleSelection, type RoleValue } from "@/lib/role-options";

export default function SelectRolePage({ autoApplyRole }: { autoApplyRole?: RoleValue }) {
  const [selected, setSelected] = useState<RoleValue | null>(autoApplyRole ?? null);
  const [autoApplyFailed, setAutoApplyFailed] = useState(false);
  const selectRole = useSelectRole();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { signOut } = useAuth();
  const hasAutoSubmitted = useRef(false);

  const submitRole = (role: RoleValue) => {
    selectRole.mutate({ data: { role } }, {
      onSuccess: () => {
        clearPendingRoleSelection();
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      },
      onError: () => {
        setAutoApplyFailed(true);
        toast({ title: "Couldn't save your role", description: "Please try again.", variant: "destructive" });
      },
    });
  };

  // If the visitor already picked a workspace role before signing up, apply
  // it automatically now that their account exists instead of asking again.
  useEffect(() => {
    if (autoApplyRole && !hasAutoSubmitted.current) {
      hasAutoSubmitted.current = true;
      submitRole(autoApplyRole);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoApplyRole]);

  const handleContinue = () => {
    if (!selected) return;
    submitRole(selected);
  };

  if (autoApplyRole && !autoApplyFailed) {
    const roleLabel = ROLE_OPTIONS.find((opt) => opt.value === autoApplyRole)?.label ?? "workspace";
    return (
      <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center px-4 py-12 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Setting up your {roleLabel} workspace...</p>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center px-4 py-12 relative overflow-y-auto">
      <div className="fixed inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSJub25lIiAvPgo8cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJjdXJyZW50Q29sb3IiIG9wYWNpdHk9IjAuMDUiIC8+Cjwvc3ZnPg==')] opacity-[0.4] pointer-events-none" />
      <div className="relative z-10 w-full max-w-3xl">
        <div className="mb-8 text-center">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">Step 1 of 1</p>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Choose your workspace role</h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            {autoApplyFailed
              ? "We couldn't save your workspace automatically. Pick it again below."
              : "This determines what you can see and do in the portal. An admin can change it later from Team Settings."}
          </p>
        </div>

        <div className="mb-8">
          <RoleOptionsGrid selected={selected} onSelect={setSelected} />
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => signOut()}
            className="text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign out
          </button>
          <Button
            className="rounded-none px-8"
            disabled={!selected || selectRole.isPending}
            onClick={handleContinue}
          >
            {selectRole.isPending ? "Saving..." : "Continue to dashboard"}
          </Button>
        </div>
      </div>
    </div>
  );
}
