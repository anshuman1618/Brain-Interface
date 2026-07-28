import { useState, useMemo } from "react";
import { 
  useListTasks, 
  useListConsultations, 
  useListCases,
  useListUsers,
  useCreateTask,
  useCreateConsultation,
  useUpdateTask,
  useUpdateConsultation,
  getListTasksQueryKey,
  getListConsultationsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useUserRole } from "@/hooks/use-user-role";
import { Calendar, dateFnsLocalizer, Event as RBCEvent } from "react-big-calendar";
import withDragAndDrop from "react-big-calendar/lib/addons/dragAndDrop";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const locales = {
  "en-US": enUS
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

const DnDCalendar = withDragAndDrop(Calendar);

type CalendarEventType = "task" | "consultation";

interface CalendarEvent extends RBCEvent {
  id: string;
  type: CalendarEventType;
  resource: any; // The original task or consultation
  colorClass: string;
}

export default function CalendarPage() {
  const { role, isClerk, user } = useUserRole();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: allTasks = [] } = useListTasks();
  const { data: allConsultations = [] } = useListConsultations();
  const { data: cases = [] } = useListCases();
  const { data: allUsers = [] } = useListUsers();
  const users = useMemo(
    () => allUsers.filter(u => u.role !== "client"),
    [allUsers]
  ); // any staff member is assignable

  const updateTask = useUpdateTask();
  const updateConsultation = useUpdateConsultation();
  const createTask = useCreateTask();
  const createConsultation = useCreateConsultation();

  const tasks = useMemo(() => {
    if (isClerk && user?.id) {
      return allTasks.filter(t => t.assigneeId === user.id);
    }
    return allTasks;
  }, [allTasks, isClerk, user?.id]);

  const consultations = useMemo(() => {
    if (isClerk) return []; // Clerks don't manage consultations
    return allConsultations;
  }, [allConsultations, isClerk]);

  const events = useMemo<CalendarEvent[]>(() => {
    const taskEvents: CalendarEvent[] = tasks.map(t => {
      let colorClass = "bg-slate-400 text-white";
      if (t.priority === 'urgent') colorClass = "bg-destructive text-destructive-foreground";
      else if (t.priority === 'high') colorClass = "bg-slate-600 text-white";
      else if (t.priority === 'medium') colorClass = "bg-slate-500 text-white";

      if (t.title.toLowerCase().startsWith('hearing:')) {
        colorClass = "bg-zinc-800 text-white border-l-4 border-l-destructive";
      }

      return {
        id: `task-${t.id}`,
        title: t.title,
        start: new Date(t.deadline),
        end: new Date(t.deadline),
        allDay: true,
        type: "task",
        resource: t,
        colorClass
      };
    });

    const consultEvents: CalendarEvent[] = consultations.map(c => {
      let colorClass = "bg-muted text-muted-foreground";
      if (c.category === 'legal_solution') colorClass = 'bg-slate-700 text-white';
      else if (c.category === 'regulatory_solution') colorClass = 'bg-zinc-600 text-white';
      else if (c.category === 'business_consultation') colorClass = 'bg-neutral-500 text-white';
      else if (c.category === 'procedural_compliance') colorClass = 'bg-gray-300 text-gray-900';

      const startDate = c.scheduledAt ? new Date(c.scheduledAt) : new Date();
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour duration

      return {
        id: `consult-${c.id}`,
        title: `📞 ${c.title}`,
        start: startDate,
        end: endDate,
        allDay: false,
        type: "consultation",
        resource: c,
        colorClass
      };
    });

    return [...taskEvents, ...consultEvents];
  }, [tasks, consultations]);

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{ start: Date; end: Date } | null>(null);
  
  const [eventType, setEventType] = useState<"task" | "hearing" | "consultation">("task");
  const [title, setTitle] = useState("");
  const [caseId, setCaseId] = useState("");
  const [priority, setPriority] = useState("medium");
  const [assigneeId, setAssigneeId] = useState("");
  const [category, setCategory] = useState<any>("");
  const [consent, setConsent] = useState(false);

  const handleSelectSlot = (slotInfo: { start: Date; end: Date }) => {
    setSelectedSlot(slotInfo);
    setEventType("task");
    setTitle("");
    setCaseId("");
    setPriority("medium");
    setAssigneeId("");
    setCategory("");
    setConsent(false);
    setModalOpen(true);
  };

  const handleEventDrop = async ({ event, start, end }: any) => {
    const e = event as CalendarEvent;
    
    if (e.type === 'task') {
      updateTask.mutate({ 
        id: Number(e.resource.id), 
        data: { deadline: start.toISOString() } 
      }, {
        onSuccess: () => {
          queryClient.setQueryData(getListTasksQueryKey(), (old: any) => 
            old ? old.map((t: any) => t.id === e.resource.id ? { ...t, deadline: start.toISOString() } : t) : old
          );
        },
        onError: () => toast({ title: "Failed to move task", variant: "destructive" })
      });
    } else if (e.type === 'consultation') {
      updateConsultation.mutate({ 
        id: Number(e.resource.id), 
        data: { scheduledAt: start.toISOString() } 
      }, {
        onSuccess: () => {
          queryClient.setQueryData(getListConsultationsQueryKey(), (old: any) => 
            old ? old.map((c: any) => c.id === e.resource.id ? { ...c, scheduledAt: start.toISOString() } : c) : old
          );
        },
        onError: () => toast({ title: "Failed to move consultation", variant: "destructive" })
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot || !title) return;

    if (eventType === "task" || eventType === "hearing") {
      const finalTitle = eventType === "hearing" ? `Hearing: ${title}` : title;
      const finalPriority = eventType === "hearing" ? "high" : priority;
      
      createTask.mutate({
        data: {
          title: finalTitle,
          description: "",
          deadline: selectedSlot.start.toISOString(),
          priority: finalPriority as any,
          caseId: Number(caseId),
          assigneeId: assigneeId && assigneeId !== "none" ? assigneeId : undefined
        }
      }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          setModalOpen(false);
          toast({ title: "Task scheduled" });
        }
      });
    } else if (eventType === "consultation") {
      if (!category) return;
      
      createConsultation.mutate({
        data: {
          title,
          notes: "",
          scheduledAt: selectedSlot.start.toISOString(),
          caseId: Number(caseId),
          category,
          consentGiven: consent
        }
      }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListConsultationsQueryKey() });
          setModalOpen(false);
          toast({ title: "Consultation scheduled" });
        }
      });
    }
  };

  const eventPropGetter = (event: CalendarEvent) => {
    return {
      className: `rounded-none border-none font-mono text-[10px] uppercase tracking-wider px-1 ${event.colorClass}`
    };
  };

  return (
    <div className="h-[calc(100vh-10rem)] flex flex-col space-y-4 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold tracking-tight mb-1">Master Calendar</h2>
        <p className="text-muted-foreground font-mono text-sm uppercase tracking-wider">Drag to reschedule &middot; Click to create</p>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        .rbc-calendar {
          font-family: var(--font-mono);
          text-transform: uppercase;
        }
        .rbc-header {
          padding: 8px 0;
          font-weight: bold;
          border-bottom: 2px solid hsl(var(--border)) !important;
          background-color: hsl(var(--muted) / 0.3);
        }
        .rbc-today {
          background-color: hsl(var(--muted) / 0.5) !important;
        }
        .rbc-event {
          border-radius: 0 !important;
        }
        .rbc-off-range-bg {
          background-color: hsl(var(--muted) / 0.1);
        }
        .rbc-toolbar button {
          border-radius: 0;
          text-transform: uppercase;
          font-weight: bold;
          letter-spacing: 0.05em;
        }
        .rbc-toolbar button.rbc-active {
          background-color: hsl(var(--foreground));
          color: hsl(var(--background));
        }
      `}} />

      <div className="flex-1 bg-background border border-border p-4">
        <DnDCalendar
          localizer={localizer}
          events={events}
          startAccessor={(e: any) => e.start}
          endAccessor={(e: any) => e.end}
          selectable
          onSelectSlot={handleSelectSlot}
          onEventDrop={handleEventDrop}
          eventPropGetter={eventPropGetter as any}
          resizable={false}
          views={["month", "week", "day"]}
          defaultView="month"
          popup
        />
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-[425px] rounded-none border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-widest">New Calendar Event</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-4">
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">Event Type *</label>
              <Select value={eventType} onValueChange={(v: any) => setEventType(v)}>
                <SelectTrigger className="rounded-none bg-background font-mono text-sm">
                  <SelectValue placeholder="SELECT TYPE" />
                </SelectTrigger>
                <SelectContent className="rounded-none">
                  <SelectItem value="task" className="font-mono text-sm">Task</SelectItem>
                  <SelectItem value="hearing" className="font-mono text-sm">Hearing</SelectItem>
                  {!isClerk && <SelectItem value="consultation" className="font-mono text-sm">Consultation</SelectItem>}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">Title *</label>
              <Input 
                value={title} 
                onChange={e => setTitle(e.target.value)} 
                className="rounded-none font-mono text-sm bg-background" 
                required 
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">Related Case *</label>
              <Select value={caseId} onValueChange={setCaseId} required>
                <SelectTrigger className="rounded-none bg-background font-mono text-sm">
                  <SelectValue placeholder="SELECT CASE" />
                </SelectTrigger>
                <SelectContent className="rounded-none">
                  {cases.map(c => (
                    <SelectItem key={c.id} value={String(c.id)} className="font-mono text-sm">
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {eventType === "task" && (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">Priority</label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger className="rounded-none bg-background font-mono text-sm">
                      <SelectValue placeholder="SELECT PRIORITY" />
                    </SelectTrigger>
                    <SelectContent className="rounded-none">
                      <SelectItem value="low" className="font-mono text-sm">Low</SelectItem>
                      <SelectItem value="medium" className="font-mono text-sm">Medium</SelectItem>
                      <SelectItem value="high" className="font-mono text-sm">High</SelectItem>
                      <SelectItem value="urgent" className="font-mono text-sm font-bold text-destructive">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">Assignee</label>
                  <Select value={assigneeId} onValueChange={setAssigneeId}>
                    <SelectTrigger className="rounded-none bg-background font-mono text-sm">
                      <SelectValue placeholder="UNASSIGNED" />
                    </SelectTrigger>
                    <SelectContent className="rounded-none">
                      <SelectItem value="none" className="font-mono text-sm italic text-muted-foreground">Unassigned</SelectItem>
                      {users.map((u: any) => (
                        <SelectItem key={u.id} value={String(u.id)} className="font-mono text-sm">
                          {u.displayName || u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {eventType === "consultation" && (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">Category *</label>
                  <Select value={category} onValueChange={setCategory} required>
                    <SelectTrigger className="rounded-none bg-background font-mono text-sm">
                      <SelectValue placeholder="SELECT CATEGORY" />
                    </SelectTrigger>
                    <SelectContent className="rounded-none">
                      <SelectItem value="legal_solution" className="font-mono text-sm">Legal Solution</SelectItem>
                      <SelectItem value="regulatory_solution" className="font-mono text-sm">Regulatory Solution</SelectItem>
                      <SelectItem value="business_consultation" className="font-mono text-sm">Business Consultation</SelectItem>
                      <SelectItem value="procedural_compliance" className="font-mono text-sm">Procedural Compliance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-start space-x-2 mt-4 pt-2">
                  <Checkbox id="consent" checked={consent} onCheckedChange={(c) => setConsent(c as boolean)} className="mt-1" required />
                  <Label htmlFor="consent" className="text-xs text-muted-foreground cursor-pointer leading-tight">
                    Client has been informed that consultations may be recorded for quality assurance.
                  </Label>
                </div>
              </>
            )}

            <div className="pt-4 flex justify-end">
              <Button 
                type="submit" 
                className="rounded-none font-mono uppercase tracking-wider w-full"
                disabled={
                  (eventType === 'task' || eventType === 'hearing') ? createTask.isPending : 
                  (createConsultation.isPending || !category || !consent)
                }
              >
                Schedule Event
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}