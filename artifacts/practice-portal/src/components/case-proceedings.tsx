import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCaseProceedings,
  useCreateCaseProceeding,
  useUpdateCaseProceeding,
  useDeleteCaseProceeding,
  getListCaseProceedingsQueryKey,
  getGetCaseTimelineQueryKey,
  type CaseProceeding,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusSelect } from "@/components/status-select";
import { StagePicker } from "@/components/stage-picker";
import { LoadFailed } from "@/components/load-failed";
import { useSession } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { userMessage } from "@/lib/errors";
import { GitBranch, Plus, Pencil, Trash2, CheckCircle2 } from "lucide-react";

const KINDS = [
  "application",
  "appeal",
  "execution",
  "review",
  "caveat",
  "contempt",
  "misc",
] as const;

const KIND_LABEL: Record<string, string> = {
  application: "Application",
  appeal: "Appeal",
  execution: "Execution",
  review: "Review",
  caveat: "Caveat",
  contempt: "Contempt",
  misc: "Other",
};

type Draft = {
  title: string;
  kind: string;
  status: string;
  stage: string | null;
  filingRef: string;
  filedOn: string;
  decidedOn: string;
  note: string;
};

const EMPTY: Draft = {
  title: "",
  kind: "application",
  status: "open",
  stage: null,
  filingRef: "",
  filedOn: "",
  decidedOn: "",
  note: "",
};

/**
 * The proceedings hanging off a matter, as branches of it.
 *
 * A writ petition spawns a stay application, a contempt, an appeal. Until now
 * those were recorded by typing them into the matter's title or leaving them
 * in somebody's head, and neither survives the advocate who did it.
 *
 * Deliberately rendered above the tabs rather than inside one: a proceeding is
 * part of what the matter IS, in the same way its court identity was, and
 * burying the fact that a matter has three live applications one tab deep
 * defeats the purpose of recording them. Live ones first, decided ones dimmed
 * below — the same treatment a closed document request gets, and for the same
 * reason.
 */
export function CaseProceedings({ caseId }: { caseId: number }) {
  const { can } = useSession();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CaseProceeding | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const {
    data: proceedings = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useListCaseProceedings(caseId, {
    query: { enabled: !!caseId, queryKey: getListCaseProceedingsQueryKey(caseId) },
  });

  const create = useCreateCaseProceeding();
  const update = useUpdateCaseProceeding();
  const remove = useDeleteCaseProceeding();
  const canWrite = can("cases.write");

  // Both lists move: the proceeding itself, and the matter's ledger, which
  // gains a row for every change made here.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListCaseProceedingsQueryKey(caseId) });
    queryClient.invalidateQueries({ queryKey: getGetCaseTimelineQueryKey(caseId) });
  };

  const openNew = () => {
    setEditing(null);
    setDraft(EMPTY);
    setOpen(true);
  };

  const openExisting = (p: CaseProceeding) => {
    setEditing(p);
    setDraft({
      title: p.title,
      kind: p.kind,
      status: p.status,
      stage: p.stage ?? null,
      filingRef: p.filingRef ?? "",
      filedOn: p.filedOn ?? "",
      decidedOn: p.decidedOn ?? "",
      note: p.note ?? "",
    });
    setOpen(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const title = draft.title.trim();
    if (!title) return;

    const onError = (err: Error) =>
      toast({
        title: "Could not save that",
        description: userMessage(err),
        variant: "destructive",
      });

    if (editing) {
      update.mutate(
        {
          caseId,
          proceedingId: editing.id,
          data: {
            title,
            kind: draft.kind as CaseProceeding["kind"],
            status: draft.status,
            stage: draft.stage,
            filingRef: draft.filingRef.trim(),
            // Empty string means "cleared", which the API models as null. Sending
            // "" would fail the date pattern rather than clearing the field.
            filedOn: draft.filedOn || null,
            decidedOn: draft.decidedOn || null,
            note: draft.note.trim(),
          },
        },
        {
          onSuccess: () => {
            invalidate();
            setOpen(false);
            toast({ title: "Updated", description: `"${title}" and the matter's ledger.` });
          },
          onError,
        },
      );
      return;
    }

    create.mutate(
      {
        caseId,
        data: {
          title,
          kind: draft.kind as CaseProceeding["kind"],
          status: draft.status,
          stage: draft.stage,
          filingRef: draft.filingRef.trim(),
          ...(draft.filedOn ? { filedOn: draft.filedOn } : {}),
          note: draft.note.trim(),
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setOpen(false);
          toast({ title: "Opened", description: `"${title}" is now on this matter.` });
        },
        onError,
      },
    );
  };

  const destroy = (p: CaseProceeding) => {
    remove.mutate(
      { caseId, proceedingId: p.id },
      {
        onSuccess: () => {
          invalidate();
          toast({
            title: "Removed",
            description: "The matter's ledger keeps the record that it existed.",
          });
        },
        onError: (err: Error) =>
          toast({
            title: "Could not remove it",
            description: userMessage(err),
            variant: "destructive",
          }),
      },
    );
  };

  const live = proceedings.filter((p: CaseProceeding) => !p.decidedOn);
  const decided = proceedings.filter((p: CaseProceeding) => p.decidedOn);

  const row = (p: CaseProceeding) => (
    <div
      key={p.id}
      className={`flex flex-wrap items-start justify-between gap-3 border-t border-border py-3 first:border-t-0 ${
        p.decidedOn ? "opacity-60 transition-opacity hover:opacity-100" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="rounded-[var(--radius)] font-mono text-3xs uppercase tracking-wider"
          >
            {KIND_LABEL[p.kind] ?? p.kind}
          </Badge>
          <span className="truncate text-sm font-medium">{p.title}</span>
          {p.filingRef && (
            <span className="font-mono text-3xs uppercase tracking-wider text-muted-foreground">
              {p.filingRef}
            </span>
          )}
          {p.decidedOn && (
            <Badge className="rounded-[var(--radius)] font-mono text-3xs uppercase tracking-wider">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Decided
            </Badge>
          )}
        </div>
        <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-3xs uppercase tracking-wider text-muted-foreground">
          <span>{p.statusLabel || p.status}</span>
          {p.stageLabel && <span>· {p.stageLabel}</span>}
          {p.filedOn && <span>· filed {p.filedOn}</span>}
          {p.decidedOn && <span>· decided {p.decidedOn}</span>}
        </p>
        {p.note && (
          <p className="mt-1 text-sm italic text-muted-foreground">&ldquo;{p.note}&rdquo;</p>
        )}
      </div>

      {canWrite && (
        <div className="flex shrink-0 gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="rounded-lg"
            onClick={() => openExisting(p)}
            aria-label={`Edit ${p.title}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-lg hover:text-destructive"
            disabled={remove.isPending}
            onClick={() => destroy(p)}
            aria-label={`Remove ${p.title}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="rounded-lg bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
              Proceedings
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {proceedings.length === 0
                ? "Applications, appeals and executions under this matter."
                : `${live.length} live${decided.length > 0 ? `, ${decided.length} decided` : ""}.`}
            </p>
          </div>
        </div>
        {canWrite && (
          <Button size="sm" variant="outline" className="shrink-0 rounded-lg" onClick={openNew}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Open one
          </Button>
        )}
      </div>

      {isError ? (
        <div className="mt-3">
          <LoadFailed error={error} onRetry={() => void refetch()} what="the proceedings" />
        </div>
      ) : isLoading ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : proceedings.length > 0 ? (
        <div className="mt-3">
          {live.map(row)}
          {decided.map(row)}
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-lg border-border sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-widest">
              {editing ? "Edit proceeding" : "Open a proceeding"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Recorded on this matter&rsquo;s Activity Ledger, including every later change.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4 pt-2">
            <div className="grid gap-2">
              <label
                htmlFor="proceeding-title"
                className="font-mono text-2xs font-bold uppercase tracking-wider text-muted-foreground"
              >
                What is it? *
              </label>
              <Input
                id="proceeding-title"
                value={draft.title}
                maxLength={200}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="e.g. Application for interim stay"
                className="rounded-lg"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <label className="font-mono text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                  Kind
                </label>
                <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v })}>
                  <SelectTrigger className="rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {KIND_LABEL[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <label className="font-mono text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                  Status
                </label>
                <StatusSelect
                  value={draft.status}
                  onChange={(v) => setDraft({ ...draft, status: v })}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <label className="font-mono text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                Stage
              </label>
              {/* The matter's own stage vocabulary, not a second one. */}
              <StagePicker
                caseId={caseId}
                value={draft.stage}
                onChange={(v) => setDraft({ ...draft, stage: v })}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <label
                  htmlFor="proceeding-ref"
                  className="font-mono text-2xs font-bold uppercase tracking-wider text-muted-foreground"
                >
                  Number
                </label>
                <Input
                  id="proceeding-ref"
                  value={draft.filingRef}
                  onChange={(e) => setDraft({ ...draft, filingRef: e.target.value })}
                  placeholder="IA 45/2026"
                  className="rounded-lg"
                />
              </div>
              <div className="grid gap-2">
                <label
                  htmlFor="proceeding-filed"
                  className="font-mono text-2xs font-bold uppercase tracking-wider text-muted-foreground"
                >
                  Filed on
                </label>
                <Input
                  id="proceeding-filed"
                  type="date"
                  value={draft.filedOn}
                  onChange={(e) => setDraft({ ...draft, filedOn: e.target.value })}
                  className="rounded-lg"
                />
              </div>
              {editing && (
                <div className="grid gap-2">
                  <label
                    htmlFor="proceeding-decided"
                    className="font-mono text-2xs font-bold uppercase tracking-wider text-muted-foreground"
                  >
                    Decided on
                  </label>
                  <Input
                    id="proceeding-decided"
                    type="date"
                    value={draft.decidedOn}
                    onChange={(e) => setDraft({ ...draft, decidedOn: e.target.value })}
                    className="rounded-lg"
                  />
                </div>
              )}
            </div>

            <div className="grid gap-2">
              <label
                htmlFor="proceeding-note"
                className="font-mono text-2xs font-bold uppercase tracking-wider text-muted-foreground"
              >
                Note
              </label>
              <Input
                id="proceeding-note"
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                placeholder="Anything worth remembering"
                className="rounded-lg"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="rounded-lg"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="rounded-lg font-mono uppercase tracking-wider"
                disabled={!draft.title.trim() || create.isPending || update.isPending}
              >
                {editing ? "Save changes" : "Open it"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
