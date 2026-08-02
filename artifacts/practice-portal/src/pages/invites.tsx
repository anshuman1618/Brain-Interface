import { useState } from "react";
import { useListInvites, useCreateInvite, getListInvitesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Plus, Mail, ShieldCheck, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/utils";
import { AccessRequestQueue } from "@/components/access-request-queue";
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
  const [role, setRole] = useState("client");
  const [caseId, setCaseId] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const handleCreate = () => {
    const payload: any = { email, role };
    if (role === "client" && caseId) {
      payload.caseId = parseInt(caseId);
    }

    createInvite.mutate({ data: payload }, {
      onSuccess: () => {
        setIsOpen(false);
        setEmail("");
        setRole("client");
        setCaseId("");
        queryClient.invalidateQueries({ queryKey: getListInvitesQueryKey() });
        toast({ title: "Invite generated successfully" });
      }
    });
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
            Approve who joins <span className="font-medium text-foreground">{activeWorkspace?.name}</span>,
            and what role they hold here.
          </p>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-none"><Plus className="mr-2 h-4 w-4" /> Generate Invite</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Provision Access Token</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Email Address</Label>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="client@example.com" />
              </div>
              <div className="grid gap-2">
                <Label>Assigned Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="rounded-none"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {role === "client" && (
                <div className="grid gap-2 border-l-2 border-primary pl-4 py-2 mt-2">
                  <Label>Restrict to Case ID (Optional but recommended)</Label>
                  <Input type="number" value={caseId} onChange={e => setCaseId(e.target.value)} placeholder="e.g. 42" />
                  <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Clients without an assigned Case ID can only see global portal elements until assigned.</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button disabled={!email || !role || createInvite.isPending} onClick={handleCreate} className="rounded-none">
                {createInvite.isPending ? "Generating..." : "Generate Link"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <AccessRequestQueue />

      <div className="border border-border bg-background">
        <div className="px-6 py-4 border-b border-border bg-muted/30">
          <h3 className="font-mono text-xs uppercase tracking-widest font-bold">Invitations</h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent bg-muted/30">
              <TableHead className="font-mono text-xs uppercase tracking-wider">Recipient</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Provisioned Role</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Status / Expiry</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider text-right">Invite Token</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
               Array(3).fill(0).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : invites?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                  No active invitations.
                </TableCell>
              </TableRow>
            ) : (
              invites?.map(inv => {
                const isExpired = new Date(inv.expiresAt) < new Date();
                const isUsed = !!inv.usedAt;
                return (
                  <TableRow key={inv.id} className={isExpired || isUsed ? 'opacity-50' : ''}>
                    <TableCell>
                      <div className="font-medium text-sm flex items-center gap-2">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        {inv.email}
                      </div>
                      {inv.caseId && <div className="text-xs text-muted-foreground font-mono mt-1">RESTRICTED TO CASE-{inv.caseId}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="rounded-none text-[10px] uppercase font-mono tracking-wider flex items-center gap-1 w-fit">
                        {inv.role === 'admin' && <ShieldCheck className="h-3 w-3" />}
                        {inv.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {isUsed ? (
                        <span className="text-sm font-mono text-primary font-bold">USED {formatDateTime(inv.usedAt!)}</span>
                      ) : isExpired ? (
                        <span className="text-sm font-mono text-destructive">EXPIRED</span>
                      ) : (
                        <span className="text-sm font-mono text-muted-foreground">EXPIRES {formatDateTime(inv.expiresAt)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="rounded-none font-mono tracking-widest text-xs"
                        disabled={isUsed || isExpired}
                        onClick={() => copyToClipboard(inv.id, inv.token)}
                      >
                        {copiedId === inv.id ? <Check className="mr-2 h-4 w-4 text-primary" /> : <Copy className="mr-2 h-4 w-4" />}
                        {copiedId === inv.id ? "COPIED" : "COPY LINK"}
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
