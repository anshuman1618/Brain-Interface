import { useEffect, useRef, useState } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useAuth as useClerkAuth } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import LandingPage from "@/pages/landing";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { RoleOptionsGrid } from "@/components/auth/role-options-grid";
import { getAccessRequestIntent, setAccessRequestIntent, type RoleValue } from "@/lib/role-options";
import { useClerkApiAuthBridge } from "@/hooks/use-api-auth-bridge";
import { isPreviewMode } from "@/lib/preview";
import { ClerkSessionProvider, PreviewSessionProvider, useSession } from "@/lib/session";
import { PreviewLanding } from "@/pages/preview-landing";
// Registers the API base URL (no-op when frontend and API share an origin).
import "@/lib/api-config";

const clerkPubKey = isPreviewMode
  ? ""
  : publishableKeyFromHost(
      window.location.hostname,
      import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
    );
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

// In preview mode there is intentionally no Clerk key — the app renders with a
// mocked session instead of failing to boot.
if (!clerkPubKey && !isPreviewMode) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(220 10% 30%)",
    colorForeground: "hsl(220 20% 20%)",
    colorMutedForeground: "hsl(220 15% 45%)",
    colorDanger: "hsl(220 10% 40%)",
    colorBackground: "hsl(220 15% 95%)",
    colorInput: "transparent",
    colorInputForeground: "hsl(220 20% 20%)",
    colorNeutral: "hsl(220 15% 85%)",
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    borderRadius: "0px",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[hsl(220_15%_95%)] border border-[hsl(220_15%_85%)] rounded-none w-[440px] max-w-full overflow-hidden shadow-none",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-foreground font-semibold font-mono tracking-tight",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButtonText: "text-foreground font-medium",
    formFieldLabel: "text-foreground font-medium",
    footerActionLink: "text-primary hover:text-primary/90 font-medium",
    footerActionText: "text-muted-foreground",
    dividerText: "text-muted-foreground bg-background px-2",
    identityPreviewEditButton: "text-primary hover:text-primary/90",
    formFieldSuccessText: "text-primary",
    alertText: "text-foreground",
    logoBox: "h-12 w-auto object-contain",
    logoImage: "h-12 w-auto",
    socialButtonsBlockButton: "border border-input hover:bg-accent bg-background rounded-none",
    formButtonPrimary: "bg-primary text-primary-foreground hover:bg-primary/90 rounded-none shadow-none",
    formFieldInput: "border border-input bg-background rounded-none focus:ring-2 focus:ring-ring focus:border-transparent text-foreground",
    footerAction: "mt-6",
    dividerLine: "bg-border",
    alert: "bg-destructive/10 border border-destructive text-destructive",
    otpCodeFieldInput: "border border-input bg-background rounded-none",
    formFieldRow: "mb-4",
    main: "w-full",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4 py-12 relative overflow-y-auto gap-6">
      <div className="fixed inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSJub25lIiAvPgo8cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJjdXJyZW50Q29sb3IiIG9wYWNpdHk9IjAuMDUiIC8+Cjwvc3ZnPg==')] opacity-[0.4] pointer-events-none" />
      <div className="relative z-10 w-full max-w-[440px]">
        <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
      </div>
      <div className="relative z-10 w-full max-w-[440px] bg-slate-100 border border-slate-200 p-4 text-xs font-mono uppercase text-slate-500 tracking-wider text-center">
        Access is granted by a workspace admin. New accounts start with no workspace until a request is approved.
      </div>
    </div>
  );
}

/**
 * Pre-auth role picker.
 *
 * This is a *preview and request-intent* step, nothing more. The choice is kept
 * only to pre-fill the access request after sign-up; it is never sent as an
 * authorization claim and the backend would ignore it if it were. What the
 * account can reach is decided later, by an admin, in the database.
 */
function ChooseWorkspaceStep({ onContinue }: { onContinue: (role: RoleValue) => void }) {
  const [selected, setSelected] = useState<RoleValue | null>(null);

  return (
    <div className="relative z-10 w-full max-w-3xl">
      <div className="mb-8 text-center">
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">Step 1 of 2 · Preview</p>
        <h1 className="text-3xl font-bold tracking-tight mb-2">What will you be doing here?</h1>
        <p className="text-muted-foreground max-w-xl mx-auto">
          This previews the portal and pre-fills your access request. It grants nothing — a workspace
          admin reviews every request and chooses the role you are actually given.
        </p>
      </div>

      <div className="mb-8">
        <RoleOptionsGrid selected={selected} onSelect={setSelected} />
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider max-w-sm text-left">
          Requesting Firm Admin does not make you one
        </p>
        <Button
          className="rounded-none px-8"
          disabled={!selected}
          onClick={() => selected && onContinue(selected)}
        >
          Continue to sign up
        </Button>
      </div>
    </div>
  );
}

function SignUpPage() {
  // The pre-auth choice is remembered so the access-request form is pre-filled
  // after sign-up, and so returning here mid-flow (e.g. during email
  // verification) does not re-ask. It is never applied as a grant.
  const [pendingRole, setPendingRole] = useState<RoleValue | null>(() => getAccessRequestIntent());

  const handleRoleChosen = (role: RoleValue) => {
    setAccessRequestIntent(role);
    setPendingRole(role);
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-12 relative overflow-y-auto">
      <div className="fixed inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSJub25lIiAvPgo8cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJjdXJyZW50Q29sb3IiIG9wYWNpdHk9IjAuMDUiIC8+Cjwvc3ZnPg==')] opacity-[0.4] pointer-events-none" />
      {pendingRole ? (
        <div className="relative z-10 w-full max-w-[440px]">
          <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
        </div>
      ) : (
        <ChooseWorkspaceStep onContinue={handleRoleChosen} />
      )}
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const { getToken } = useClerkAuth();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  // Attach Clerk bearer tokens to API calls when the API is cross-origin.
  useClerkApiAuthBridge(getToken);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

const queryClient = new QueryClient();

/**
 * Preview tree. Renders no ClerkProvider at all — Clerk hooks throw outside one,
 * so the mocked session has to replace it rather than sit alongside it. An
 * unauthenticated visitor picks a role first and explores from there.
 */
function PreviewRoutes() {
  const { isSignedIn } = useSession();

  if (!isSignedIn) return <PreviewLanding />;

  return (
    <Switch>
      {/* "/:rest*" does not match the bare root, so send it to the dashboard
          explicitly — otherwise entering the portal renders an empty page. */}
      <Route path="/"><Redirect to="/dashboard" /></Route>
      <Route path="/:rest*" component={DashboardLayout} />
    </Switch>
  );
}

function PreviewApp() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <PreviewSessionProvider>
          <TooltipProvider>
            <PreviewRoutes />
            <Toaster />
          </TooltipProvider>
        </PreviewSessionProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}

function ClerkApp() {
  const [, setLocation] = useLocation();

  return (
    <WouterRouter base={basePath}>
      <ClerkProvider
        publishableKey={clerkPubKey}
        proxyUrl={clerkProxyUrl}
        appearance={clerkAppearance}
        signInUrl={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        routerPush={(to) => setLocation(stripBase(to))}
        routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
      >
        <QueryClientProvider client={queryClient}>
          <ClerkSessionProvider>
            <TooltipProvider>
              <ClerkQueryClientCacheInvalidator />
              <Switch>
                <Route path="/" component={HomeRedirect} />
                <Route path="/sign-in/*?" component={SignInPage} />
                <Route path="/sign-up/*?" component={SignUpPage} />
                <Route path="/:rest*" component={DashboardLayout} />
              </Switch>
              <Toaster />
            </TooltipProvider>
          </ClerkSessionProvider>
        </QueryClientProvider>
      </ClerkProvider>
    </WouterRouter>
  );
}

function App() {
  return isPreviewMode ? <PreviewApp /> : <ClerkApp />;
}

export default App;
