import { useCallback, useMemo, useState } from "react";
import {
  useListCalendarEntries,
  useCreateCalendarEntry,
  useUpdateCalendarEntry,
  useDeleteCalendarEntry,
  useListTasks,
  useUpdateTask,
  useListCases,
  getListCalendarEntriesQueryKey,
  getListTasksQueryKey,
  getListCasesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Calendar, dateFnsLocalizer, type View } from "react-big-calendar";
import withDragAndDrop from "react-big-calendar/lib/addons/dragAndDrop";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";
import "@/styles/calendar.css";

import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { CalendarSkeleton } from "@/components/module-skeleton";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Plus, Trash2, CalendarDays } from "lucide-react";

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: { "en-US": enUS },
});

const DnDCalendar = withDragAndDrop(Calendar);

type Source = "entry" | "task";

type CauseEvent = {
  id: string;
  source: Source;
  refId: number;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  kind: string;
  audience: string;
  notes: string | null;
  caseId: number | null;
  /** Task deadlines can be dragged only by someone who may reschedule work. */
  draggable: boolean;
};

function dateOnly(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function timeOnly(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function combine(date: string, time: string | null | undefined): Date {
  return new Date(`${date}T${time && /^\d{2}:\d{2}/.test(time) ? time : "09:00"}:00`);
}

const KIND_COLOUR: Record<string, string> = {
  hearing: "rbc-kind-hearing",
  filing: "rbc-kind-filing",
  meeting: "rbc-kind-meeting",
  note: "rbc-kind-note",
  task: "rbc-kind-task",
};

/**
 * The master calendar — an interactive month/week/day grid.
 *
 * Two kinds of thing share it, and they behave differently on purpose:
 *  • Chamber updates (hearings, filings, meetings, notes) are full CRUD for
 *    anyone with `calendar.write`.
 *  • Task deadlines are drawn in for context. Dragging one reschedules the task
 *    itself, which is why it needs `tasks.write` rather than `calendar.write`.
 *
 * Both sources arrive already scoped by the API: updates by audience, tasks by
 * assignment. Nothing here filters for privacy; it only draws what it was given.
 */
export default function CalendarPage() {
  const { can, activeWorkspace, displayRole } = useSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    data: entries = [],
    isLoading: entriesLoading,
    isError,
    error,
  } = useListCalendarEntries({
    query: { queryKey: getListCalendarEntriesQueryKey() },
  });
  const { data: tasks = [], isLoading: tasksLoading } = useListTasks(undefined, {
    query: { queryKey: getListTasksQueryKey(), enabled: can("tasks.read") },
  });
  const { data: cases = [] } = useListCases(undefined, {
    query: { queryKey: getListCasesQueryKey(), enabled: can("calendar.write") },
  });

  const createEntry = useCreateCalendarEntry();
  const updateEntry = useUpdateCalendarEntry();
  const deleteEntry = useDeleteCalendarEntry();
  const updateTask = useUpdateTask();

  const canWrite = can("calendar.write");
  const canReschedule = can("tasks.write");

  /**
   * A month grid needs roughly seven readable columns. At 360px each would be
   * 45px wide, which fits a date number and nothing else — so a hearing on a
   * phone becomes an unlabelled dot. The agenda is the same data as a list, and
   * is what a phone can actually show.
   *
   * `useIsMobile` is the app's existing 768px probe. Only the INITIAL view is
   * chosen from it: once somebody switches view deliberately, rotating the
   * device must not throw their choice away.
   */
  const isMobile = useIsMobile();
  const [view, setView] = useState<View>(() => (isMobile ? "agenda" : "month"));
  const [date, setDate] = useState(new Date());
  const [editing, setEditing] = useState<CauseEvent | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const [form, setForm] = useState({
    title: "",
    notes: "",
    kind: "hearing",
    entryDate: dateOnly(new Date()),
    entryTime: "",
    audience: "all",
    caseId: "none",
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListCalendarEntriesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
  };

  const events = useMemo<CauseEvent[]>(() => {
    const out: CauseEvent[] = [];

    for (const e of entries) {
      const start = combine(e.entryDate, e.entryTime);
      out.push({
        id: `entry-${e.id}`,
        source: "entry",
        refId: e.id,
        title: e.title,
        start,
        end: new Date(start.getTime() + 60 * 60 * 1000),
        allDay: !e.entryTime,
        kind: e.kind,
        audience: e.audience,
        notes: e.notes ?? null,
        caseId: e.caseId ?? null,
        draggable: canWrite,
      });
    }

    for (const t of tasks) {
      if (t.status === "completed") continue;
      const start = combine(String(t.deadline).slice(0, 10), null);
      out.push({
        id: `task-${t.id}`,
        source: "task",
        refId: t.id,
        title: `${t.title}${t.assigneeName ? ` · ${t.assigneeName}` : ""}`,
        start,
        end: new Date(start.getTime() + 60 * 60 * 1000),
        allDay: true,
        kind: "task",
        audience: "all",
        notes: null,
        caseId: t.caseId,
        draggable: canReschedule,
      });
    }

    return out;
  }, [entries, tasks, canWrite, canReschedule]);

  /** Drag or resize. Chamber updates move themselves; a task moves its deadline. */
  const move = useCallback(
    ({ event, start }: { event: object; start: Date | string }) => {
      const ev = event as CauseEvent;
      const when = start instanceof Date ? start : new Date(start);

      if (ev.source === "task") {
        if (!canReschedule) {
          toast({
            title: "Only Admin and Senior Advocate can reschedule work",
            variant: "destructive",
          });
          return;
        }
        updateTask.mutate(
          { id: ev.refId, data: { deadline: dateOnly(when) } },
          {
            onSuccess: () => {
              refresh();
              toast({ title: "Deadline moved", description: format(when, "d MMM yyyy") });
            },
            onError: () => toast({ title: "Couldn't move that deadline", variant: "destructive" }),
          },
        );
        return;
      }

      if (!canWrite) {
        toast({
          title: "Only Admin and Senior Advocate can edit the calendar",
          variant: "destructive",
        });
        return;
      }
      updateEntry.mutate(
        {
          id: ev.refId,
          data: { entryDate: dateOnly(when), entryTime: ev.allDay ? undefined : timeOnly(when) },
        },
        {
          onSuccess: () => {
            refresh();
            toast({ title: "Moved", description: format(when, "d MMM yyyy") });
          },
          onError: () => toast({ title: "Couldn't move that entry", variant: "destructive" }),
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canReschedule, canWrite, updateTask, updateEntry],
  );

  const openNew = (slotDate?: Date) => {
    setEditing(null);
    setForm({
      title: "",
      notes: "",
      kind: "hearing",
      entryDate: dateOnly(slotDate ?? new Date()),
      entryTime: "",
      audience: "all",
      caseId: "none",
    });
    setIsOpen(true);
  };

  const openExisting = (ev: CauseEvent) => {
    if (ev.source === "task" || !canWrite) return;
    setEditing(ev);
    setForm({
      title: ev.title,
      notes: ev.notes ?? "",
      kind: ev.kind,
      entryDate: dateOnly(ev.start),
      entryTime: ev.allDay ? "" : timeOnly(ev.start),
      audience: ev.audience,
      caseId: ev.caseId ? String(ev.caseId) : "none",
    });
    setIsOpen(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.entryDate) return;

    const payload = {
      title: form.title.trim(),
      notes: form.notes.trim() || undefined,
      kind: form.kind as never,
      entryDate: form.entryDate,
      entryTime: form.entryTime || undefined,
      audience: form.audience,
      caseId: form.caseId !== "none" ? Number(form.caseId) : undefined,
    };

    const done = (msg: string) => () => {
      refresh();
      toast({ title: msg });
      setIsOpen(false);
    };
    const failed = () => toast({ title: "Couldn't save that entry", variant: "destructive" });

    if (editing)
      updateEntry.mutate(
        { id: editing.refId, data: payload },
        { onSuccess: done("Entry updated"), onError: failed },
      );
    else createEntry.mutate({ data: payload }, { onSuccess: done("Entry added"), onError: failed });
  };

  const remove = () => {
    if (!editing) return;
    deleteEntry.mutate(
      { id: editing.refId },
      {
        onSuccess: () => {
          refresh();
          toast({ title: "Entry removed" });
          setIsOpen(false);
        },
        onError: () => toast({ title: "Couldn't remove that entry", variant: "destructive" }),
      },
    );
  };

  if (entriesLoading || tasksLoading) return <CalendarSkeleton />;

  if (isError) {
    return (
      <div className="border border-destructive/40 bg-destructive/5 p-10 text-center">
        <CalendarDays className="h-8 w-8 text-destructive mx-auto mb-3" />
        <p className="font-medium mb-1">Couldn't load the calendar</p>
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "The request failed."}
        </p>
        <Button variant="outline" className="rounded-lg mt-5" onClick={refresh}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-1">Master Calendar</h2>
          <p className="text-muted-foreground">
            {activeWorkspace?.name} · cause list, filings and deadlines you're party to
            {displayRole ? ` as ${displayRole}` : ""}.
            {canWrite ? " Drag an item to reschedule it." : ""}
          </p>
        </div>
        {canWrite && (
          <Button className="rounded-lg shrink-0" onClick={() => openNew()}>
            <Plus className="mr-2 h-4 w-4" /> Add to cause list
          </Button>
        )}
      </div>

      <div className="rounded-lg bg-card shadow-sm p-4">
        <DnDCalendar
          localizer={localizer}
          events={events}
          view={view}
          onView={(v) => setView(v)}
          date={date}
          onNavigate={(d) => setDate(d)}
          views={["month", "week", "day", "agenda"]}
          popup
          style={{ height: isMobile ? 520 : 620 }}
          selectable={canWrite}
          onSelectSlot={(slot: { start: Date }) => canWrite && openNew(slot.start)}
          onSelectEvent={(ev: object) => openExisting(ev as CauseEvent)}
          onEventDrop={move}
          onEventResize={move}
          draggableAccessor={(ev: object) => (ev as CauseEvent).draggable}
          resizableAccessor={() => false}
          eventPropGetter={(ev: object) => ({
            className: KIND_COLOUR[(ev as CauseEvent).kind] ?? KIND_COLOUR.note,
          })}
          messages={{ noEventsInRange: "Nothing scheduled in this range." }}
        />
      </div>

      {events.length === 0 && (
        <div className="rounded-lg bg-card shadow-sm p-10 text-center">
          <CalendarDays className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium mb-1">Nothing on the calendar yet</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {canWrite
              ? "Add hearings and filings to the cause list. Task deadlines appear here automatically as work is assigned."
              : "Listings posted by your chamber will appear here, along with anything assigned to you."}
          </p>
        </div>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[480px] rounded-lg border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-widest">
              {editing ? "Edit entry" : "Add to cause list"}
            </DialogTitle>
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
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="rounded-lg font-mono text-sm bg-background"
                placeholder="e.g. Listing before Bench II"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                  Type
                </label>
                <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                  <SelectTrigger className="rounded-lg bg-background font-mono text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg">
                    <SelectItem value="hearing">Hearing</SelectItem>
                    <SelectItem value="filing">Filing</SelectItem>
                    <SelectItem value="meeting">Meeting</SelectItem>
                    <SelectItem value="note">Note</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                  Date *
                </label>
                <Input
                  type="date"
                  value={form.entryDate}
                  onChange={(e) => setForm({ ...form, entryDate: e.target.value })}
                  className="rounded-lg font-mono text-sm bg-background"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                  Time
                </label>
                <Input
                  type="time"
                  value={form.entryTime}
                  onChange={(e) => setForm({ ...form, entryTime: e.target.value })}
                  className="rounded-lg font-mono text-sm bg-background"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                  Who sees it
                </label>
                <Select
                  value={form.audience}
                  onValueChange={(v) => setForm({ ...form, audience: v })}
                >
                  <SelectTrigger className="rounded-lg bg-background font-mono text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg">
                    <SelectItem value="all">Everyone</SelectItem>
                    <SelectItem value="staff">Chamber staff only</SelectItem>
                    <SelectItem value="role:senior_advocate">Senior Advocates</SelectItem>
                    <SelectItem value="role:junior_advocate">Junior Advocates</SelectItem>
                    <SelectItem value="role:clerk_intern">Clerks / Interns</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {cases.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                  Related matter
                </label>
                <Select value={form.caseId} onValueChange={(v) => setForm({ ...form, caseId: v })}>
                  <SelectTrigger className="rounded-lg bg-background font-mono text-sm">
                    <SelectValue placeholder="OPTIONAL" />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg">
                    <SelectItem value="none" className="italic text-muted-foreground">
                      None
                    </SelectItem>
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
                Notes
              </label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="rounded-lg font-mono text-sm bg-background resize-none h-20"
                placeholder="Bench, counsel, anything the chamber needs..."
              />
            </div>

            <DialogFooter className="pt-2 sm:justify-between">
              {editing ? (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-lg text-destructive border-destructive/40"
                  onClick={remove}
                  disabled={deleteEntry.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Remove
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-lg"
                  onClick={() => setIsOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="rounded-lg font-mono uppercase tracking-wider"
                  disabled={createEntry.isPending || updateEntry.isPending || !form.title.trim()}
                >
                  {editing ? "Save changes" : "Add entry"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
