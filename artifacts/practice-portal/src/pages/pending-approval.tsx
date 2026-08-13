import { useState } from "react";
import { Clock, ShieldCheck, LogOut, Building2, ChevronRight, Loader2 } from "lucide-react";
import { useListWorkspaces, type WorkspaceMembershipSummary } from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { roleLabel } from "@/lib/role-options";
import CreateChamberPage from "@/pages/create-chamber";

/**
 * Where a signed-in user with no *selected* workspace lands.
 *
 * Three distinct situations share this screen, and they need different words:
 *
 *   1. Active memberships exist but none is selected — the user belongs to more
 *      than one chamber and has to pick. This is not "pending" anything, and
 *      telling them their access was awaiting approval was simply wrong: the
 *      workspace switcher lives in the dashboard header, which is not rendered
 *      from here, so there was no way out of the screen at all.
 *   2. A request is genuinely awaiting an admin's decision.
 *   3. Neither — signed in, admitted nowhere.
 *
 * There is no "request access" form. It posted to a chamber slug hardcoded in
 * this file which existed on no deployment, so every request 404'd. Joining an
 * existing chamber is by admin invitation; founding one is the self-serve path.
 */
export default function PendingApprovalPage() {
  const { displayName, email, signOut, switchWorkspace, isSwitchingWorkspace } = useSession();
  const { data: memberships = [] } = useListWorkspaces();

  const [founding, setFounding] = useState(false);

  const pending = memberships.filter((m: WorkspaceMembershipSummary) => m.status === "pending");
  const active = memberships.filter((m: WorkspaceMembershipSummary) => m.status === "active");
  const hasPending = pending.length > 0;
  const mustChoose = active.length > 0;

  if (founding) {
    return <CreateChamberPage onCancel={() => setFounding(false)} />;
  }

  const heading = mustChoose
    ? "Choose a chamber"
    : hasPending
      ? "Your request is with an admin"
      : "You're signed in, but not yet in a chamber";

  const subheading = mustChoose
    ? " You belong to more than one chamber, so pick the one you want to work in."
    : hasPending
      ? " No workspace data is available to you until an admin approves it."
      : " Ask your chamber admin to add this address to the access list, or create your own chamber.";

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center px-4 py-12 relative overflow-y-auto">
      <div className="fixed inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSJub25lIiAvPgo8cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJjdXJyZW50Q29sb3IiIG9wYWNpdHk9IjAuMDUiIC8+Cjwvc3ZnPg==')] opacity-[0.4] pointer-events-none" />

      <div className="relative z-10 w-full max-w-3xl">
        <div className="rounded-lg bg-card shadow-sm p-8 mb-6">
          <div className="flex items-start gap-4">
            <div className="h-10 w-10 bg-muted flex items-center justify-center shrink-0">
              {mustChoose ? (
                <Building2 className="h-5 w-5 text-muted-foreground" />
              ) : (
                <Clock className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1">
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-1">
                {mustChoose ? "Select a chamber" : "Access pending"}
              </p>
              <h1 className="text-2xl font-bold tracking-tight mb-2">{heading}</h1>
              <p className="text-sm text-muted-foreground">
                Signed in as{" "}
                <span className="font-medium text-foreground">{displayName || email}</span>.
                {subheading}
              </p>
            </div>
          </div>
        </div>

        {mustChoose && (
          <div className="rounded-lg bg-card shadow-sm p-8">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground mb-4">
              <Building2 className="h-4 w-4" /> Your chambers
            </div>
            <div className="space-y-3">
              {active.map((m: WorkspaceMembershipSummary) => (
                <button
                  key={m.workspace.id}
                  type="button"
                  disabled={isSwitchingWorkspace}
                  onClick={() => switchWorkspace(m.workspace.id)}
                  className="w-full border border-border p-4 flex justify-between items-center gap-4 text-left hover:border-primary/50 hover:bg-accent transition-colors disabled:opacity-60"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{m.workspace.name}</p>
                    <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider mt-1">
                      {roleLabel(m.role) || m.role}
                    </p>
                  </div>
                  {isSwitchingWorkspace ? (
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {!mustChoose && hasPending && (
          <div className="rounded-lg bg-card shadow-sm p-8">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground mb-4">
              <ShieldCheck className="h-4 w-4" /> Awaiting decision
            </div>
            <div className="space-y-3">
              {pending.map((m: WorkspaceMembershipSummary) => (
                <div
                  key={m.workspace.id}
                  className="border border-border p-4 flex justify-between items-center gap-4"
                >
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
        )}

        {!mustChoose && !hasPending && (
          <div className="rounded-lg bg-card shadow-sm p-8">
            <h2 className="text-lg font-bold tracking-tight mb-1">Nothing is waiting on you</h2>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              Your address{" "}
              <span className="font-mono text-foreground break-all">{email || "(unknown)"}</span> is
              not on any chamber's access list. An admin can add it, after which signing in again
              admits you automatically. If you are setting up your own practice, create a chamber
              now.
            </p>
            <Button className="rounded-lg" onClick={() => setFounding(true)}>
              <Building2 className="h-4 w-4 mr-2" /> Create a chamber
            </Button>
          </div>
        )}

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => signOut()}
            className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
