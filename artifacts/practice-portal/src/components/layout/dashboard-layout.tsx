import { Link, Route, Switch, useLocation } from "wouter"
import { useSession } from "@/lib/session"
import { PreviewBar } from "@/components/preview-bar"
import { WorkspaceSwitcher } from "@/components/workspace-switcher"
import { RequireCapability } from "@/components/auth/route-guard"
import DashboardPage from "@/pages/dashboard"
import CasesPage from "@/pages/cases"
import CaseDetailPage from "@/pages/case-detail"
import TasksPage from "@/pages/tasks"
import ConsultationsPage from "@/pages/consultations"
import KpiPage from "@/pages/kpi"
import InvitesPage from "@/pages/invites"
import ClientPortalPage from "@/pages/client-portal"
import CalendarPage from "@/pages/calendar"
import DocumentsPage from "@/pages/documents"
import FeedbackPage from "@/pages/feedback"
import TeamPage from "@/pages/team"
import PendingApprovalPage from "@/pages/pending-approval"
import AccessDeniedPage from "@/pages/access-denied"
import UnauthorizedPage from "@/pages/unauthorized"
import NotFound from "@/pages/not-found"
import { Briefcase, LayoutDashboard, CheckSquare, PhoneCall, BarChart2, Users, LogOut, Loader2, ChevronRight, Calendar as CalendarIcon, CreditCard, ShieldCheck, FileText, Star } from "lucide-react"
import { PricingModalProvider, usePricingModal } from "@/components/pricing-modal"
import { NotificationBell } from "@/components/notification-bell"
import { GlobalSearch } from "@/components/global-search"
import { ThemeToggle } from "@/components/theme-toggle"
import { ErrorBoundary } from "@/components/error-boundary"

function DashboardLayoutContent() {
  const {
    isLoaded,
    isSignedIn,
    displayName,
    initial,
    signOut,
    claims,
    isPendingApproval,
    isNotRecognised,
    activeWorkspace,
    displayRole,
    can,
  } = useSession();
  const [location] = useLocation();
  const { setOpen: setPricingModalOpen } = usePricingModal();

  if (!isLoaded || (isSignedIn && !claims)) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isSignedIn) {
    window.location.href = import.meta.env.BASE_URL;
    return null;
  }

  // No ACTIVE membership anywhere: the account exists and reaches nothing. Both
  // screens below render the backend's answer, not a local decision — every API
  // call from these states returns 403 regardless of what the UI does.
  // The preview bar stays mounted so the identity switcher remains reachable;
  // without it, signing in as an unadmitted address would be a dead end.
  //
  // The two are distinguished deliberately: an address nobody has admitted needs
  // to be told so (and given a way to ask), while someone who has already asked
  // needs to be told their request is waiting.
  if (isNotRecognised) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PreviewBar />
        <AccessDeniedPage />
      </div>
    );
  }

  if (isPendingApproval || !activeWorkspace) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PreviewBar />
        <PendingApprovalPage />
      </div>
    );
  }

  // Nav visibility is a projection of the server-issued capability list. Hiding
  // an item is cosmetic; the route guard below and the API both re-check.
  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, show: true },
    { href: "/calendar", label: "Master Calendar", icon: CalendarIcon, show: can("calendar.read") },
    { href: "/client-portal", label: "My Portal", icon: Briefcase, show: !can("cases.write") && !can("tasks.read") },
    { href: "/cases", label: "Cases", icon: Briefcase, show: can("cases.write") },
    { href: "/tasks", label: "Tasks", icon: CheckSquare, show: can("tasks.read") },
    { href: "/documents", label: "Documents", icon: FileText, show: can("documents.read") },
    { href: "/feedback", label: can("feedback.write") ? "My Feedback" : "Client Feedback", icon: Star, show: can("feedback.read") },
    { href: "/consultations", label: "Consultations", icon: PhoneCall, show: can("consultations.write") },
    { href: "/kpi", label: "KPI Engine", icon: BarChart2, show: can("kpi.read") },
    { href: "/invites", label: "Access Control", icon: Users, show: can("access_control.manage") },
    { href: "/team", label: "Team Roles", icon: ShieldCheck, show: can("team.manage") },
  ].filter(item => item.show);

  return (
    <div className="min-h-screen bg-background text-foreground">
    <PreviewBar />
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-sidebar flex-shrink-0 flex flex-col relative z-20">
        <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
          <Link href="/dashboard" className="flex items-center gap-2 group">
            <div className="h-8 w-8 bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center font-mono font-bold tracking-tighter">
              LEX
            </div>
            <span className="font-mono font-semibold tracking-tight text-sidebar-foreground group-hover:text-primary transition-colors">
              PRACTICE
            </span>
          </Link>
        </div>

        <div className="p-3 border-b border-sidebar-border">
          <WorkspaceSwitcher />
        </div>

        <div className="flex-1 py-6 px-3 flex flex-col gap-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.startsWith(item.href) && item.href !== "/" && (item.href !== "/dashboard" || location === "/dashboard");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="p-4 border-t border-sidebar-border flex flex-col gap-2">
          {can("billing.manage") && (
            <button
              onClick={() => setPricingModalOpen(true)}
              className="flex items-center justify-center gap-2 w-full py-2 bg-gradient-to-r from-gray-300 to-gray-500 text-black font-bold rounded-none uppercase text-xs tracking-wider mb-2 hover:opacity-90 transition-opacity"
            >
              <CreditCard className="h-4 w-4" />
              Manage Subscription
            </button>
          )}
          <div className="flex items-center gap-3 px-3 py-3 border border-border bg-background shadow-sm">
            <div className="h-8 w-8 bg-muted flex items-center justify-center text-xs font-medium uppercase shrink-0">
              {initial}
            </div>
            <div className="flex flex-col flex-1 overflow-hidden">
              <span className="text-sm font-semibold truncate">{displayName}</span>
              <span className="text-xs text-muted-foreground truncate font-mono uppercase">{displayRole}</span>
            </div>
            <button
              onClick={() => signOut()}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 transition-colors"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-border bg-background flex items-center px-8 z-10 sticky top-0 justify-between">
          <div className="flex items-center gap-2 text-sm font-mono text-muted-foreground min-w-0">
            <span className="uppercase tracking-widest truncate">{activeWorkspace.name}</span>
            <ChevronRight className="h-3 w-3 shrink-0" />
            <span className="text-foreground capitalize truncate">{location.split('/')[1] || 'Dashboard'}</span>
          </div>

          <div className="flex items-center gap-3">
            <GlobalSearch />
            <NotificationBell />
            <ThemeToggle />
          </div>
        </header>

        <div className="flex-1 p-8 overflow-y-auto relative">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSJub25lIiAvPgo8cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJjdXJyZW50Q29sb3IiIG9wYWNpdHk9IjAuMDUiIC8+Cjwvc3ZnPg==')] opacity-[0.2] pointer-events-none z-0" />
          <div className="relative z-10 max-w-6xl mx-auto animate-in fade-in duration-500">
            {/*
              Restricted routes are wrapped, not merely hidden from the nav.
              Navigating straight to /kpi or /invites without the backend claim
              redirects to the 401 page instead of rendering the component.
            */}
            <Switch>
              <Route path="/dashboard" component={DashboardPage} />
              <Route path="/unauthorized" component={UnauthorizedPage} />
              <Route path="/calendar">
                <RequireCapability capability="calendar.read">
                  <ErrorBoundary label="Master Calendar"><CalendarPage /></ErrorBoundary>
                </RequireCapability>
              </Route>
              <Route path="/documents">
                <RequireCapability capability="documents.read">
                  <ErrorBoundary label="Documents"><DocumentsPage /></ErrorBoundary>
                </RequireCapability>
              </Route>
              <Route path="/feedback">
                <RequireCapability capability="feedback.read">
                  <ErrorBoundary label="Client Feedback"><FeedbackPage /></ErrorBoundary>
                </RequireCapability>
              </Route>
              <Route path="/cases">
                <RequireCapability capability="cases.write"><CasesPage /></RequireCapability>
              </Route>
              <Route path="/cases/:id">
                <RequireCapability capability="cases.read"><CaseDetailPage /></RequireCapability>
              </Route>
              <Route path="/tasks">
                <RequireCapability capability="tasks.read"><TasksPage /></RequireCapability>
              </Route>
              <Route path="/consultations">
                <RequireCapability capability="consultations.write"><ConsultationsPage /></RequireCapability>
              </Route>
              <Route path="/kpi">
                <RequireCapability capability="kpi.read"><KpiPage /></RequireCapability>
              </Route>
              <Route path="/invites">
                <RequireCapability capability="access_control.manage"><InvitesPage /></RequireCapability>
              </Route>
              <Route path="/team">
                <RequireCapability capability="team.manage"><TeamPage /></RequireCapability>
              </Route>
              <Route path="/client-portal" component={ClientPortalPage} />
              <Route component={NotFound} />
            </Switch>
          </div>
        </div>
      </main>
    </div>
    </div>
  );
}

export default function DashboardLayout() {
  return (
    <PricingModalProvider>
      <DashboardLayoutContent />
    </PricingModalProvider>
  );
}
