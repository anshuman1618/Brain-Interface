import { Building2, Check, ChevronsUpDown, Clock, Loader2 } from "lucide-react";
import { useSession } from "@/lib/session";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { roleLabel } from "@/lib/role-options";

/**
 * Workspace switcher.
 *
 * The list is exactly `GET /workspaces` — the memberships the database holds for
 * this user. There is no client-side list of "all workspaces" to filter, so
 * there is nothing here for a tampered client to reveal. Selecting one calls
 * `POST /session/workspace`, which re-verifies membership before it will hand
 * back a scoped token.
 */
export function WorkspaceSwitcher() {
  const { workspaces, activeWorkspace, switchWorkspace, isSwitchingWorkspace, role } = useSession();

  const active = workspaces.filter((m) => m.status === "active");
  const pending = workspaces.filter((m) => m.status === "pending");

  if (active.length === 0) return null;

  // Nothing to switch between — show it as a label rather than a dead control.
  if (active.length === 1 && pending.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-card shadow-sm px-3 py-2 min-w-0">
        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium truncate leading-tight">
            {activeWorkspace?.name ?? active[0].workspace.name}
          </span>
          <span className="text-3xs font-mono uppercase tracking-wider text-muted-foreground truncate">
            {roleLabel(role) || role}
          </span>
        </div>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-lg bg-card shadow-sm px-3 py-2 hover:bg-accent transition-colors min-w-0 max-w-[280px]"
          disabled={isSwitchingWorkspace}
        >
          {isSwitchingWorkspace ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
          ) : (
            <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <div className="flex flex-col min-w-0 text-left">
            <span className="text-sm font-medium truncate leading-tight">
              {activeWorkspace?.name ?? "Select a workspace"}
            </span>
            <span className="text-3xs font-mono uppercase tracking-wider text-muted-foreground truncate">
              {roleLabel(role) || "No role"}
            </span>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 ml-1" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-[280px] rounded-lg">
        <DropdownMenuLabel className="font-mono text-3xs uppercase tracking-widest text-muted-foreground">
          Your workspaces
        </DropdownMenuLabel>
        {active.map((m) => (
          <DropdownMenuItem
            key={m.workspace.id}
            className="rounded-lg cursor-pointer"
            onSelect={() => {
              if (m.workspace.id !== activeWorkspace?.id) switchWorkspace(m.workspace.id);
            }}
          >
            <div className="flex items-center gap-2 w-full min-w-0">
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm truncate">{m.workspace.name}</span>
                <span className="text-3xs font-mono uppercase tracking-wider text-muted-foreground">
                  {roleLabel(m.role) || m.role}
                </span>
              </div>
              {m.workspace.id === activeWorkspace?.id && <Check className="h-4 w-4 shrink-0" />}
            </div>
          </DropdownMenuItem>
        ))}

        {pending.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="font-mono text-3xs uppercase tracking-widest text-muted-foreground">
              Awaiting approval
            </DropdownMenuLabel>
            {pending.map((m) => (
              // Rendered disabled, but that is cosmetic: the backend refuses a
              // switch into a workspace whose membership is not active.
              <DropdownMenuItem key={m.workspace.id} disabled className="rounded-lg opacity-60">
                <div className="flex items-center gap-2 w-full min-w-0">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-sm truncate flex-1">{m.workspace.name}</span>
                  <span className="text-3xs font-mono uppercase tracking-wider">Pending</span>
                </div>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
