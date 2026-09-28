import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import {
  useListCases,
  useListDocuments,
  useListDrafts,
  useCreateDraft,
  useUpdateDraft,
  useDeleteDraft,
  getListDraftsQueryKey,
  getGetAiBudgetQueryKey,
  getListCasesQueryKey,
  getListDocumentsQueryKey,
  type Draft,
  type DraftInputKind,
  type Case,
  type Document,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PenLine, ScanSearch, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { userMessage } from "@/lib/errors";
import { BudgetMeter } from "@/components/drafting/budget-meter";
import { LoadFailed } from "@/components/load-failed";

/**
 * Draft a document, or be briefed on the matter before it is filed.
 *
 * Two buttons, one screen, because they take the same inputs: a matter, an
 * instruction, and whichever documents the advocate wants read.
 *
 * ── The document picker is the security control ─────────────────────────
 *
 * Everything else on this page is convenience. The tick boxes are what decide
 * which privileged client files leave the server, so they are shown plainly,
 * default to none, and say when a document cannot be read at all. Nothing is
 * sent because it happened to be on the matter.
 *
 * ── The disclaimer is shown twice, and that is deliberate ───────────────
 *
 * Once at the top of the page, before anything is asked for, and once on every
 * output card. The server also prepends its own banner to the body text, so a
 * draft that is copied out of here carries the warning with it. Three places
 * for one sentence is not redundancy: a person who pastes a draft into a
 * filing has left all of this behind, and the only copy that follows them is
 * the one inside the text.
 */

/** Said in the advocate's own terms, not the model's. */
const VERIFY_NOTICE =
  "Everything on this page is machine-written and unverified. Check every citation, " +
  "date, figure and provision against the record before you rely on it. Nothing here " +
  "is filed, served or shown to a client — an advocate signs, and an advocate is on " +
  "the record.";

/**
 * What can be asked for, which is narrower than what can be read back.
 *
 * Long pleadings — petition, written statement, appeal, reply, notice, letter
 * — were retired. A model writing an entire writ petition produces something
 * an advocate has to rewrite line by line before they can sign it, which is
 * slower than drafting it, and it is the output most likely to be filed with
 * less reading than it needed. Drafts already stored under those kinds still
 * load; see `DRAFT_KINDS` in `lib/db/src/schema/drafts.ts`.
 */
const OFFERED_KINDS = ["application", "brief", "analysis"] as const;

// Includes the retired kinds, so a draft written before they were retired
// still renders under its name rather than a raw key.
const KIND_LABEL: Record<string, string> = {
  petition: "Petition",
  written_statement: "Written statement",
  appeal: "Memorandum of appeal",
  application: "Application",
  reply: "Reply / counter-affidavit",
  notice: "Legal notice",
  letter: "Letter",
  brief: "Case brief",
  analysis: "Document analysis",
};

/** Types the server can actually take text out of. Anything else is inert. */
const READABLE = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/csv",
]);

function DraftBody({ draft, onChanged }: { draft: Draft; onChanged: () => void }) {
  const { toast } = useToast();
  const [body, setBody] = useState(draft.body);
  const [editing, setEditing] = useState(false);
  const update = useUpdateDraft();
  const remove = useDeleteDraft();

  return (
    <div className="rounded-lg bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="rounded-md text-3xs uppercase tracking-wider">
              {KIND_LABEL[draft.kind] ?? draft.kind}
            </Badge>
            {draft.status === "generating" && (
              <span className="flex items-center gap-1 text-2xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> writing…
              </span>
            )}
            {draft.status === "failed" && <span className="text-2xs text-destructive">failed</span>}
            {draft.status === "kept" && (
              <span className="text-2xs text-muted-foreground">kept</span>
            )}
          </div>
          <p className="mt-1 text-sm font-medium">{draft.title || "Untitled"}</p>
          <p className="mt-0.5 text-3xs text-muted-foreground">
            {draft.createdByName} · {new Date(draft.createdAt).toLocaleString()} ·{" "}
            <span className="font-mono">{draft.model}</span>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Done" : "Edit"}
          </Button>
          <button
            type="button"
            aria-label="Discard draft"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => remove.mutate({ id: draft.id }, { onSuccess: onChanged })}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {draft.error && <p className="mt-2 text-2xs text-destructive">{draft.error}</p>}

      {/* Exactly what was sent to produce this. Not a debugging aid — it is the
          answer when a client asks what of theirs was used, and it is why the
          "the advocate chose" claim is checkable rather than asserted. */}
      {draft.sources && draft.sources.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {draft.sources.map((s, i) => (
            <span
              key={`${s.kind}-${s.sourceId ?? i}`}
              className="rounded-md bg-muted/50 px-1.5 py-0.5 text-3xs text-muted-foreground"
            >
              {s.kind}: {s.label}
            </span>
          ))}
        </div>
      )}

      {/* A document that yielded nothing must never be quietly counted as
          context — a scanned order is the commonest thing an advocate ticks and
          the commonest thing that contributes nothing. */}
      {draft.unreadable && draft.unreadable.length > 0 && (
        <div className="mt-2 rounded-[var(--radius)] bg-muted/40 p-2">
          <p className="flex items-center gap-1 text-3xs font-medium text-foreground">
            <AlertTriangle className="h-3 w-3" /> Not used
          </p>
          {draft.unreadable.map((u) => (
            <p key={u.name} className="mt-0.5 text-3xs text-muted-foreground">
              {u.name} — {u.note}
            </p>
          ))}
        </div>
      )}

      {editing ? (
        <>
          <Textarea
            className="mt-3 rounded-lg font-mono text-xs"
            rows={20}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <Button
            className="mt-2 rounded-lg"
            onClick={() =>
              update.mutate(
                { id: draft.id, data: { body, keep: true } },
                {
                  onSuccess: () => {
                    setEditing(false);
                    onChanged();
                    toast({ title: "Saved" });
                  },
                },
              )
            }
          >
            Save
          </Button>
        </>
      ) : (
        draft.body && (
          <>
            <pre className="mt-3 max-h-[32rem] overflow-auto scroll-trap whitespace-pre-wrap rounded-[var(--radius)] bg-muted/30 p-3 text-xs leading-relaxed">
              {draft.body}
            </pre>
            <p className="mt-2 flex items-start gap-1.5 text-3xs leading-relaxed text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              {VERIFY_NOTICE}
            </p>
          </>
        )
      )}
    </div>
  );
}

export default function DraftingPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, params] = useRoute("/drafting/:caseId");

  const {
    data: cases = [],
    isError: casesFailed,
    error: casesError,
    refetch: refetchCases,
  } = useListCases(undefined, {
    query: { queryKey: getListCasesQueryKey() },
  });

  const [caseId, setCaseId] = useState(params?.caseId ?? "");
  const [kind, setKind] = useState<string>("petition");
  const [instruction, setInstruction] = useState("");
  const [picked, setPicked] = useState<number[]>([]);

  const activeCase = caseId ? Number(caseId) : null;

  const { data: documents = [] } = useListDocuments(activeCase ?? 0, {
    query: {
      enabled: activeCase !== null,
      queryKey: getListDocumentsQueryKey(activeCase ?? 0),
    },
  });

  const { data: drafts = [] } = useListDrafts(activeCase ?? 0, {
    query: {
      enabled: activeCase !== null,
      queryKey: getListDraftsQueryKey(activeCase ?? 0),
      // A draft takes a minute; the row appears immediately and fills in.
      refetchInterval: (q) =>
        (q.state.data ?? []).some((d: Draft) => d.status === "generating") ? 2000 : false,
    },
  });

  const create = useCreateDraft();

  const refresh = () => {
    if (activeCase !== null) {
      queryClient.invalidateQueries({ queryKey: getListDraftsQueryKey(activeCase) });
    }
    queryClient.invalidateQueries({ queryKey: getGetAiBudgetQueryKey() });
  };

  const DEFAULT_INSTRUCTION: Record<string, string> = {
    brief: "Prepare a brief on this matter before the hearing.",
    analysis: "Analyse the documents I have ticked and report what is in them.",
  };

  const run = (which: "chosen" | "brief") => {
    if (activeCase === null) return;
    const asked = which === "brief" ? "brief" : kind;
    create.mutate(
      {
        id: activeCase,
        data: {
          kind: asked as DraftInputKind,
          instruction: instruction.trim() || (DEFAULT_INSTRUCTION[asked] ?? ""),
          documentIds: picked,
        },
      },
      {
        onSuccess: () => {
          refresh();
          toast({
            title:
              asked === "brief"
                ? "Preparing the brief"
                : asked === "analysis"
                  ? "Reading the documents"
                  : "Drafting",
            description: "It will appear below as it is written.",
          });
        },
        onError: (err: Error) =>
          toast({
            title: "Could not start",
            description: userMessage(err),
            variant: "destructive",
          }),
      },
    );
  };

  const canRun = activeCase !== null && instruction.trim().length >= 5 && !create.isPending;

  return (
    <div className="space-y-4">
      {/* The matter picker below reads an empty list as "this chamber has no
          matters". A failed load leaves it empty too, and an advocate is then
          told there is nothing to draft against. */}
      {casesFailed && (
        <LoadFailed error={casesError} onRetry={() => void refetchCases()} what="your matters" />
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg uppercase tracking-wider">Research &amp; Analysis</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Three things, from this chamber&rsquo;s own records. An{" "}
            <strong className="font-medium text-foreground">analysis</strong> reads a judgment,
            contract, application or pleading and reports what is in it — the obligations, the dates
            that bite, what is adverse and what is missing. A{" "}
            <strong className="font-medium text-foreground">brief</strong> assesses the matter
            before it is filed: the facts on the record, the merits, how the other side will run it,
            the defects to cure. An{" "}
            <strong className="font-medium text-foreground">application</strong> is drafted for you
            to edit and sign.
          </p>
          <p className="mt-1 max-w-3xl text-2xs leading-relaxed text-muted-foreground">
            Long pleadings are deliberately not offered. A machine-written writ petition has to be
            rewritten line by line before an advocate can sign it, which is slower than drafting it
            — and it is the one output most likely to be filed with less reading than it needed.
          </p>
        </div>
      </div>

      <div
        role="note"
        className="flex items-start gap-2 rounded-[var(--radius)] bg-warning p-3 text-warning-foreground shadow-[var(--raise)]"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="text-xs leading-relaxed">{VERIFY_NOTICE}</p>
      </div>

      <BudgetMeter />

      <div className="rounded-lg bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <label className="font-mono text-3xs uppercase tracking-wider text-muted-foreground">
              Matter
            </label>
            <Select
              value={caseId}
              onValueChange={(v) => {
                setCaseId(v);
                setPicked([]);
              }}
            >
              <SelectTrigger className="w-[320px] rounded-lg">
                <SelectValue placeholder="Choose a matter" />
              </SelectTrigger>
              <SelectContent>
                {cases.map((c: Case) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <label className="font-mono text-3xs uppercase tracking-wider text-muted-foreground">
              What to produce
            </label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="w-[240px] rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OFFERED_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Textarea
          className="mt-3 rounded-lg"
          rows={3}
          placeholder="What is wanted? e.g. Challenge the demand notice dated 12.03.2026 for want of a hearing, and press for interim stay."
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />

        {activeCase !== null && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="font-mono text-3xs uppercase tracking-wider text-muted-foreground">
              Documents to send ({picked.length} of {documents.length})
            </p>
            <p className="mt-1 text-3xs leading-relaxed text-muted-foreground">
              Only what you tick leaves this server. Nothing is sent because it happens to be on the
              matter.
            </p>
            {documents.length === 0 ? (
              <p className="mt-2 text-2xs text-muted-foreground">
                No documents on this matter yet.
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {documents.map((d: Document) => {
                  const readable = READABLE.has((d.fileType ?? "").split(";")[0] ?? "");
                  return (
                    <li key={d.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`doc-${d.id}`}
                        checked={picked.includes(d.id)}
                        disabled={!readable}
                        onCheckedChange={(on) =>
                          setPicked((prev) =>
                            on ? [...prev, d.id] : prev.filter((x) => x !== d.id),
                          )
                        }
                      />
                      <label
                        htmlFor={`doc-${d.id}`}
                        className={`text-2xs ${readable ? "" : "text-muted-foreground"}`}
                      >
                        {d.name}
                        {!readable && " — no text can be read from this type"}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button className="rounded-lg" disabled={!canRun} onClick={() => run("chosen")}>
            {kind === "analysis" ? (
              <ScanSearch className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <PenLine className="mr-1.5 h-3.5 w-3.5" />
            )}
            {kind === "analysis" ? "Analyse it" : kind === "brief" ? "Prepare it" : "Draft it"}
          </Button>
          <Button
            variant="outline"
            className="rounded-lg"
            disabled={activeCase === null || create.isPending}
            onClick={() => run("brief")}
          >
            <ScanSearch className="mr-1.5 h-3.5 w-3.5" />
            Analyse this matter
          </Button>
          <Link
            href="/chamber-knowledge"
            className="self-center text-2xs text-muted-foreground underline underline-offset-2"
          >
            Improve these drafts →
          </Link>
        </div>
      </div>

      {drafts.map((d: Draft) => (
        <DraftBody key={d.id} draft={d} onChanged={refresh} />
      ))}
    </div>
  );
}
