import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAccessList,
  useCreateAccessListEntry,
  useRevokeAccessListEntry,
  getListAccessListQueryKey,
  type AccessListEntry,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AtSign, Globe, Plus, ShieldCheck, Trash2, AlertTriangle, Smartphone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/lib/session";
import { ROLE_OPTIONS, roleLabel } from "@/lib/role-options";

/**
 * The access list — the control that decides who may sign in at all.
 *
 * Federated sign-in means Google, Zoho and an SMS code will authenticate
 * anyone; this table is what keeps "only an admin grants access" true anyway.
 * Adding an address or a number here is a standing grant, so the role is chosen
 * at the same time.
 */
export function AccessListManager() {
  const { activeWorkspace } = useSession();
  const { data: entries, isLoading } = useListAccessList();
  const createEntry = useCreateAccessListEntry();
  const revokeEntry = useRevokeAccessListEntry();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [kind, setKind] = useState<"email" | "domain" | "phone">("email");
  const [value, setValue] = useState("");
  const [role, setRole] = useState("client");
  const [caseId, setCaseId] = useState("");
  const [note, setNote] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAccessListQueryKey() });

  const active = (entries ?? []).filter((e: AccessListEntry) => !e.revokedAt);

  // Same rule the server enforces: a client entry must name the one matter it
  // admits into, so this mirrors that rather than letting the request
  // round-trip to learn it.
  const caseIdRequired = role === "client";
  const canSubmit = !!value.trim() && (!caseIdRequired || !!caseId) && !createEntry.isPending;

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    createEntry.mutate(
      {
        data: {
          kind,
          value: value.trim(),
          role: role as never,
          ...(role === "client" ? { caseId: parseInt(caseId, 10) } : {}),
          note: note.trim() || undefined,
        },
      },
      {
        onSuccess: (created) => {
          invalidate();
          toast({
            title: `${created.value} admitted`,
            description: `Will sign in as ${roleLabel(created.role)} in ${activeWorkspace?.name}.`,
          });
          setValue("");
          setCaseId("");
          setNote("");
        },
        onError: (err: unknown) => {
          toast({
            title: "Couldn't add that entry",
            description: err instanceof Error ? err.message : undefined,
            variant: "destructive",
          });
        },
      },
    );
  };

  const revoke = (entry: AccessListEntry) => {
    revokeEntry.mutate(
      { id: entry.id },
      {
        onSuccess: () => {
          invalidate();
          toast({
            title: `${entry.value} removed`,
            description:
              "New sign-ins are refused. Anyone already admitted keeps access until revoked in Team Roles.",
          });
        },
        onError: () => toast({ title: "Couldn't remove that entry", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="rounded-lg bg-card shadow-sm">
      <div className="px-6 py-4 border-b border-border bg-muted/30 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-mono text-xs uppercase tracking-widest font-bold">Who may sign in</h3>
        <span className="ml-auto text-xs font-mono uppercase tracking-wider text-muted-foreground">
          {active.length} admitted
        </span>
      </div>

      <div className="p-6 border-b border-border">
        <p className="text-sm text-muted-foreground mb-4">
          Google, Zoho and an SMS code will authenticate anyone. Only the addresses and numbers
          below are let into{" "}
          <span className="font-medium text-foreground">{activeWorkspace?.name}</span> — everyone
          else is shown an error and turned away.
        </p>

        <form
          onSubmit={add}
          className="grid gap-3 sm:grid-cols-[140px_1fr_180px_auto] sm:items-end"
        >
          <div className="space-y-1.5">
            <label className="block text-3xs font-mono uppercase tracking-wider text-muted-foreground">
              Match
            </label>
            <Select value={kind} onValueChange={(v) => setKind(v as "email" | "domain" | "phone")}>
              <SelectTrigger className="rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="phone">Mobile number</SelectItem>
                <SelectItem value="domain">Whole domain</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-3xs font-mono uppercase tracking-wider text-muted-foreground">
              {kind === "email" ? "Email address" : kind === "phone" ? "Mobile number" : "Domain"}
            </label>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="rounded-lg font-mono text-sm"
              placeholder={
                kind === "email"
                  ? "krishnan@yourchamber.in"
                  : kind === "phone"
                    ? "+91 98765 43210"
                    : "yourchamber.in"
              }
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-3xs font-mono uppercase tracking-wider text-muted-foreground">
              Signs in as
            </label>
            <Select value={role} onValueChange={setRole}>
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

          <Button type="submit" className="rounded-lg" disabled={!canSubmit}>
            <Plus className="h-4 w-4 mr-1.5" />
            {createEntry.isPending ? "Adding..." : "Admit"}
          </Button>

          {role === "client" && (
            <div className="sm:col-span-4 space-y-1.5">
              <label className="block text-3xs font-mono uppercase tracking-wider text-muted-foreground">
                Restrict to Case ID (Required)
              </label>
              <Input
                type="number"
                value={caseId}
                onChange={(e) => setCaseId(e.target.value)}
                className="rounded-lg font-mono text-sm sm:max-w-[180px]"
                placeholder="e.g. 42"
              />
            </div>
          )}

          <div className="sm:col-span-4 space-y-1.5">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="rounded-lg text-sm"
              placeholder="Note — e.g. Client, succession matter"
            />
          </div>
        </form>

        {kind === "phone" && (
          <div className="rounded-lg bg-card p-3 shadow-sm">
            <p className="text-2xs leading-relaxed text-muted-foreground">
              A number admits whoever can receive its SMS. Indian telcos reassign a disconnected
              mobile after about <strong>ninety days</strong>, so an entry left standing can one day
              admit somebody else entirely — an email address is never reused this way. Revoke the
              entry when the person leaves, and check &ldquo;last used&rdquo; below for numbers that
              have gone quiet.
            </p>
          </div>
        )}
        {kind === "domain" && (
          <div className="mt-4 flex gap-2 rounded-lg bg-warning px-3 py-2">
            <AlertTriangle className="h-4 w-4 text-warning-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-warning-foreground">
              A domain rule admits <strong>every</strong> address at that domain, now and in future.
              Use it for your own Google Workspace or Zoho Mail tenant, never for a public one like
              gmail.com.
            </p>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="p-6 space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : active.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground font-mono uppercase tracking-wider">
          Nobody is admitted yet
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent bg-muted/30">
              <TableHead className="font-mono text-xs uppercase tracking-wider">Admitted</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">
                Signs in as
              </TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Used</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider text-right">
                Remove
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {active.map((entry: AccessListEntry) => (
              <TableRow key={entry.id}>
                <TableCell>
                  <div className="flex items-center gap-2 font-mono text-sm">
                    {entry.kind === "domain" ? (
                      <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ) : entry.kind === "phone" ? (
                      <Smartphone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <AtSign className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    {entry.kind === "domain" ? `anyone @${entry.value}` : entry.value}
                  </div>
                  {entry.note && <p className="text-xs text-muted-foreground mt-1">{entry.note}</p>}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className="rounded-lg text-3xs uppercase font-mono tracking-wider flex items-center gap-1 w-fit"
                  >
                    {entry.role === "admin" && <ShieldCheck className="h-3 w-3" />}
                    {roleLabel(entry.role) || entry.role}
                  </Badge>
                  {entry.caseId != null && (
                    <p className="text-3xs text-muted-foreground font-mono mt-1">
                      RESTRICTED TO CASE-{entry.caseId}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-xs font-mono text-muted-foreground">
                  {entry.lastUsedAt ? new Date(entry.lastUsedAt).toLocaleDateString() : "Never"}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg"
                    disabled={revokeEntry.isPending}
                    onClick={() => revoke(entry)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
