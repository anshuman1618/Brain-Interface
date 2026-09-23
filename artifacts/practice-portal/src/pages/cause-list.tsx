import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCauseListProposals,
  useDecideCauseListProposal,
  useListCauseListRuns,
  useTriggerCauseListSync,
  useListCourts,
  getListCauseListProposalsQueryKey,
  getListCauseListRunsQueryKey,
  getListCalendarEntriesQueryKey,
  getListCourtsQueryKey,
  type CauseListProposal,
  type CauseListSyncRun,
  type Court,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Gavel, Check, X, CalendarCheck, ChevronDown, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { userMessage } from "@/lib/errors";
import { useSession } from "@/lib/session";

/**
 * Listings a court published that appear to be this chamber's matters.
 *
 * The one screen that decides whether this feature is worth having. A
 * proposal is not a hearing — nothing here has touched the calendar — so the
 * job of this page is to give somebody enough to say yes or no in a couple of
 * seconds, and to make the raw listing available for the times when a couple
 * of seconds is not enough.
 *
 * `Accept` is gated on `calendar.write` (Admin and Senior Advocate), the same
 * boundary as posting any other calendar entry. A clerk holding
 * `calendar.read` sees the queue — they keep the diary and need to know what
 * is coming — but cannot commit it.
 */

const TAB_LABEL: Record<string, string> = {
  pending: "Awaiting a decision",
  accepted: "Accepted",
  dismissed: "Dismissed",
};

function ListingDetail({ p }: { p: CauseListProposal }) {
  const facts = [
    p.courtNo ? ["Court", p.courtNo] : null,
    p.itemNo ? ["Item", p.itemNo] : null,
    p.purpose ? ["Purpose", p.purpose] : null,
    p.coram ? ["Coram", p.coram] : null,
    p.parties ? ["Parties", p.parties] : null,
  ].filter(Boolean) as [string, string][];

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-mono uppercase tracking-wider text-muted-foreground">{k}</dt>
            <dd className="text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
      {/* The listing exactly as published. This is what somebody reads at 9pm
          when deciding whether to trust the parsed date above it. */}
      {p.rawText && (
        <div>
          <p className="mb-1 font-mono text-3xs uppercase tracking-wider text-muted-foreground">
            As published
          </p>
          <pre className="overflow-x-auto rounded-[var(--radius)] bg-muted/40 p-2 text-2xs text-muted-foreground">
            {p.rawText}
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * Whether the reading is actually happening.
 *
 * A scraper's real failure is going quiet: a court redesigns its page, the
 * adapter returns nothing, and the queue stays empty in a way that looks
 * exactly like a week with no listings. The run table is the difference, so it
 * is on the screen rather than only in the database — and only for whoever
 * holds `audit.read`, since it is operational detail, not case work.
 *
 * The manual check exists because the schedule is off unless CAUSE_LIST_SYNC
 * is set. Without it an admin on a default deployment sees an empty queue
 * forever with nothing to press and no explanation.
 */
function SyncHealth() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: runs = [] } = useListCauseListRuns({
    query: { queryKey: getListCauseListRunsQueryKey() },
  });
  const { data: courts = [] } = useListCourts({ query: { queryKey: getListCourtsQueryKey() } });
  const sync = useTriggerCauseListSync();

  const syncable = courts.filter((c: Court) => c.syncable);
  const [courtCode, setCourtCode] = useState("");
  const [listDate, setListDate] = useState(today);
  const chosen = courtCode || syncable[0]?.code || "";

  const run = () => {
    sync.mutate(
      { data: { courtCode: chosen, listDate } },
      {
        onSuccess: (r) => {
          queryClient.invalidateQueries({ queryKey: getListCauseListRunsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListCauseListProposalsQueryKey() });
          toast({
            title:
              r.status === "ok"
                ? `Read ${r.fetched} listings, ${r.proposed} matched`
                : r.status === "skipped"
                  ? "No reader for that court yet"
                  : "The court's list could not be read",
            description: r.error ?? undefined,
            variant: r.status === "failed" ? "destructive" : undefined,
          });
        },
        onError: (err: Error) =>
          toast({
            title: "Could not check",
            description: userMessage(err),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <div className="rounded-lg bg-card p-4 shadow-sm">
      <p className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
        Reading the courts
      </p>

      {syncable.length === 0 ? (
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          No court on this deployment has a reader yet. Matters can carry their court identity now,
          and listings will be proposed from the day one lands.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <label
              htmlFor="sync-court"
              className="font-mono text-3xs uppercase tracking-wider text-muted-foreground"
            >
              Court
            </label>
            <Select value={chosen} onValueChange={setCourtCode}>
              <SelectTrigger id="sync-court" className="w-full sm:w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {syncable.map((c: Court) => (
                  <SelectItem key={c.id} value={c.code}>
                    {c.bench ? `${c.name} (${c.bench})` : c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <label
              htmlFor="sync-date"
              className="font-mono text-3xs uppercase tracking-wider text-muted-foreground"
            >
              List for
            </label>
            <Input
              id="sync-date"
              type="date"
              className="w-full sm:w-[170px]"
              value={listDate}
              onChange={(e) => setListDate(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            className="rounded-lg"
            disabled={sync.isPending || !chosen}
            onClick={run}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${sync.isPending ? "animate-spin" : ""}`} />
            Check now
          </Button>
        </div>
      )}

      {runs.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-border pt-3">
          {runs.slice(0, 6).map((r: CauseListSyncRun) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 text-2xs">
              <span
                className={`font-mono uppercase tracking-wider ${
                  r.status === "ok"
                    ? "text-muted-foreground"
                    : r.status === "failed"
                      ? "text-destructive"
                      : "text-muted-foreground"
                }`}
              >
                {r.status}
              </span>
              <span className="font-medium">{r.courtName}</span>
              <span className="text-muted-foreground">list of {r.listDate}</span>
              <span className="text-muted-foreground">
                {r.fetched} read · {r.proposed} matched
              </span>
              {r.error && <span className="text-destructive">{r.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CauseListPage() {
  const { can, activeWorkspace } = useSession();
  const [status, setStatus] = useState<"pending" | "accepted" | "dismissed">("pending");
  const [expanded, setExpanded] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const canDecide = can("calendar.write");

  const { data: proposals = [], isLoading } = useListCauseListProposals(
    { status },
    { query: { queryKey: getListCauseListProposalsQueryKey({ status }) } },
  );
  const decide = useDecideCauseListProposal();

  const act = (p: CauseListProposal, decision: "accept" | "dismiss") => {
    decide.mutate(
      { id: p.id, data: { decision } },
      {
        onSuccess: () => {
          // Both lists move: the proposal leaves this tab, and accepting has
          // put a hearing on the calendar that a stale cache would hide.
          queryClient.invalidateQueries({ queryKey: getListCauseListProposalsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListCalendarEntriesQueryKey() });
          toast({
            title: decision === "accept" ? "Added to the calendar" : "Dismissed",
            description:
              decision === "accept"
                ? `${p.caseRef} on ${p.listDate}.`
                : "It will not be proposed again.",
          });
        },
        onError: (err: Error) => {
          toast({
            title: "Could not record that",
            description: userMessage(err, "Try again."),
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="mb-1 text-3xl font-bold tracking-tight">Court Listings</h2>
        <p className="text-muted-foreground">
          Matters of <span className="font-medium text-foreground">{activeWorkspace?.name}</span>{" "}
          that appear on a published cause list. Nothing here is on your calendar until you accept
          it.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by decision">
        {(["pending", "accepted", "dismissed"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            className={`rounded-[var(--radius)] px-3 py-1.5 font-mono text-2xs uppercase tracking-widest transition-colors ${
              status === s
                ? "bg-foreground text-background"
                : "bg-card text-muted-foreground shadow-sm hover:text-foreground"
            }`}
          >
            {TAB_LABEL[s]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : proposals.length === 0 ? (
        <div className="rounded-lg bg-card p-10 text-center shadow-sm">
          <Gavel className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium">
            {status === "pending" ? "Nothing awaiting a decision" : `No ${status} listings`}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
            {status === "pending"
              ? "A matter is only matched when it carries a court, case type, number and year — set those on the matter to have its listings appear here."
              : "Listings you decide on are kept here as a record."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map((p: CauseListProposal) => {
            const open = expanded === p.id;
            return (
              <div key={p.id} className="rounded-lg bg-card p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-foreground">
                        {p.caseRef}
                      </span>
                      <Badge
                        variant="outline"
                        className="rounded-[var(--radius)] font-mono text-3xs uppercase tracking-wider"
                      >
                        {p.listDate}
                      </Badge>
                      {p.status === "accepted" && (
                        <Badge className="rounded-[var(--radius)] font-mono text-3xs uppercase tracking-wider">
                          <CalendarCheck className="mr-1 h-3 w-3" />
                          On the calendar
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 truncate text-sm font-medium">{p.caseTitle}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.courtName}
                      {p.courtNo ? ` · Court No. ${p.courtNo}` : ""}
                      {p.itemNo ? ` · Item ${p.itemNo}` : ""}
                    </p>
                    {p.decidedBy && (
                      <p className="mt-1 text-3xs font-mono uppercase tracking-wider text-muted-foreground">
                        {p.status} by {p.decidedBy}
                      </p>
                    )}
                  </div>

                  {p.status === "pending" && canDecide && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        className="rounded-lg"
                        disabled={decide.isPending}
                        onClick={() => act(p, "accept")}
                      >
                        <Check className="mr-1.5 h-3.5 w-3.5" />
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-lg"
                        disabled={decide.isPending}
                        onClick={() => act(p, "dismiss")}
                      >
                        <X className="mr-1.5 h-3.5 w-3.5" />
                        Not ours
                      </Button>
                    </div>
                  )}
                  {p.status === "pending" && !canDecide && (
                    <p className="shrink-0 text-2xs text-muted-foreground">
                      An advocate or admin decides these.
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : p.id)}
                  aria-expanded={open}
                  className="mt-2 flex items-center gap-1 font-mono text-3xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
                  />
                  {open ? "Hide the listing" : "See the listing as published"}
                </button>

                {open && <ListingDetail p={p} />}
              </div>
            );
          })}
        </div>
      )}

      {can("audit.read") && <SyncHealth />}
    </div>
  );
}
