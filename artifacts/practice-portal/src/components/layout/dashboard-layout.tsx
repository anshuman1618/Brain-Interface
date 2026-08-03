import { Link, Route, Switch, useLocation } from "wouter";
import { useSession } from "@/lib/session";
import { PreviewBar } from "@/components/preview-bar";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { RequireCapability } from "@/components/auth/route-guard";
import DashboardPage from "@/pages/dashboard";
import CasesPage from "@/pages/cases";
import CaseDetailPage from "@/pages/case-detail";
import TasksPage from "@/pages/tasks";
import ConsultationsPage from "@/pages/consultations";
import KpiPage from "@/pages/kpi";
import InvitesPage from "@/pages/invites";
import ClientPortalPage from "@/pages/client-portal";
import CalendarPage from "@/pages/calendar";
import DocumentsPage from "@/pages/documents";
import FeedbackPage from "@/pages/feedback";
import TeamPage from "@/pages/team";
import PendingApprovalPage from "@/pages/pending-approval";
import AccessDeniedPage from "@/pages/access-denied";
import UnauthorizedPage from "@/pages/unauthorized";
import NotFound from "@/pages/not-found";
import {
  Briefcase,
  LayoutDashboard,
  CheckSquare,
  PhoneCall,
  BarChart2,
  Users,
  LogOut,
  Loader2,
  ChevronRight,
  Calendar as CalendarIcon,
  CreditCard,
  ShieldCheck,
  FileText,
  Star,
  MoreVertical,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { PricingModalProvider, usePricingModal } from "@/components/pricing-modal";
import { NotificationBell } from "@/components/notification-bell";
import { GlobalSearch } from "@/components/global-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { ErrorBoundary } from "@/components/error-boundary";

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
    {
      href: "/client-portal",
      label: "My Portal",
      icon: Briefcase,
      show: !can("cases.write") && !can("tasks.read"),
    },
    { href: "/cases", label: "Cases", icon: Briefcase, show: can("cases.write") },
    { href: "/tasks", label: "Tasks", icon: CheckSquare, show: can("tasks.read") },
    { href: "/documents", label: "Documents", icon: FileText, show: can("documents.read") },
    {
      href: "/feedback",
      label: can("feedback.write") ? "My Feedback" : "Client Feedback",
      icon: Star,
      show: can("feedback.read"),
    },
    {
      href: "/consultations",
      label: "Consultations",
      icon: PhoneCall,
      show: can("consultations.write"),
    },
    { href: "/kpi", label: "KPI Engine", icon: BarChart2, show: can("kpi.read") },
    { href: "/invites", label: "Access Control", icon: Users, show: can("access_control.manage") },
    { href: "/team", label: "Team Roles", icon: ShieldCheck, show: can("team.manage") },
  ].filter((item) => item.show);

  const activeItem = navItems.find(
    (item) =>
      location.startsWith(item.href) &&
      item.href !== "/" &&
      (item.href !== "/dashboard" || location === "/dashboard"),
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PreviewBar />
      <div className="flex min-h-screen bg-background text-foreground">
        {/*
          Navigation lives behind the three-dot button on this rail rather than
          in a permanently expanded list. The rail keeps the menu anchored to a
          fixed spot on the left, so the destination list is always one click
          from the same place no matter which page is open.
        */}
        {/* Sticky and exactly one viewport tall: the menu button and the
            signed-in identity must both stay reachable on a long page, which
            they would not be if the rail grew with the content and pushed the
            avatar below the fold. */}
        <aside className="w-16 border-r border-border bg-sidebar shrink-0 flex flex-col items-center sticky top-0 h-screen z-20">
          <div className="h-16 flex items-center justify-center border-b border-sidebar-border w-full">
            <Link href="/dashboard" title="LEX Practice">
              <div className="h-9 w-9 bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center font-mono font-bold tracking-tighter text-xs">
                LEX
              </div>
            </Link>
          </div>

          <div className="py-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="h-10 w-10 flex items-center justify-center text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground transition-colors"
                  aria-label="Open navigation menu"
                >
                  <MoreVertical className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="right"
                align="start"
                sideOffset={8}
                className="w-60 rounded-none"
              >
                <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Go to
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {navItems.map((item) => {
                  const isActive = item.href === activeItem?.href;
                  return (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link
                        href={item.href}
                        className={`flex items-center gap-3 cursor-pointer rounded-none ${
                          isActive ? "bg-accent font-semibold text-accent-foreground" : ""
                        }`}
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  );
                })}

                {can("billing.manage") && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => setPricingModalOpen(true)}
                      className="flex items-center gap-3 cursor-pointer rounded-none"
                    >
                      <CreditCard className="h-4 w-4 shrink-0" />
                      Subscription
                    </DropdownMenuItem>
                  </>
                )}

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => signOut()}
                  className="flex items-center gap-3 cursor-pointer rounded-none text-destructive focus:text-destructive"
                >
                  <LogOut className="h-4 w-4 shrink-0" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Identity stays visible on the rail: which account you are signed in
              as should never require opening a menu to discover. */}
          <div className="mt-auto pb-4 flex flex-col items-center gap-2">
            <div
              className="h-9 w-9 bg-muted flex items-center justify-center text-xs font-medium uppercase"
              title={`${displayName} - ${displayRole}`}
            >
              {initial}
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0">
          <header className="h-16 border-b border-border bg-background flex items-center gap-4 px-6 z-10 sticky top-0 justify-between">
            <div className="flex items-center gap-4 min-w-0">
              {/* The switcher moves up here now that the sidebar is a rail. It
                  is a tenant boundary, not a nav item, so it stays in sight. */}
              <div className="w-56 shrink-0 hidden sm:block">
                <WorkspaceSwitcher />
              </div>
              <div className="flex items-center gap-2 text-sm font-mono text-muted-foreground min-w-0">
                <ChevronRight className="h-3 w-3 shrink-0 hidden sm:block" />
                <span className="text-foreground truncate">{activeItem?.label ?? "Dashboard"}</span>
              </div>
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
                    <ErrorBoundary label="Master Calendar">
                      <CalendarPage />
                    </ErrorBoundary>
                  </RequireCapability>
                </Route>
                <Route path="/documents">
                  <RequireCapability capability="documents.read">
                    <ErrorBoundary label="Documents">
                      <DocumentsPage />
                    </ErrorBoundary>
                  </RequireCapability>
                </Route>
                <Route path="/feedback">
                  <RequireCapability capability="feedback.read">
                    <ErrorBoundary label="Client Feedback">
                      <FeedbackPage />
                    </ErrorBoundary>
                  </RequireCapability>
                </Route>
                <Route path="/cases">
                  <RequireCapability capability="cases.write">
                    <CasesPage />
                  </RequireCapability>
                </Route>
                <Route path="/cases/:id">
                  <RequireCapability capability="cases.read">
                    <CaseDetailPage />
                  </RequireCapability>
                </Route>
                <Route path="/tasks">
                  <RequireCapability capability="tasks.read">
                    <TasksPage />
                  </RequireCapability>
                </Route>
                <Route path="/consultations">
                  <RequireCapability capability="consultations.write">
                    <ConsultationsPage />
                  </RequireCapability>
                </Route>
                <Route path="/kpi">
                  <RequireCapability capability="kpi.read">
                    <KpiPage />
                  </RequireCapability>
                </Route>
                <Route path="/invites">
                  <RequireCapability capability="access_control.manage">
                    <InvitesPage />
                  </RequireCapability>
                </Route>
                <Route path="/team">
                  <RequireCapability capability="team.manage">
                    <TeamPage />
                  </RequireCapability>
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
