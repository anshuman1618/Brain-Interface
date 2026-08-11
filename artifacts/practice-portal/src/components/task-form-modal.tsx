import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateTask,
  useListCases,
  useListUsers,
  getListTasksQueryKey,
  getListCasesQueryKey,
  getListUsersQueryKey,
  getGetDashboardSummaryQueryKey,
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { roleLabel } from "@/lib/role-options";

const UNASSIGNED = "__unassigned__";

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Create and assign a task.
 *
 * The assignee list is `GET /users`, which is workspace-scoped server-side, so
 * only members of the current chamber appear — and the API re-checks the
 * assignee's membership on submit, rejecting anyone who is not in it.
 */
export function TaskFormModal({
  open,
  onOpenChange,
  defaultCaseId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCaseId?: number;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: cases = [] } = useListCases(undefined, {
    query: { queryKey: getListCasesQueryKey(), enabled: open },
  });
  const { data: members = [] } = useListUsers(undefined, {
    query: { queryKey: getListUsersQueryKey(), enabled: open },
  });

  const [caseId, setCaseId] = useState<string>(defaultCaseId ? String(defaultCaseId) : "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>(UNASSIGNED);
  const [priority, setPriority] = useState("medium");
  const [deadline, setDeadline] = useState(() => todayPlus(7));

  useEffect(() => {
    if (open && defaultCaseId) setCaseId(String(defaultCaseId));
  }, [open, defaultCaseId]);

  const createTask = useCreateTask();

  // Clients are members too, but work is assigned to staff.
  const assignable = members.filter((m) => m.role !== "client");

  const reset = () => {
    setCaseId(defaultCaseId ? String(defaultCaseId) : "");
    setTitle("");
    setDescription("");
    setAssigneeId(UNASSIGNED);
    setPriority("medium");
    setDeadline(todayPlus(7));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!caseId || !title || !deadline) return;

    createTask.mutate(
      {
        data: {
          caseId: Number(caseId),
          title,
          description: description || undefined,
          assigneeId: assigneeId === UNASSIGNED ? undefined : assigneeId,
          priority: priority as never,
          deadline,
        },
      },
      {
        onSuccess: () => {
          toast({
            title: "Task created",
            description:
              assigneeId === UNASSIGNED
                ? "Left unassigned."
                : "Assignee notified in their pipeline.",
          });
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          reset();
          onOpenChange(false);
        },
        onError: (err: unknown) => {
          toast({
            title: "Couldn't create the task",
            description: err instanceof Error ? err.message : undefined,
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] rounded-lg border-border">
        <DialogHeader>
          <DialogTitle className="font-mono uppercase tracking-widest">New Task</DialogTitle>
          <DialogDescription className="font-mono text-xs uppercase tracking-wider">
            Add work to a matter and assign it to a member of this chamber.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
              Matter *
            </label>
            <Select value={caseId} onValueChange={setCaseId}>
              <SelectTrigger className="rounded-lg bg-background font-mono text-sm">
                <SelectValue placeholder="SELECT CASE" />
              </SelectTrigger>
              <SelectContent className="rounded-lg">
                {cases.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)} className="font-mono text-sm">
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
              Task *
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-lg font-mono text-sm bg-background"
              placeholder="e.g. Draft written submissions"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
              Assign to
            </label>
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger className="rounded-lg bg-background font-mono text-sm">
                <SelectValue placeholder="SELECT ASSIGNEE" />
              </SelectTrigger>
              <SelectContent className="rounded-lg">
                <SelectItem
                  value={UNASSIGNED}
                  className="font-mono text-sm italic text-muted-foreground"
                >
                  Unassigned
                </SelectItem>
                {assignable.map((m) => (
                  <SelectItem key={m.id} value={m.clerkId} className="font-mono text-sm">
                    {m.displayName || m.email} · {roleLabel(m.role) || m.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                Priority
              </label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="rounded-lg bg-background font-mono text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-lg">
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                Deadline *
              </label>
              <Input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="rounded-lg font-mono text-sm bg-background"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
              Notes (optional)
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="rounded-lg font-mono text-sm bg-background resize-none h-20"
              placeholder="Anything the assignee needs to know..."
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-lg"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="rounded-lg font-mono uppercase tracking-wider"
              disabled={createTask.isPending || !caseId || !title || !deadline}
            >
              {createTask.isPending ? "Creating..." : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
