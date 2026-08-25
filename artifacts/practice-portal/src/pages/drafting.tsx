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

/**
 * Draft a document, or have the matter reviewed before it is filed.
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
 */

const DRAFT_KINDS = [
  "petition",
  "written_statement",
  "appeal",
  "application",
  "reply",
  "notice",
  "letter",
] as const;

const KIND_LABEL: Record<string, string> = {
  petition: "Petition",
  written_statement: "Written statement",
  appeal: "Memorandum of appeal",
  application: "Application",
  reply: "Reply / counter-affidavit",
  notice: "Legal notice",
  letter: "Letter",
  review: "Review",
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
          <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-[var(--radius)] bg-muted/30 p-3 text-xs leading-relaxed">
            {draft.body}
          </pre>
        )
      )}
    </div>
  );
}

export default function DraftingPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, params] = useRoute("/drafting/:caseId");

  const { data: cases = [] } = useListCases(undefined, {
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

  const run = (which: "draft" | "review") => {
    if (activeCase === null) return;
    create.mutate(
      {
        id: activeCase,
        data: {
          kind: which === "review" ? "review" : (kind as Draft["kind"]),
          instruction:
            instruction.trim() || (which === "review" ? "Review this matter before we file." : ""),
          documentIds: picked,
        },
      },
      {
        onSuccess: () => {
          refresh();
          toast({
            title: which === "review" ? "Reviewing" : "Drafting",
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-lg uppercase tracking-wider">Drafting</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Prepare a first draft from this chamber&rsquo;s own records, or have a matter reviewed
            for defects and merits before it is filed. Everything produced here is a starting point
            for an advocate to correct and sign.
          </p>
        </div>
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
              Document
            </label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="w-[240px] rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DRAFT_KINDS.map((k) => (
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
          <Button className="rounded-lg" disabled={!canRun} onClick={() => run("draft")}>
            <PenLine className="mr-1.5 h-3.5 w-3.5" />
            Draft it
          </Button>
          <Button
            variant="outline"
            className="rounded-lg"
            disabled={activeCase === null || create.isPending}
            onClick={() => run("review")}
          >
            <ScanSearch className="mr-1.5 h-3.5 w-3.5" />
            Find defects &amp; merits
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
