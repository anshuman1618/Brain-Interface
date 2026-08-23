import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The Android and iOS shells around the practice portal.
 *
 * The apps are not a second product. They bundle the SAME built SPA that the
 * web deployment serves and point it at the same API, so every page, every
 * capability guard and every route comes across by construction rather than
 * being re-implemented and drifting.
 *
 * See DEPLOYMENT.md §11 for the build and release runbook.
 */
const config: CapacitorConfig = {
  /**
   * Permanent once published to either store, and it is also the custom URL
   * scheme the OAuth round trip returns through. Changing it means a new
   * listing, so it is deliberately boring.
   *
   * Must stay in step with `APP_URL_SCHEME` in
   * artifacts/practice-portal/src/lib/platform.ts, the intent-filter in
   * AndroidManifest.xml, CFBundleURLTypes in Info.plist, and Clerk's list of
   * allowed redirect URLs.
   */
  appId: "in.lexpractice.app",
  appName: "LEX Practice",

  /**
   * The portal's own Vite output, bundled into the binary rather than fetched.
   *
   * Bundled assets mean the shell paints instantly, works with no signal up to
   * the first API call, and — the practical reason — passes store review far
   * more reliably than an app that is a webview pointed at a website.
   *
   * The path reaches outside this package on purpose: there is exactly one
   * built SPA, and copying it here would create a second one to keep in step.
   */
  webDir: "../practice-portal/dist/public",

  server: {
    /**
     * `https` rather than Capacitor's older `http` default, so the webview runs
     * in a secure context. Without it `crypto.subtle`, and any API that
     * requires a secure origin, is missing — and the failure looks like a
     * broken app rather than a scheme setting.
     */
    androidScheme: "https",

    /**
     * Which hosts stay INSIDE the webview. Everything else opens in the
     * system browser, and that default is doing real work here rather than
     * being incidental configuration.
     *
     * Google refuses OAuth in an embedded webview outright
     * (`disallowed_useragent`), so the sign-in round trip MUST leave. Because
     * the provider hosts are absent from this list, Capacitor hands them to a
     * Custom Tab / SFSafariViewController automatically; the provider then
     * redirects to `in.lexpractice.app://portal/callback`, the OS routes that
     * back to this app, and `appUrlOpen` (see lib/native.ts) forwards it into
     * the router.
     *
     * So: do NOT add accounts.google.com or a Clerk domain here. Doing so
     * would pull the flow back inside the webview and break Google sign-in.
     */
    allowNavigation: [],
  },

  android: {
    /**
     * A mixed-content page cannot load over this bundle's https origin, and
     * the API is https in every deployment. Leaving this on would let a
     * plaintext request succeed silently.
     */
    allowMixedContent: false,
  },

  ios: {
    /**
     * The relief system in index.css assumes an opaque ground; a transparent
     * webview background lets the native window colour show through the
     * neumorphic shadows and they read as dirt.
     */
    backgroundColor: "#e6ded2",
    contentInset: "always",
  },

  plugins: {
    SplashScreen: {
      /**
       * Dismissed from JS once React has mounted (lib/native.ts), not on a
       * timer. A timer either flashes the splash away before the first paint
       * or holds it after the app is ready, and which one you get depends on
       * the handset.
       */
      launchAutoHide: false,
      backgroundColor: "#e6ded2",
      androidScaleType: "CENTER_CROP",
    },
    Keyboard: {
      /**
       * Resize the webview rather than the body: the shell uses a sticky
       * header and `h-dvh` rail, and body-resizing detaches both from the
       * visible viewport when the keyboard opens.
       */
      resize: "native",
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      // The badge is the one presentation option the server does not control
      // per-message, so it is declared here.
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
