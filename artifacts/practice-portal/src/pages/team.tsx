import {
  useListWorkspaceMembers,
  useUpdateWorkspaceMember,
  getListWorkspaceMembersQueryKey,
  type AccessRequest,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, UserMinus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/lib/session";
import { ROLE_OPTIONS, roleLabel } from "@/lib/role-options";

const ASSIGNABLE_ROLES = ROLE_OPTIONS.map((o) => o.value);

/**
 * Membership management for the current workspace.
 *
 * Roles are edited on the membership row, not on the user — a person can be an
 * admin here and a client somewhere else, and changing one has no effect on the
 * other.
 */
export default function TeamPage() {
  const { activeWorkspace, claims } = useSession();
  const { data: members, isLoading } = useListWorkspaceMembers();
  const updateMember = useUpdateWorkspaceMember();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListWorkspaceMembersQueryKey() });

  const handleRoleChange = (membershipId: number, role: string) => {
    updateMember.mutate(
      { id: membershipId, data: { role: role as never } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Role updated", description: `Applies to ${activeWorkspace?.name} only.` });
        },
        onError: () => toast({ title: "Couldn't update role", variant: "destructive" }),
      },
    );
  };

  const handleRevoke = (membershipId: number, name: string) => {
    updateMember.mutate(
      { id: membershipId, data: { status: "revoked" } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: `${name} removed`, description: "Their access ends on their next request." });
        },
        onError: () => toast({ title: "Couldn't remove member", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold tracking-tight mb-1">Team Roles</h2>
        <p className="text-muted-foreground">
          Membership of <span className="font-medium text-foreground">{activeWorkspace?.name}</span>.
          Roles here apply to this workspace only.
        </p>
      </div>

      <div className="border border-border bg-background">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent bg-muted/30">
              <TableHead className="font-mono text-xs uppercase tracking-wider">Name</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Email</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Role here</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider text-right">Change role</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider text-right">Access</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array(4).fill(0).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-40 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-20 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : members?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  No members yet.
                </TableCell>
              </TableRow>
            ) : (
              members?.map((m: AccessRequest) => {
                const isSelf = m.userId === claims?.userId;
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium text-sm">
                      {m.displayName || "—"}
                      {isSelf && <span className="text-muted-foreground font-normal ml-2 text-xs">(you)</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.email || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="rounded-none text-[10px] uppercase font-mono tracking-wider flex items-center gap-1 w-fit">
                        {m.role === "admin" && <ShieldCheck className="h-3 w-3" />}
                        {roleLabel(m.role) || m.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Select
                        value={m.role}
                        onValueChange={(role) => handleRoleChange(m.id, role)}
                        disabled={updateMember.isPending || isSelf}
                      >
                        <SelectTrigger className="rounded-none w-44 ml-auto">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ASSIGNABLE_ROLES.map((r) => (
                            <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      {/* An admin cannot revoke themselves — the server refuses it too,
                          so a workspace can never be left with nobody to administer it. */}
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-none"
                        disabled={updateMember.isPending || isSelf}
                        onClick={() => handleRevoke(m.id, m.displayName || "Member")}
                      >
                        <UserMinus className="h-3.5 w-3.5 mr-1.5" />
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
