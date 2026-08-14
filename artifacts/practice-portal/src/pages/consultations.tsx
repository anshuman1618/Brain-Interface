import { useState } from "react";
import {
  useListConsultations,
  useUpdateConsultation,
  useListCases,
  useCreateConsultation,
  getListConsultationsQueryKey,
  type ConsultationInputCategory,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Plus } from "lucide-react";
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

  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newScheduledAt, setNewScheduledAt] = useState("");
  const [newCaseId, setNewCaseId] = useState("");
  // Empty until the advocate picks one; the Create button stays disabled meanwhile.
  const [newCategory, setNewCategory] = useState<ConsultationInputCategory | "">("");
  const [newConsent, setNewConsent] = useState(false);

  // Closing a consultation is the one state change this screen makes. It used
  // to be the end of a recording that never happened; now it is what it always
  // meant — the meeting took place, mark it done.
  const handleMarkCompleted = (id: string | number) => {
    updateConsultation.mutate(
      { id: Number(id), data: { status: "completed" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListConsultationsQueryKey() });
          toast({ title: "Consultation completed", description: "Marked as held." });
        },
      },
    );
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle || !newScheduledAt || !newCategory) return;

    createConsultation.mutate(
      {
        data: {
          title: newTitle,
          notes: newNotes,
          scheduledAt: new Date(newScheduledAt).toISOString(),
          caseId: Number(newCaseId),
          // Narrowed to a real category by the guard above.
          category: newCategory,
          consentGiven: newConsent,
        },
      },
      {
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
        },
      },
    );
  };

  const getCategoryBadgeClass = (category: string | null) => {
    switch (category) {
      case "legal_solution":
        return "bg-primary text-primary-foreground";
      case "regulatory_solution":
        return "bg-secondary text-secondary-foreground";
      case "business_consultation":
        return "bg-warning text-warning-foreground";
      case "procedural_compliance":
        return "bg-muted text-muted-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getCategoryLabel = (category: string | null) => {
    if (!category) return "Uncategorized";
    return category
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-start md:items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-1">Consultation Records</h2>
          <p className="text-muted-foreground">
            Schedule client consultations against a matter, record consent, and keep the notes with
            the file.
          </p>
        </div>
        <Button
          onClick={() => setNewModalOpen(true)}
          className="rounded-lg bg-foreground text-background font-mono uppercase tracking-wider"
        >
          <Plus className="mr-2 h-4 w-4" /> New Consultation
        </Button>
      </div>

      <div className="rounded-lg bg-card shadow-sm">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow>
              <TableHead className="font-mono uppercase tracking-wider text-xs">Date</TableHead>
              <TableHead className="font-mono uppercase tracking-wider text-xs">Subject</TableHead>
              <TableHead className="font-mono uppercase tracking-wider text-xs">Category</TableHead>
              <TableHead className="font-mono uppercase tracking-wider text-xs">Case</TableHead>
              <TableHead className="font-mono uppercase tracking-wider text-xs">Status</TableHead>
              <TableHead className="font-mono uppercase tracking-wider text-xs text-right">
                Action
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-48" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-32" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-8 w-24 ml-auto" />
                  </TableCell>
                </TableRow>
              ))
            ) : consultations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <p className="font-medium text-sm">No consultations recorded</p>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed max-w-sm mx-auto">
                    Log a consultation to keep a record of what was advised, when, and to whom.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              consultations.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-sm whitespace-nowrap">
                    {c.scheduledAt ? formatDateTime(c.scheduledAt) : "N/A"}
                  </TableCell>
                  <TableCell className="font-medium">{c.title}</TableCell>
                  <TableCell>
                    <span
                      className={`px-2 py-1 text-3xs uppercase font-mono tracking-wider whitespace-nowrap rounded-lg ${getCategoryBadgeClass(c.category as string)}`}
                    >
                      {getCategoryLabel(c.category as string)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {c.caseId ? (
                      <Link
                        href={`/cases/${c.caseId}`}
                        className="text-sm font-mono text-primary hover:underline"
                      >
                        {c.caseId}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground text-xs italic">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-semibold font-mono uppercase tracking-wider ${
                        c.status === "scheduled"
                          ? "bg-secondary text-secondary-foreground"
                          : c.status === "completed"
                            ? "bg-success text-success-foreground"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {c.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {c.status === "scheduled" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="font-mono uppercase tracking-wider"
                        onClick={() => handleMarkCompleted(c.id)}
                        disabled={updateConsultation.isPending}
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" /> Mark Held
                      </Button>
                    )}
                    {c.status === "completed" && (
                      <span className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
                        Held
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={newModalOpen} onOpenChange={setNewModalOpen}>
        <DialogContent className="sm:max-w-[425px] rounded-lg border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-widest">
              Schedule Consultation
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 pt-4">
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                Related Case *
              </label>
              <Select value={newCaseId} onValueChange={setNewCaseId} required>
                <SelectTrigger className="rounded-lg bg-background font-mono text-sm">
                  <SelectValue placeholder="SELECT CASE" />
                </SelectTrigger>
                <SelectContent className="rounded-lg">
                  {cases.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)} className="font-mono text-sm">
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                Title *
              </label>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="rounded-lg font-mono text-sm bg-background"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                Category *
              </label>
              <Select
                value={newCategory}
                onValueChange={(v) => setNewCategory(v as ConsultationInputCategory)}
                required
              >
                <SelectTrigger className="rounded-lg bg-background font-mono text-sm">
                  <SelectValue placeholder="SELECT CATEGORY" />
                </SelectTrigger>
                <SelectContent className="rounded-lg">
                  <SelectItem value="legal_solution" className="font-mono text-sm">
                    Legal Solution
                  </SelectItem>
                  <SelectItem value="regulatory_solution" className="font-mono text-sm">
                    Regulatory Solution
                  </SelectItem>
                  <SelectItem value="business_consultation" className="font-mono text-sm">
                    Business Consultation
                  </SelectItem>
                  <SelectItem value="procedural_compliance" className="font-mono text-sm">
                    Procedural Compliance
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                Scheduled Time *
              </label>
              <Input
                type="datetime-local"
                value={newScheduledAt}
                onChange={(e) => setNewScheduledAt(e.target.value)}
                className="rounded-lg font-mono text-sm bg-background"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                Notes
              </label>
              <Textarea
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                className="rounded-lg font-mono text-sm bg-background resize-none h-20"
              />
            </div>

            <div className="flex items-start space-x-2 mt-4 pt-2">
              <Checkbox
                id="new-consent"
                checked={newConsent}
                onCheckedChange={(c) => setNewConsent(c as boolean)}
                className="mt-1"
              />
              <Label
                htmlFor="new-consent"
                className="text-xs text-muted-foreground cursor-pointer leading-tight"
              >
                Client has been informed that a record of this consultation will be kept in the
                chamber's file.
              </Label>
            </div>

            <div className="pt-4 flex justify-end">
              <Button
                type="submit"
                className="rounded-lg font-mono uppercase tracking-wider w-full"
                disabled={
                  createConsultation.isPending ||
                  !newTitle ||
                  !newScheduledAt ||
                  !newCategory ||
                  !newConsent
                }
              >
                {createConsultation.isPending ? "Scheduling..." : "Schedule"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
