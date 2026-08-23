import { useEffect, useRef } from "react";
import {
  ClerkProvider,
  Show,
  AuthenticateWithRedirectCallback,
  useClerk,
  useAuth as useClerkAuth,
} from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import LandingPage from "@/pages/landing";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { useClerkApiAuthBridge } from "@/hooks/use-api-auth-bridge";
import { isPreviewMode } from "@/lib/preview";
import { ClerkSessionProvider, PreviewSessionProvider, useSession } from "@/lib/session";
import PortalSignInPage from "@/pages/portal-sign-in";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { RootErrorBoundary } from "@/components/error-boundary";
import { AppLockGate } from "@/components/app-lock";
import { applyNativeTheme, dismissSplash, initNativeShell } from "@/lib/native";
import { onPushOpened } from "@/lib/native-push";
import { BetaFeedbackWidget } from "@/components/beta-feedback-widget";
// Registers the API base URL (no-op when frontend and API share an origin).
import "@/lib/api-config";

const clerkPubKey = isPreviewMode
  ? ""
  : publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}

// In preview mode there is intentionally no Clerk key — the app renders with a
// mocked session instead of failing to boot.
if (!clerkPubKey && !isPreviewMode) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

/**
 * The sign-in widget is rendered by Clerk, outside our stylesheet, so it cannot
 * read the design tokens through var() — Clerk derives its own hover and focus
 * shades from these values and needs colours it can actually parse.
 *
 * They are therefore duplicated here as literals, and this is the only place in
 * the app where that is true. Keep them equal to the light-mode palette in
 * src/index.css; the names below are the names used there.
 */
const wood = {
  ground: "#e6ded2",
  ink: "#241708",
  ink3: "#6b5942",
  line: "#d3c7b6",
  accent: "#5b3a1c",
  crit: "#8a2318",
} as const;

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: wood.accent,
    colorForeground: wood.ink,
    colorMutedForeground: wood.ink3,
    colorDanger: wood.crit,
    colorBackground: wood.ground,
    colorInput: "transparent",
    colorInputForeground: wood.ink,
    colorNeutral: wood.line,
    // System stack, matching --app-font-sans. The named webfont that used to be
    // here went with the Google Fonts import it depended on, and had been
    // silently resolving to the sans-serif fallback ever since.
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    borderRadius: "14px",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    // Raised off the ground like any other container, and with no border: the
    // relief is what separates it from the page, so a line as well would be
    // saying the same thing twice. This also drops the last two hardcoded
    // colours from the old slate palette.
    cardBox: "bg-background rounded-xl w-[440px] max-w-full overflow-hidden shadow-lg",
    card: "!shadow-none !border-0 !bg-transparent",
    footer: "!shadow-none !border-0 !bg-transparent",
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
    // Buttons extrude, fields recede — the same rule the rest of the app runs
    // on, restated here because Clerk's markup never reaches our base layer.
    socialButtonsBlockButton:
      "border-0 bg-background rounded-lg shadow-sm active:shadow-[var(--press-sm)] hover:bg-accent",
    formButtonPrimary:
      "bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg shadow-sm active:shadow-[var(--press-sm)]",
    formFieldInput:
      "border-0 bg-background rounded-lg shadow-[var(--press-sm)] focus:ring-2 focus:ring-ring focus:border-transparent text-foreground",
    footerAction: "mt-6",
    dividerLine: "bg-border",
    alert: "bg-destructive/10 border border-destructive text-destructive",
    otpCodeFieldInput: "border-0 bg-background rounded-lg shadow-[var(--press-sm)]",
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
        <Route path="/sign-in/*?">
          <Redirect to="/portal" />
        </Route>
        <Route path="/sign-up/*?">
          <Redirect to="/portal?new=1" />
        </Route>
        {/* "/*" is the catch-all, and unlike "/:rest*" it matches a path of
            any depth. ":rest*" compiles to a single-segment pattern, so
            anything two levels deep fell through the Switch and rendered a
            blank page. The explicit "/" stays for legibility; the Switch takes
            the first match either way. */}
        <Route path="/" component={LandingPage} />
        <Route path="/*" component={LandingPage} />
      </Switch>
    );
  }

  return (
    <Switch>
      {/* "/" is claimed first so the catch-all below cannot swallow it. */}
      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>
      {/* Already signed in — the sign-in screens are a no-op, so land in the
          portal rather than leaving the URL on a door that has been walked
          through. */}
      <Route path="/portal">
        <Redirect to="/dashboard" />
      </Route>
      <Route path="/sign-in/*?">
        <Redirect to="/dashboard" />
      </Route>
      <Route path="/sign-up/*?">
        <Redirect to="/dashboard" />
      </Route>
      {/* Depth matters: "/:rest*" matches ONE segment only, which left
          /cases/:id rendering nothing at all. */}
      <Route path="/*" component={DashboardLayout} />
    </Switch>
  );
}

function PreviewApp() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <PreviewSessionProvider>
          <TooltipProvider>
            <NativeShell />
            <AppLockGate>
              <PreviewRoutes />
            </AppLockGate>
            <Toaster />
            {/* Mounted here rather than in the dashboard shell: the two screens
                that most need a way to report a problem — access denied and
                pending approval — render outside that shell. */}
            <BetaFeedbackWidget />
          </TooltipProvider>
        </PreviewSessionProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}

/**
 * Extracted so the lock overlay can wrap the routes without wrapping the
 * providers: `AppLockGate` reads the session, which ClerkSessionProvider
 * supplies, so it has to sit inside that provider and outside the pages.
 */
function ClerkRoutes() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/portal" component={PortalSignInPage} />
      {/* Where Google and Zoho land after the provider round trip. Clerk
          finishes the handshake, then the app decides what this identity may
          reach. In the native shell the provider redirects to the app's custom
          scheme instead, and lib/native.ts routes it to this same path. */}
      <Route path="/portal/callback">
        <AuthenticateWithRedirectCallback
          signInFallbackRedirectUrl={`${basePath}/dashboard`}
          signUpFallbackRedirectUrl={`${basePath}/dashboard`}
        />
      </Route>
      {/* Legacy entry points — both are the same passwordless door now. */}
      <Route path="/sign-in/*?">
        <Redirect to="/portal" />
      </Route>
      <Route path="/sign-up/*?">
        <Redirect to="/portal?new=1" />
      </Route>
      {/* "/*", not "/:rest*" — see the preview tree above. */}
      <Route path="/*" component={DashboardLayout} />
    </Switch>
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
              <NativeShell />
              <AppLockGate>
                <ClerkRoutes />
              </AppLockGate>
              <Toaster />
              <BetaFeedbackWidget />
            </TooltipProvider>
          </ClerkSessionProvider>
        </QueryClientProvider>
      </ClerkProvider>
    </WouterRouter>
  );
}

/**
 * The native shell's lifecycle, and nothing else.
 *
 * Renders no UI. It lives inside ThemeProvider because the status bar has to
 * follow the resolved theme, and inside the router because a deep link has to
 * become a navigation.
 *
 * Every call it makes is a no-op on the web.
 */
function NativeShell() {
  const [, setLocation] = useLocation();
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    // The OAuth round trip returns here, as in.lexpractice.app://portal/callback.
    // A client-side navigation, not a reload: the Clerk client in memory is
    // mid-handshake, and reloading would restart from whatever had reached
    // storage and lose it.
    const teardown = initNativeShell((path) => setLocation(stripBase(path)));
    // Tapping a "hearing tomorrow" notification should land on the calendar,
    // not on whatever screen the app was last showing.
    const teardownPush = onPushOpened((path) => setLocation(stripBase(path)));
    // The splash is held until React has actually painted — see
    // `launchAutoHide: false` in capacitor.config.ts.
    void dismissSplash();
    return () => {
      teardown();
      teardownPush();
    };
  }, [setLocation]);

  useEffect(() => {
    void applyNativeTheme(resolvedTheme === "dark" ? "dark" : "light");
  }, [resolvedTheme]);

  return null;
}

function App() {
  // One provider around both trees: the theme is a property of the browser, not
  // of whether Clerk happens to be configured.
  //
  // The boundary sits outside the theme provider deliberately — a crash inside
  // ThemeProvider, ClerkProvider or the router is exactly the case that used to
  // leave a white page, so the thing catching it cannot depend on any of them.
  return (
    <RootErrorBoundary>
      <ThemeProvider>{isPreviewMode ? <PreviewApp /> : <ClerkApp />}</ThemeProvider>
    </RootErrorBoundary>
  );
}

export default App;
