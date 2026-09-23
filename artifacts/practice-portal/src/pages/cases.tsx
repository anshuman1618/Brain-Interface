import { useState } from "react";
import { useListCases } from "@workspace/api-client-react";
import { Link } from "wouter";
import { AdaptiveTable } from "@/components/ui/adaptive-table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadFailed } from "@/components/load-failed";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Plus, FileText, ChevronRight, FolderOpen } from "lucide-react";
import { CaseFormModal } from "@/components/case-form-modal";

export default function CasesPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: cases, isLoading, isError, error, refetch } = useListCases();

  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const filteredCases = cases?.filter((c) => {
    const matchesSearch =
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      c.clientName?.toLowerCase().includes(search.toLowerCase()) ||
      c.filingRef?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // A registry with nothing in it and a filter that matched nothing are
  // different problems, and "No cases found matching your criteria" was the
  // wrong answer to the first: there were no criteria, there was no work yet.
  // `isError` first: a failed load must never fall through to the empty
  // state, which would tell a chamber its matters are gone.
  const registryEmpty = !isLoading && !isError && (cases?.length ?? 0) === 0;

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent":
        return "bg-destructive text-destructive-foreground";
      case "high":
        return "bg-primary text-primary-foreground";
      // muted-foreground on muted is 3.86:1 in dark — the badge is 10px text,
      // so it needs 4.5:1. The card foreground clears it on both grounds.
      case "medium":
        return "bg-muted text-foreground border-border border";
      case "low":
        return "bg-background text-foreground border-border border";
      default:
        return "bg-muted text-foreground";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "bg-primary/20 text-primary border-primary/30";
      case "in_progress":
        return "bg-secondary text-secondary-foreground border-secondary-foreground/20";
      case "review":
        return "bg-accent text-accent-foreground border-accent-foreground/20";
      case "closed":
        return "bg-muted text-muted-foreground border-border";
      default:
        return "bg-muted text-foreground border-border";
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-1">Case Registry</h2>
          <p className="text-muted-foreground">
            Manage active litigation, corporate matters, and client files.
          </p>
        </div>

        <Button className="rounded-lg" onClick={() => setIsCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New Case File
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search cases by name, client, or ref..."
            className="pl-9 bg-background rounded-lg"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px] rounded-lg bg-background">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="review">In Review</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isError && (
        <LoadFailed error={error} onRetry={() => void refetch()} what="the case registry" />
      )}

      {isLoading ? (
        <div className="flex flex-col gap-2 rounded-lg bg-card p-3 shadow-sm">
          {Array(5)
            .fill(0)
            .map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
        </div>
      ) : registryEmpty ? (
        <div className="flex h-56 flex-col items-center justify-center gap-3 rounded-lg bg-card px-4 text-center shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
            <FolderOpen className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold">No matters yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              The case registry is where every matter in this chamber lives. Open the first one and
              it will appear here.
            </p>
          </div>
          <Button className="mt-1 rounded-lg" onClick={() => setIsCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> File the first case
          </Button>
        </div>
      ) : (
        <AdaptiveTable
          label="Matters"
          className="rounded-lg md:bg-card md:shadow-sm"
          rows={filteredCases ?? []}
          rowKey={(c) => c.id}
          onRowClick={(c) => {
            window.location.href = `/cases/${c.id}`;
          }}
          empty={
            <div className="flex h-32 flex-col items-center justify-center rounded-lg bg-card text-center shadow-sm">
              <p className="text-muted-foreground">No cases match this search or filter.</p>
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                }}
                className="mt-2 min-h-9 text-sm text-primary hover:underline"
              >
                Clear filters
              </button>
            </div>
          }
          columns={[
            {
              key: "id",
              header: "ID",
              card: "subtitle",
              className: "w-[100px] font-mono text-xs uppercase tracking-wider",
              /* Still dropped from the TABLE at narrow widths — but the card
                 keeps it, which is the whole difference. Under the old rule
                 this column was simply gone on a phone. */
              tableClassName: "hidden sm:table-cell",
              cell: (c) => <span className="text-muted-foreground">#{c.id}</span>,
            },
            {
              key: "matter",
              header: "Case Matter",
              card: "title",
              className: "font-mono text-xs uppercase tracking-wider",
              cell: (c) => (
                <>
                  <div className="group-hover:text-primary flex items-center gap-2 text-sm font-medium transition-colors">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 break-words">{c.title}</span>
                  </div>
                  {c.filingRef && (
                    <div className="mt-1 font-mono text-xs text-muted-foreground">
                      REF: {c.filingRef}
                    </div>
                  )}
                </>
              ),
            },
            {
              key: "client",
              header: "Client",
              className: "font-mono text-xs uppercase tracking-wider",
              tableClassName: "hidden md:table-cell",
              cell: (c) =>
                c.clientName || <span className="italic text-muted-foreground">Unassigned</span>,
            },
            {
              key: "status",
              header: "Status",
              className: "font-mono text-xs uppercase tracking-wider",
              cell: (c) => (
                <Badge
                  variant="outline"
                  className={`rounded-lg border font-mono text-3xs uppercase tracking-wider ${getStatusColor(c.status)}`}
                >
                  {c.status.replace("_", " ")}
                </Badge>
              ),
            },
            {
              key: "priority",
              header: "Priority",
              className: "font-mono text-xs uppercase tracking-wider",
              cell: (c) => (
                <Badge
                  variant="outline"
                  className={`rounded-lg font-mono text-3xs uppercase tracking-wider ${getPriorityColor(c.priority || "medium")}`}
                >
                  {c.priority}
                </Badge>
              ),
            },
            {
              key: "open",
              header: "Action",
              /* The card is itself a link to the matter, so a chevron inside it
                 would be a second control doing the same thing. */
              card: "hidden",
              className: "text-right font-mono text-xs uppercase tracking-wider",
              cell: (c) => (
                <Button
                  variant="ghost"
                  size="icon"
                  asChild
                  className="group-hover:text-foreground h-8 w-8 rounded-lg text-muted-foreground"
                >
                  <Link href={`/cases/${c.id}`}>
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </Button>
              ),
            },
          ]}
        />
      )}

      <CaseFormModal open={isCreateOpen} onOpenChange={setIsCreateOpen} />
    </div>
  );
}
