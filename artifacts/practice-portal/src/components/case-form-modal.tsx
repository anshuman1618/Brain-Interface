import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateCase,
  useCheckConflicts,
  getListCasesQueryKey,
  getGetDashboardSummaryQueryKey,
  type CaseInput,
  type CaseInputPriority,
  type CaseInputStatus,
  type ConflictHit,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, AlertTriangle, CreditCard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePricingModal } from "@/components/pricing-modal";
import { CourtIdentityFields } from "@/components/court-identity-fields";
import {
  courtIdentityPayload,
  courtIdentityProblem,
  type CourtIdentity,
} from "@/lib/court-identity";
import { userMessage } from "@/lib/errors";

/** Mirrors the API's minimum, so the form and the server cannot disagree. */
const MIN_FILING_REF = 3;

function filingRefProblem(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "A filing reference is required — for example CV-2026-118.";
  if (trimmed.length < MIN_FILING_REF)
    return `At least ${MIN_FILING_REF} characters — for example CV-2026-118.`;
  return null;
}

const EMPTY_CASE: CaseInput = {
  title: "",
  description: "",
  priority: "medium",
  status: "open",
  filingRef: "",
};

/**
 * Open a new matter.
 *
 * Lifted out of the Case Registry page so the dashboard can offer the same
 * action without a second implementation of it. Filing a case screens for
 * conflicts and can be refused by the plan limit, and neither of those is
 * something to reimplement per entry point — a second copy is a second copy
 * that can drift out of step with the first.
 *
 * `onOpened` fires after the matter exists, for callers that want to react
 * beyond the cache invalidation done here.
 */
export function CaseFormModal({
  open,
  onOpenChange,
  onOpened,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpened?: (caseId: number) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { setOpen: setPricingOpen } = usePricingModal();

  const createCaseMutation = useCreateCase();
  const conflictCheck = useCheckConflicts();

  /**
   * Conflict state for the dialog.
   *
   * `hits` is what the screening found; `conflictNote` is the advocate's reason
   * for proceeding anyway. Both are cleared whenever the dialog opens, so a note
   * written for one party can never be silently reused for another.
   */
  const [hits, setHits] = useState<ConflictHit[]>([]);
  const [conflictNote, setConflictNote] = useState("");
  const [planBlock, setPlanBlock] = useState<string | null>(null);
  const [refError, setRefError] = useState<string | null>(null);
  const [newCase, setNewCase] = useState<CaseInput>(EMPTY_CASE);
  const [court, setCourt] = useState<CourtIdentity>({});

  // Submit stays disabled until both required fields hold something usable, and
  // until the optional court block is either complete or entirely empty.
  const canSubmit =
    newCase.title.trim().length > 0 &&
    filingRefProblem(newCase.filingRef) === null &&
    courtIdentityProblem(court) === null;

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setHits([]);
      setConflictNote("");
      setPlanBlock(null);
      setRefError(null);
      setCourt({});
    }
    onOpenChange(next);
  };

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
          ...courtIdentityPayload(court),
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
            description: userMessage(err),
            variant: "destructive",
          });
        },
        onSuccess: (created) => {
          // Both caches: the registry list and the dashboard's counters read
          // different endpoints, and a matter filed from the dashboard has to
          // show up there without a reload.
          queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          toast({
            title: "Matter opened",
            description: `"${created.title}" is now in the case registry.`,
          });
          setHits([]);
          setConflictNote("");
          setRefError(null);
          setNewCase(EMPTY_CASE);
          setCourt({});
          onOpenChange(false);
          onOpened?.(created.id);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="rounded-lg border-border max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono uppercase tracking-widest">Open New Case</DialogTitle>
          <DialogDescription className="font-mono text-xs uppercase tracking-wider">
            Screened for conflicts before the file opens.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="case-title">Case Title / Name *</Label>
            <Input
              id="case-title"
              value={newCase.title}
              onChange={(e) => setNewCase({ ...newCase, title: e.target.value })}
              placeholder="e.g. Smith v. Megacorp"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="case-opposing">Opposing party</Label>
            <Input
              id="case-opposing"
              value={newCase.opposingParty ?? ""}
              onChange={(e) => setNewCase({ ...newCase, opposingParty: e.target.value })}
              onBlur={screen}
              placeholder="Who the matter is against"
            />
            <p className="text-2xs text-muted-foreground">
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
                  onOpenChange(false);
                  setPricingOpen(true);
                }}
              >
                <CreditCard className="mr-2 h-4 w-4" /> View plans
              </Button>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="case-ref">Filing Reference *</Label>
            <Input
              id="case-ref"
              value={newCase.filingRef}
              onChange={(e) => {
                setNewCase({ ...newCase, filingRef: e.target.value });
                if (refError) setRefError(null);
              }}
              onBlur={() =>
                newCase.filingRef.trim() && setRefError(filingRefProblem(newCase.filingRef))
              }
              aria-invalid={refError ? true : undefined}
              aria-describedby={refError ? "case-ref-error" : undefined}
              placeholder="e.g. CV-2026-118"
            />
            {refError ? (
              <p
                id="case-ref-error"
                role="alert"
                className="text-2xs text-destructive flex items-center gap-1.5"
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {refError}
              </p>
            ) : (
              <p className="text-2xs text-muted-foreground">
                The court or registry reference this matter is filed under.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Priority</Label>
              <Select
                value={newCase.priority}
                onValueChange={(v) => setNewCase({ ...newCase, priority: v as CaseInputPriority })}
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

          <CourtIdentityFields value={court} onChange={setCourt} idPrefix="new-case" />
        </div>
        <DialogFooter>
          <Button
            disabled={
              !canSubmit ||
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
  );
}
