import { useState, useRef, useEffect } from "react";
import { useListConsultations, useUpdateConsultation, getListConsultationsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Mic, PhoneCall, CheckCircle2, AlertCircle } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

export default function ConsultationsPage() {
  const { data: consultations, isLoading } = useListConsultations();
  const updateConsultation = useUpdateConsultation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [activeRecordingId, setActiveRecordingId] = useState<number | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const [pendingConsultId, setPendingConsultId] = useState<number | null>(null);

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

  const handleStartRecording = (id: number) => {
    setPendingConsultId(id);
    setConsentGiven(false);
    setConsentOpen(true);
  };

  const confirmRecordingStart = () => {
    if (!pendingConsultId || !consentGiven) return;
    
    updateConsultation.mutate({ id: pendingConsultId, data: { status: 'recording' } }, {
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
    
    // Simulate saving an audio URL
    const simulatedAudioUrl = `https://secure-vault.example.com/audio/consult_${activeRecordingId}_${Date.now()}.mp3`;
    
    updateConsultation.mutate({ 
      id: activeRecordingId, 
      data: { status: 'completed', audioUrl: simulatedAudioUrl, transcriptPlaceholder: "Transcript pending processing..." } 
    }, {
      onSuccess: () => {
        setActiveRecordingId(null);
        queryClient.invalidateQueries({ queryKey: getListConsultationsQueryKey() });
        toast({ title: "Recording stopped", description: "Audio saved securely." });
      }
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold tracking-tight mb-1">Consultation Records</h2>
        <p className="text-muted-foreground">Manage client calls, digital consent, and audio ledgers.</p>
      </div>

      {activeRecordingId && (
        <div className="bg-destructive/10 border border-destructive p-4 flex items-center justify-between animate-in slide-in-from-top-4">
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 bg-destructive rounded-full animate-pulse" />
            <span className="font-mono font-bold text-destructive tracking-wider">REC: {formatTime(recordingTime)}</span>
            <span className="text-sm font-medium text-destructive ml-4">Consultation #{activeRecordingId} audio capture in progress</span>
          </div>
          <Button variant="destructive" className="rounded-none font-bold tracking-wider" onClick={handleStopRecording}>
            STOP & SAVE
          </Button>
        </div>
      )}

      <div className="border border-border bg-background">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent bg-muted/30">
              <TableHead className="font-mono text-xs uppercase tracking-wider">Date</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Subject</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Case</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Status</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
               Array(5).fill(0).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : consultations?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  No consultations scheduled.
                </TableCell>
              </TableRow>
            ) : (
              consultations?.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-sm">{c.scheduledAt ? formatDateTime(c.scheduledAt) : 'Unscheduled'}</TableCell>
                  <TableCell>
                    <div className="font-medium text-sm flex items-center gap-2">
                      <PhoneCall className="h-4 w-4 text-muted-foreground" />
                      {c.title}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Link href={`/cases/${c.caseId}`} className="text-xs font-mono border border-border px-2 py-1 hover:bg-accent transition-colors">
                      CASE-{c.caseId}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`rounded-none text-[10px] uppercase font-mono tracking-wider border ${
                      c.status === 'completed' ? 'bg-muted text-muted-foreground border-border' :
                      c.status === 'recording' ? 'bg-destructive/20 text-destructive border-destructive/50 animate-pulse' :
                      'bg-primary/10 text-primary border-primary/30'
                    }`}>
                      {c.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {c.status === 'scheduled' && !activeRecordingId && (
                      <Button size="sm" className="rounded-none" variant="outline" onClick={() => handleStartRecording(c.id)}>
                        <Mic className="mr-2 h-4 w-4" /> Start
                      </Button>
                    )}
                    {c.status === 'completed' && (
                      <Button size="sm" variant="ghost" className="rounded-none" disabled>
                        <CheckCircle2 className="mr-2 h-4 w-4" /> Completed
                      </Button>
                    )}
                    {c.status === 'recording' && activeRecordingId !== c.id && (
                      <span className="text-xs text-destructive font-mono font-bold animate-pulse">RECORDING ACTIVE</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={consentOpen} onOpenChange={setConsentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive"><AlertCircle className="h-5 w-5" /> Digital Consent Required</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <p className="text-sm">Before initiating recording, verbal consent must be obtained from all parties on the line. Recording without consent may violate applicable wiretap and privacy statutes.</p>
            
            <div className="bg-muted p-4 border border-border text-sm font-mono italic">
              "Please note that this consultation is being recorded for case file accuracy and quality assurance. Do I have your consent to proceed with the recording?"
            </div>

            <div className="flex items-center space-x-2 mt-4 pt-4 border-t border-border">
              <Checkbox id="consent" checked={consentGiven} onCheckedChange={(c) => setConsentGiven(c as boolean)} />
              <Label htmlFor="consent" className="font-semibold cursor-pointer">
                I verify that all parties have provided explicit consent to be recorded.
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConsentOpen(false)} className="rounded-none">Cancel</Button>
            <Button 
              onClick={confirmRecordingStart} 
              disabled={!consentGiven} 
              className="rounded-none bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Initialize Recording
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
