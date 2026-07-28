import { useListUsers, useUpdateUserRole, getListUsersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useUserRole } from "@/hooks/use-user-role";

const ROLE_LABELS: Record<string, string> = {
  admin: "Firm Admin",
  senior_advocate: "Senior Advocate",
  junior_advocate: "Junior Advocate",
  clerk_intern: "Clerk / Intern",
  clerk: "Clerk / Intern",
  client: "Client",
};

const ASSIGNABLE_ROLES = ["admin", "senior_advocate", "junior_advocate", "clerk_intern", "client"];

export default function TeamPage() {
  const { data: users, isLoading } = useListUsers();
  const updateRole = useUpdateUserRole();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { profile: me } = useUserRole();

  const handleRoleChange = (userId: number, role: string) => {
    updateRole.mutate({ id: userId, data: { role: role as any } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        toast({ title: "Role updated" });
      },
      onError: () => {
        toast({ title: "Couldn't update role", variant: "destructive" });
      },
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold tracking-tight mb-1">Team Roles</h2>
        <p className="text-muted-foreground">Every user picks a role at sign-up. Change it here at any time.</p>
      </div>

      <div className="border border-border bg-background">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent bg-muted/30">
              <TableHead className="font-mono text-xs uppercase tracking-wider">Name</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Email</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Current Role</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider text-right">Change Role</TableHead>
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
                </TableRow>
              ))
            ) : users?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                  No users yet.
                </TableCell>
              </TableRow>
            ) : (
              users?.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium text-sm">{u.displayName || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{u.email || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="rounded-none text-[10px] uppercase font-mono tracking-wider flex items-center gap-1 w-fit">
                      {u.role === "admin" && <ShieldCheck className="h-3 w-3" />}
                      {ROLE_LABELS[u.role] ?? u.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Select
                      value={u.role === "clerk" ? "clerk_intern" : u.role}
                      onValueChange={(role) => handleRoleChange(u.id, role)}
                      disabled={updateRole.isPending || u.id === me?.id}
                    >
                      <SelectTrigger className="rounded-none w-44 ml-auto">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSIGNABLE_ROLES.map((r) => (
                          <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
