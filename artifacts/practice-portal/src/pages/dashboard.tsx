import { useState } from "react";
import {
  useGetDashboardSummary,
  useListTasks,
  useListCases,
  getGetDashboardSummaryQueryKey,
  getListTasksQueryKey,
  getListCasesQueryKey,
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
  Check,
  Plus,
  Send,
  UserRound,
  PenLine,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { PlanBanner } from "@/components/plan-banner";
import { CredentialsNotice } from "@/components/credentials-notice";
import { DraftingNotice } from "@/components/drafting/drafting-notice";
import { NoticeStrip } from "@/components/notice-strip";
import { DocumentRequestModal } from "@/components/document-request-modal";
import { TaskFormModal } from "@/components/task-form-modal";
import { CaseFormModal } from "@/components/case-form-modal";
import {
  StatDetailDialog,
  StatCardButton,
  MaybeStatButton,
  type StatRow,
} from "@/components/stat-detail-dialog";
import { useSession } from "@/lib/session";
import { greet, todayLong } from "@/lib/greeting";
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
  "p-3 sm:p-4 min-h-24 flex flex-col items-center justify-center gap-2 sm:gap-3 text-center " +
  "transition-shadow [&>svg]:text-primary [&>svg]:h-6 [&>svg]:w-6 sm:[&>svg]:h-7 sm:[&>svg]:w-7 " +
  // Keyboard users got nothing here: these are <button>s with no focus style.
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-background";

export default function DashboardPage() {
  const { isStaff } = useUserRole();

  if (isStaff) {
    return <StaffDashboard />;
  }

  return <ClientDashboard />;
}

/**
 * One numbered step in the first-run panel.
 *
 * A separate component only so the three steps cannot drift apart in spacing
 * or type — three copies of the same markup is how a list ends up with one
 * item a pixel out.
 */
function FirstRunStep({
  n,
  title,
  body,
  action,
}: {
  n: number;
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-xs font-bold text-secondary-foreground">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
      </div>
      <div className="shrink-0 sm:pt-0.5">{action}</div>
    </li>
  );
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
  const { can, activeWorkspace, displayName } = useSession();
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

  /**
   * The rows behind each stat card.
   *
   * `/dashboard/summary` returns counts and nothing else, so the lists come from
   * queries this page already makes. That is not only cheaper than a new
   * endpoint — it is what guarantees the popup and the number agree, because
   * they are the same rows counted twice rather than two separate answers.
   *
   * Cases are the one addition: the summary reports `activeCases` but never says
   * which. Scoped by the server to what this caller may see, like every other
   * list.
   */
  const { data: cases = [] } = useListCases(undefined, {
    query: { queryKey: getListCasesQueryKey(), enabled: can("cases.read") },
  });
  const openCases = cases.filter((c) => c.status !== "closed");

  const [openStat, setOpenStat] = useState<"cases" | "pending" | "overdue" | "hearings" | null>(
    null,
  );

  const dueLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

  const caseRows: StatRow[] = openCases.map((c) => ({
    id: c.id,
    title: c.title,
    subtitle: `${c.filingRef} · ${c.clientName ?? "No client assigned"}`,
    trailing: c.priority,
    href: `/cases/${c.id}`,
  }));

  const taskRow = (t: (typeof pendingTasks)[number]): StatRow => ({
    id: t.id,
    title: t.title,
    subtitle: t.assigneeName ? `Assigned to ${t.assigneeName}` : "Unassigned",
    trailing: `due ${dueLabel(t.deadline)}`,
    href: `/cases/${t.caseId}`,
  });

  const hearingRows: StatRow[] = calendarEntries
    .filter((e) => e.kind === "hearing" && e.entryDate >= todayIso)
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate))
    .map((e) => ({
      id: e.id,
      title: e.title,
      subtitle: e.caseId ? `Matter ${e.caseId}` : undefined,
      trailing: dueLabel(e.entryDate),
      href: "/calendar",
    }));

  return (
    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">
      {/* All three still render for everyone and still render nothing when they
          do not apply. The strip collapses them into one row and counts what is
          outstanding — see components/notice-strip.tsx for why the counting has
          to happen inside each notice. */}
      <NoticeStrip>
        <PlanBanner canManage={can("billing.manage")} />
        <CredentialsNotice />
        <DraftingNotice />
      </NoticeStrip>

      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-end">
        <div>
          {/* The greeting replaces "Status Overview" rather than sitting above
              it. A heading that names the screen you are already looking at is
              the least useful line on the page; the chamber, the day and the
              refresh cadence underneath carry the orientation it was doing. */}
          <h2 className="text-3xl font-bold tracking-tight mb-1">{greet(displayName)}</h2>
          <p className="text-muted-foreground text-sm">
            {activeWorkspace?.name} &middot; {todayLong()} &middot; Refreshes every 30s
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

      {/*
        A chamber's first screen used to be four zeros and an empty table.
        ────────────────────────────────────────────────────────────────────
        Four counters reading nothing is a dead screen, and it is the first
        impression of the product for every chamber that ever signs up. It also
        teaches nothing: the numbers are meaningless until there is a matter,
        and the way to get one is not on the screen.

        This replaces the stat row until the first matter exists, and never
        appears again after that — the condition is the matter count, not a
        dismissal flag, so it cannot be got wrong or come back.

        Held until `summaryLoading` clears. Rendering it during the first load
        would flash the first-run panel at every existing chamber on every
        refresh, which is a worse bug than the one being fixed.
      */}
      {!summaryLoading && openCases.length === 0 && can("cases.write") ? (
        <div className="rounded-[var(--radius)] bg-card p-5 sm:p-6 shadow-[var(--raise)]">
          <h3 className="text-lg font-bold tracking-tight">Your chamber is empty</h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-xl">
            Three things worth doing first. This panel goes away for good once you file a matter.
          </p>

          <ol className="mt-5 space-y-3">
            <FirstRunStep
              n={1}
              title="File your first matter"
              body="Everything else hangs off a matter — hearings, tasks, documents, time and the invoice at the end."
              action={
                <Button size="sm" className="rounded-lg" onClick={() => setCaseFormOpen(true)}>
                  File a matter
                </Button>
              }
            />
            {can("access_control.manage") && (
              <FirstRunStep
                n={2}
                title="Admit your clerk and your juniors"
                body="Nobody reaches this chamber until you put their address on the access list, and you choose what each of them may see."
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg"
                    onClick={() => setLocation("/invites")}
                  >
                    Open access control
                  </Button>
                }
              />
            )}
            {can("drafting.use") && (
              <FirstRunStep
                n={3}
                title="Decide about AI drafting"
                body="Off until you switch it on. When it is on, matter facts and document text are sent to an AI provider — read the note before deciding."
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg"
                    onClick={() => setLocation("/drafting")}
                  >
                    See what it does
                  </Button>
                }
              />
            )}
          </ol>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          {/*
          The only card that is not always a button. At zero it holds its own
          "File your first case" action, and a button inside a button is invalid
          markup — but it is also the right behaviour: opening an empty list
          teaches nobody anything, while the empty state already offers the one
          move worth making.
        */}
          <MaybeStatButton
            active={Boolean(summary?.activeCases)}
            onClick={() => setOpenStat("cases")}
            label={`Active cases: ${summary?.activeCases ?? 0}. Open the list.`}
          >
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Briefcase className="h-4 w-4" /> Active cases
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
                    <div className="text-4xl font-bold tracking-tighter text-muted-foreground">
                      0
                    </div>
                    {can("cases.write") && (
                      <button
                        type="button"
                        onClick={() => setCaseFormOpen(true)}
                        className="text-sm text-primary hover:underline text-left"
                      >
                        File your first case →
                      </button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </MaybeStatButton>

          <StatCardButton
            onClick={() => setOpenStat("pending")}
            label={`Pending tasks: ${summary?.pendingTasks ?? 0}. Open the list.`}
          >
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <CheckSquare className="h-4 w-4" /> Pending tasks
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
          </StatCardButton>

          <StatCardButton
            onClick={() => setOpenStat("overdue")}
            label={`Overdue tasks: ${overdueTasks.length}. Open the list.`}
          >
            <Card className="bg-destructive/10 text-destructive">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" /> Overdue tasks
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
          </StatCardButton>

          <MaybeStatButton
            active={hearingRows.length > 0}
            onClick={() => setOpenStat("hearings")}
            label={`Next hearing. ${hearingRows.length} upcoming. Open the list.`}
          >
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Calendar className="h-4 w-4" /> Next hearing
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
                    <p className="text-xs text-muted-foreground truncate mt-1">
                      {nextHearing.title}
                    </p>
                  </>
                ) : (
                  <div className="text-lg font-bold tracking-tight text-muted-foreground">
                    None scheduled
                  </div>
                )}
              </CardContent>
            </Card>
          </MaybeStatButton>
        </div>
      )}

      {/* One dialog, four sets of rows. Rendering four would duplicate the
          shell for no gain — only one can be open. */}
      <StatDetailDialog
        open={openStat === "cases"}
        onOpenChange={(o) => !o && setOpenStat(null)}
        title="Active cases"
        description="Every matter that is not closed, as far as your role can see."
        rows={caseRows}
        emptyMessage="No open matters."
        seeAllHref="/cases"
        seeAllLabel="Open the case registry"
      />
      <StatDetailDialog
        open={openStat === "pending"}
        onOpenChange={(o) => !o && setOpenStat(null)}
        title="Pending tasks"
        description="Not yet complete. Earliest deadline first."
        rows={[...pendingTasks].sort((a, b) => a.deadline.localeCompare(b.deadline)).map(taskRow)}
        emptyMessage="Nothing outstanding."
        seeAllHref="/tasks"
        seeAllLabel="Open the task list"
      />
      <StatDetailDialog
        open={openStat === "overdue"}
        onOpenChange={(o) => !o && setOpenStat(null)}
        title="Overdue tasks"
        description="Past their deadline and still open. Oldest first."
        rows={[...overdueTasks].sort((a, b) => a.deadline.localeCompare(b.deadline)).map(taskRow)}
        emptyMessage="Nothing is overdue — every deadline is still ahead of you."
        seeAllHref="/tasks"
        seeAllLabel="Open the task list"
      />
      <StatDetailDialog
        open={openStat === "hearings"}
        onOpenChange={(o) => !o && setOpenStat(null)}
        title="Upcoming hearings"
        description="Scheduled from today onward, soonest first."
        rows={hearingRows}
        emptyMessage="No hearings scheduled."
        seeAllHref="/calendar"
        seeAllLabel="Open the calendar"
      />

      {/*
        Four tiles, not ten.
        ────────────────────────────────────────────────────────────────────
        The grid used to carry ten, and an audit of where they actually went
        found six that did not do what they said. "My Assigned Work", "Work
        Completed" and "Pending Cases / Cause List" all navigated to the same
        unfiltered /tasks; "Case Briefs & Drafting" and "Upload Digital Copy"
        both went to /cases, which neither drafts nor uploads; "Priority /
        Urgent Cases" went to an unfiltered list too.

        Three different labels wired to one route is the most legible sign of
        a screen assembled rather than designed, and each one costs a person a
        click plus the moment of working out that nothing was filtered. What
        survives is the four that do exactly what they promise.

        The staggered `delay-[700ms]` entrance went with them. Motion inside
        the application was ruled out deliberately (see index.css) and a
        dashboard whose last tile arrives two thirds of a second late is the
        clearest possible contradiction of that.
      */}
      <div className="pt-4 border-t border-border">
        <h3 className="text-2xs font-mono font-bold uppercase tracking-widest text-muted-foreground mb-4">
          Quick actions
        </h3>
        {/* Five columns at lg, not four: with five tiles a four-column grid
            orphans the last one onto a row of its own, which reads as an
            afterthought rather than a set. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
          {can("cases.write") && (
            <button onClick={() => setCaseFormOpen(true)} className={quickActionTile}>
              <Briefcase className="h-8 w-8" />
              <span className="text-sm font-medium text-center">File a new matter</span>
            </button>
          )}

          {can("tasks.write") && (
            <button onClick={() => setTaskFormOpen(true)} className={quickActionTile}>
              <Plus className="h-8 w-8" />
              <span className="text-sm font-medium text-center">Create / assign task</span>
            </button>
          )}

          {/* Drafting is the thing an advocate opens this product to do, so it
              sits in the first row rather than at the end. */}
          {can("drafting.use") && (
            <button onClick={() => setLocation("/drafting")} className={quickActionTile}>
              <PenLine className="h-8 w-8" />
              <span className="text-sm font-medium text-center">Draft with AI</span>
            </button>
          )}

          {can("calendar.read") && (
            <button onClick={() => setLocation("/calendar")} className={quickActionTile}>
              <Calendar className="h-8 w-8" />
              <span className="text-sm font-medium text-center">Master calendar</span>
            </button>
          )}

          {can("cases.write") && (
            <button onClick={() => setDocRequestOpen(true)} className={quickActionTile}>
              <FileText className="h-8 w-8" />
              <span className="text-sm font-medium text-center">Request a client document</span>
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
                <div className="p-8 text-center">
                  <p className="font-medium text-sm">Nothing overdue</p>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed max-w-xs mx-auto">
                    Every task with a deadline is still inside it. Anything that slips past its date
                    appears here.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <h3 className="text-xl font-bold tracking-tight mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" /> Pending tasks
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
                <div className="p-8 text-center">
                  <p className="font-medium text-sm">No open tasks</p>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed max-w-xs mx-auto">
                    Nothing is waiting on the chamber right now.
                    {can("tasks.write") ? " Create one to put work in the pipeline." : ""}
                  </p>
                  {can("tasks.write") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg mt-3"
                      onClick={() => setTaskFormOpen(true)}
                    >
                      <Plus className="mr-2 h-4 w-4" /> New task
                    </Button>
                  )}
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
            <div className="p-8 text-center rounded-lg bg-background shadow-[var(--press-sm)]">
              <p className="font-medium text-sm">No documents requested</p>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed max-w-sm mx-auto">
                When you ask a client for a document, it is tracked here until they upload it.
              </p>
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
  const { activeWorkspace, displayName } = useSession();
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
        {/* Same greeting a member of the chamber gets. A client signing in to
            read their own matter is a person arriving, not a lesser case of
            one — and the chamber's name is the thing they need to see, since
            they may be a client of more than one. */}
        <h2 className="text-3xl font-bold tracking-tight mb-1">{greet(displayName)}</h2>
        <p className="text-muted-foreground font-mono text-sm uppercase tracking-wider mb-3">
          {activeWorkspace?.name} &middot; {todayLong()}
        </p>
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
