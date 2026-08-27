import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListInsights,
  useCreateInsight,
  useDeleteInsight,
  useListExemplars,
  useCreateExemplar,
  useUpdateExemplar,
  useDeleteExemplar,
  useListCourts,
  getListInsightsQueryKey,
  getListExemplarsQueryKey,
  getListCourtsQueryKey,
  type Insight,
  type Exemplar,
  type Court,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Lightbulb, FileText, Plus, Trash2, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { userMessage } from "@/lib/errors";

/**
 * What this chamber knows, and how it writes.
 *
 * Two things live here because they are the same idea from two directions: both
 * are the chamber's own accumulated judgement, and both are fed to the drafting
 * model rather than being read by a person. Splitting them across two screens
 * would make each look like an admin chore instead of what they are — the
 * reason drafting here is better than drafting anywhere else.
 *
 * **Insights** are what an advocate learned in court, typed in a sentence.
 * **Style examples** are past filings kept for their form.
 */

const KINDS = [
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
  appeal: "Appeal",
  application: "Application",
  reply: "Reply",
  notice: "Notice",
  letter: "Letter",
};

/* ── Insights ────────────────────────────────────────────────────────────── */

function InsightsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [courtId, setCourtId] = useState("none");

  const { data: insights = [] } = useListInsights(undefined, {
    query: { queryKey: getListInsightsQueryKey() },
  });
  const { data: courts = [] } = useListCourts({ query: { queryKey: getListCourtsQueryKey() } });
  const create = useCreateInsight();
  const remove = useDeleteInsight();

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListInsightsQueryKey() });

  const save = () => {
    create.mutate(
      {
        data: {
          title,
          body,
          tags,
          courtId: courtId === "none" ? null : Number(courtId),
        },
      },
      {
        onSuccess: () => {
          setTitle("");
          setBody("");
          setTags("");
          refresh();
          toast({ title: "Noted", description: "It will be used in future drafts." });
        },
        onError: (err: Error) =>
          toast({ title: "Not saved", description: userMessage(err), variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-4">
      {/* Deliberately the first thing on the screen and deliberately tiny. This
          only works if an advocate will actually type into it on the way out of
          court, which means one line and a Save button — a form with twelve
          fields is a form nobody fills in. */}
      <div className="rounded-lg bg-card p-4 shadow-sm">
        <p className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
          Something you learned
        </p>
        <Input
          className="mt-2 rounded-lg"
          placeholder="e.g. Lucknow registry returns an unstamped vakalatnama the same day"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Textarea
          className="mt-2 rounded-lg"
          rows={3}
          placeholder="The detail — when it applies, what to do about it. Optional."
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Input
            className="w-full rounded-lg sm:w-[220px]"
            placeholder="tags, comma separated"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
          <Select value={courtId} onValueChange={setCourtId}>
            <SelectTrigger className="w-full rounded-lg sm:w-[260px]">
              <SelectValue placeholder="Any forum" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Applies anywhere</SelectItem>
              {courts.map((c: Court) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.bench ? `${c.name} (${c.bench})` : c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            className="rounded-lg"
            disabled={title.trim().length < 3 || create.isPending}
            onClick={save}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Save
          </Button>
        </div>
      </div>

      {insights.length === 0 ? (
        <p className="rounded-lg bg-card p-4 text-sm leading-relaxed text-muted-foreground shadow-sm">
          Nothing recorded yet. These notes are what make a draft read like it came from this
          chamber rather than from a textbook — they are searched and fed to the model whenever a
          matter looks related.
        </p>
      ) : (
        <ul className="space-y-2">
          {insights.map((i: Insight) => (
            <li key={i.id} className="rounded-lg bg-card p-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{i.title}</p>
                  {i.body && (
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{i.body}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-3xs text-muted-foreground">
                    {i.courtName && (
                      <Badge variant="secondary" className="rounded-md text-3xs">
                        {i.courtName}
                      </Badge>
                    )}
                    {i.tags && <span className="font-mono uppercase tracking-wider">{i.tags}</span>}
                    <span>{i.authorName}</span>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Delete insight"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => remove.mutate({ id: i.id }, { onSuccess: refresh })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Style examples ──────────────────────────────────────────────────────── */

function ExemplarsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<string>("petition");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [redacted, setRedacted] = useState("");

  const { data: exemplars = [] } = useListExemplars({
    query: { queryKey: getListExemplarsQueryKey() },
  });
  const create = useCreateExemplar();
  const update = useUpdateExemplar();
  const remove = useDeleteExemplar();

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListExemplarsQueryKey() });

  const add = () => {
    create.mutate(
      { data: { kind: kind as Exemplar["kind"], title, text } },
      {
        onSuccess: (row) => {
          setTitle("");
          setText("");
          setEditing(row.id);
          setRedacted(row.body);
          refresh();
          toast({
            title: "Redacted — please check it",
            description: "It will not be used until you approve the redacted copy.",
          });
        },
        onError: (err: Error) =>
          toast({ title: "Not added", description: userMessage(err), variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-card p-4 shadow-sm">
        <p className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
          Add a past filing as an example
        </p>
        <p className="mt-1 max-w-3xl text-2xs leading-relaxed text-muted-foreground">
          Paste one of the chamber&rsquo;s own filings. Names, numbers and identifying facts are
          removed automatically — then you check the result before it is used. Examples are kept for
          their <em>structure and voice</em>, never their facts.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Input
            className="w-full rounded-lg sm:w-[280px]"
            placeholder="Label, e.g. the good writ from last year"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="w-full rounded-lg sm:w-[200px]">
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
        <Textarea
          className="mt-2 rounded-lg font-mono text-xs"
          rows={6}
          placeholder="Paste the filing here…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button
          className="mt-2 rounded-lg"
          disabled={title.trim().length < 3 || text.trim().length < 200 || create.isPending}
          onClick={add}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {create.isPending ? "Redacting…" : "Add and redact"}
        </Button>
      </div>

      <ul className="space-y-2">
        {exemplars.map((e: Exemplar) => (
          <li key={e.id} className="rounded-lg bg-card p-3 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{e.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-3xs">
                  <Badge variant="secondary" className="rounded-md text-3xs">
                    {KIND_LABEL[e.kind] ?? e.kind}
                  </Badge>
                  {/* The gate, stated on the row. An unapproved example is inert
                      — it reaches no prompt — and saying so is the difference
                      between a queue somebody clears and one they ignore. */}
                  {e.reviewedAt ? (
                    <span className="text-muted-foreground">
                      In use · checked by {e.reviewedBy}
                    </span>
                  ) : (
                    <span className="text-destructive">Not in use until you check it</span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg"
                  onClick={() => {
                    setEditing(editing === e.id ? null : e.id);
                    setRedacted(e.body);
                  }}
                >
                  {editing === e.id ? "Close" : "Check the redaction"}
                </Button>
                <button
                  type="button"
                  aria-label="Delete example"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => remove.mutate({ id: e.id }, { onSuccess: refresh })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {editing === e.id && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="mb-1 font-mono text-3xs uppercase tracking-wider text-muted-foreground">
                  The redacted copy — this is exactly what the model will be shown
                </p>
                <Textarea
                  className="rounded-lg font-mono text-xs"
                  rows={12}
                  value={redacted}
                  onChange={(ev) => setRedacted(ev.target.value)}
                />
                <div className="mt-2 flex gap-2">
                  <Button
                    className="rounded-lg"
                    onClick={() =>
                      update.mutate(
                        { id: e.id, data: { body: redacted, approve: true } },
                        {
                          onSuccess: () => {
                            setEditing(null);
                            refresh();
                            toast({
                              title: "Approved",
                              description: "It will be used from now on.",
                            });
                          },
                        },
                      )
                    }
                  >
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    Looks right — use it
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-lg"
                    onClick={() =>
                      update.mutate({ id: e.id, data: { body: redacted } }, { onSuccess: refresh })
                    }
                  >
                    Save corrections only
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ChamberKnowledgePage() {
  const [tab, setTab] = useState<"insights" | "examples">("insights");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-mono text-lg uppercase tracking-wider">Chamber knowledge</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          What your advocates have learned, and how this chamber writes. Both are used when a draft
          is prepared — nothing here is shared outside this chamber.
        </p>
      </div>

      <div className="flex gap-2">
        {(
          [
            ["insights", "Observations", Lightbulb],
            ["examples", "Style examples", FileText],
          ] as const
        ).map(([id, label, Icon]) => (
          <Button
            key={id}
            variant={tab === id ? "default" : "outline"}
            className="rounded-lg"
            onClick={() => setTab(id)}
          >
            <Icon className="mr-1.5 h-3.5 w-3.5" />
            {label}
          </Button>
        ))}
      </div>

      {tab === "insights" ? <InsightsTab /> : <ExemplarsTab />}
    </div>
  );
}
