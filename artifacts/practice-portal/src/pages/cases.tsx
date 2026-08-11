import { useState } from "react";
import {
  useListCases,
  useCreateCase,
  type CaseInput,
  type CaseInputPriority,
  type CaseInputStatus,
} from "@workspace/api-client-react";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Plus, FileText, ChevronRight, AlertTriangle, CreditCard } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListCasesQueryKey,
  useCheckConflicts,
  type ConflictHit,
} from "@workspace/api-client-react";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { usePricingModal } from "@/components/pricing-modal";

export default function CasesPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const queryClient = useQueryClient();

  const { data: cases, isLoading } = useListCases();
  const createCaseMutation = useCreateCase();
  const conflictCheck = useCheckConflicts();
  const { toast } = useToast();
  const { setOpen: setPricingOpen } = usePricingModal();

  /**
   * Conflict state for the create dialog.
   *
   * `hits` is what the screening found; `note` is the advocate's reason for
   * proceeding anyway. Both are cleared whenever the dialog opens, so a note
   * written for one party can never be silently reused for another.
   */
  const [hits, setHits] = useState<ConflictHit[]>([]);
  const [conflictNote, setConflictNote] = useState("");
  const [planBlock, setPlanBlock] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newCase, setNewCase] = useState<CaseInput>({
    title: "",
    description: "",
    priority: "medium",
    status: "open",
    filingRef: "",
  });

  const filteredCases = cases?.filter((c) => {
    const matchesSearch =
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      c.clientName?.toLowerCase().includes(search.toLowerCase()) ||
      c.filingRef?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  /** Screen as soon as the field loses focus, so the warning arrives early. */
  const screen = () => {
    const party = newCase.opposingParty?.trim();
    if (!party) {
      setHits([]);
      return;
    }
    conflictCheck.mutate({ data: { opposingParty: party } }, { onSuccess: (r) => setHits(r.hits) });
  };

  const handleCreate = () => {
    setPlanBlock(null);
    createCaseMutation.mutate(
      {
        data: {
          ...newCase,
          // Only sent when the advocate has actually been shown a conflict.
          conflictAcknowledged: hits.length > 0 ? true : undefined,
          conflictNote: hits.length > 0 ? conflictNote.trim() : undefined,
        },
      },
      {
        onError: (err: unknown) => {
          const body = (err as { data?: Record<string, unknown> })?.data ?? {};
          if (body["error"] === "conflict_of_interest") {
            setHits((body["hits"] as ConflictHit[]) ?? []);
            toast({
              title: "Possible conflict of interest",
              description: "Review the matches and record why the matter can proceed.",
              variant: "destructive",
            });
            return;
          }
          if (body["error"] === "plan_limit") {
            setPlanBlock(String(body["message"] ?? "Your plan is full."));
            return;
          }
          toast({
            title: "Could not open the matter",
            description: err instanceof Error ? err.message : undefined,
            variant: "destructive",
          });
        },
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() });
          setIsCreateOpen(false);
          setHits([]);
          setConflictNote("");
          setNewCase({
            title: "",
            description: "",
            priority: "medium",
            status: "open",
            filingRef: "",
          });
        },
      },
    );
  };

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

        <Dialog
          open={isCreateOpen}
          onOpenChange={(o) => {
            setIsCreateOpen(o);
            if (o) {
              setHits([]);
              setConflictNote("");
              setPlanBlock(null);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button className="rounded-lg">
              <Plus className="mr-2 h-4 w-4" /> New Case File
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Open New Case</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="title">Case Title / Name</Label>
                <Input
                  id="title"
                  value={newCase.title}
                  onChange={(e) => setNewCase({ ...newCase, title: e.target.value })}
                  placeholder="e.g. Smith v. Megacorp"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="opposing">Opposing party</Label>
                <Input
                  id="opposing"
                  value={newCase.opposingParty ?? ""}
                  onChange={(e) => setNewCase({ ...newCase, opposingParty: e.target.value })}
                  onBlur={screen}
                  placeholder="Who the matter is against"
                />
                <p className="text-[11px] text-muted-foreground">
                  Checked against your existing clients and matters before the file opens.
                </p>
              </div>

              {/* A conflict is surfaced before the matter exists, and cannot be
                  passed by clicking again — the API requires the reason too. */}
              {hits.length > 0 && (
                <div className="border border-destructive bg-destructive/10 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-destructive font-semibold text-sm">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Possible conflict of interest
                  </div>
                  <ul className="text-xs space-y-1 list-disc pl-5">
                    {hits.map((h, i) => (
                      <li key={i}>{h.detail}</li>
                    ))}
                  </ul>
                  <Textarea
                    value={conflictNote}
                    onChange={(e) => setConflictNote(e.target.value)}
                    rows={2}
                    className="rounded-lg"
                    placeholder="Why can this matter proceed? (recorded in the audit log)"
                  />
                </div>
              )}

              {planBlock && (
                <div className="border border-primary bg-primary/10 p-3 space-y-2">
                  <p className="text-sm">{planBlock}</p>
                  <Button
                    size="sm"
                    className="rounded-lg"
                    onClick={() => {
                      setIsCreateOpen(false);
                      setPricingOpen(true);
                    }}
                  >
                    <CreditCard className="mr-2 h-4 w-4" /> View plans
                  </Button>
                </div>
              )}

              <div className="grid gap-2">
                <Label htmlFor="ref">Filing Reference (Optional)</Label>
                <Input
                  id="ref"
                  value={newCase.filingRef}
                  onChange={(e) => setNewCase({ ...newCase, filingRef: e.target.value })}
                  placeholder="e.g. CV-2023-992"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Priority</Label>
                  <Select
                    value={newCase.priority}
                    onValueChange={(v) =>
                      setNewCase({ ...newCase, priority: v as CaseInputPriority })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Initial Status</Label>
                  <Select
                    value={newCase.status}
                    onValueChange={(v) => setNewCase({ ...newCase, status: v as CaseInputStatus })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="review">Review</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                disabled={
                  !newCase.title ||
                  createCaseMutation.isPending ||
                  // A reported conflict needs a reason before it can be passed.
                  (hits.length > 0 && !conflictNote.trim())
                }
                onClick={handleCreate}
                className="rounded-lg"
              >
                {createCaseMutation.isPending ? "Creating..." : "Create Case"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
            ) : filteredCases?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  No cases found matching your criteria.
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
    </div>
  );
}
