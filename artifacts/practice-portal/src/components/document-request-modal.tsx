import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUsers,
  useListCases,
  useCreateDocumentRequest,
  getListUsersQueryKey,
  getListCasesQueryKey,
  getListDocumentRequestsQueryKey,
} from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { UserRound, ArrowRight } from "lucide-react";

interface DocumentRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function DocumentRequestModal({ open, onOpenChange }: DocumentRequestModalProps) {
  const [clientId, setClientId] = useState<string>("");
  const [caseId, setCaseId] = useState<string>("");
  const [documentName, setDocumentName] = useState("");
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState(() => todayPlus(7));

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { displayName, displayRole } = useSession();

  const { data: cases = [] } = useListCases(undefined, {
    query: { queryKey: getListCasesQueryKey(), enabled: open },
  });
  // Workspace-scoped server-side: only clients of this chamber come back, so
  // there is no cross-tenant recipient to filter out here.
  const { data: clients = [] } = useListUsers(
    { role: "client" },
    {
      query: { queryKey: getListUsersQueryKey({ role: "client" }), enabled: open },
    },
  );

  const createRequest = useCreateDocumentRequest();
  const recipient = clients.find((c) => String(c.id) === clientId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId || !documentName) return;

    createRequest.mutate(
      {
        data: {
          clientId: Number(clientId),
          documentName,
          note: note || undefined,
          dueDate: dueDate || undefined,
          caseId: caseId && caseId !== "none" ? Number(caseId) : undefined,
        },
      },
      {
        onSuccess: () => {
          toast({
            title: "Request sent",
            description: `${recipient?.displayName ?? "The client"} will see it in their portal.`,
          });
          queryClient.invalidateQueries({ queryKey: getListDocumentRequestsQueryKey() });
          setClientId("");
          setCaseId("");
          setDocumentName("");
          setNote("");
          setDueDate(todayPlus(7));
          onOpenChange(false);
        },
        onError: () => {
          toast({ title: "Failed to send request", variant: "destructive" });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px] rounded-lg border-border">
        <DialogHeader>
          <DialogTitle className="font-mono uppercase tracking-widest">
            Request Document
          </DialogTitle>
          <DialogDescription className="font-mono text-xs uppercase tracking-wider">
            Ask a client to upload a document to their portal.
          </DialogDescription>
        </DialogHeader>

        {/* Names both ends of the request explicitly — it was previously unclear
            who the document was being requested from, and on whose behalf. */}
        <div className="flex items-center gap-3 border border-border bg-muted/30 px-4 py-3 text-xs font-mono uppercase tracking-wider">
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground">From</p>
            <p className="truncate text-foreground">{displayName}</p>
            <p className="text-[10px] text-muted-foreground truncate">{displayRole}</p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] text-muted-foreground">Requesting from</p>
            <p className="truncate text-foreground flex items-center gap-1.5">
              <UserRound className="h-3 w-3 shrink-0" />
              {recipient?.displayName || "— select a client —"}
            </p>
            {recipient?.email && (
              <p className="text-[10px] text-muted-foreground truncate normal-case">
                {recipient.email}
              </p>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
              Requesting from (client) *
            </label>
            <Select value={clientId} onValueChange={setClientId} required>
              <SelectTrigger className="rounded-lg bg-background font-mono text-sm">
                <SelectValue placeholder="SELECT CLIENT" />
              </SelectTrigger>
              <SelectContent className="rounded-lg">
                {clients.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-muted-foreground font-mono uppercase tracking-wider">
                    No clients in this workspace
                  </div>
                ) : (
                  clients.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)} className="font-mono text-sm">
                      {c.displayName || c.email || "Unknown client"}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
              Document Name *
            </label>
            <Input
              value={documentName}
              onChange={(e) => setDocumentName(e.target.value)}
              className="rounded-lg font-mono text-sm bg-background"
              placeholder="e.g. Notarised affidavit"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                Needed by
              </label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="rounded-lg font-mono text-sm bg-background"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                Related Matter
              </label>
              <Select value={caseId} onValueChange={setCaseId}>
                <SelectTrigger className="rounded-lg bg-background font-mono text-sm">
                  <SelectValue placeholder="OPTIONAL" />
                </SelectTrigger>
                <SelectContent className="rounded-lg">
                  <SelectItem
                    value="none"
                    className="font-mono text-sm italic text-muted-foreground"
                  >
                    None
                  </SelectItem>
                  {cases.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)} className="font-mono text-sm">
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
              Note
            </label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="rounded-lg font-mono text-sm bg-background resize-none h-20"
              placeholder="Any specific instructions..."
            />
          </div>

          <div className="pt-2 flex justify-end">
            <Button
              type="submit"
              className="rounded-lg font-mono uppercase tracking-wider w-full"
              disabled={createRequest.isPending || !clientId || !documentName}
            >
              {createRequest.isPending
                ? "Sending..."
                : recipient
                  ? `Send to ${recipient.displayName || "client"}`
                  : "Send Request"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
