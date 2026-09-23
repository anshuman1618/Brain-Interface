import { useState } from "react";
import {
  useListInvites,
  useCreateInvite,
  getListInvitesQueryKey,
  type InviteInput,
  type InviteInputRole,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdaptiveTable } from "@/components/ui/adaptive-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Plus, Mail, Smartphone, ShieldCheck, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/utils";
import { AccessRequestQueue } from "@/components/access-request-queue";
import { AccessListManager } from "@/components/access-list-manager";
import { useSession } from "@/lib/session";
import { ROLE_OPTIONS } from "@/lib/role-options";

export default function InvitesPage() {
  const { activeWorkspace } = useSession();
  const { data: invites, isLoading } = useListInvites();
  const createInvite = useCreateInvite();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  // An invite names one identifier. A chamber's clerks and most of its clients
  // have a mobile and no work address, so refusing to invite a number would
  // exclude exactly the people the chamber needs on the system.
  const [inviteBy, setInviteBy] = useState<"email" | "phone">("email");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<InviteInputRole>("client");
  const [caseId, setCaseId] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // A client invite must name the one matter it admits them to — the server
  // rejects a client invite with no caseId, and rejects a caseId on any other
  // role, so this mirrors that rule rather than letting the request round-trip
  // to learn it.
  const caseIdRequired = role === "client";
  const identifier = inviteBy === "phone" ? phone : email;
  const canSubmit =
    !!identifier.trim() && !!role && (!caseIdRequired || !!caseId) && !createInvite.isPending;

  const handleCreate = () => {
    // Exactly one, never both — the server refuses the pair, and sending an
    // empty string for the other would be sending both.
    const payload: InviteInput =
      inviteBy === "phone" ? { phone: phone.trim(), role } : { email: email.trim(), role };
    if (role === "client") {
      payload.caseId = parseInt(caseId, 10);
    }

    createInvite.mutate(
      { data: payload },
      {
        onSuccess: () => {
          setIsOpen(false);
          setEmail("");
          setRole("client");
          setCaseId("");
          queryClient.invalidateQueries({ queryKey: getListInvitesQueryKey() });
          toast({ title: "Invite generated successfully" });
        },
      },
    );
  };

  const copyToClipboard = (id: number, token: string) => {
    // Construct a hypothetical invite link
    const link = `${window.location.origin}/sign-up?token=${token}`;
    navigator.clipboard.writeText(link);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({ title: "Link copied to clipboard" });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-1">Access Control</h2>
          <p className="text-muted-foreground">
            Approve who joins{" "}
            <span className="font-medium text-foreground">{activeWorkspace?.name}</span>, and what
            role they hold here.
          </p>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-lg">
              <Plus className="mr-2 h-4 w-4" /> Generate Invite
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Provision Access Token</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Invite by</Label>
                <Select value={inviteBy} onValueChange={(v) => setInviteBy(v as "email" | "phone")}>
                  <SelectTrigger className="rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email address</SelectItem>
                    <SelectItem value="phone">Mobile number</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{inviteBy === "phone" ? "Mobile number" : "Email Address"}</Label>
                <Input
                  type={inviteBy === "phone" ? "tel" : "email"}
                  value={identifier}
                  onChange={(e) =>
                    inviteBy === "phone" ? setPhone(e.target.value) : setEmail(e.target.value)
                  }
                  placeholder={inviteBy === "phone" ? "+91 98765 43210" : "client@example.com"}
                />
                {inviteBy === "phone" && (
                  <p className="text-2xs leading-relaxed text-muted-foreground">
                    They sign in by SMS to this number. Indian telcos reassign a disconnected number
                    after about ninety days — revoke the entry when somebody leaves.
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label>Assigned Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as InviteInputRole)}>
                  <SelectTrigger className="rounded-lg">
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
              {role === "client" && (
                <div className="grid gap-2 border-l-2 border-primary pl-4 py-2 mt-2">
                  <Label>Restrict to Case ID (Required)</Label>
                  <Input
                    type="number"
                    value={caseId}
                    onChange={(e) => setCaseId(e.target.value)}
                    placeholder="e.g. 42"
                  />
                  <p className="text-3xs text-muted-foreground font-mono uppercase tracking-wider">
                    A client is admitted to this one matter, and nothing else — this is enforced,
                    not just a label.
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button disabled={!canSubmit} onClick={handleCreate} className="rounded-lg">
                {createInvite.isPending ? "Generating..." : "Generate Link"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <AccessListManager />

      <AccessRequestQueue />

      <div className="rounded-lg bg-card shadow-sm">
        <div className="px-6 py-4 border-b border-border bg-muted/30">
          <h3 className="font-mono text-xs uppercase tracking-widest font-bold">Invitations</h3>
        </div>
        {isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            {Array(3)
              .fill(0)
              .map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
          </div>
        ) : (
          <AdaptiveTable
            label="Invitations"
            className="p-3 md:p-0"
            rows={invites ?? []}
            rowKey={(inv) => inv.id}
            rowClassName={(inv) =>
              new Date(inv.expiresAt) < new Date() || inv.usedAt ? "opacity-50" : undefined
            }
            empty={
              <div className="flex h-32 flex-col items-center justify-center px-4 text-center">
                <p className="text-sm font-medium">No invitations out</p>
                <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  Generate a link above to bring a client or colleague into this chamber. Links
                  expire, and each one can only be used once.
                </p>
              </div>
            }
            columns={[
              {
                key: "recipient",
                header: "Recipient",
                card: "title",
                className: "font-mono text-xs uppercase tracking-wider",
                cell: (inv) => (
                  <>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {inv.phone ? (
                        <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 break-all">{inv.phone || inv.email}</span>
                    </div>
                    {inv.caseId && (
                      <div className="mt-1 font-mono text-xs text-muted-foreground">
                        RESTRICTED TO CASE-{inv.caseId}
                      </div>
                    )}
                  </>
                ),
              },
              {
                key: "role",
                header: "Provisioned Role",
                className: "font-mono text-xs uppercase tracking-wider",
                tableClassName: "hidden sm:table-cell",
                cell: (inv) => (
                  <Badge
                    variant="outline"
                    className="flex w-fit items-center gap-1 rounded-lg font-mono text-3xs uppercase tracking-wider"
                  >
                    {inv.role === "admin" && <ShieldCheck className="h-3 w-3" />}
                    {inv.role}
                  </Badge>
                ),
              },
              {
                key: "status",
                header: "Status / Expiry",
                className: "font-mono text-xs uppercase tracking-wider",
                cell: (inv) => {
                  const isExpired = new Date(inv.expiresAt) < new Date();
                  if (inv.usedAt) {
                    return (
                      <span className="font-mono text-sm font-bold text-primary">
                        USED {formatDateTime(inv.usedAt)}
                      </span>
                    );
                  }
                  return isExpired ? (
                    <span className="font-mono text-sm text-destructive">EXPIRED</span>
                  ) : (
                    <span className="font-mono text-sm text-muted-foreground">
                      EXPIRES {formatDateTime(inv.expiresAt)}
                    </span>
                  );
                },
              },
              {
                key: "token",
                header: "Invite Token",
                card: "action",
                className: "text-right font-mono text-xs uppercase tracking-wider",
                cell: (inv) => {
                  const isExpired = new Date(inv.expiresAt) < new Date();
                  return (
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg font-mono text-xs tracking-widest"
                      disabled={!!inv.usedAt || isExpired}
                      onClick={() => copyToClipboard(inv.id, inv.token)}
                    >
                      {copiedId === inv.id ? (
                        <Check className="mr-2 h-4 w-4 text-primary" />
                      ) : (
                        <Copy className="mr-2 h-4 w-4" />
                      )}
                      {copiedId === inv.id ? "COPIED" : "COPY LINK"}
                    </Button>
                  );
                },
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}
