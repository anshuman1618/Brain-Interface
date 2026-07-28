import { useState, useEffect } from "react";
import { 
  useListConsultations, 
  useUpdateConsultation, 
  useListCases,
  useCreateConsultation,
  getListConsultationsQueryKey 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mic, PhoneCall, CheckCircle2, AlertCircle, Plus } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

export default function ConsultationsPage() {
  const { data: consultations = [], isLoading } = useListConsultations();
  const { data: cases = [] } = useListCases();
  const updateConsultation = useUpdateConsultation();
  const createConsultation = useCreateConsultation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [activeRecordingId, setActiveRecordingId] = useState<number | string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const [pendingConsultId, setPendingConsultId] = useState<number | string | null>(null);

  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newScheduledAt, setNewScheduledAt] = useState("");
  const [newCaseId, setNewCaseId] = useState("");
  const [newCategory, setNewCategory] = useState<any>("");
  const [newConsent, setNewConsent] = useState(false);

  useEffect(() => {
    let interval: any;
    if (activeRecordingId) {
      interval = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } else {
      setRecordingTime(0);
    }
    return () => clearInterval(interval);
  }, [activeRecordingId]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleStartRecording = (id: string | number) => {
    setPendingConsultId(id);
    setConsentGiven(false);
    setConsentOpen(true);
  };

  const confirmRecordingStart = () => {
    if (!pendingConsultId || !consentGiven) return;
    
    updateConsultation.mutate({ id: Number(pendingConsultId), data: { status: 'recording' } }, {
      onSuccess: () => {
        setActiveRecordingId(pendingConsultId);
        setConsentOpen(false);
        setPendingConsultId(null);
        queryClient.invalidateQueries({ queryKey: getListConsultationsQueryKey() });
        toast({ title: "Recording started", description: "Audio capture active." });
      }
    });
  };

  const handleStopRecording = () => {
    if (!activeRecordingId) return;
    
    const simulatedAudioUrl = `https://secure-vault.example.com/audio/consult_${activeRecordingId}_${Date.now()}.mp3`;
    
    updateConsultation.mutate({ 
      id: Number(activeRecordingId), 
      data: { status: 'completed', audioUrl: simulatedAudioUrl, transcriptPlaceholder: "Transcript pending processing..." } 
    }, {
      onSuccess: () => {
        setActiveRecordingId(null);
        queryClient.invalidateQueries({ queryKey: getListConsultationsQueryKey() });
        toast({ title: "Recording stopped", description: "Audio saved securely." });
      }
    });
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle || !newScheduledAt || !newCategory) return;

    createConsultation.mutate({
      data: {
        title: newTitle,
        notes: newNotes,
        scheduledAt: new Date(newScheduledAt).toISOString(),
        caseId: Number(newCaseId),
        category: newCategory as any,
        consentGiven: newConsent
      }
    }, {
      onSuccess: () => {
        toast({ title: "Consultation scheduled" });
        queryClient.invalidateQueries({ queryKey: getListConsultationsQueryKey() });
        setNewModalOpen(false);
        setNewTitle("");
        setNewNotes("");
        setNewScheduledAt("");
        setNewCaseId("");
        setNewCategory("");
        setNewConsent(false);
      }
    });
  };

  const getCategoryBadgeClass = (category: string | null) => {
    switch (category) {
      case 'legal_solution': return 'bg-slate-700 text-white';
      case 'regulatory_solution': return 'bg-zinc-600 text-white';
      case 'business_consultation': return 'bg-neutral-500 text-white';
      case 'procedural_compliance': return 'bg-gray-300 text-gray-900';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getCategoryLabel = (category: string | null) => {
    if (!category) return 'Uncategorized';
    return category.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-start md:items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-1">Consultation Records</h2>
          <p className="text-muted-foreground">Manage client calls, digital consent, and audio ledgers.</p>
        </div>
        <Button 
          onClick={() => setNewModalOpen(true)}
          className="rounded-none bg-foreground text-background font-mono uppercase tracking-wider"
        >
          <Plus className="mr-2 h-4 w-4" /> New Consultation
        </Button>
      </div>

      {activeRecordingId && (
        <div className="bg-destructive/10 border border-destructive p-4 flex items-center justify-between animate-in slide-in-from-top-4">
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 bg-destructive rounded-full animate-pulse" />
            <span className="font-mono text-destructive font-bold tracking-wider">RECORDING IN PROGRESS</span>
            <span className="font-mono text-destructive ml-4">{formatTime(recordingTime)}</span>
          </div>
          <Button variant="destructive" size="sm" onClick={handleStopRecording} className="rounded-none font-mono uppercase tracking-wider">
            Stop & Save Ledger
          </Button>
        </div>
      )}

      <div className="border border-border bg-background">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead className="font-mono uppercase tracking-wider text-xs">Date</TableHead>
              <TableHead className="font-mono uppercase tracking-wider text-xs">Subject</TableHead>
              <TableHead className="font-mono uppercase tracking-wider text-xs">Category</TableHead>
              <TableHead className="font-mono uppercase tracking-wider text-xs">Case</TableHead>
              <TableHead className="font-mono uppercase tracking-wider text-xs">Status</TableHead>
              <TableHead className="font-mono uppercase tracking-wider text-xs text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : consultations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground font-mono uppercase tracking-wider text-sm">
                  No consultations recorded
                </TableCell>
              </TableRow>
            ) : (
              consultations.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-sm whitespace-nowrap">
                    {c.scheduledAt ? formatDateTime(c.scheduledAt) : 'N/A'}
                  </TableCell>
                  <TableCell className="font-medium">
                    {c.title}
                  </TableCell>
                  <TableCell>
                    <span className={`px-2 py-1 text-[10px] uppercase font-mono tracking-wider whitespace-nowrap rounded-none ${getCategoryBadgeClass(c.category as string)}`}>
                      {getCategoryLabel(c.category as string)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {c.caseId ? (
                      <Link href={`/cases/${c.caseId}`} className="text-sm font-mono text-primary hover:underline">
                        {c.caseId}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground text-xs italic">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-none px-2 py-0.5 text-xs font-semibold font-mono uppercase tracking-wider ${
                      c.status === 'scheduled' ? 'bg-blue-100 text-blue-800' :
                      c.status === 'completed' ? 'bg-green-100 text-green-800' :
                      'bg-destructive text-destructive-foreground animate-pulse'
                    }`}>
                      {c.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {c.status === 'scheduled' && !activeRecordingId && (
                      <Button size="sm" variant="outline" className="rounded-none border-primary text-primary hover:bg-primary hover:text-primary-foreground font-mono uppercase tracking-wider" onClick={() => handleStartRecording(c.id)}>
                        <Mic className="mr-2 h-4 w-4" /> Start
                      </Button>
                    )}
                    {c.status === 'completed' && (
                      <Button size="sm" variant="ghost" className="rounded-none text-muted-foreground font-mono uppercase tracking-wider" disabled>
                        <CheckCircle2 className="mr-2 h-4 w-4" /> Completed
                      </Button>
                    )}
                    {c.status === 'recording' && activeRecordingId !== c.id && (
                      <span className="text-xs text-destructive font-mono font-bold animate-pulse uppercase tracking-wider">RECORDING ACTIVE</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={newModalOpen} onOpenChange={setNewModalOpen}>
        <DialogContent className="sm:max-w-[425px] rounded-none border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-widest">Schedule Consultation</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 pt-4">
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">Related Case *</label>
              <Select value={newCaseId} onValueChange={setNewCaseId} required>
                <SelectTrigger className="rounded-none bg-background font-mono text-sm">
                  <SelectValue placeholder="SELECT CASE" />
                </SelectTrigger>
                <SelectContent className="rounded-none">
                  {cases.map(c => (
                    <SelectItem key={c.id} value={String(c.id)} className="font-mono text-sm">
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">Title *</label>
              <Input 
                value={newTitle} 
                onChange={e => setNewTitle(e.target.value)} 
                className="rounded-none font-mono text-sm bg-background" 
                required 
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">Category *</label>
              <Select value={newCategory} onValueChange={setNewCategory} required>
                <SelectTrigger className="rounded-none bg-background font-mono text-sm">
                  <SelectValue placeholder="SELECT CATEGORY" />
                </SelectTrigger>
                <SelectContent className="rounded-none">
                  <SelectItem value="legal_solution" className="font-mono text-sm">Legal Solution</SelectItem>
                  <SelectItem value="regulatory_solution" className="font-mono text-sm">Regulatory Solution</SelectItem>
                  <SelectItem value="business_consultation" className="font-mono text-sm">Business Consultation</SelectItem>
                  <SelectItem value="procedural_compliance" className="font-mono text-sm">Procedural Compliance</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">Scheduled Time *</label>
              <Input 
                type="datetime-local"
                value={newScheduledAt} 
                onChange={e => setNewScheduledAt(e.target.value)} 
                className="rounded-none font-mono text-sm bg-background" 
                required 
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">Notes</label>
              <Textarea 
                value={newNotes} 
                onChange={e => setNewNotes(e.target.value)} 
                className="rounded-none font-mono text-sm bg-background resize-none h-20"
              />
            </div>

            <div className="flex items-start space-x-2 mt-4 pt-2">
              <Checkbox id="new-consent" checked={newConsent} onCheckedChange={(c) => setNewConsent(c as boolean)} className="mt-1" />
              <Label htmlFor="new-consent" className="text-xs text-muted-foreground cursor-pointer leading-tight">
                Client has been informed that consultations may be recorded for quality assurance.
              </Label>
            </div>

            <div className="pt-4 flex justify-end">
              <Button 
                type="submit" 
                className="rounded-none font-mono uppercase tracking-wider w-full"
                disabled={createConsultation.isPending || !newTitle || !newScheduledAt || !newCategory || !newConsent}
              >
                {createConsultation.isPending ? "Scheduling..." : "Schedule"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={consentOpen} onOpenChange={setConsentOpen}>
        <DialogContent className="rounded-none border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive font-mono uppercase tracking-widest">
              <AlertCircle className="h-5 w-5" /> Digital Consent Required
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <p className="text-sm font-medium">Before initiating recording, verbal consent must be obtained from all parties on the line. Recording without consent may violate applicable wiretap and privacy statutes.</p>
            
            <div className="bg-muted p-4 border border-border text-sm font-mono italic">
              "Please note that this consultation is being recorded for case file accuracy and quality assurance. Do I have your consent to proceed with the recording?"
            </div>

            <div className="flex items-center space-x-2 mt-4 pt-4 border-t border-border">
              <Checkbox id="consent" checked={consentGiven} onCheckedChange={(c) => setConsentGiven(c as boolean)} />
              <Label htmlFor="consent" className="font-semibold cursor-pointer text-sm">
                I verify that all parties have provided explicit consent to be recorded.
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConsentOpen(false)} className="rounded-none font-mono uppercase tracking-wider">Cancel</Button>
            <Button 
              onClick={confirmRecordingStart} 
              disabled={!consentGiven} 
              className="rounded-none bg-destructive text-destructive-foreground hover:bg-destructive/90 font-mono uppercase tracking-wider"
            >
              Initialize Recording
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}