import { lazy, Suspense, useState } from "react";
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
const CauseListPage = lazy(() => import("@/pages/cause-list"));
const DraftingPage = lazy(() => import("@/pages/drafting"));
const ChamberKnowledgePage = lazy(() => import("@/pages/chamber-knowledge"));
const DocumentsPage = lazy(() => import("@/pages/documents"));
const FeedbackPage = lazy(() => import("@/pages/feedback"));
const TeamPage = lazy(() => import("@/pages/team"));
const ActivityPage = lazy(() => import("@/pages/activity"));
const OperatorPage = lazy(() => import("@/pages/operator"));
import PendingApprovalPage from "@/pages/pending-approval";
import AccessDeniedPage from "@/pages/access-denied";
import CompleteProfilePage from "@/pages/complete-profile";
import ChoosePlanPage from "@/pages/choose-plan";
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
  Gavel,
  CreditCard,
  ShieldCheck,
  FileText,
  Star,
  Menu,
  History,
  Receipt,
  PenLine,
  Lightbulb,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PricingModalProvider, usePricingModal } from "@/components/pricing-modal";
import { useGetSubscription, getGetSubscriptionQueryKey } from "@workspace/api-client-react";
import { NotificationBell } from "@/components/notification-bell";
import { GlobalSearch } from "@/components/global-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { ErrorBoundary } from "@/components/error-boundary";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

/**
 * The destination list, rendered identically in the permanent sidebar and in
 * the mobile slide-over.
 *
 * One component rather than two copies: the list is fifteen entries long and
 * grows, and a second copy is a second place to forget. `onNavigate` is what
 * the slide-over passes to close itself on selection; the permanent sidebar
 * omits it, because there is nothing to close.
 *
 * `min-h-11` on every row is a 44px touch target, which is the reason the rows
 * are taller than the type strictly needs.
 */
function NavList({
  items,
  activeHref,
  canManageBilling,
  onNavigate,
  onOpenPricing,
  onSignOut,
}: {
  items: NavItem[];
  activeHref?: string;
  canManageBilling: boolean;
  onNavigate?: () => void;
  onOpenPricing: () => void;
  onSignOut: () => void;
}) {
  const row =
    "flex items-center gap-3 min-h-11 px-3 rounded-[var(--radius)] text-sm w-full text-left";

  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-3 flex flex-col gap-0.5">
      {items.map((item) => {
        const isActive = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={`${row} ${
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60"
            }`}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}

      {canManageBilling && (
        <>
          <div className="my-2 border-t border-sidebar-border" />
          <button
            type="button"
            onClick={onOpenPricing}
            className={`${row} text-sidebar-foreground hover:bg-sidebar-accent/60`}
          >
            <CreditCard className="h-4 w-4 shrink-0" />
            <span className="truncate">Subscription</span>
          </button>
        </>
      )}

      <div className="my-2 border-t border-sidebar-border" />
      <button
        type="button"
        onClick={onSignOut}
        className={`${row} text-destructive hover:bg-destructive/10`}
      >
        <LogOut className="h-4 w-4 shrink-0" />
        <span className="truncate">Sign out</span>
      </button>
    </nav>
  );
}

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
    profileComplete,
    activeWorkspace,
    displayRole,
    can,
  } = useSession();
  const [location, setLocation] = useLocation();
  const { setOpen: setPricingModalOpen } = usePricingModal();

  /*
   * The subscription screen, shown once, just after chamber setup.
   *
   * `neverPaid` is read from the server rather than derived here, because it is
   * the same flag `requireCapability` gates on — anything computed in the
   * browser would eventually disagree with the 402 the API is about to send.
   *
   * The query is held until there is a workspace AND the profile is complete,
   * since every workspace-scoped read is refused before both, and a 403 in the
   * console on the profile screen is a bug report waiting to be filed.
   *
   * `skippedPlan` is deliberately component state and not persisted: the
   * chamber is never locked, so somebody who wants to look around first can,
   * and the offer comes back next time they open the app. The plan banner keeps
   * it in front of them meanwhile.
   */
  const [skippedPlan, setSkippedPlan] = useState(false);
  // Only the slide-over below lg uses this; the permanent sidebar is always open.
  const [navOpen, setNavOpen] = useState(false);
  const { data: subscriptionState } = useGetSubscription({
    query: {
      queryKey: getGetSubscriptionQueryKey(),
      enabled: Boolean(activeWorkspace) && profileComplete,
    },
  });

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

  // A practice role (admin, senior/junior advocate) that has not declared bar
  // enrolment yet is stopped here, before the nav or any page renders. This is
  // the client-side half of the gate — every capability-guarded write is also
  // refused server-side (requireCapability checks profileComplete directly),
  // since a client-only gate is bypassable by calling the API.
  if (!profileComplete) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PreviewBar />
        <CompleteProfilePage />
      </div>
    );
  }

  // A chamber that has never taken a plan can read its own shell and nothing
  // else, so the founder is shown the plans before a dashboard of modules that
  // will each answer 402. Placed after the bar gate rather than before it
  // because every workspace-scoped read — this one included — is refused until
  // enrolment is declared, so there is nothing to show until then.
  if (subscriptionState?.subscription.neverPaid && !skippedPlan) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PreviewBar />
        <ChoosePlanPage onSkip={() => setSkippedPlan(true)} />
      </div>
    );
  }

  // Nav visibility is a projection of the server-issued capability list. Hiding
  // an item is cosmetic; the route guard below and the API both re-check.
  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, show: true },
    { href: "/calendar", label: "Master Calendar", icon: CalendarIcon, show: can("calendar.read") },
    { href: "/cause-list", label: "Court Listings", icon: Gavel, show: can("calendar.read") },
    { href: "/drafting", label: "Drafting", icon: PenLine, show: can("drafting.use") },
    {
      href: "/chamber-knowledge",
      label: "Chamber Knowledge",
      icon: Lightbulb,
      show: can("drafting.use"),
    },
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
          Navigation is a labelled list, not a menu behind a button.

          It used to be a three-dot dropdown on a 64px rail. That kept the rail
          narrow, and cost a click and a moment's recall before every single
          navigation — on a tool somebody has open all day, with up to fifteen
          destinations, none of which were visible until you asked. Labels beat
          icons for a list this long: "Cause list" and "Calendar" are two
          different calendars, and no icon distinguishes them.

          Sticky and exactly one viewport tall, with the list scrolling inside
          it, so the identity block at the bottom stays reachable on a long page
          rather than being pushed below the fold.
        */}
        <aside className="hidden lg:flex w-56 border-r border-border bg-sidebar shrink-0 flex-col sticky top-0 h-dvh z-20">
          <div className="h-16 flex items-center gap-2.5 px-4 border-b border-sidebar-border shrink-0">
            <Link href="/dashboard" title="LEX Practice" className="flex items-center gap-2.5">
              <div className="h-9 w-9 bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center font-mono font-bold tracking-tighter text-xs shrink-0">
                LEX
              </div>
              <span className="font-mono font-bold tracking-tight text-sm">PRACTICE</span>
            </Link>
          </div>

          <NavList
            items={navItems}
            activeHref={activeItem?.href}
            canManageBilling={can("billing.manage")}
            onOpenPricing={() => setPricingModalOpen(true)}
            onSignOut={() => signOut()}
          />

          {/* Identity stays visible: which account you are signed in as should
              never require opening anything to discover. */}
          <div className="border-t border-sidebar-border px-3 py-3 flex items-center gap-2.5 shrink-0">
            <div className="h-8 w-8 bg-muted flex items-center justify-center text-xs font-medium uppercase shrink-0">
              {initial}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">{displayName}</p>
              <p className="text-3xs font-mono uppercase tracking-wider text-muted-foreground truncate">
                {displayRole}
              </p>
            </div>
          </div>
        </aside>

        {/* Below lg the sidebar would eat the page, so it becomes a slide-over
            opened from the header. Same list, same component — a second copy
            would drift from the first the next time an item is added. */}
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" className="w-64 p-0 bg-sidebar flex flex-col gap-0">
            <SheetHeader className="h-16 px-4 border-b border-sidebar-border flex-row items-center gap-2.5 space-y-0 shrink-0">
              <div className="h-9 w-9 bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center font-mono font-bold tracking-tighter text-xs shrink-0">
                LEX
              </div>
              <SheetTitle className="font-mono font-bold tracking-tight text-sm">
                PRACTICE
              </SheetTitle>
            </SheetHeader>

            <NavList
              items={navItems}
              activeHref={activeItem?.href}
              canManageBilling={can("billing.manage")}
              onNavigate={() => setNavOpen(false)}
              onOpenPricing={() => {
                setNavOpen(false);
                setPricingModalOpen(true);
              }}
              onSignOut={() => signOut()}
            />

            <div className="border-t border-sidebar-border px-3 py-3 flex items-center gap-2.5 shrink-0">
              <div className="h-8 w-8 bg-muted flex items-center justify-center text-xs font-medium uppercase shrink-0">
                {initial}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium truncate">{displayName}</p>
                <p className="text-3xs font-mono uppercase tracking-wider text-muted-foreground truncate">
                  {displayRole}
                </p>
              </div>
            </div>
          </SheetContent>
        </Sheet>

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
              {/* Opens the slide-over. Hidden at lg and up, where the sidebar is
                  permanently on screen and a button to reveal it would do
                  nothing. */}
              <button
                type="button"
                onClick={() => setNavOpen(true)}
                aria-label="Open navigation menu"
                className="lg:hidden h-11 w-11 -ml-2 flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground"
              >
                <Menu className="h-5 w-5" />
              </button>
              {/* The switcher lives up here rather than in the sidebar: it is a
                  tenant boundary, not a destination, so it stays in sight. */}
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
          <div data-scroll className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto relative isolate">
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
                  {/* Reachable at will, not only as the gate above — this is
                      where "editable later" in Team Roles points to. No
                      capability guard: it only ever writes the caller's own
                      declared bar details. */}
                  <Route path="/complete-profile">
                    <CompleteProfilePage onDone={() => setLocation("/team")} />
                  </Route>
                  <Route path="/calendar">
                    <RequireCapability capability="calendar.read">
                      <ErrorBoundary label="Master Calendar">
                        <CalendarPage />
                      </ErrorBoundary>
                    </RequireCapability>
                  </Route>
                  {/* calendar.read to SEE proposals; the Accept button inside
                      is gated on calendar.write, matching the API. */}
                  <Route path="/cause-list">
                    <RequireCapability capability="calendar.read">
                      <ErrorBoundary label="Court Listings">
                        <CauseListPage />
                      </ErrorBoundary>
                    </RequireCapability>
                  </Route>
                  {/* Both behind drafting.use — practice roles only. A clerk
                      keeps the diary but does not settle pleadings, and a
                      drafting request spends the chamber's money. */}
                  <Route path="/drafting/:caseId">
                    <RequireCapability capability="drafting.use">
                      <ErrorBoundary label="Drafting">
                        <DraftingPage />
                      </ErrorBoundary>
                    </RequireCapability>
                  </Route>
                  <Route path="/drafting">
                    <RequireCapability capability="drafting.use">
                      <ErrorBoundary label="Drafting">
                        <DraftingPage />
                      </ErrorBoundary>
                    </RequireCapability>
                  </Route>
                  <Route path="/chamber-knowledge">
                    <RequireCapability capability="drafting.use">
                      <ErrorBoundary label="Chamber Knowledge">
                        <ChamberKnowledgePage />
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
                  {/* Not in the nav on purpose: the nav is built from
                      capabilities and this is not one. The server answers 404
                      to anyone outside OPERATOR_EMAILS, so the URL is not the
                      control — see lib/operator.ts. */}
                  <Route path="/operator">
                    <ErrorBoundary label="Platform">
                      <OperatorPage />
                    </ErrorBoundary>
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
      <a
        href="/legal/terms"
        className="hover:text-foreground inline-flex items-center min-h-10 px-1"
      >
        Terms
      </a>
      <a
        href="/legal/privacy"
        className="hover:text-foreground inline-flex items-center min-h-10 px-1"
      >
        Privacy
      </a>
      <a
        href="/legal/notice"
        className="hover:text-foreground inline-flex items-center min-h-10 px-1"
      >
        Data notice
      </a>
      <a href="/legal/dpa" className="hover:text-foreground inline-flex items-center min-h-10 px-1">
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
