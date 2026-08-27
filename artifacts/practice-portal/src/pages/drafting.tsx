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
  ApiError,
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
  brief: "Case brief",
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
            <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-[var(--radius)] bg-muted/30 p-3 text-xs leading-relaxed">
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

  const run = (which: "draft" | "brief") => {
    if (activeCase === null) return;
    create.mutate(
      {
        id: activeCase,
        data: {
          kind: which === "brief" ? "brief" : (kind as Draft["kind"]),
          instruction:
            instruction.trim() ||
            (which === "brief" ? "Prepare a brief on this matter before the hearing." : ""),
          documentIds: picked,
        },
      },
      {
        onSuccess: () => {
          refresh();
          toast({
            title: which === "brief" ? "Preparing the brief" : "Drafting",
            description: "It will appear below as it is written.",
          });
        },
        onError: (err: Error) => {
          // The POST is held open for the whole model call, which on a phone is
          // the request most likely to be lost: backgrounding the app suspends
          // the webview's network task, and a wifi-to-cellular handoff drops it
          // outright. The server is unaffected — `runDraft` writes the row
          // before it calls the model and sets `ready` or `failed` itself — so a
          // dropped connection means the draft is very probably still coming.
          //
          // Saying "could not start" there would be false, and worse: the reader
          // runs it again and the chamber pays for the same draft twice. An
          // ApiError carries a status, so it IS the server refusing; anything
          // else is the connection, and the list is what knows the truth.
          const refused = err instanceof ApiError;
          refresh();
          toast(
            refused
              ? {
                  title: "Could not start",
                  description: userMessage(err),
                  variant: "destructive",
                }
              : {
                  title: "Lost the connection",
                  description:
                    "The draft may still be running — it will appear below when it lands. Check before asking for it again.",
                },
          );
        },
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
            Prepare a first draft from this chamber&rsquo;s own records, or ask for a brief on the
            matter before it is filed — the facts on the record, the chronology, the merits, how the
            other side will run it, the objections to anticipate and the defects to cure.
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
        {/* Each control is full-width on a phone and its designed width from
            `sm` up. `flex-wrap` alone is not enough: a 320px trigger inside a
            padded card inside a 360px viewport overflows the page before it
            has anything to wrap onto. */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid w-full gap-1 sm:w-auto">
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
              <SelectTrigger className="w-full rounded-lg sm:w-[320px]">
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
          <div className="grid w-full gap-1 sm:w-auto">
            <label className="font-mono text-3xs uppercase tracking-wider text-muted-foreground">
              Document
            </label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="w-full rounded-lg sm:w-[240px]">
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
            onClick={() => run("brief")}
          >
            <ScanSearch className="mr-1.5 h-3.5 w-3.5" />
            Brief me on this matter
          </Button>
          <Link
            href="/chamber-knowledge"
            // `self-center` collapsed this to the height of its own text —
            // about 14px, next to two 36px buttons. Sized rather than padded so
            // it keeps sitting on the buttons' baseline row.
            className="flex min-h-9 items-center text-2xs text-muted-foreground underline underline-offset-2"
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
