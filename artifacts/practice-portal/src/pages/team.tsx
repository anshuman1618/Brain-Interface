import {
  useListWorkspaceMembers,
  useUpdateWorkspaceMember,
  getListWorkspaceMembersQueryKey,
  type AccessRequest,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AdaptiveTable } from "@/components/ui/adaptive-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, UserMinus, Scale, EyeOff } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/lib/session";
import { ROLE_OPTIONS, roleLabel, needsBarRegistration } from "@/lib/role-options";
import { CaseAccessDialog } from "@/components/case-access-dialog";

const ASSIGNABLE_ROLES = ROLE_OPTIONS.map((o) => o.value);

/**
 * Who can be narrowed to named matters.
 *
 * A senior advocate directs the chamber's work and cannot be shut out of it; a
 * client is already confined to their own matter by row scope, and layering a
 * second mechanism on top would give two places to look when somebody cannot
 * see something. The server refuses the others with a 400 — this only decides
 * whether the button is worth offering.
 */
const RESTRICTABLE_ROLES = ["junior_advocate", "clerk_intern"];

/**
 * Membership management for the current workspace.
 *
 * Roles are edited on the membership row, not on the user — a person can be an
 * admin here and a client somewhere else, and changing one has no effect on the
 * other.
 */
export default function TeamPage() {
  const { activeWorkspace, claims, can } = useSession();
  const [caseAccessFor, setCaseAccessFor] = useState<{ id: number; name: string } | null>(null);
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
          toast({
            title: "Role updated",
            description: `Applies to ${activeWorkspace?.name} only.`,
          });
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
          toast({
            title: `${name} removed`,
            description: "Their access ends on their next request.",
          });
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
          Membership of <span className="font-medium text-foreground">{activeWorkspace?.name}</span>
          . Roles here apply to this workspace only.
        </p>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2 rounded-lg bg-card p-3 shadow-sm">
          {Array(4)
            .fill(0)
            .map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
        </div>
      ) : (
        <AdaptiveTable
          label="Team"
          className="rounded-lg md:bg-card md:shadow-sm"
          rows={members ?? []}
          rowKey={(m: AccessRequest) => m.id}
          empty={
            <div className="flex h-32 flex-col items-center justify-center rounded-lg bg-card px-4 text-center shadow-sm">
              <p className="text-sm font-medium">Just you so far</p>
              <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
                Add colleagues to the access list under Access Control, and they appear here once
                they sign in.
              </p>
            </div>
          }
          columns={[
            {
              key: "name",
              header: "Name",
              card: "title",
              className: "font-mono text-xs uppercase tracking-wider",
              cell: (m: AccessRequest) => {
                const isSelf = m.userId === claims?.userId;
                return (
                  <span className="text-sm font-medium">
                    {m.displayName || "—"}
                    {isSelf && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>
                    )}
                    {/* Self-declared, so only editable by the person it
                        describes — not something an admin sets for someone else
                        here. Reaching this page at all already implies
                        profileComplete is true, so this is always "Edit". */}
                    {isSelf && needsBarRegistration(m.role) && (
                      <Link
                        href="/complete-profile"
                        className="mt-1 flex w-fit items-center gap-1 font-mono text-2xs uppercase tracking-wider text-primary hover:text-primary/80"
                      >
                        <Scale className="h-3 w-3" />
                        Edit bar registration
                      </Link>
                    )}
                  </span>
                );
              },
            },
            {
              key: "email",
              header: "Email",
              card: "subtitle",
              className: "font-mono text-xs uppercase tracking-wider",
              tableClassName: "hidden sm:table-cell",
              cell: (m: AccessRequest) => (
                <span className="text-sm text-muted-foreground">{m.email || "—"}</span>
              ),
            },
            {
              key: "role",
              header: "Role here",
              className: "font-mono text-xs uppercase tracking-wider",
              tableClassName: "hidden md:table-cell",
              cell: (m: AccessRequest) => (
                <Badge
                  variant="outline"
                  className="flex w-fit items-center gap-1 rounded-lg font-mono text-3xs uppercase tracking-wider"
                >
                  {m.role === "admin" && <ShieldCheck className="h-3 w-3" />}
                  {roleLabel(m.role) || m.role}
                </Badge>
              ),
            },
            {
              key: "changeRole",
              header: "Change role",
              card: "field",
              className: "text-right font-mono text-xs uppercase tracking-wider",
              cell: (m: AccessRequest) => {
                const isSelf = m.userId === claims?.userId;
                return (
                  <Select
                    value={m.role}
                    onValueChange={(role) => handleRoleChange(m.id, role)}
                    disabled={updateMember.isPending || isSelf}
                  >
                    {/* `w-full` on a phone: the card gives it the row, and a
                        fixed 11rem trigger inside a 320px card overflows. */}
                    <SelectTrigger className="ml-auto w-full rounded-lg sm:w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASSIGNABLE_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {roleLabel(r)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              },
            },
            {
              key: "access",
              header: "Access",
              card: "action",
              className: "text-right font-mono text-xs uppercase tracking-wider",
              cell: (m: AccessRequest) => {
                const isSelf = m.userId === claims?.userId;
                return (
                  <div className="flex flex-col items-end gap-2 sm:flex-row sm:justify-end">
                    {/* Narrowing someone's matters is the same kind of decision
                        as admitting them, so it sits behind the same capability
                        the access list does. */}
                    {can("access_control.manage") && RESTRICTABLE_ROLES.includes(m.role) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-lg"
                        onClick={() =>
                          setCaseAccessFor({ id: m.id, name: m.displayName || "This member" })
                        }
                      >
                        <EyeOff className="mr-1.5 h-3.5 w-3.5" />
                        Case access
                      </Button>
                    )}
                    {/* An admin cannot revoke themselves — the server refuses it
                        too, so a workspace can never be left with nobody to
                        administer it. */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg"
                      disabled={updateMember.isPending || isSelf}
                      onClick={() => handleRevoke(m.id, m.displayName || "Member")}
                    >
                      <UserMinus className="mr-1.5 h-3.5 w-3.5" />
                      Revoke
                    </Button>
                  </div>
                );
              },
            },
          ]}
        />
      )}

      <CaseAccessDialog
        membershipId={caseAccessFor?.id ?? null}
        memberName={caseAccessFor?.name ?? ""}
        open={caseAccessFor !== null}
        onOpenChange={(next) => {
          if (!next) setCaseAccessFor(null);
        }}
      />
    </div>
  );
}
