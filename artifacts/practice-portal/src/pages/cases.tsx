import { useState } from "react";
import { useListCases } from "@workspace/api-client-react";
import { Link } from "wouter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

  const { data: cases, isLoading } = useListCases();

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
  const registryEmpty = !isLoading && (cases?.length ?? 0) === 0;

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent":
        return "bg-destructive text-destructive-foreground";
      case "high":
        return "bg-primary text-primary-foreground";
      case "medium":
        return "bg-muted text-muted-foreground border-border border";
      case "low":
        return "bg-background text-muted-foreground border-border border";
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

      <div className="rounded-lg bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent bg-muted/30">
              <TableHead className="w-[100px] font-mono text-xs uppercase tracking-wider">
                ID
              </TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">
                Case Matter
              </TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Client</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Status</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Priority</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider text-right">
                Action
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array(5)
                .fill(0)
                .map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-12" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-48" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-6 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-6 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-8 w-8 ml-auto" />
                    </TableCell>
                  </TableRow>
                ))
            ) : registryEmpty ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="h-56">
                  <div className="flex flex-col items-center justify-center text-center gap-3 px-4">
                    <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
                      <FolderOpen className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-semibold">No matters yet</p>
                      <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                        The case registry is where every matter in this chamber lives. Open the
                        first one and it will appear here.
                      </p>
                    </div>
                    <Button className="rounded-lg mt-1" onClick={() => setIsCreateOpen(true)}>
                      <Plus className="mr-2 h-4 w-4" /> File the first case
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : filteredCases?.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="h-32 text-center">
                  <p className="text-muted-foreground">No cases match this search or filter.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setStatusFilter("all");
                    }}
                    className="text-sm text-primary hover:underline mt-2"
                  >
                    Clear filters
                  </button>
                </TableCell>
              </TableRow>
            ) : (
              filteredCases?.map((c) => (
                <TableRow
                  key={c.id}
                  className="group cursor-pointer"
                  onClick={() => (window.location.href = `/cases/${c.id}`)}
                >
                  <TableCell className="font-mono text-xs text-muted-foreground">#{c.id}</TableCell>
                  <TableCell>
                    <div className="font-medium text-sm group-hover:text-primary transition-colors flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {c.title}
                    </div>
                    {c.filingRef && (
                      <div className="text-xs text-muted-foreground font-mono mt-1">
                        REF: {c.filingRef}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {c.clientName || (
                      <span className="text-muted-foreground italic">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`rounded-lg text-[10px] uppercase font-mono tracking-wider border ${getStatusColor(c.status)}`}
                    >
                      {c.status.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`rounded-lg text-[10px] uppercase font-mono tracking-wider ${getPriorityColor(c.priority || "medium")}`}
                    >
                      {c.priority}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      asChild
                      className="rounded-lg h-8 w-8 text-muted-foreground group-hover:text-foreground"
                    >
                      <Link href={`/cases/${c.id}`}>
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <CaseFormModal open={isCreateOpen} onOpenChange={setIsCreateOpen} />
    </div>
  );
}
