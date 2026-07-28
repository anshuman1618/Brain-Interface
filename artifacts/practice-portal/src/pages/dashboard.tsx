import { useState } from "react";
import { 
  useGetDashboardSummary, 
  useListTasks, 
  getGetDashboardSummaryQueryKey, 
  getListTasksQueryKey,
  useListDocumentRequests,
  useUpdateDocumentRequest,
  getListDocumentRequestsQueryKey
} from "@workspace/api-client-react";
import { useUserRole } from "@/hooks/use-user-role";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { 
  Briefcase, CheckSquare, Calendar, Activity, AlertCircle, Clock, 
  CheckCircle2, ChevronRight, FileText, Upload, ListTodo, Archive, Check 
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { usePricingModal } from "@/components/pricing-modal";
import { DocumentRequestModal } from "@/components/document-request-modal";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function DashboardPage() {
  const { isStaff } = useUserRole();

  if (isStaff) {
    return <StaffDashboard />;
  }

  return <ClientDashboard />;
}

function StaffDashboard() {
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary({ query: { refetchInterval: 30000, queryKey: getGetDashboardSummaryQueryKey() } });
  const { data: tasks, isLoading: tasksLoading } = useListTasks(undefined, { query: { refetchInterval: 30000, queryKey: getListTasksQueryKey() } });
  
  const { role, isAdmin, isSenior, isJunior, isClerk } = useUserRole();
  const { setOpen: setPricingModalOpen } = usePricingModal();
  const [, setLocation] = useLocation();
  const [docRequestOpen, setDocRequestOpen] = useState(false);

  const overdueTasks = tasks?.filter(t => t.status === 'overdue' || t.isOverdue) || [];
  const pendingTasks = tasks?.filter(t => t.status === 'pending' || t.status === 'in_progress') || [];

  return (
    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">
      {isAdmin && (
        <div 
          onClick={() => setPricingModalOpen(true)}
          className="w-full p-3 bg-gradient-to-r from-gray-300 to-gray-500 text-black font-bold uppercase font-mono tracking-widest text-center cursor-pointer hover:opacity-90 transition-opacity"
        >
          1-Month Free Trial Active &mdash; Upgrade Now
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-1">Status Overview</h2>
          <p className="text-muted-foreground font-mono text-sm uppercase tracking-wider">Live telemetry &middot; Auto-refresh 30s</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-background border-border shadow-none rounded-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase font-mono tracking-wider flex items-center gap-2">
              <Briefcase className="h-4 w-4" /> Active Cases
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? <Skeleton className="h-10 w-20" /> : <div className="text-4xl font-bold tracking-tighter">{summary?.activeCases || 0}</div>}
          </CardContent>
        </Card>
        
        <Card className="bg-background border-border shadow-none rounded-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase font-mono tracking-wider flex items-center gap-2">
              <CheckSquare className="h-4 w-4" /> Pending Tasks
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? <Skeleton className="h-10 w-20" /> : <div className="text-4xl font-bold tracking-tighter">{summary?.pendingTasks || 0}</div>}
          </CardContent>
        </Card>

        <Card className="bg-destructive/10 border-destructive/20 shadow-none rounded-none text-destructive">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium uppercase font-mono tracking-wider flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> Overdue Tasks
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tasksLoading ? <Skeleton className="h-10 w-20 bg-destructive/20" /> : <div className="text-4xl font-bold tracking-tighter">{overdueTasks.length}</div>}
          </CardContent>
        </Card>

        <Card className="bg-background border-border shadow-none rounded-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase font-mono tracking-wider flex items-center gap-2">
              <Calendar className="h-4 w-4" /> Next Hearing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold tracking-tight text-muted-foreground">
              None Scheduled
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="pt-4 border-t border-border">
        <h3 className="text-xl font-bold tracking-tight mb-4 uppercase font-mono">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <button onClick={() => setLocation('/calendar')} className="bg-slate-800 border-l-4 border-slate-400 text-white rounded-none p-4 flex flex-col items-center justify-center gap-3 hover:opacity-90 transition-opacity animate-in fade-in slide-in-from-bottom-4 duration-500 delay-75">
            <Calendar className="h-8 w-8" />
            <span className="font-mono uppercase text-xs font-bold tracking-wider text-center">Interactive Master Calendar</span>
          </button>
          
          {(isAdmin || isSenior || isJunior) && (
            <button onClick={() => setLocation('/cases')} className="bg-zinc-800 text-gray-200 rounded-none p-4 flex flex-col items-center justify-center gap-3 hover:opacity-90 transition-opacity animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
              <AlertCircle className="h-8 w-8" />
              <span className="font-mono uppercase text-xs font-bold tracking-wider text-center">Priority / Urgent Cases</span>
            </button>
          )}

          {(isAdmin || isSenior || isJunior) && (
            <button onClick={() => setLocation('/tasks')} className="bg-slate-700 hover:bg-slate-600 text-white rounded-none p-4 flex flex-col items-center justify-center gap-3 transition-colors animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150">
              <ListTodo className="h-8 w-8" />
              <span className="font-mono uppercase text-xs font-bold tracking-wider text-center">Pending Cases / Cause List</span>
            </button>
          )}

          <button onClick={() => setLocation('/tasks')} className="bg-stone-700 hover:bg-stone-600 text-white rounded-none p-4 flex flex-col items-center justify-center gap-3 transition-colors animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
            <CheckSquare className="h-8 w-8" />
            <span className="font-mono uppercase text-xs font-bold tracking-wider text-center">My Assigned Work</span>
          </button>

          <button onClick={() => setLocation('/tasks')} className="bg-gray-800 text-gray-400 rounded-none p-4 flex flex-col items-center justify-center gap-3 hover:opacity-90 transition-opacity animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
            <Archive className="h-8 w-8" />
            <span className="font-mono uppercase text-xs font-bold tracking-wider text-center">Work Completed</span>
          </button>

          {(isAdmin || isSenior || isJunior) && (
            <button onClick={() => setLocation('/cases')} className="bg-neutral-700 hover:bg-neutral-600 text-white rounded-none p-4 flex flex-col items-center justify-center gap-3 transition-colors animate-in fade-in slide-in-from-bottom-4 duration-500 delay-500">
              <FileText className="h-8 w-8" />
              <span className="font-mono uppercase text-xs font-bold tracking-wider text-center">Case Briefs & Drafting</span>
            </button>
          )}

          <button onClick={() => setLocation('/cases')} className="bg-zinc-700 hover:bg-zinc-600 text-white rounded-none p-4 flex flex-col items-center justify-center gap-3 transition-colors animate-in fade-in slide-in-from-bottom-4 duration-500 delay-[600ms]">
            <Upload className="h-8 w-8" />
            <span className="font-mono uppercase text-xs font-bold tracking-wider text-center">Upload Digital Copy</span>
          </button>

          {(isAdmin || isSenior || isJunior) && (
            <button onClick={() => setDocRequestOpen(true)} className="bg-slate-600 border border-slate-500 hover:bg-slate-500 text-white rounded-none p-4 flex flex-col items-center justify-center gap-3 transition-colors animate-in fade-in slide-in-from-bottom-4 duration-500 delay-[700ms]">
              <FileText className="h-8 w-8" />
              <span className="font-mono uppercase text-xs font-bold tracking-wider text-center">Request Client Document</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
        <div>
          <h3 className="text-xl font-bold tracking-tight mb-4 flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" /> Needs Attention
          </h3>
          {tasksLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <div className="space-y-2">
              {overdueTasks.slice(0, 5).map((task) => (
                <div key={task.id} className="p-4 border-l-4 border-l-destructive bg-destructive/5 border-y border-r border-border flex items-center gap-4">
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="font-medium text-sm truncate text-destructive">{task.title}</span>
                    <span className="text-xs text-destructive/80 mt-1 font-mono uppercase tracking-wider flex gap-2">
                      <span>Due {new Date(task.deadline).toLocaleDateString()}</span>
                    </span>
                  </div>
                  <Link href={`/cases/${task.caseId}`} className="text-xs border border-destructive/20 px-3 py-1.5 hover:bg-destructive/10 transition-colors shrink-0 text-destructive">
                    Case {task.caseId}
                  </Link>
                </div>
              ))}
              {overdueTasks.length === 0 && (
                <div className="p-8 text-center text-muted-foreground text-sm font-mono uppercase tracking-wider">No overdue items</div>
              )}
            </div>
          )}
        </div>

        <div>
          <h3 className="text-xl font-bold tracking-tight mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" /> Pending Tasks
          </h3>
          {tasksLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <div className="space-y-2">
              {pendingTasks.slice(0, 5).map((task) => (
                <div key={task.id} className="p-4 border border-border bg-background flex items-center gap-4 hover:border-primary/50 transition-colors group">
                  <Clock className="h-5 w-5 text-primary shrink-0" />
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="font-medium text-sm truncate">{task.title}</span>
                    <span className="text-xs text-muted-foreground mt-1 font-mono uppercase tracking-wider flex gap-2">
                      <span className={task.priority === 'urgent' ? 'text-destructive font-bold' : ''}>{task.priority}</span>
                      <span>&middot;</span>
                      <span>Due {new Date(task.deadline).toLocaleDateString()}</span>
                    </span>
                  </div>
                  <Link href={`/cases/${task.caseId}`} className="text-xs border border-border px-3 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors shrink-0">
                    Case {task.caseId}
                  </Link>
                </div>
              ))}
              {pendingTasks.length === 0 && (
                <div className="p-8 text-center text-muted-foreground text-sm font-mono uppercase tracking-wider">No pending tasks</div>
              )}
            </div>
          )}
        </div>
      </div>

      <DocumentRequestModal open={docRequestOpen} onOpenChange={setDocRequestOpen} />
    </div>
  );
}

function ClientDashboard() {
  const { data: requests = [], isLoading } = useListDocumentRequests({ query: { queryKey: getListDocumentRequestsQueryKey() } });
  const updateRequest = useUpdateDocumentRequest();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const pendingRequests = requests.filter(r => r.status === 'pending');

  const handleAction = (id: number, status: 'fulfilled' | 'dismissed') => {
    updateRequest.mutate({ id, data: { status } }, {
      onSuccess: () => {
        toast({ title: `Request ${status}` });
        queryClient.invalidateQueries({ queryKey: getListDocumentRequestsQueryKey() });
      }
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">
      <div className="mb-8">
        <h2 className="text-3xl font-bold tracking-tight mb-2">Welcome to your Portal</h2>
        <p className="text-muted-foreground max-w-2xl">Access your case materials, track progress, and view upcoming consultations securely.</p>
      </div>

      {/* Action Required: Pending Document Requests */}
      <div className="border-l-4 border-slate-400 bg-slate-800 text-white p-6 rounded-none mb-8">
        <h3 className="text-xl font-bold tracking-tight mb-4 flex items-center gap-2 uppercase font-mono">
          <AlertCircle className="h-5 w-5" /> Action Required: Pending Document Requests
        </h3>
        
        {isLoading ? (
          <Skeleton className="h-20 bg-slate-700 w-full" />
        ) : pendingRequests.length > 0 ? (
          <div className="space-y-3">
            {pendingRequests.map(req => (
              <div key={req.id} className="bg-slate-700/50 p-4 border border-slate-600 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                <div>
                  <h4 className="font-bold font-mono tracking-tight text-lg">{req.documentName}</h4>
                  <div className="text-sm text-slate-300 font-mono mt-1 space-y-1">
                    <p>Requested by: {req.requestedBy || 'Firm'}</p>
                    {req.note && <p className="italic opacity-80">"{req.note}"</p>}
                    <p className="text-xs opacity-60 uppercase tracking-widest">{new Date(req.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <Button 
                    variant="outline" 
                    className="flex-1 sm:flex-none rounded-none bg-transparent border-slate-500 text-white hover:bg-slate-700 hover:text-white font-mono uppercase text-xs"
                    onClick={() => handleAction(req.id, 'dismissed')}
                    disabled={updateRequest.isPending}
                  >
                    Dismiss
                  </Button>
                  <Button 
                    className="flex-1 sm:flex-none rounded-none bg-slate-200 text-slate-900 hover:bg-white font-mono uppercase text-xs font-bold"
                    onClick={() => handleAction(req.id, 'fulfilled')}
                    disabled={updateRequest.isPending}
                  >
                    Mark Fulfilled
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center bg-slate-900/50 border border-slate-700">
            <p className="text-slate-400 text-sm font-mono uppercase tracking-wider flex items-center justify-center gap-2">
              <Check className="h-4 w-4" /> No pending requests — you're all caught up.
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card className="bg-background border-border shadow-none rounded-none flex flex-col justify-center items-center py-12 px-6 text-center hover:border-primary transition-colors cursor-pointer" onClick={() => window.location.href='/client-portal'}>
          <Briefcase className="h-12 w-12 text-muted-foreground mb-4" />
          <CardTitle className="text-xl mb-2">My Cases</CardTitle>
          <CardDescription>View updates and documents for your active cases.</CardDescription>
        </Card>
        <Card className="bg-background border-border shadow-none rounded-none flex flex-col justify-center items-center py-12 px-6 text-center hover:border-primary transition-colors cursor-pointer" onClick={() => window.location.href='/client-portal'}>
          <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
          <CardTitle className="text-xl mb-2">Consultations</CardTitle>
          <CardDescription>View scheduled meetings and details.</CardDescription>
        </Card>
      </div>
    </div>
  );
}