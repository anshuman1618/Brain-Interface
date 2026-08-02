import { useState } from "react";
import { Clock, ShieldCheck, LogOut, Send } from "lucide-react";
import {
  useCreateAccessRequest,
  useListWorkspaces,
  type WorkspaceMembershipSummary,
} from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RoleOptionsGrid } from "@/components/auth/role-options-grid";
import { useToast } from "@/hooks/use-toast";
import {
  clearAccessRequestIntent,
  getAccessRequestIntent,
  roleLabel,
  type RoleValue,
} from "@/lib/role-options";

/**
 * Where a signed-in user with no active membership lands.
 *
 * This is the whole of what a fresh account gets. There is no data behind it —
 * every protected endpoint answers 403 for a user in this state — so the page
 * cannot be "escaped" by editing the URL or any stored value.
 */
export default function PendingApprovalPage({ defaultWorkspaceSlug = "raghavan-chambers" }: { defaultWorkspaceSlug?: string }) {
  const { displayName, email, signOut, refreshSession } = useSession();
  const { data: memberships = [], refetch } = useListWorkspaces();
  const createRequest = useCreateAccessRequest();
  const { toast } = useToast();

  const [selected, setSelected] = useState<RoleValue | null>(() => getAccessRequestIntent());
  const [note, setNote] = useState("");

  const pending = memberships.filter((m: WorkspaceMembershipSummary) => m.status === "pending");
  const hasPending = pending.length > 0;

  const submit = () => {
    if (!selected) return;
    createRequest.mutate(
      { data: { workspaceSlug: defaultWorkspaceSlug, requestedRole: selected, note: note || undefined } },
      {
        onSuccess: () => {
          clearAccessRequestIntent();
          toast({
            title: "Request submitted",
            description: "An admin will review it. Nothing is granted until they approve.",
          });
          void refetch();
          refreshSession();
        },
        onError: (err: unknown) => {
          toast({
            title: "Couldn't submit the request",
            description: err instanceof Error ? err.message : undefined,
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center px-4 py-12 relative overflow-y-auto">
      <div className="fixed inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSJub25lIiAvPgo8cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJjdXJyZW50Q29sb3IiIG9wYWNpdHk9IjAuMDUiIC8+Cjwvc3ZnPg==')] opacity-[0.4] pointer-events-none" />

      <div className="relative z-10 w-full max-w-3xl">
        <div className="border border-border bg-background p-8 mb-6">
          <div className="flex items-start gap-4">
            <div className="h-10 w-10 bg-muted flex items-center justify-center shrink-0">
              <Clock className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-1">
                Access pending
              </p>
              <h1 className="text-2xl font-bold tracking-tight mb-2">
                {hasPending ? "Your request is with an admin" : "You're signed in, but not yet in a workspace"}
              </h1>
              <p className="text-sm text-muted-foreground">
                Signed in as <span className="font-medium text-foreground">{displayName || email}</span>.
                {hasPending
                  ? " No workspace data is available to you until an admin approves it."
                  : " Ask for access below — this records a request; it does not grant anything."}
              </p>
            </div>
          </div>
        </div>

        {hasPending ? (
          <div className="border border-border bg-background p-8">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground mb-4">
              <ShieldCheck className="h-4 w-4" /> Awaiting decision
            </div>
            <div className="space-y-3">
              {pending.map((m: WorkspaceMembershipSummary) => (
                <div key={m.workspace.id} className="border border-border p-4 flex justify-between items-center gap-4">
                  <div>
                    <p className="font-medium">{m.workspace.name}</p>
                    <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider mt-1">
                      Requested: {roleLabel(m.requestedRole) || "Access"}
                    </p>
                  </div>
                  <span className="text-xs font-mono uppercase tracking-wider border border-border px-3 py-1.5 text-muted-foreground">
                    Pending
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-6 leading-relaxed">
              The role you asked for is recorded as a request only. An admin chooses which role — if
              any — is actually granted.
            </p>
          </div>
        ) : (
          <div className="border border-border bg-background p-8">
            <h2 className="text-lg font-bold tracking-tight mb-1">Request access</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Tell the admin what you need. They decide the role you're given.
            </p>

            <div className="mb-6">
              <RoleOptionsGrid selected={selected} onSelect={setSelected} />
            </div>

            <div className="space-y-2 mb-6">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                Why do you need access? (optional)
              </label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="rounded-none resize-none h-20 bg-background"
                placeholder="e.g. Joining as practice manager from 1 September."
              />
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => signOut()}
                className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </button>
              <Button
                className="rounded-none px-8"
                disabled={!selected || createRequest.isPending}
                onClick={submit}
              >
                <Send className="h-4 w-4 mr-2" />
                {createRequest.isPending ? "Submitting..." : "Submit request"}
              </Button>
            </div>
          </div>
        )}

        {hasPending && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => signOut()}
              className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
