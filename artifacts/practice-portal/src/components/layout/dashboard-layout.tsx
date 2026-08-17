import { lazy, Suspense } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import { useSession } from "@/lib/session";
import { PreviewBar } from "@/components/preview-bar";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { RequireCapability } from "@/components/auth/route-guard";
import DashboardPage from "@/pages/dashboard";
/**
 * Everything except the dashboard is loaded on demand.
 *
 * The calendar alone pulls in react-big-calendar, react-dnd and moment; a
 * client who only ever opens their own portal should not download any of it.
 * Each of these becomes its own chunk, fetched the first time its route is
 * visited and cached thereafter.
 */
const CasesPage = lazy(() => import("@/pages/cases"));
const CaseDetailPage = lazy(() => import("@/pages/case-detail"));
const TasksPage = lazy(() => import("@/pages/tasks"));
const ConsultationsPage = lazy(() => import("@/pages/consultations"));
const KpiPage = lazy(() => import("@/pages/kpi"));
const InvoicesPage = lazy(() => import("@/pages/invoices"));
const InvitesPage = lazy(() => import("@/pages/invites"));
const ClientPortalPage = lazy(() => import("@/pages/client-portal"));
const CalendarPage = lazy(() => import("@/pages/calendar"));
const DocumentsPage = lazy(() => import("@/pages/documents"));
const FeedbackPage = lazy(() => import("@/pages/feedback"));
const TeamPage = lazy(() => import("@/pages/team"));
const ActivityPage = lazy(() => import("@/pages/activity"));
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
  History,
  Receipt,
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
    { href: "/invoices", label: "Invoices", icon: Receipt, show: can("billing.manage") },
    { href: "/invites", label: "Access Control", icon: Users, show: can("access_control.manage") },
    { href: "/team", label: "Team Roles", icon: ShieldCheck, show: can("team.manage") },
    { href: "/activity", label: "Activity", icon: History, show: can("audit.read") },
    // Everyone gets their own data rights; admins additionally see the queue.
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
        <aside className="w-12 sm:w-16 border-r border-border bg-sidebar shrink-0 flex flex-col items-center sticky top-0 h-dvh z-20">
          <div className="h-14 sm:h-16 flex items-center justify-center border-b border-sidebar-border w-full">
            <Link href="/dashboard" title="LEX Practice">
              <div className="h-8 w-8 sm:h-9 sm:w-9 bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center font-mono font-bold tracking-tighter text-3xs sm:text-xs">
                LEX
              </div>
            </Link>
          </div>

          <div className="py-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="h-11 w-11 flex items-center justify-center text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground transition-colors"
                  aria-label="Open navigation menu"
                >
                  <MoreVertical className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="right"
                align="start"
                sideOffset={8}
                collisionPadding={8}
                className="w-[min(15rem,calc(100vw-4.5rem))] rounded-lg"
              >
                <DropdownMenuLabel className="font-mono text-3xs uppercase tracking-widest text-muted-foreground">
                  Go to
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {navItems.map((item) => {
                  const isActive = item.href === activeItem?.href;
                  return (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link
                        href={item.href}
                        className={`flex items-center gap-3 cursor-pointer rounded-lg min-h-11 ${
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
                      className="flex items-center gap-3 cursor-pointer rounded-lg min-h-11"
                    >
                      <CreditCard className="h-4 w-4 shrink-0" />
                      Subscription
                    </DropdownMenuItem>
                  </>
                )}

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => signOut()}
                  className="flex items-center gap-3 cursor-pointer rounded-lg min-h-11 text-destructive focus:text-destructive"
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
          {/*
            z-30, above the sidebar rail's z-20, and the scroll container below
            is `isolate`. Both halves matter, and the reason is worth writing
            down because it looked like a header problem and was not.

            The header was z-10 and the page content inside the scroll container
            was ALSO z-10. The scroll container is `relative` with no z-index of
            its own, so it creates no stacking context and its child competed
            directly with the header — equal z-index, later in the document, so
            the content painted over the header on every scroll.

            The search results dropdown made it worse: it is z-50, but it lives
            INSIDE this header, which does create a stacking context. Its z-50
            is therefore relative to this element, not to the page, so it could
            never rise above content that was drawing over the header itself.
          */}
          <header className="min-h-14 sm:h-16 border-b border-border bg-background flex items-center gap-2 sm:gap-4 px-3 sm:px-6 z-30 sticky top-0 justify-between">
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
              {/* The switcher moves up here now that the sidebar is a rail. It
                  is a tenant boundary, not a nav item, so it stays in sight. */}
              <div className="w-40 lg:w-56 shrink-0 hidden xs:block">
                <WorkspaceSwitcher />
              </div>
              <div className="flex items-center gap-2 text-sm font-mono text-muted-foreground min-w-0">
                <ChevronRight className="h-3 w-3 shrink-0 hidden sm:block" />
                <span className="text-foreground truncate">{activeItem?.label ?? "Dashboard"}</span>
              </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-3 min-w-0 flex-1 justify-end">
              <GlobalSearch />
              <NotificationBell />
              <ThemeToggle />
            </div>
          </header>

          {/* `isolate` keeps every z-index inside the page from being measured
              against the chrome around it. Without it, any page that raises an
              element re-opens the bug the header comment above describes. */}
          <div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto relative isolate">
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSJub25lIiAvPgo8cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJjdXJyZW50Q29sb3IiIG9wYWNpdHk9IjAuMDUiIC8+Cjwvc3ZnPg==')] opacity-[0.2] pointer-events-none z-0" />
            <div className="relative z-10 max-w-6xl mx-auto animate-in fade-in duration-500">
              {/*
              Restricted routes are wrapped, not merely hidden from the nav.
              Navigating straight to /kpi or /invites without the backend claim
              redirects to the 401 page instead of rendering the component.
            */}
              <Suspense
                fallback={
                  <div className="flex items-center justify-center py-24">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                }
              >
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
                  <Route path="/invoices">
                    <RequireCapability capability="billing.manage">
                      <InvoicesPage />
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
                  <Route path="/activity">
                    <RequireCapability capability="audit.read">
                      <ErrorBoundary label="Activity">
                        <ActivityPage />
                      </ErrorBoundary>
                    </RequireCapability>
                  </Route>
                  <Route path="/client-portal" component={ClientPortalPage} />
                  <Route component={NotFound} />
                </Switch>
              </Suspense>
            </div>
          </div>
        </main>
      </div>
      <LegalFooter />
    </div>
  );
}

/**
 * The legal documents are served by the API as plain pages, outside the SPA, so
 * these are real navigations rather than routes. They have to be reachable from
 * inside the app as well as before sign-in — "where are the terms I agreed to"
 * is a question people ask after they have an account.
 */
function LegalFooter() {
  return (
    <footer className="border-t border-border px-4 sm:px-6 py-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-2xs font-mono uppercase tracking-widest text-muted-foreground">
      <a href="/legal/terms" className="hover:text-foreground py-2.5 px-1">
        Terms
      </a>
      <a href="/legal/privacy" className="hover:text-foreground py-2.5 px-1">
        Privacy
      </a>
      <a href="/legal/notice" className="hover:text-foreground py-2.5 px-1">
        Data notice
      </a>
      <a href="/legal/dpa" className="hover:text-foreground py-2.5 px-1">
        Processing
      </a>
    </footer>
  );
}

export default function DashboardLayout() {
  return (
    <PricingModalProvider>
      <DashboardLayoutContent />
    </PricingModalProvider>
  );
}
