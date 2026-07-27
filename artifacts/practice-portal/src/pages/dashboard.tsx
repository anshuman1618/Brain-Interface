import { useGetDashboardSummary, useListTasks, getGetDashboardSummaryQueryKey, getListTasksQueryKey } from "@workspace/api-client-react";
import { useUserRole } from "@/hooks/use-user-role";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Briefcase, CheckSquare, Calendar, Activity, AlertCircle, Clock, CheckCircle2, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { formatDateTime } from "@/lib/utils";

export default function DashboardPage() {
  const { role, isAdmin, isClerk, isClient, user } = useUserRole();

  if (isAdmin || isClerk) {
    return <AdminClerkDashboard />;
  }

  if (isClient) {
    return <ClientDashboard />;
  }

  return null;
}

function AdminClerkDashboard() {
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary({ query: { refetchInterval: 30000, queryKey: getGetDashboardSummaryQueryKey() } });
  const { data: tasks, isLoading: tasksLoading } = useListTasks(undefined, { query: { refetchInterval: 30000, queryKey: getListTasksQueryKey() } });

  const overdueTasks = tasks?.filter(t => t.status === 'overdue' || t.isOverdue) || [];
  const pendingTasks = tasks?.filter(t => t.status === 'pending' || t.status === 'in_progress') || [];

  return (
    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">
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
              <Calendar className="h-4 w-4" /> Consultations
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? <Skeleton className="h-10 w-20" /> : <div className="text-4xl font-bold tracking-tighter">{summary?.upcomingConsultations || 0}</div>}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h3 className="text-lg font-semibold tracking-tight">Recent Activity Feed</h3>
          </div>
          {summaryLoading ? (
            <div className="space-y-4">
               <Skeleton className="h-16 w-full" />
               <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <div className="space-y-0 border border-border bg-background">
              {summary?.recentActivity?.length ? summary.recentActivity.map((event, i) => (
                <div key={event.id} className={`p-4 flex gap-4 ${i !== summary.recentActivity.length - 1 ? 'border-b border-border' : ''} hover:bg-muted/50 transition-colors`}>
                  <Activity className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">{event.description}</span>
                    <span className="text-xs text-muted-foreground mt-1 font-mono uppercase tracking-wider">{formatDateTime(event.createdAt)}</span>
                  </div>
                </div>
              )) : (
                <div className="p-8 text-center text-muted-foreground text-sm font-mono uppercase tracking-wider">No recent activity</div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <h3 className="text-lg font-semibold tracking-tight">Priority Task Pipeline</h3>
            <Link href="/tasks" className="text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground flex items-center gap-1">
              View All <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          {tasksLoading ? (
            <div className="space-y-4">
               <Skeleton className="h-16 w-full" />
               <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <div className="space-y-0 border border-border bg-background">
              {pendingTasks.slice(0, 5).map((task, i) => (
                <div key={task.id} className={`p-4 flex gap-4 items-center ${i !== 4 ? 'border-b border-border' : ''} hover:bg-muted/50 transition-colors`}>
                  {task.priority === 'urgent' ? (
                    <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
                  ) : task.status === 'in_progress' ? (
                    <Clock className="h-5 w-5 text-primary shrink-0" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 text-muted-foreground shrink-0 opacity-50" />
                  )}
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
    </div>
  );
}

function ClientDashboard() {
  return (
    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">
      <div className="mb-8">
        <h2 className="text-3xl font-bold tracking-tight mb-2">Welcome to your Portal</h2>
        <p className="text-muted-foreground max-w-2xl">Access your case materials, track progress, and view upcoming consultations securely.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card className="bg-background border-border shadow-none rounded-none flex flex-col justify-center items-center py-12 px-6 text-center hover:border-primary transition-colors cursor-pointer" onClick={() => window.location.href='/client-portal'}>
          <Briefcase className="h-12 w-12 text-muted-foreground mb-4" />
          <CardTitle className="text-xl mb-2">My Cases</CardTitle>
          <CardDescription>View updates and documents for your active cases.</CardDescription>
        </Card>
        <Card className="bg-background border-border shadow-none rounded-none flex flex-col justify-center items-center py-12 px-6 text-center hover:border-primary transition-colors cursor-pointer">
          <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
          <CardTitle className="text-xl mb-2">Consultations</CardTitle>
          <CardDescription>View scheduled meetings and request new ones.</CardDescription>
        </Card>
      </div>
    </div>
  );
}
