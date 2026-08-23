import { useState } from "react";
import {
  useListTasks,
  useCompleteTask,
  getListTasksQueryKey,
  Task,
  type TaskCompletion,
  type TaskCompletionDelayReason,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdaptiveTable } from "@/components/ui/adaptive-table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Clock, CheckSquare, Search, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { TaskFormModal } from "@/components/task-form-modal";
import { useSession } from "@/lib/session";

/**
 * The server sends `isOverdue`, but a task can cross its deadline while the
 * page is open, so the date is re-checked here too. Extracted because the
 * table, the card tint and the completion dialog all have to agree — they
 * previously each recomputed it and could disagree by a render.
 */
function isTaskOverdue(task: Task): boolean {
  return task.status !== "completed" && (task.isOverdue || new Date(task.deadline) < new Date());
}

function TaskStatusDot({ task }: { task: Task }) {
  if (task.status === "completed") {
    return (
      <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center">
        <CheckSquare className="h-3 w-3 text-muted-foreground" />
      </div>
    );
  }
  if (isTaskOverdue(task)) {
    return (
      <div className="h-6 w-6 rounded-full bg-destructive flex items-center justify-center">
        <AlertCircle className="h-3 w-3 text-destructive-foreground" />
      </div>
    );
  }
  return (
    <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center">
      <Clock className="h-3 w-3 text-primary-foreground" />
    </div>
  );
}

export default function TasksPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: tasks, isLoading } = useListTasks();
  const completeTask = useCompleteTask();
  // Rendered from the server-issued capability list — Admin and both Advocate
  // tiers hold tasks.write; Clerk/Intern completes work but does not assign it.
  const { can } = useSession();
  const canAssign = can("tasks.write");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const [isCompleteOpen, setIsCompleteOpen] = useState(false);
  const [completingTask, setCompletingTask] = useState<Task | null>(null);
  const [delayReason, setDelayReason] = useState<TaskCompletionDelayReason>("other");
  const [delayNotes, setDelayNotes] = useState("");
  const [proofFile, setProofFile] = useState("");

  const filteredTasks = tasks?.filter((t) => {
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "pending_all" && (t.status === "pending" || t.status === "in_progress")) ||
      t.status === statusFilter;
    const matchesSearch =
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      t.assigneeName?.toLowerCase().includes(search.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const handleCompleteTask = () => {
    if (!completingTask) return;
    const isOverdue = completingTask.isOverdue || new Date(completingTask.deadline) < new Date();

    const payload: TaskCompletion = isOverdue
      ? { delayReason, delayNotes, proofFileName: proofFile }
      : {};

    completeTask.mutate(
      { id: completingTask.id, data: payload },
      {
        onSuccess: () => {
          setIsCompleteOpen(false);
          setCompletingTask(null);
          setDelayNotes("");
          setProofFile("");
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          toast({ title: "Task completed" });
        },
        onError: (err: Error) => {
          toast({ title: "Completion failed", description: err.message, variant: "destructive" });
        },
      },
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-1">Task Pipeline</h2>
          <p className="text-muted-foreground">Manage and track action items across all cases.</p>
        </div>
        {canAssign && (
          <Button className="rounded-lg shrink-0" onClick={() => setIsCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Task
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks or assignees..."
            className="pl-9 bg-background rounded-lg"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[200px] rounded-lg bg-background">
            <SelectValue placeholder="Status Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending_all">Pending & In Progress</SelectItem>
            <SelectItem value="overdue">Overdue Only</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg bg-card shadow-sm overflow-hidden">
        <AdaptiveTable
          label="Tasks"
          rows={filteredTasks ?? []}
          rowKey={(task) => task.id}
          isLoading={isLoading}
          rowClassName={(task) => (isTaskOverdue(task) ? "bg-destructive/5" : undefined)}
          empty={
            <>
              <p className="font-medium text-sm text-foreground">Nothing in the pipeline</p>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed max-w-sm mx-auto">
                Tasks assigned to this chamber appear here, newest deadline first.
              </p>
              {canAssign && (
                <Button
                  variant="outline"
                  className="rounded-lg mt-4"
                  onClick={() => setIsCreateOpen(true)}
                >
                  <Plus className="mr-2 h-4 w-4" /> Assign the first task
                </Button>
              )}
            </>
          }
          columns={[
            {
              key: "status",
              header: "Status",
              // Pure decoration once the row is a card: the deadline field
              // already carries the overdue colour, and the card is tinted.
              card: "hidden",
              headClassName: "w-[80px]",
              skeletonClassName: "h-6 w-6 rounded-full",
              cell: (task) => <TaskStatusDot task={task} />,
            },
            {
              key: "title",
              header: <span className="font-mono text-xs uppercase tracking-wider">Task</span>,
              card: "title",
              skeletonClassName: "h-4 w-48",
              cell: (task) => (
                <>
                  <div className="font-medium text-sm">{task.title}</div>
                  <Badge
                    variant="outline"
                    className="mt-1 rounded-lg text-3xs uppercase font-mono px-1 py-0"
                  >
                    {task.priority} priority
                  </Badge>
                </>
              ),
            },
            {
              key: "case",
              header: <span className="font-mono text-xs uppercase tracking-wider">Case ID</span>,
              cardLabel: "Case",
              skeletonClassName: "h-4 w-12",
              cell: (task) => (
                <Link
                  href={`/cases/${task.caseId}`}
                  className="text-xs font-mono border border-border px-2 py-1 hover:bg-accent transition-colors"
                >
                  CASE-{task.caseId}
                </Link>
              ),
            },
            {
              key: "assignee",
              header: <span className="font-mono text-xs uppercase tracking-wider">Assignee</span>,
              cellClassName: "text-sm",
              cell: (task) =>
                task.assigneeName || (
                  <span className="text-muted-foreground italic">Unassigned</span>
                ),
            },
            {
              key: "deadline",
              header: <span className="font-mono text-xs uppercase tracking-wider">Deadline</span>,
              cell: (task) => (
                <span
                  className={`text-sm font-mono ${isTaskOverdue(task) ? "text-destructive font-bold" : ""}`}
                >
                  {new Date(task.deadline).toLocaleDateString()}
                </span>
              ),
            },
            {
              key: "action",
              header: <span className="font-mono text-xs uppercase tracking-wider">Action</span>,
              card: "action",
              headClassName: "text-right",
              cellClassName: "text-right",
              skeletonClassName: "h-8 w-20 ml-auto",
              cell: (task) =>
                task.status !== "completed" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg"
                    onClick={() => {
                      setCompletingTask(task);
                      setIsCompleteOpen(true);
                    }}
                  >
                    Complete
                  </Button>
                ) : null,
            },
          ]}
        />
      </div>

      <TaskFormModal open={isCreateOpen} onOpenChange={setIsCreateOpen} />

      <Dialog open={isCompleteOpen} onOpenChange={setIsCompleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Task: {completingTask?.title}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            {completingTask &&
            (completingTask.isOverdue || new Date(completingTask.deadline) < new Date()) ? (
              <div className="space-y-4 border border-destructive bg-destructive/5 p-4">
                <div className="flex items-center gap-2 text-destructive font-bold uppercase tracking-wider text-sm font-mono mb-4">
                  <AlertCircle className="h-4 w-4" /> Mandatory Delay Log Required
                </div>
                <div className="grid gap-2">
                  <Label>Reason for Delay</Label>
                  <Select
                    value={delayReason}
                    onValueChange={(v) => setDelayReason(v as TaskCompletionDelayReason)}
                  >
                    <SelectTrigger className="rounded-lg border-destructive/30 focus:ring-destructive">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="client_unresponsive">Client Unresponsive</SelectItem>
                      <SelectItem value="court_delay">Court Delay</SelectItem>
                      <SelectItem value="document_missing">Document Missing</SelectItem>
                      <SelectItem value="resource_unavailable">Resource Unavailable</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Proof File Name (Required)</Label>
                  <Input
                    value={proofFile}
                    onChange={(e) => setProofFile(e.target.value)}
                    placeholder="e.g. Email_Thread_Client.pdf"
                    className="rounded-lg border-destructive/30 focus:ring-destructive"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={delayNotes}
                    onChange={(e) => setDelayNotes(e.target.value)}
                    className="rounded-lg border-destructive/30 focus:ring-destructive resize-none"
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Confirm completion to record in the case ledger.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCompleteOpen(false)}
              className="rounded-lg"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCompleteTask}
              className="rounded-lg"
              disabled={Boolean(
                completingTask &&
                (completingTask.isOverdue || new Date(completingTask.deadline) < new Date()) &&
                (!delayReason || !proofFile),
              )}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
