import { useState } from "react";
import { useParams } from "wouter";
import {
  useGetCase,
  useUpdateCase,
  useDeleteCase,
  useGetCaseTimeline,
  useListTasks,
  useListDocuments,
  useCreateTask,
  useDeleteTask,
  useUploadDocument,
  useDeleteDocument,
  useCompleteTask,
  getListTasksQueryKey,
  getGetCaseTimelineQueryKey,
  getListDocumentsQueryKey,
  getGetCaseQueryKey,
  Task,
  type CaseUpdateStatus,
  type TaskInputPriority,
  type TaskCompletion,
  type TaskCompletionDelayReason,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Trash2,
  AlertCircle,
  FileText,
  CheckSquare,
  Clock,
  Calendar,
  CheckCircle2,
  FileLock2,
  Upload,
  Download,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function CaseDetailPage() {
  const { id } = useParams();
  const caseId = parseInt(id || "0");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: caseData, isLoading: caseLoading } = useGetCase(caseId, {
    query: { enabled: !!caseId, queryKey: getGetCaseQueryKey(caseId) },
  });
  const { data: timeline } = useGetCaseTimeline(caseId, {
    query: { enabled: !!caseId, queryKey: getGetCaseTimelineQueryKey(caseId) },
  });
  const { data: tasks } = useListTasks(
    { caseId },
    { query: { enabled: !!caseId, queryKey: getListTasksQueryKey({ caseId }) } },
  );
  const { data: docs } = useListDocuments(caseId, {
    query: { enabled: !!caseId, queryKey: getListDocumentsQueryKey(caseId) },
  });

  const updateCase = useUpdateCase();
  const deleteCase = useDeleteCase();
  const createTask = useCreateTask();
  const deleteTask = useDeleteTask();
  const completeTask = useCompleteTask();
  const uploadDoc = useUploadDocument();
  const deleteDoc = useDeleteDocument();

  // Dialog states
  const [isTaskOpen, setIsTaskOpen] = useState(false);
  const [newTask, setNewTask] = useState<{
    title: string;
    description: string;
    deadline: string;
    priority: TaskInputPriority;
  }>({ title: "", description: "", deadline: "", priority: "medium" });

  const [isCompleteOpen, setIsCompleteOpen] = useState(false);
  const [completingTask, setCompletingTask] = useState<Task | null>(null);
  const [delayReason, setDelayReason] = useState<TaskCompletionDelayReason>("other");
  const [delayNotes, setDelayNotes] = useState("");
  const [proofFile, setProofFile] = useState("");

  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [newDocName, setNewDocName] = useState("");

  if (caseLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (!caseData) return <div>Case not found.</div>;

  const handleStatusChange = (newStatus: CaseUpdateStatus) => {
    updateCase.mutate(
      { id: caseId, data: { status: newStatus } },
      {
        onSuccess: () => {
          toast({
            title: "Status updated",
            description: `Case is now ${newStatus.replace("_", " ")}`,
          });
          queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
          queryClient.invalidateQueries({ queryKey: getGetCaseTimelineQueryKey(caseId) });
        },
      },
    );
  };

  const handleCreateTask = () => {
    createTask.mutate(
      { data: { caseId, ...newTask } },
      {
        onSuccess: () => {
          setIsTaskOpen(false);
          setNewTask({ title: "", description: "", deadline: "", priority: "medium" });
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey({ caseId }) });
          queryClient.invalidateQueries({ queryKey: getGetCaseTimelineQueryKey(caseId) });
        },
      },
    );
  };

  const handleCompleteTask = () => {
    if (!completingTask) return;
    const isOverdue = completingTask.isOverdue || new Date(completingTask.deadline) < new Date();

    // An overdue task must carry its delay reason: the API records the delay log
    // from the completion payload, so there is no separate call to make.
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
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey({ caseId }) });
          queryClient.invalidateQueries({ queryKey: getGetCaseTimelineQueryKey(caseId) });
          toast({ title: "Task completed" });
        },
        onError: (err: Error) => {
          toast({ title: "Completion failed", description: err.message, variant: "destructive" });
        },
      },
    );
  };

  const handleUploadDoc = () => {
    uploadDoc.mutate(
      { caseId, data: { name: newDocName } },
      {
        onSuccess: () => {
          setIsUploadOpen(false);
          setNewDocName("");
          queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(caseId) });
          queryClient.invalidateQueries({ queryKey: getGetCaseTimelineQueryKey(caseId) });
          toast({ title: "Document stub created" });
        },
      },
    );
  };

  const handleDeleteCase = () => {
    if (!confirm("Are you sure you want to delete this case? This action is irreversible.")) return;
    deleteCase.mutate(
      { id: caseId },
      {
        onSuccess: () => {
          toast({ title: "Case deleted successfully" });
          window.location.href = "/cases";
        },
      },
    );
  };

  const handleDeleteTask = (taskId: number) => {
    if (!confirm("Delete this task?")) return;
    deleteTask.mutate(
      { id: taskId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey({ caseId }) });
        },
      },
    );
  };

  const handleDeleteDoc = (docId: number) => {
    if (!confirm("Delete this document?")) return;
    deleteDoc.mutate(
      { caseId, docId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(caseId) });
        },
      },
    );
  };

  const pendingTasks = tasks?.filter((t) => t.status !== "completed") || [];
  const completedTasks = tasks?.filter((t) => t.status === "completed") || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="bg-background border border-border p-6 flex flex-col md:flex-row justify-between items-start gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold tracking-tight">{caseData.title}</h1>
            <Badge
              variant="outline"
              className="rounded-lg font-mono uppercase tracking-wider bg-muted text-xs"
            >
              #{caseData.id}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground font-mono">
            <span className="flex items-center gap-1">
              <FileText className="h-4 w-4" /> REF: {caseData.filingRef || "N/A"}
            </span>
            <span className="flex items-center gap-1">
              <CheckSquare className="h-4 w-4" /> Priority: {caseData.priority}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-4 w-4" /> Opened:{" "}
              {new Date(caseData.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          {/* Radix hands back a bare string; the SelectItem values below are the
              enum, so the narrowing is safe and stays at this one boundary. */}
          <Select
            value={caseData.status}
            onValueChange={(v) => handleStatusChange(v as CaseUpdateStatus)}
          >
            <SelectTrigger className="w-[180px] rounded-lg font-mono uppercase tracking-wider text-xs font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">STATUS: OPEN</SelectItem>
              <SelectItem value="in_progress">STATUS: IN PROGRESS</SelectItem>
              <SelectItem value="review">STATUS: REVIEW</SelectItem>
              <SelectItem value="closed">STATUS: CLOSED</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-2 items-center">
            <span className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
              Client: {caseData.clientName || "Unassigned"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-destructive hover:bg-destructive/10 rounded-lg ml-2"
              onClick={handleDeleteCase}
              title="Delete Case"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="tasks" className="w-full">
        <TabsList className="bg-transparent border-b border-border w-full justify-start rounded-lg h-12 p-0 gap-8">
          <TabsTrigger
            value="tasks"
            className="rounded-lg border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none h-full px-0 font-semibold tracking-tight text-base"
          >
            Task Pipeline
          </TabsTrigger>
          <TabsTrigger
            value="documents"
            className="rounded-lg border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none h-full px-0 font-semibold tracking-tight text-base"
          >
            Encrypted Vault
          </TabsTrigger>
          <TabsTrigger
            value="timeline"
            className="rounded-lg border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none h-full px-0 font-semibold tracking-tight text-base"
          >
            Activity Ledger
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="pt-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Active Pipeline</h3>
            <Dialog open={isTaskOpen} onOpenChange={setIsTaskOpen}>
              <DialogTrigger asChild>
                <Button className="rounded-lg" size="sm">
                  Add Task
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Queue New Task</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label>Task Title</Label>
                    <Input
                      value={newTask.title}
                      onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Deadline</Label>
                    <Input
                      type="date"
                      value={newTask.deadline}
                      onChange={(e) => setNewTask({ ...newTask, deadline: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Priority</Label>
                    <Select
                      value={newTask.priority}
                      onValueChange={(v) =>
                        setNewTask({ ...newTask, priority: v as TaskInputPriority })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    disabled={!newTask.title || !newTask.deadline}
                    onClick={handleCreateTask}
                    className="rounded-lg"
                  >
                    Create
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-4">
            {pendingTasks.map((task) => {
              const isOverdue = task.isOverdue || new Date(task.deadline) < new Date();
              return (
                <Card
                  key={task.id}
                  className={`${isOverdue ? "border border-destructive bg-destructive/5" : ""}`}
                >
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {isOverdue ? (
                        <AlertCircle className="h-5 w-5 text-destructive" />
                      ) : (
                        <Clock className="h-5 w-5 text-muted-foreground" />
                      )}
                      <div>
                        <h4 className="font-semibold text-sm">{task.title}</h4>
                        <div className="flex gap-3 text-xs text-muted-foreground font-mono mt-1">
                          <span className={isOverdue ? "text-destructive font-bold" : ""}>
                            DUE: {new Date(task.deadline).toLocaleDateString()}
                          </span>
                          <span>PRIORITY: {task.priority.toUpperCase()}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        className="rounded-lg"
                        size="sm"
                        onClick={() => {
                          setCompletingTask(task);
                          setIsCompleteOpen(true);
                        }}
                      >
                        Mark Complete
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10 rounded-lg"
                        onClick={() => handleDeleteTask(task.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
            {pendingTasks.length === 0 && (
              <div className="text-muted-foreground text-sm font-mono text-center p-8 border border-border">
                Pipeline clear
              </div>
            )}
          </div>

          {completedTasks.length > 0 && (
            <div className="mt-8">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                Completed
              </h3>
              <div className="space-y-2 opacity-70">
                {completedTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 p-3 bg-muted/50 border border-border text-sm"
                  >
                    <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                    <span className="line-through flex-1">{task.title}</span>
                    <span className="font-mono text-xs">
                      {new Date(task.completedAt!).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="documents" className="pt-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Case Documents</h3>
            <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
              <DialogTrigger asChild>
                <Button className="rounded-lg" size="sm" variant="outline">
                  <Upload className="mr-2 h-4 w-4" /> Upload
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Upload Document</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label>Document Name</Label>
                    <Input
                      value={newDocName}
                      onChange={(e) => setNewDocName(e.target.value)}
                      placeholder="e.g. Discovery_Motion_v2.pdf"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button disabled={!newDocName} onClick={handleUploadDoc} className="rounded-lg">
                    Add Record
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="rounded-lg bg-card shadow-sm">
            {docs?.map((doc, i) => (
              <div
                key={doc.id}
                className={`p-4 flex items-center justify-between hover:bg-muted/50 transition-colors ${i !== docs.length - 1 ? "border-b border-border" : ""}`}
              >
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 bg-muted flex items-center justify-center">
                    <FileLock2 className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h4 className="font-medium text-sm">{doc.name}</h4>
                    <div className="text-xs text-muted-foreground font-mono mt-1 flex gap-2">
                      <span>{formatDateTime(doc.uploadedAt)}</span>
                      {doc.encrypted && <span className="text-primary font-bold">ENCRYPTED</span>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg shrink-0">
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-lg shrink-0 text-destructive hover:bg-destructive/10"
                    onClick={() => handleDeleteDoc(doc.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            {(!docs || docs.length === 0) && (
              <div className="p-8 text-center text-muted-foreground font-mono text-sm">
                Vault is empty
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="timeline" className="pt-6">
          <div className="border-l-2 border-border ml-4 pl-6 space-y-8 py-4">
            {timeline?.map((event) => (
              <div key={event.id} className="relative">
                <div className="absolute -left-[35px] h-4 w-4 rounded-full bg-background border-2 border-primary" />
                <div className="text-xs font-mono text-muted-foreground mb-1">
                  {formatDateTime(event.createdAt)}
                </div>
                <div className="font-medium text-sm bg-muted/30 p-3 border border-border inline-block min-w-[300px]">
                  {event.description}
                  {event.actorName && (
                    <div className="text-xs text-muted-foreground mt-2 font-mono border-t border-border pt-2">
                      BY: {event.actorName.toUpperCase()}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {(!timeline || timeline.length === 0) && (
              <div className="text-muted-foreground font-mono text-sm">No activity recorded</div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Task Completion Dialog (handles overdue logic) */}
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
                  <Label>Notes (Optional)</Label>
                  <Textarea
                    value={delayNotes}
                    onChange={(e) => setDelayNotes(e.target.value)}
                    className="rounded-lg border-destructive/30 focus:ring-destructive resize-none"
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Are you sure you want to mark this task as complete? This will record the completion
                time in the case ledger.
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
              Confirm Completion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
