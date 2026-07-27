import { useListCases, useGetCaseTimeline, useListDocuments } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, FileLock2, Clock, ChevronRight, Download } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { Link } from "wouter";

export default function ClientPortalPage() {
  const { data: cases, isLoading } = useListCases();

  if (isLoading) {
    return <div className="space-y-4 p-8"><Skeleton className="h-10 w-48" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (!cases || cases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center max-w-md mx-auto space-y-4">
        <FileLock2 className="h-16 w-16 text-muted-foreground/30" />
        <h2 className="text-2xl font-bold tracking-tight">No Active Matters</h2>
        <p className="text-muted-foreground">You do not have any active cases assigned to your portal. If you believe this is an error, please contact your attorney.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold tracking-tight mb-1">Your Legal Matters</h2>
        <p className="text-muted-foreground">Encrypted access to your case files and statuses.</p>
      </div>

      <div className="grid gap-6">
        {cases.map(c => (
          <CaseOverviewCard key={c.id} caseId={c.id} caseTitle={c.title} status={c.status} />
        ))}
      </div>
    </div>
  );
}

function CaseOverviewCard({ caseId, caseTitle, status }: { caseId: number, caseTitle: string, status: string }) {
  const { data: timeline } = useGetCaseTimeline(caseId);
  const { data: docs } = useListDocuments(caseId);

  const getStatusColor = (s: string) => {
    switch(s) {
      case 'open': return 'bg-primary/10 text-primary border-primary/30';
      case 'in_progress': return 'bg-primary text-primary-foreground';
      case 'review': return 'bg-accent text-accent-foreground';
      case 'closed': return 'bg-muted text-muted-foreground';
      default: return 'bg-muted text-foreground';
    }
  };

  return (
    <Card className="rounded-none border-border shadow-none overflow-hidden">
      <div className="bg-muted/30 p-6 border-b border-border flex justify-between items-start md:items-center flex-col md:flex-row gap-4">
        <div>
          <Badge variant="outline" className={`mb-3 rounded-none text-[10px] uppercase font-mono tracking-wider ${getStatusColor(status)}`}>
            {status.replace('_', ' ')}
          </Badge>
          <h3 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            {caseTitle}
          </h3>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
        <div className="p-6">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground font-mono mb-4 flex items-center gap-2">
            <FileLock2 className="h-4 w-4" /> Secure Vault
          </h4>
          <div className="space-y-3">
            {docs?.slice(0, 3).map(doc => (
              <div key={doc.id} className="flex justify-between items-center p-3 border border-border bg-background hover:bg-muted/50 transition-colors">
                <div className="truncate pr-4 flex-1">
                  <p className="text-sm font-medium truncate">{doc.name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider mt-1">{formatDateTime(doc.uploadedAt)}</p>
                </div>
                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-none shrink-0"><Download className="h-4 w-4" /></Button>
              </div>
            ))}
            {(!docs || docs.length === 0) && <p className="text-sm text-muted-foreground italic">No documents available.</p>}
          </div>
        </div>

        <div className="p-6">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground font-mono mb-4 flex items-center gap-2">
            <Clock className="h-4 w-4" /> Recent Updates
          </h4>
          <div className="space-y-4">
            {timeline?.slice(0, 3).map(event => (
              <div key={event.id} className="relative pl-4 border-l border-border">
                <div className="absolute -left-1 top-1.5 h-2 w-2 rounded-full bg-primary" />
                <p className="text-sm font-medium leading-snug">{event.description}</p>
                <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider mt-1">{formatDateTime(event.createdAt)}</p>
              </div>
            ))}
            {(!timeline || timeline.length === 0) && <p className="text-sm text-muted-foreground italic">No recent updates.</p>}
          </div>
        </div>
      </div>
    </Card>
  );
}
