import * as React from "react"
import { Link, Route, Switch, useLocation } from "wouter"
import { useSession } from "@/lib/session"
import { PreviewBar } from "@/components/preview-bar"
import { useUserRole } from "@/hooks/use-user-role"
import DashboardPage from "@/pages/dashboard"
import CasesPage from "@/pages/cases"
import CaseDetailPage from "@/pages/case-detail"
import TasksPage from "@/pages/tasks"
import ConsultationsPage from "@/pages/consultations"
import KpiPage from "@/pages/kpi"
import InvitesPage from "@/pages/invites"
import ClientPortalPage from "@/pages/client-portal"
import CalendarPage from "@/pages/calendar"
import TeamPage from "@/pages/team"
import SelectRolePage from "@/pages/select-role"
import NotFound from "@/pages/not-found"
import { getPendingRoleSelection } from "@/lib/role-options"
import { Briefcase, LayoutDashboard, CheckSquare, PhoneCall, BarChart2, Users, LogOut, Loader2, ChevronRight, Calendar as CalendarIcon, CreditCard, ShieldCheck } from "lucide-react"
import { PricingModalProvider, usePricingModal } from "@/components/pricing-modal"
import { NotificationBell } from "@/components/notification-bell"
import { GlobalSearch } from "@/components/global-search"

function DashboardLayoutContent() {
  const { isLoaded, isSignedIn, displayName, initial, signOut, previewMode } = useSession();
  const { role, roleSelected, isLoaded: roleLoaded, isAdmin, isSenior, isJunior, isClerk, isClient, isStaff } = useUserRole();
  const [location] = useLocation();
  const { setOpen: setPricingModalOpen } = usePricingModal();

  if (!isLoaded || !roleLoaded) {
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

  // Brand-new sign-ups pick their workspace role once, before seeing any nav or data.
  // Visitors who chose a role before signing up (see sign-up page) have it applied
  // automatically here; anyone else (e.g. pre-existing accounts) sees the picker.
  // Preview identities are seeded with a role already, so the picker is skipped —
  // the role switcher in the preview bar takes its place.
  if (!roleSelected && !previewMode) {
    return <SelectRolePage autoApplyRole={getPendingRoleSelection() ?? undefined} />;
  }

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, show: true },
    { href: "/calendar", label: "Master Calendar", icon: CalendarIcon, show: isStaff },
    { href: "/client-portal", label: "My Portal", icon: Briefcase, show: isClient },
    { href: "/cases", label: "Cases", icon: Briefcase, show: isAdmin || isSenior || isJunior },
    { href: "/tasks", label: "Tasks", icon: CheckSquare, show: isStaff },
    { href: "/consultations", label: "Consultations", icon: PhoneCall, show: isAdmin || isSenior || isJunior },
    { href: "/kpi", label: "KPI Engine", icon: BarChart2, show: isAdmin },
    { href: "/invites", label: "Access Control", icon: Users, show: isAdmin },
    { href: "/team", label: "Team Roles", icon: ShieldCheck, show: role === "admin" },
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
        
        <div className="flex-1 py-6 px-3 flex flex-col gap-1 overflow-y-auto">
          <div className="px-3 pb-2 mb-2">
            <p className="text-xs font-mono font-semibold tracking-wider text-muted-foreground uppercase">
              {role} workspace
            </p>
          </div>
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
          {isAdmin && (
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
              <span className="text-xs text-muted-foreground truncate font-mono uppercase">{role}</span>
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
          <div className="flex items-center gap-2 text-sm font-mono text-muted-foreground">
            <span className="uppercase tracking-widest">{role}</span>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground capitalize">{location.split('/')[1] || 'Dashboard'}</span>
          </div>
          
          <div className="flex items-center gap-4">
            <GlobalSearch />
            <NotificationBell />
          </div>
        </header>
        
        <div className="flex-1 p-8 overflow-y-auto relative">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSJub25lIiAvPgo8cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJjdXJyZW50Q29sb3IiIG9wYWNpdHk9IjAuMDUiIC8+Cjwvc3ZnPg==')] opacity-[0.2] pointer-events-none z-0" />
          <div className="relative z-10 max-w-6xl mx-auto animate-in fade-in duration-500">
            <Switch>
              <Route path="/dashboard" component={DashboardPage} />
              <Route path="/calendar" component={CalendarPage} />
              <Route path="/cases" component={CasesPage} />
              <Route path="/cases/:id" component={CaseDetailPage} />
              <Route path="/tasks" component={TasksPage} />
              <Route path="/consultations" component={ConsultationsPage} />
              <Route path="/kpi" component={KpiPage} />
              <Route path="/invites" component={InvitesPage} />
              <Route path="/team" component={TeamPage} />
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
