import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useListUsers, 
  useListCases, 
  useCreateDocumentRequest,
  getListDocumentRequestsQueryKey
} from "@workspace/api-client-react";
import { useUserRole } from "@/hooks/use-user-role";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface DocumentRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DocumentRequestModal({ open, onOpenChange }: DocumentRequestModalProps) {
  const [clientId, setClientId] = useState<string>("");
  const [caseId, setCaseId] = useState<string>("");
  const [documentName, setDocumentName] = useState("");
  const [note, setNote] = useState("");
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin, isSenior, isJunior } = useUserRole();

  const { data: cases = [] } = useListCases();
  const { data: clientsData = [] } = useListUsers({ role: 'client' });

  // If Junior Advocate, only allow selecting clients from cases they can see.
  // Otherwise, all clients.
  const allowedClientIds = isJunior ? new Set(cases.map(c => c.clientId)) : null;
  
  const clients = allowedClientIds 
    ? clientsData.filter(c => allowedClientIds.has(c.id)) 
    : clientsData;

  const createRequest = useCreateDocumentRequest();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId || !documentName) return;

    createRequest.mutate({
      data: {
        clientId: Number(clientId),
        documentName,
        note: note || undefined,
        caseId: caseId && caseId !== "none" ? Number(caseId) : undefined
      }
    }, {
      onSuccess: () => {
        toast({ title: "Document request sent" });
        queryClient.invalidateQueries({ queryKey: getListDocumentRequestsQueryKey() });
        setClientId("");
        setCaseId("");
        setDocumentName("");
        setNote("");
        onOpenChange(false);
      },
      onError: () => {
        toast({ title: "Failed to send request", variant: "destructive" });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] rounded-none border-border">
        <DialogHeader>
          <DialogTitle className="font-mono uppercase tracking-widest">Request Document</DialogTitle>
          <DialogDescription className="font-mono text-xs uppercase tracking-wider">
            Send a secure request to a client to upload a document.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">Client *</label>
            <Select value={clientId} onValueChange={setClientId} required>
              <SelectTrigger className="rounded-none bg-background font-mono text-sm">
                <SelectValue placeholder="SELECT CLIENT" />
              </SelectTrigger>
              <SelectContent className="rounded-none">
                {clients.map(c => (
                  <SelectItem key={c.id} value={String(c.id)} className="font-mono text-sm">
                    {c.displayName || 'Unknown Client'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">Document Name *</label>
            <Input 
              value={documentName} 
              onChange={e => setDocumentName(e.target.value)} 
              className="rounded-none font-mono text-sm bg-background" 
              placeholder="e.g. Passport Copy"
              required 
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">Related Case (Optional)</label>
            <Select value={caseId} onValueChange={setCaseId}>
              <SelectTrigger className="rounded-none bg-background font-mono text-sm">
                <SelectValue placeholder="SELECT CASE" />
              </SelectTrigger>
              <SelectContent className="rounded-none">
                <SelectItem value="none" className="font-mono text-sm italic text-muted-foreground">None</SelectItem>
                {cases.map(c => (
                  <SelectItem key={c.id} value={String(c.id)} className="font-mono text-sm">
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">Note (Optional)</label>
            <Textarea 
              value={note} 
              onChange={e => setNote(e.target.value)} 
              className="rounded-none font-mono text-sm bg-background resize-none h-20"
              placeholder="Any specific instructions..." 
            />
          </div>

          <div className="pt-4 flex justify-end">
            <Button 
              type="submit" 
              className="rounded-none font-mono uppercase tracking-wider w-full"
              disabled={createRequest.isPending || !clientId || !documentName}
            >
              {createRequest.isPending ? "Sending..." : "Send Request"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}