import { App as CapacitorApp } from "@capacitor/app";
import { Keyboard } from "@capacitor/keyboard";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import type { PluginListenerHandle } from "@capacitor/core";
import { APP_URL_SCHEME, isIOS, isNative } from "@/lib/platform";

/**
 * The native shell's behaviour, in one place, initialised once from App.tsx.
 *
 * Every export here returns immediately on the web. The website imports this
 * module and runs none of it, which is what lets one SPA serve both without a
 * second entry point or a build-time flag.
 */

/**
 * Wire up the shell. Returns a teardown that removes every listener.
 *
 * `onDeepLink` is handed an in-app PATH, never a URL — see the appUrlOpen
 * listener for why that distinction is the security boundary here.
 */
export function initNativeShell(onDeepLink: (path: string) => void): () => void {
  if (!isNative()) return () => {};

  const listeners: PluginListenerHandle[] = [];

  /*
   * The Android hardware back button.
   *
   * Without this, back closes the app from anywhere — including a matter
   * detail page reached through four taps, which is the single most jarring
   * thing an Android user can meet in a webview app. `canGoBack` is Capacitor's
   * own answer about the webview's history, so this hands the gesture to the
   * router until there is nothing left to go back to, and only then exits.
   *
   * iOS has no hardware back button and never fires this.
   */
  void CapacitorApp.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      void CapacitorApp.exitApp();
    }
  }).then((l) => listeners.push(l));

  /*
   * The OAuth return.
   *
   * Google refuses OAuth inside an embedded webview outright, so sign-in has to
   * leave for a Custom Tab / SFSafariViewController and come back. The provider
   * finishes at `in.lexpractice.app://portal/callback?...`, the OS hands that
   * URL here, and the router has to be told — the webview itself never
   * navigated, so nothing else would notice the sign-in completed.
   *
   * **Anything that is not our scheme is dropped rather than routed.** Any app
   * on the device can trigger an `appUrlOpen`, so this listener is an untrusted
   * input. What survives the check is turned into a PATH handed to the router,
   * never a URL handed to a navigation — so the worst a hostile caller can do
   * is open a screen the user could have opened themselves.
   */
  void CapacitorApp.addListener("appUrlOpen", ({ url }) => {
    const prefix = `${APP_URL_SCHEME}://`;
    if (!url.startsWith(prefix)) return;
    const rest = url.slice(prefix.length);
    // The scheme has no host component, so everything after "://" is already
    // the path — but a leading slash is not guaranteed and wouter needs one.
    onDeepLink(rest.startsWith("/") ? rest : `/${rest}`);
  }).then((l) => listeners.push(l));

  if (isIOS()) {
    /*
     * The grey Previous/Next/Done strip above the iOS keyboard. On a short form
     * it covers the field it is meant to help with, and none of this app's
     * forms are long enough for it to earn its place.
     */
    void Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});
  }

  return () => {
    for (const l of listeners) void l.remove();
  };
}

/**
 * Point the status bar at the resolved theme.
 *
 * `Style.Light` means light CONTENT on a dark bar — the opposite of what the
 * name suggests, and the usual cause of an unreadable clock. So a dark app
 * takes `Style.Light`, not `Style.Dark`.
 *
 * Android also paints a background colour behind the bar; iOS draws under it
 * and has none to set, which is why the call is guarded rather than passed a
 * colour that one platform would ignore.
 */
export function applyNativeTheme(resolvedTheme: "light" | "dark"): void {
  if (!isNative()) return;
  void StatusBar.setStyle({ style: resolvedTheme === "dark" ? Style.Light : Style.Dark }).catch(
    () => {},
  );
  if (!isIOS()) {
    void StatusBar.setBackgroundColor({
      color: resolvedTheme === "dark" ? "#221f1c" : "#e6ded2",
    }).catch(() => {});
  }
}

/**
 * Hide the splash once React has actually painted.
 *
 * `launchAutoHide: false` in each platform's capacitor.config.ts hands that
 * decision to this call. A timer instead would either flash the splash away
 * before the first paint or hold it after the app is ready, and which one you
 * get depends on the handset.
 */
export async function dismissSplash(): Promise<void> {
  if (!isNative()) return;
  await SplashScreen.hide().catch(() => {});
}
