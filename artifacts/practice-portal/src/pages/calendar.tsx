import { useMemo, useState } from "react";
import {
  useListCalendarEntries,
  useCreateCalendarEntry,
  useDeleteCalendarEntry,
  useListTasks,
  useListConsultations,
  useListCases,
  getListCalendarEntriesQueryKey,
  getListTasksQueryKey,
  getListConsultationsQueryKey,
  getListCasesQueryKey,
  type CalendarEntry,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarDays, Plus, Gavel, FileText, Users, StickyNote, Trash2, Clock, CheckSquare, PhoneCall,
} from "lucide-react";
import { Link } from "wouter";

type Row = {
  key: string;
  date: string;
  time: string | null;
  title: string;
  detail: string | null;
  source: "update" | "task" | "consultation";
  kind: string;
  audienceLabel: string | null;
  caseId: number | null;
  entryId?: number;
};

const KIND_ICON: Record<string, typeof Gavel> = {
  hearing: Gavel,
  filing: FileText,
  meeting: Users,
  note: StickyNote,
  task: CheckSquare,
  consultation: PhoneCall,
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/**
 * The master calendar.
 *
 * One calendar, every portal — but each portal sees a different calendar,
 * because all three sources are already scoped to the caller server-side:
 * updates by audience, tasks by assignment, consultations by matter. A clerk's
 * calendar shows their own deadlines; a client's shows their own hearings; an
 * admin's shows the chamber's.
 *
 * Posting an update is `calendar.write` — Admin and Senior Advocate only, the
 * same pair that may assign work.
 */
export default function CalendarPage() {
  const { can, activeWorkspace, displayRole } = useSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: entries = [], isLoading: entriesLoading } = useListCalendarEntries({
    query: { queryKey: getListCalendarEntriesQueryKey() },
  });
  const { data: tasks = [] } = useListTasks(undefined, { query: { queryKey: getListTasksQueryKey() } });
  const { data: consultations = [] } = useListConsultations(undefined, {
    query: { queryKey: getListConsultationsQueryKey() },
  });
  const { data: cases = [] } = useListCases(undefined, {
    query: { queryKey: getListCasesQueryKey(), enabled: can("calendar.write") },
  });

  const createEntry = useCreateCalendarEntry();
  const deleteEntry = useDeleteCalendarEntry();

  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [kind, setKind] = useState("hearing");
  const [entryDate, setEntryDate] = useState(today());
  const [entryTime, setEntryTime] = useState("");
  const [audience, setAudience] = useState("all");
  const [caseId, setCaseId] = useState("none");

  const canPost = can("calendar.write");

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];

    for (const e of entries) {
      out.push({
        key: `entry-${e.id}`,
        date: e.entryDate,
        time: e.entryTime ?? null,
        title: e.title,
        detail: e.notes ?? e.caseTitle ?? null,
        source: "update",
        kind: e.kind,
        audienceLabel: e.audienceLabel ?? null,
        caseId: e.caseId ?? null,
        entryId: e.id,
      });
    }

    for (const t of tasks) {
      if (t.status === "completed") continue;
      out.push({
        key: `task-${t.id}`,
        date: String(t.deadline).slice(0, 10),
        time: null,
        title: t.title,
        detail: t.assigneeName ? `Assigned to ${t.assigneeName}` : "Unassigned",
        source: "task",
        kind: "task",
        audienceLabel: null,
        caseId: t.caseId,
      });
    }

    for (const c of consultations) {
      if (!c.scheduledAt) continue;
      const when = new Date(c.scheduledAt);
      out.push({
        key: `consult-${c.id}`,
        date: when.toISOString().slice(0, 10),
        time: when.toISOString().slice(11, 16),
        title: c.title,
        detail: "Consultation",
        source: "consultation",
        kind: "consultation",
        audienceLabel: null,
        caseId: c.caseId,
      });
    }

    return out.sort((a, b) => (a.date === b.date ? (a.time ?? "").localeCompare(b.time ?? "") : a.date.localeCompare(b.date)));
  }, [entries, tasks, consultations]);

  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const list = map.get(r.date) ?? [];
      list.push(r);
      map.set(r.date, list);
    }
    return [...map.entries()];
  }, [rows]);

  const reset = () => {
    setTitle("");
    setNotes("");
    setKind("hearing");
    setEntryDate(today());
    setEntryTime("");
    setAudience("all");
    setCaseId("none");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !entryDate) return;

    createEntry.mutate(
      {
        data: {
          title: title.trim(),
          notes: notes.trim() || undefined,
          kind: kind as never,
          entryDate,
          entryTime: entryTime || undefined,
          audience,
          caseId: caseId !== "none" ? Number(caseId) : undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCalendarEntriesQueryKey() });
          toast({ title: "Update posted", description: "It appears on the calendar of everyone it's addressed to." });
          reset();
          setIsOpen(false);
        },
        onError: (err: unknown) => {
          toast({
            title: "Couldn't post the update",
            description: err instanceof Error ? err.message : undefined,
            variant: "destructive",
          });
        },
      },
    );
  };

  const remove = (entry: Row) => {
    if (!entry.entryId) return;
    deleteEntry.mutate(
      { id: entry.entryId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCalendarEntriesQueryKey() });
          toast({ title: "Update removed" });
        },
        onError: () => toast({ title: "Couldn't remove that update", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-1">Master Calendar</h2>
          <p className="text-muted-foreground">
            {activeWorkspace?.name} · hearings, filings, deadlines and consultations you're party to
            {displayRole ? ` as ${displayRole}` : ""}.
          </p>
        </div>
        {canPost && (
          <Button className="rounded-none shrink-0" onClick={() => setIsOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Post update
          </Button>
        )}
      </div>

      {entriesLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : grouped.length === 0 ? (
        <div className="border border-border bg-background p-16 text-center">
          <CalendarDays className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <p className="text-lg font-medium mb-1">Nothing on the calendar yet</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {canPost
              ? "Hearings, filings and deadlines appear here as you add them. Task deadlines and scheduled consultations arrive automatically."
              : "Hearings and deadlines posted by your chamber will appear here, along with anything assigned to you."}
          </p>
          {canPost && (
            <Button variant="outline" className="rounded-none mt-6" onClick={() => setIsOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Post the first update
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([date, items]) => {
            const isToday = date === today();
            const isPast = date < today();
            return (
              <div key={date} className="border border-border bg-background">
                <div
                  className={`px-6 py-3 border-b border-border flex items-center gap-3 ${
                    isToday ? "bg-primary/10" : "bg-muted/30"
                  }`}
                >
                  <span className="font-mono text-xs uppercase tracking-widest font-bold">
                    {formatDay(date)}
                  </span>
                  {isToday && (
                    <Badge className="rounded-none text-[10px] uppercase font-mono tracking-wider">Today</Badge>
                  )}
                  {isPast && (
                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      Past
                    </span>
                  )}
                  <span className="ml-auto text-xs font-mono text-muted-foreground">
                    {items.length} {items.length === 1 ? "item" : "items"}
                  </span>
                </div>

                <div className="divide-y divide-border">
                  {items.map((row) => {
                    const Icon = KIND_ICON[row.kind] ?? StickyNote;
                    return (
                      <div key={row.key} className="px-6 py-4 flex items-start gap-4">
                        <div className="h-8 w-8 border border-border flex items-center justify-center shrink-0 mt-0.5">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-sm">{row.title}</span>
                            <Badge
                              variant="outline"
                              className="rounded-none text-[9px] uppercase font-mono tracking-wider px-1 py-0"
                            >
                              {row.kind}
                            </Badge>
                            {row.audienceLabel && row.audienceLabel !== "Everyone" && (
                              <Badge
                                variant="outline"
                                className="rounded-none text-[9px] uppercase font-mono tracking-wider px-1 py-0"
                              >
                                {row.audienceLabel}
                              </Badge>
                            )}
                          </div>
                          {row.detail && (
                            <p className="text-xs text-muted-foreground mt-1 truncate">{row.detail}</p>
                          )}
                        </div>

                        {row.time && (
                          <span className="text-xs font-mono text-muted-foreground flex items-center gap-1 shrink-0">
                            <Clock className="h-3 w-3" /> {row.time}
                          </span>
                        )}

                        {row.caseId && (
                          <Link
                            href={`/cases/${row.caseId}`}
                            className="text-xs font-mono border border-border px-2 py-1 hover:bg-accent transition-colors shrink-0"
                          >
                            CASE-{row.caseId}
                          </Link>
                        )}

                        {canPost && row.source === "update" && (
                          <button
                            type="button"
                            onClick={() => remove(row)}
                            disabled={deleteEntry.isPending}
                            title="Remove update"
                            className="p-1.5 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[480px] rounded-none border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-widest">Post calendar update</DialogTitle>
            <DialogDescription className="font-mono text-xs uppercase tracking-wider">
              Appears on the calendar of everyone it is addressed to
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4 pt-2">
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                What is it? *
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="rounded-none font-mono text-sm bg-background"
                placeholder="e.g. Listing before Bench II"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">Type</label>
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger className="rounded-none bg-background font-mono text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent className="rounded-none">
                    <SelectItem value="hearing">Hearing</SelectItem>
                    <SelectItem value="filing">Filing</SelectItem>
                    <SelectItem value="meeting">Meeting</SelectItem>
                    <SelectItem value="note">Note</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">Date *</label>
                <Input
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className="rounded-none font-mono text-sm bg-background"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">Time</label>
                <Input
                  type="time"
                  value={entryTime}
                  onChange={(e) => setEntryTime(e.target.value)}
                  className="rounded-none font-mono text-sm bg-background"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                  Who sees it
                </label>
                <Select value={audience} onValueChange={setAudience}>
                  <SelectTrigger className="rounded-none bg-background font-mono text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent className="rounded-none">
                    <SelectItem value="all">Everyone</SelectItem>
                    <SelectItem value="staff">Chamber staff only</SelectItem>
                    <SelectItem value="role:senior_advocate">Senior Advocates</SelectItem>
                    <SelectItem value="role:junior_advocate">Junior Advocates</SelectItem>
                    <SelectItem value="role:clerk_intern">Clerks / Interns</SelectItem>
                    <SelectItem value="role:client">Clients</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {cases.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                  Related matter
                </label>
                <Select value={caseId} onValueChange={setCaseId}>
                  <SelectTrigger className="rounded-none bg-background font-mono text-sm">
                    <SelectValue placeholder="OPTIONAL" />
                  </SelectTrigger>
                  <SelectContent className="rounded-none">
                    <SelectItem value="none" className="italic text-muted-foreground">None</SelectItem>
                    {cases.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)} className="font-mono text-sm">
                        {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                Notes (optional)
              </label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="rounded-none font-mono text-sm bg-background resize-none h-20"
                placeholder="Anything the chamber needs to know..."
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" className="rounded-none" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="rounded-none font-mono uppercase tracking-wider"
                disabled={createEntry.isPending || !title.trim() || !entryDate}
              >
                {createEntry.isPending ? "Posting..." : "Post update"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
