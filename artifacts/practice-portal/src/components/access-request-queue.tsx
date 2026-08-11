import { useState } from "react";
import {
  useListAccessRequests,
  useDecideAccessRequest,
  getListAccessRequestsQueryKey,
  getListWorkspaceMembersQueryKey,
  type AccessRequest,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, X, UserPlus, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/lib/session";
import { ROLE_OPTIONS, roleLabel } from "@/lib/role-options";

/**
 * The approval queue — the only way a person becomes a member of a workspace.
 *
 * Note the two separate values per row: what the applicant *asked for*, and the
 * role the admin is about to grant. They are deliberately not the same control.
 * The grant defaults to Client (least privilege), so approving without thinking
 * hands out the safest role rather than the requested one.
 */
export function AccessRequestQueue() {
  const { activeWorkspace } = useSession();
  const { data: requests, isLoading } = useListAccessRequests();
  const decide = useDecideAccessRequest();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [grantRoles, setGrantRoles] = useState<Record<number, string>>({});

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListAccessRequestsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListWorkspaceMembersQueryKey() });
  };

  const approve = (req: AccessRequest) => {
    const role = grantRoles[req.id] ?? "client";
    decide.mutate(
      { id: req.id, data: { decision: "approve", role: role as never } },
      {
        onSuccess: () => {
          refresh();
          toast({
            title: `${req.displayName || "Applicant"} approved`,
            description: `Granted ${roleLabel(role)} in ${activeWorkspace?.name}.`,
          });
        },
        onError: () => toast({ title: "Couldn't approve the request", variant: "destructive" }),
      },
    );
  };

  const deny = (req: AccessRequest) => {
    decide.mutate(
      { id: req.id, data: { decision: "deny" } },
      {
        onSuccess: () => {
          refresh();
          toast({ title: "Request denied" });
        },
        onError: () => toast({ title: "Couldn't deny the request", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="rounded-lg bg-card shadow-sm">
      <div className="px-6 py-4 border-b border-border bg-muted/30 flex items-center gap-2">
        <UserPlus className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-mono text-xs uppercase tracking-widest font-bold">
          Pending access requests
        </h3>
        {requests && requests.length > 0 && (
          <span className="ml-auto text-xs font-mono uppercase tracking-wider bg-destructive text-destructive-foreground px-2 py-0.5">
            {requests.length} waiting
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="p-6 space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !requests || requests.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground font-mono uppercase tracking-wider">
          No one is waiting for access
        </div>
      ) : (
        <div className="divide-y divide-border">
          {requests.map((req: AccessRequest) => (
            <div key={req.id} className="p-6 flex flex-col lg:flex-row gap-4 lg:items-center">
              <div className="flex-1 min-w-0">
                <p className="font-medium">{req.displayName || "Unnamed applicant"}</p>
                <p className="text-sm text-muted-foreground truncate">{req.email}</p>
                {req.requestNote && (
                  <p className="text-sm text-muted-foreground italic mt-2">"{req.requestNote}"</p>
                )}
                {req.requestedRole && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-muted-foreground">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Asked for: {roleLabel(req.requestedRole)} — not granted
                  </p>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-3 sm:items-end shrink-0">
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    Grant role
                  </label>
                  <Select
                    value={grantRoles[req.id] ?? "client"}
                    onValueChange={(v) => setGrantRoles((prev) => ({ ...prev, [req.id]: v }))}
                  >
                    <SelectTrigger className="rounded-lg w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="rounded-lg"
                    disabled={decide.isPending}
                    onClick={() => deny(req)}
                  >
                    <X className="h-4 w-4 mr-1.5" /> Deny
                  </Button>
                  <Button
                    className="rounded-lg"
                    disabled={decide.isPending}
                    onClick={() => approve(req)}
                  >
                    <Check className="h-4 w-4 mr-1.5" /> Approve
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
