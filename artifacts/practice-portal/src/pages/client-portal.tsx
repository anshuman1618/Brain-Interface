import {
  useListCases,
  useGetCaseTimeline,
  useListDocuments,
  useListMyInvoices,
  getListMyInvoicesQueryKey,
  getMyInvoicePdf,
  type Invoice,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, FileLock2, Clock, Download, Receipt } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { formatMinor } from "@/lib/format";

export default function ClientPortalPage() {
  const { data: cases, isLoading } = useListCases();

  if (isLoading) {
    return (
      <div className="space-y-4 p-8">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!cases || cases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center max-w-md mx-auto space-y-4">
        <FileLock2 className="h-16 w-16 text-muted-foreground/30" />
        <h2 className="text-2xl font-bold tracking-tight">No Active Matters</h2>
        <p className="text-muted-foreground">
          You do not have any active cases assigned to your portal. If you believe this is an error,
          please contact your attorney.
        </p>
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
        {cases.map((c) => (
          <CaseOverviewCard
            key={c.id}
            caseId={c.id}
            caseTitle={c.title}
            status={c.status}
            stageLabel={c.stageLabel ?? null}
          />
        ))}
      </div>

      <MyInvoices />
    </div>
  );
}

/**
 * The invoices raised against this client.
 *
 * Until now a chamber could raise an invoice, issue it, and the person being
 * billed had no way to see it: every route under /invoices requires
 * `billing.manage`, which no client holds, and email is not configured, so
 * nothing was delivered either. The document existed only inside the chamber.
 *
 * Reads `/my-invoices`, which is scoped server-side to the caller as the billed
 * client and to invoices that have actually been issued — drafts never appear,
 * because a draft's figures are still being edited and showing one invites an
 * argument about a number nobody meant to send.
 *
 * Renders nothing at all when there are none. A client with no invoices should
 * not be shown an empty billing section; it reads as a bill that failed to
 * load.
 */
function MyInvoices() {
  const { data, isLoading } = useListMyInvoices({
    query: { queryKey: getListMyInvoicesQueryKey() },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const invoices = data?.invoices ?? [];
  if (invoices.length === 0) return null;

  /*
   * Fetched through the API client, not linked to.
   *
   * The route sits behind the workspace header the client attaches to every
   * request; a plain <a href> arrives without it and is refused. The invoices
   * page above the fold has the identical comment for the identical reason —
   * this is a trap the codebase has already fallen into once.
   */
  const download = async (invoice: Invoice) => {
    try {
      const blob = await getMyInvoicePdf(invoice.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(invoice.invoiceRef ?? `invoice-${invoice.id}`).replace(/\//g, "-")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Deliberately quiet: the list still renders, and a client who cannot
      // reach a PDF is better served by trying again than by a red banner.
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <Receipt className="h-5 w-5" /> Invoices
        </h3>
        {data && data.outstandingMinor > 0 && (
          <p className="text-sm text-muted-foreground mt-1">
            {formatMinor(data.outstandingMinor)} outstanding
            {data.overdueMinor > 0 ? `, of which ${formatMinor(data.overdueMinor)} is overdue` : ""}
            .
          </p>
        )}
      </div>

      <div className="grid gap-3">
        {invoices.map((inv) => (
          <Card key={inv.id} className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="font-semibold truncate">{inv.invoiceRef ?? `Invoice ${inv.id}`}</p>
              <p className="text-sm text-muted-foreground">
                {formatMinor(inv.totalMinor)}
                {inv.dueDate ? ` · due ${inv.dueDate}` : ""}
              </p>
            </div>
            <Badge variant={inv.isOverdue ? "destructive" : "secondary"} className="shrink-0">
              {inv.isOverdue ? "Overdue" : inv.status}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 rounded-lg"
              onClick={() => void download(inv)}
            >
              <Download className="mr-2 h-4 w-4" /> PDF
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CaseOverviewCard({
  caseId,
  caseTitle,
  status,
  stageLabel,
}: {
  caseId: number;
  caseTitle: string;
  status: string;
  /** Where the matter has got to, in the chamber's own words. May be unset. */
  stageLabel: string | null;
}) {
  const { data: timeline } = useGetCaseTimeline(caseId);
  const { data: docs } = useListDocuments(caseId);

  const getStatusColor = (s: string) => {
    switch (s) {
      case "open":
        return "bg-primary/10 text-primary border-primary/30";
      case "in_progress":
        return "bg-primary text-primary-foreground";
      case "review":
        return "bg-accent text-accent-foreground";
      case "closed":
        return "bg-muted text-muted-foreground";
      default:
        return "bg-muted text-foreground";
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="bg-muted/30 p-6 border-b border-border flex justify-between items-start md:items-center flex-col md:flex-row gap-4">
        <div>
          <Badge
            variant="outline"
            className={`mb-3 rounded-lg text-3xs uppercase font-mono tracking-wider ${getStatusColor(status)}`}
          >
            {status.replace("_", " ")}
          </Badge>
          {/*
            Where the matter has actually got to. `status` above is workflow —
            "in progress" for a year — and it is the question a client is really
            asking when they open this page. Rendered only when the chamber has
            set a stage; an empty badge would just raise the question again.
          */}
          {stageLabel && (
            <Badge
              variant="outline"
              className="mb-3 ml-2 rounded-lg text-3xs uppercase font-mono tracking-wider"
            >
              {stageLabel}
            </Badge>
          )}
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
            {docs?.slice(0, 3).map((doc) => (
              <div
                key={doc.id}
                className="flex justify-between items-center p-3 rounded-lg bg-card shadow-sm hover:bg-muted/50 transition-colors"
              >
                <div className="truncate pr-4 flex-1">
                  <p className="text-sm font-medium truncate">{doc.name}</p>
                  <p className="text-3xs text-muted-foreground font-mono uppercase tracking-wider mt-1">
                    {formatDateTime(doc.uploadedAt)}
                  </p>
                </div>
                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg shrink-0">
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {(!docs || docs.length === 0) && (
              <p className="text-sm text-muted-foreground leading-relaxed">
                Nothing has been shared with you yet. Documents your advocate releases to you will
                appear here.
              </p>
            )}
          </div>
        </div>

        <div className="p-6">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground font-mono mb-4 flex items-center gap-2">
            <Clock className="h-4 w-4" /> Recent Updates
          </h4>
          <div className="space-y-4">
            {timeline?.slice(0, 3).map((event) => (
              <div key={event.id} className="relative pl-4 border-l border-border">
                <div className="absolute -left-1 top-1.5 h-2 w-2 rounded-full bg-primary" />
                <p className="text-sm font-medium leading-snug">{event.description}</p>
                <p className="text-3xs text-muted-foreground font-mono uppercase tracking-wider mt-1">
                  {formatDateTime(event.createdAt)}
                </p>
              </div>
            ))}
            {(!timeline || timeline.length === 0) && (
              <p className="text-sm text-muted-foreground leading-relaxed">
                No activity on your matter yet. Progress will show up here as it happens.
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
