import { useState } from "react";
import {
  useGetDashboardSummary,
  useListTasks,
  getGetDashboardSummaryQueryKey,
  getListTasksQueryKey,
  useListDocumentRequests,
  useUpdateDocumentRequest,
  useListCalendarEntries,
  getListDocumentRequestsQueryKey,
  getListCalendarEntriesQueryKey,
} from "@workspace/api-client-react";
import { useUserRole } from "@/hooks/use-user-role";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Briefcase,
  CheckSquare,
  Calendar,
  Activity,
  AlertCircle,
  Clock,
  FileText,
  Upload,
  ListTodo,
  Archive,
  Check,
  Plus,
  Send,
  UserRound,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { usePricingModal } from "@/components/pricing-modal";
import { DocumentRequestModal } from "@/components/document-request-modal";
import { TaskFormModal } from "@/components/task-form-modal";
import { CaseFormModal } from "@/components/case-form-modal";
import { useSession } from "@/lib/session";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

/**
 * Quick-action tiles.
 *
 * These were nine separately hand-picked greys — slate-900, zinc-800,
 * stone-700, gray-800, neutral-700 and so on — drawn from a palette the rest of
 * the app does not use. That made the busiest surface on the dashboard the one
 * place a theme change could not reach, and the nine shades implied a ranking
 * between the actions that does not exist.
 *
 * One tile now: extruded from the ground, sinking when pressed, with the icon
 * carrying the accent. What distinguishes the tiles is the label, which is the
 * only thing that actually differs between them.
 */
const quickActionTile =
  "bg-card text-card-foreground rounded-lg shadow-md active:shadow-[var(--press)] " +
  "p-4 flex flex-col items-center justify-center gap-3 text-center " +
  "transition-shadow [&>svg]:text-primary";

export default function DashboardPage() {
  const { isStaff } = useUserRole();

  if (isStaff) {
    return <StaffDashboard />;
  }

  return <ClientDashboard />;
}

function StaffDashboard() {
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary({
    query: { refetchInterval: 30000, queryKey: getGetDashboardSummaryQueryKey() },
  });
  const { data: tasks, isLoading: tasksLoading } = useListTasks(undefined, {
    query: { refetchInterval: 30000, queryKey: getListTasksQueryKey() },
  });

  // Quick actions are gated on the capability list the backend issued, not on a
  // role the browser worked out for itself.
  const { can, activeWorkspace } = useSession();
  const { setOpen: setPricingModalOpen } = usePricingModal();
  const [, setLocation] = useLocation();
  const [docRequestOpen, setDocRequestOpen] = useState(false);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [caseFormOpen, setCaseFormOpen] = useState(false);

  const { data: docRequests = [] } = useListDocumentRequests({
    query: {
      queryKey: getListDocumentRequestsQueryKey(),
      enabled: can("document_requests.create"),
    },
  });
  const outstandingRequests = docRequests.filter((r) => r.status === "pending");

  // Real next hearing, from the calendar the caller can actually see — not a
  // hardcoded "None Scheduled".
  const { data: calendarEntries = [] } = useListCalendarEntries({
    query: { queryKey: getListCalendarEntriesQueryKey(), enabled: can("calendar.read") },
  });
  const todayIso = new Date().toISOString().slice(0, 10);
  const nextHearing = calendarEntries
    .filter((e) => e.kind === "hearing" && e.entryDate >= todayIso)
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate))[0];

  const overdueTasks = tasks?.filter((t) => t.status === "overdue" || t.isOverdue) || [];
  const pendingTasks =
    tasks?.filter((t) => t.status === "pending" || t.status === "in_progress") || [];

  return (
    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">
      {can("billing.manage") && (
        <div
          onClick={() => setPricingModalOpen(true)}
          className="w-full p-3 rounded-lg shadow-sm bg-secondary text-secondary-foreground font-bold uppercase font-mono tracking-widest text-center cursor-pointer hover:bg-secondary/80 transition-colors"
        >
          1-Month Free Trial Active &mdash; Upgrade Now
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-1">Status Overview</h2>
          <p className="text-muted-foreground font-mono text-sm uppercase tracking-wider">
            {activeWorkspace?.name} &middot; Auto-refresh 30s
          </p>
        </div>
        {/* Filing a matter is the first thing a chamber does, and it used to
            require navigating to the registry to find the button. It sits in
            the header block, which is above the fold at 375px as well as on a
            desktop. `w-full sm:w-auto` because two buttons side by side on a
            narrow phone leaves neither of them tappable. */}
        <div className="flex flex-col-reverse sm:flex-row gap-2 w-full md:w-auto shrink-0">
          {can("tasks.write") && (
            <Button
              variant="outline"
              className="rounded-lg w-full sm:w-auto"
              onClick={() => setTaskFormOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" /> New Task
            </Button>
          )}
          {can("cases.write") && (
            <Button
              className="rounded-lg w-full sm:w-auto"
              onClick={() => setCaseFormOpen(true)}
              data-testid="dashboard-file-case"
            >
              <Briefcase className="mr-2 h-4 w-4" /> File New Case
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase font-mono tracking-wider flex items-center gap-2">
              <Briefcase className="h-4 w-4" /> Active Cases
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-10 w-20" />
            ) : summary?.activeCases ? (
              <div className="text-4xl font-bold tracking-tighter">{summary.activeCases}</div>
            ) : (
              // A bare "0" is a dead end on a chamber's first day. Say what the
              // next step is, and make it the thing you click.
              <div className="space-y-2">
                <div className="text-4xl font-bold tracking-tighter text-muted-foreground">0</div>
                {can("cases.write") && (
                  <button
                    type="button"
                    onClick={() => setCaseFormOpen(true)}
                    className="text-xs font-mono uppercase tracking-wider text-primary hover:underline text-left"
                  >
                    File your first case →
                  </button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase font-mono tracking-wider flex items-center gap-2">
              <CheckSquare className="h-4 w-4" /> Pending Tasks
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-10 w-20" />
            ) : (
              <div className="text-4xl font-bold tracking-tighter">
                {summary?.pendingTasks || 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-destructive/10 text-destructive">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium uppercase font-mono tracking-wider flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> Overdue Tasks
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tasksLoading ? (
              <Skeleton className="h-10 w-20 bg-destructive/20" />
            ) : (
              <div className="text-4xl font-bold tracking-tighter">{overdueTasks.length}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase font-mono tracking-wider flex items-center gap-2">
              <Calendar className="h-4 w-4" /> Next Hearing
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nextHearing ? (
              <>
                <div className="text-lg font-bold tracking-tight truncate">
                  {new Date(`${nextHearing.entryDate}T00:00:00`).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                  })}
                </div>
                <p className="text-xs text-muted-foreground truncate mt-1">{nextHearing.title}</p>
              </>
            ) : (
              <div className="text-lg font-bold tracking-tight text-muted-foreground">
                None scheduled
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="pt-4 border-t border-border">
        <h3 className="text-xl font-bold tracking-tight mb-4 uppercase font-mono">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {can("tasks.write") && (
            <button
              onClick={() => setTaskFormOpen(true)}
              className={`${quickActionTile} animate-in fade-in slide-in-from-bottom-4 duration-500`}
            >
              <Plus className="h-8 w-8" />
              <span className="font-mono uppercase text-xs font-bold tracking-wider text-center">
                Create / Assign Task
              </span>
            </button>
          )}

          <button
            onClick={() => setLocation("/calendar")}
            className={`${quickActionTile} animate-in fade-in slide-in-from-bottom-4 duration-500 delay-75`}
          >
            <Calendar className="h-8 w-8" />
            <span className="font-mono uppercase text-xs font-bold tracking-wider text-center">
              Interactive Master Calendar
            </span>
          </button>

          {can("cases.write") && (
            <button
              onClick={() => setLocation("/cases")}
              className={`${quickActionTile} animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100`}
            >
              <AlertCircle className="h-8 w-8" />
              <span className="font-mono uppercase text-xs font-bold tracking-wider text-center">
                Priority / Urgent Cases
              </span>
            </button>
          )}

          {can("cases.write") && (
            <button
              onClick={() => setLocation("/tasks")}
              className={`${quickActionTile} animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150`}
            >
              <ListTodo className="h-8 w-8" />
              <span className="font-mono uppercase text-xs font-bold tracking-wider text-center">
                Pending Cases / Cause List
              </span>
            </button>
          )}

          <button
            onClick={() => setLocation("/tasks")}
            className={`${quickActionTile} animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200`}
          >
            <CheckSquare className="h-8 w-8" />
            <span className="font-mono uppercase text-xs font-bold tracking-wider text-center">
              My Assigned Work
            </span>
          </button>

          <button
            onClick={() => setLocation("/tasks")}
            className={`${quickActionTile} animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300`}
          >
            <Archive className="h-8 w-8" />
            <span className="font-mono uppercase text-xs font-bold tracking-wider text-center">
              Work Completed
            </span>
          </button>

          {can("cases.write") && (
            <button
              onClick={() => setLocation("/cases")}
              className={`${quickActionTile} animate-in fade-in slide-in-from-bottom-4 duration-500 delay-500`}
            >
              <FileText className="h-8 w-8" />
              <span className="font-mono uppercase text-xs font-bold tracking-wider text-center">
                Case Briefs & Drafting
              </span>
            </button>
          )}

          <button
            onClick={() => setLocation("/cases")}
            className={`${quickActionTile} animate-in fade-in slide-in-from-bottom-4 duration-500 delay-[600ms]`}
          >
            <Upload className="h-8 w-8" />
            <span className="font-mono uppercase text-xs font-bold tracking-wider text-center">
              Upload Digital Copy
            </span>
          </button>

          {can("cases.write") && (
            <button
              onClick={() => setDocRequestOpen(true)}
              className={`${quickActionTile} animate-in fade-in slide-in-from-bottom-4 duration-500 delay-[700ms]`}
            >
              <FileText className="h-8 w-8" />
              <span className="font-mono uppercase text-xs font-bold tracking-wider text-center">
                Request Client Document
              </span>
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
                <div
                  key={task.id}
                  className="p-4 border-l-4 border-l-destructive bg-destructive/5 border-y border-r border-border flex items-center gap-4"
                >
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="font-medium text-sm truncate text-destructive">
                      {task.title}
                    </span>
                    <span className="text-xs text-destructive/80 mt-1 font-mono uppercase tracking-wider flex gap-2">
                      <span>Due {new Date(task.deadline).toLocaleDateString()}</span>
                    </span>
                  </div>
                  <Link
                    href={`/cases/${task.caseId}`}
                    className="text-xs border border-destructive/20 px-3 py-1.5 hover:bg-destructive/10 transition-colors shrink-0 text-destructive"
                  >
                    Case {task.caseId}
                  </Link>
                </div>
              ))}
              {overdueTasks.length === 0 && (
                <div className="p-8 text-center text-muted-foreground text-sm font-mono uppercase tracking-wider">
                  No overdue items
                </div>
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
                <div
                  key={task.id}
                  className="p-4 rounded-lg bg-card shadow-sm flex items-center gap-4 hover:border-primary/50 transition-colors group"
                >
                  <Clock className="h-5 w-5 text-primary shrink-0" />
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="font-medium text-sm truncate">{task.title}</span>
                    <span className="text-xs text-muted-foreground mt-1 font-mono uppercase tracking-wider flex gap-2">
                      <span
                        className={task.priority === "urgent" ? "text-destructive font-bold" : ""}
                      >
                        {task.priority}
                      </span>
                      <span>&middot;</span>
                      <span>Due {new Date(task.deadline).toLocaleDateString()}</span>
                    </span>
                  </div>
                  <Link
                    href={`/cases/${task.caseId}`}
                    className="text-xs border border-border px-3 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors shrink-0"
                  >
                    Case {task.caseId}
                  </Link>
                </div>
              ))}
              {pendingTasks.length === 0 && (
                <div className="p-8 text-center text-muted-foreground text-sm font-mono uppercase tracking-wider">
                  No pending tasks
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {can("document_requests.create") && (
        <div className="pt-4 border-t border-border">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
            <h3 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <Send className="h-5 w-5 text-muted-foreground" /> Document requests out
            </h3>
            <Button
              variant="outline"
              className="shrink-0 self-start sm:self-auto"
              onClick={() => setDocRequestOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" /> Request a document
            </Button>
          </div>

          {outstandingRequests.length === 0 ? (
            <div className="p-8 text-center rounded-lg bg-background shadow-[var(--press-sm)] text-muted-foreground text-sm font-mono uppercase tracking-wider">
              Nothing outstanding
            </div>
          ) : (
            <div className="space-y-2">
              {outstandingRequests.slice(0, 5).map((req) => (
                <div
                  key={req.id}
                  className="p-4 rounded-lg bg-card shadow-sm flex flex-col sm:flex-row sm:items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{req.documentName}</p>
                    {/* Both parties named: who it is addressed to and who raised it. */}
                    <p className="text-xs text-muted-foreground mt-1 font-mono uppercase tracking-wider flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="flex items-center gap-1 text-foreground">
                        <UserRound className="h-3 w-3" />
                        From: {req.requestedFromName || req.clientName || "Client"}
                      </span>
                      <span>&middot;</span>
                      <span>
                        Asked by {req.requestedBy}
                        {req.requestedByRole ? ` (${req.requestedByRole})` : ""}
                      </span>
                      {req.dueDate && (
                        <>
                          <span>&middot;</span>
                          <span
                            className={
                              new Date(req.dueDate) < new Date() ? "text-destructive font-bold" : ""
                            }
                          >
                            Due {new Date(req.dueDate).toLocaleDateString()}
                          </span>
                        </>
                      )}
                    </p>
                    {req.caseTitle && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        Matter: {req.caseTitle}
                      </p>
                    )}
                  </div>
                  <span className="text-xs font-mono uppercase tracking-wider border border-border px-3 py-1.5 text-muted-foreground shrink-0">
                    Awaiting upload
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <DocumentRequestModal open={docRequestOpen} onOpenChange={setDocRequestOpen} />
      <TaskFormModal open={taskFormOpen} onOpenChange={setTaskFormOpen} />
      {/* Same component the Case Registry uses, so conflict screening and the
          plan limit behave identically from either entry point. */}
      <CaseFormModal open={caseFormOpen} onOpenChange={setCaseFormOpen} />
    </div>
  );
}

function ClientDashboard() {
  const { data: requests = [], isLoading } = useListDocumentRequests({
    query: { queryKey: getListDocumentRequestsQueryKey() },
  });
  const updateRequest = useUpdateDocumentRequest();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const pendingRequests = requests.filter((r) => r.status === "pending");

  const handleAction = (id: number, status: "fulfilled" | "dismissed") => {
    updateRequest.mutate(
      { id, data: { status } },
      {
        onSuccess: () => {
          toast({ title: `Request ${status}` });
          queryClient.invalidateQueries({ queryKey: getListDocumentRequestsQueryKey() });
        },
      },
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">
      <div className="mb-8">
        <h2 className="text-3xl font-bold tracking-tight mb-2">Welcome to your Portal</h2>
        <p className="text-muted-foreground max-w-2xl">
          Access your case materials, track progress, and view upcoming consultations securely.
        </p>
      </div>

      {/* Action Required: Pending Document Requests */}
      <div className="bg-background text-foreground p-6 rounded-lg shadow-[var(--press)] mb-8">
        <h3 className="text-xl font-bold tracking-tight mb-4 flex items-center gap-2 uppercase font-mono">
          <AlertCircle className="h-5 w-5" /> Action Required: Pending Document Requests
        </h3>

        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : pendingRequests.length > 0 ? (
          <div className="space-y-3">
            {pendingRequests.map((req) => (
              <div
                key={req.id}
                className="bg-card p-4 rounded-lg shadow-sm flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center"
              >
                <div className="min-w-0">
                  <h4 className="font-bold font-mono tracking-tight text-lg">{req.documentName}</h4>
                  <div className="text-sm text-muted-foreground font-mono mt-1 space-y-1">
                    {/* Names the requester and their role, so the client knows who is asking. */}
                    <p>
                      Requested by: {req.requestedBy || "Firm"}
                      {req.requestedByRole ? ` (${req.requestedByRole})` : ""}
                    </p>
                    {req.caseTitle && <p className="opacity-80">Matter: {req.caseTitle}</p>}
                    {req.dueDate && (
                      <p
                        className={
                          new Date(req.dueDate) < new Date() ? "text-destructive font-bold" : ""
                        }
                      >
                        Needed by: {new Date(req.dueDate).toLocaleDateString()}
                      </p>
                    )}
                    {req.note && <p className="italic opacity-80">"{req.note}"</p>}
                    <p className="text-xs opacity-60 uppercase tracking-widest">
                      Raised {new Date(req.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <Button
                    variant="outline"
                    className="flex-1 sm:flex-none font-mono uppercase text-xs"
                    onClick={() => handleAction(req.id, "dismissed")}
                    disabled={updateRequest.isPending}
                  >
                    Dismiss
                  </Button>
                  <Button
                    className="flex-1 sm:flex-none font-mono uppercase text-xs font-bold"
                    onClick={() => handleAction(req.id, "fulfilled")}
                    disabled={updateRequest.isPending}
                  >
                    Mark Fulfilled
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center rounded-lg bg-background shadow-[var(--press-sm)]">
            <p className="text-muted-foreground text-sm font-mono uppercase tracking-wider flex items-center justify-center gap-2">
              <Check className="h-4 w-4" /> No pending requests — you're all caught up.
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card
          className="flex flex-col justify-center items-center py-12 px-6 text-center hover:border-primary transition-colors cursor-pointer"
          onClick={() => (window.location.href = "/client-portal")}
        >
          <Briefcase className="h-12 w-12 text-muted-foreground mb-4" />
          <CardTitle className="text-xl mb-2">My Cases</CardTitle>
          <CardDescription>View updates and documents for your active cases.</CardDescription>
        </Card>
        <Card
          className="flex flex-col justify-center items-center py-12 px-6 text-center hover:border-primary transition-colors cursor-pointer"
          onClick={() => (window.location.href = "/client-portal")}
        >
          <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
          <CardTitle className="text-xl mb-2">Consultations</CardTitle>
          <CardDescription>View scheduled meetings and details.</CardDescription>
        </Card>
      </div>
    </div>
  );
}
