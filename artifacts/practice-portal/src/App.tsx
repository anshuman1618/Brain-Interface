import { useEffect, useRef, useState } from "react";
import { ClerkProvider, Show, AuthenticateWithRedirectCallback, useClerk, useAuth as useClerkAuth } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import LandingPage from "@/pages/landing";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { useClerkApiAuthBridge } from "@/hooks/use-api-auth-bridge";
import { isPreviewMode } from "@/lib/preview";
import { ClerkSessionProvider, PreviewSessionProvider, useSession } from "@/lib/session";
import PortalSignInPage from "@/pages/portal-sign-in";
import { ThemeProvider } from "@/lib/theme";
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

/**
 * Passwordless only.
 *
 * The Clerk-hosted <SignIn>/<SignUp> components used to live here. They render
 * whatever strategies the Clerk dashboard has enabled — including a password
 * field — which is exactly what this app must not offer. Both routes now
 * redirect to /portal, which drives Clerk's OAuth and email-code strategies
 * directly and has no password path at all.
 */
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

  if (!isSignedIn) {
    // Signed out, preview mode shows the same front door as production: the
    // landing page and the real sign-in layer. The seeded-identity picker is a
    // demo shortcut kept on its own route, not a substitute for signing in.
    return (
      <Switch>
        <Route path="/portal" component={PortalSignInPage} />
        {/* Legacy entry points, same as the Clerk tree: one passwordless door. */}
        <Route path="/sign-in/*?"><Redirect to="/portal" /></Route>
        <Route path="/sign-up/*?"><Redirect to="/portal?new=1" /></Route>
        {/* "/:rest*" does not match the bare root in wouter, so it needs its
            own route — without it, "/" renders nothing at all. */}
        <Route path="/" component={LandingPage} />
        <Route path="/:rest*" component={LandingPage} />
      </Switch>
    );
  }

  return (
    <Switch>
      {/* "/:rest*" does not match the bare root, so send it to the dashboard
          explicitly — otherwise entering the portal renders an empty page. */}
      <Route path="/"><Redirect to="/dashboard" /></Route>
      {/* Already signed in — the sign-in screens are a no-op, so land in the
          portal rather than leaving the URL on a door that has been walked
          through. */}
      <Route path="/portal"><Redirect to="/dashboard" /></Route>
      <Route path="/sign-in/*?"><Redirect to="/dashboard" /></Route>
      <Route path="/sign-up/*?"><Redirect to="/dashboard" /></Route>
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
                <Route path="/portal" component={PortalSignInPage} />
                {/* Where Google and Zoho land after the provider round trip.
                    Clerk finishes the handshake, then the app decides what this
                    identity may reach. */}
                <Route path="/portal/callback">
                  <AuthenticateWithRedirectCallback
                    signInFallbackRedirectUrl={`${basePath}/dashboard`}
                    signUpFallbackRedirectUrl={`${basePath}/dashboard`}
                  />
                </Route>
                {/* Legacy entry points — both are the same passwordless door now. */}
                <Route path="/sign-in/*?"><Redirect to="/portal" /></Route>
                <Route path="/sign-up/*?"><Redirect to="/portal?new=1" /></Route>
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
  // One provider around both trees: the theme is a property of the browser, not
  // of whether Clerk happens to be configured.
  return (
    <ThemeProvider>{isPreviewMode ? <PreviewApp /> : <ClerkApp />}</ThemeProvider>
  );
}

export default App;
