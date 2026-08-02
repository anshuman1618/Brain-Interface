import { useState } from "react";
import { useListTasks, useCompleteTask, getListTasksQueryKey, Task } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Clock, CheckSquare, Search, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { TaskFormModal } from "@/components/task-form-modal";
import { useSession } from "@/lib/session";

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
  const [delayReason, setDelayReason] = useState("other");
  const [delayNotes, setDelayNotes] = useState("");
  const [proofFile, setProofFile] = useState("");

  const filteredTasks = tasks?.filter(t => {
    const matchesStatus = statusFilter === "all" || 
      (statusFilter === "pending_all" && (t.status === "pending" || t.status === "in_progress")) ||
      t.status === statusFilter;
    const matchesSearch = t.title.toLowerCase().includes(search.toLowerCase()) || 
                          t.assigneeName?.toLowerCase().includes(search.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const handleCompleteTask = () => {
    if (!completingTask) return;
    const isOverdue = completingTask.isOverdue || new Date(completingTask.deadline) < new Date();
    
    const payload: any = isOverdue ? { delayReason, delayNotes, proofFileName: proofFile } : {};
    
    completeTask.mutate({ id: completingTask.id, data: payload }, {
      onSuccess: () => {
        setIsCompleteOpen(false);
        setCompletingTask(null);
        setDelayNotes("");
        setProofFile("");
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        toast({ title: "Task completed" });
      },
      onError: (err: any) => {
        toast({ title: "Completion failed", description: err.message, variant: "destructive" });
      }
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-1">Task Pipeline</h2>
          <p className="text-muted-foreground">Manage and track action items across all cases.</p>
        </div>
        {canAssign && (
          <Button className="rounded-none shrink-0" onClick={() => setIsCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Task
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search tasks or assignees..." 
            className="pl-9 bg-background rounded-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[200px] rounded-none bg-background">
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

      <div className="border border-border bg-background">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent bg-muted/30">
              <TableHead className="w-[80px]">Status</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Task</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Case ID</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Assignee</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider">Deadline</TableHead>
              <TableHead className="font-mono text-xs uppercase tracking-wider text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
               Array(5).fill(0).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-6 w-6 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-20 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : filteredTasks?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  <p>No tasks found in pipeline.</p>
                  {canAssign && (
                    <Button
                      variant="outline"
                      className="rounded-none mt-4"
                      onClick={() => setIsCreateOpen(true)}
                    >
                      <Plus className="mr-2 h-4 w-4" /> Assign the first task
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              filteredTasks?.map(task => {
                const isOverdue = task.isOverdue || (task.status !== 'completed' && new Date(task.deadline) < new Date());
                
                return (
                  <TableRow key={task.id} className={isOverdue ? 'bg-destructive/5' : ''}>
                    <TableCell>
                      {task.status === 'completed' ? (
                        <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center"><CheckSquare className="h-3 w-3 text-muted-foreground" /></div>
                      ) : isOverdue ? (
                        <div className="h-6 w-6 rounded-full bg-destructive flex items-center justify-center"><AlertCircle className="h-3 w-3 text-destructive-foreground" /></div>
                      ) : (
                        <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center"><Clock className="h-3 w-3 text-primary-foreground" /></div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{task.title}</div>
                      <Badge variant="outline" className="mt-1 rounded-none text-[9px] uppercase font-mono px-1 py-0">{task.priority} priority</Badge>
                    </TableCell>
                    <TableCell>
                      <Link href={`/cases/${task.caseId}`} className="text-xs font-mono border border-border px-2 py-1 hover:bg-accent transition-colors">
                        CASE-{task.caseId}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{task.assigneeName || <span className="text-muted-foreground italic">Unassigned</span>}</TableCell>
                    <TableCell>
                      <span className={`text-sm font-mono ${isOverdue ? 'text-destructive font-bold' : ''}`}>
                        {new Date(task.deadline).toLocaleDateString()}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {task.status !== 'completed' && (
                         <Button 
                          variant="outline" 
                          size="sm" 
                          className="rounded-none"
                          onClick={() => {
                            setCompletingTask(task);
                            setIsCompleteOpen(true);
                          }}
                         >
                           Complete
                         </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <TaskFormModal open={isCreateOpen} onOpenChange={setIsCreateOpen} />

      <Dialog open={isCompleteOpen} onOpenChange={setIsCompleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Task: {completingTask?.title}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            {completingTask && (completingTask.isOverdue || new Date(completingTask.deadline) < new Date()) ? (
              <div className="space-y-4 border border-destructive bg-destructive/5 p-4">
                <div className="flex items-center gap-2 text-destructive font-bold uppercase tracking-wider text-sm font-mono mb-4">
                  <AlertCircle className="h-4 w-4" /> Mandatory Delay Log Required
                </div>
                <div className="grid gap-2">
                  <Label>Reason for Delay</Label>
                  <Select value={delayReason} onValueChange={setDelayReason}>
                    <SelectTrigger className="rounded-none border-destructive/30 focus:ring-destructive"><SelectValue /></SelectTrigger>
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
                    onChange={e => setProofFile(e.target.value)} 
                    placeholder="e.g. Email_Thread_Client.pdf"
                    className="rounded-none border-destructive/30 focus:ring-destructive" 
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Notes (Optional)</Label>
                  <Textarea value={delayNotes} onChange={e => setDelayNotes(e.target.value)} className="rounded-none border-destructive/30 focus:ring-destructive resize-none" />
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Confirm completion to record in the case ledger.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCompleteOpen(false)} className="rounded-none">Cancel</Button>
            <Button 
              onClick={handleCompleteTask} 
              className="rounded-none"
              disabled={Boolean(completingTask && (completingTask.isOverdue || new Date(completingTask.deadline) < new Date()) && (!delayReason || !proofFile))}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
