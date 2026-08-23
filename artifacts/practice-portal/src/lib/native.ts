/**
 * The native shell's side of the app: the behaviours a webview does not get
 * for free.
 *
 * Everything here is a no-op on the web. The plugins are imported statically
 * because Capacitor's web implementations are tiny stubs, and a dynamic import
 * would mean the first Android back press races a module fetch.
 *
 * Called once from App.tsx. It never throws: a shell that fails to set its
 * status-bar colour should still run the application.
 */
import { App as CapacitorApp } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Keyboard } from "@capacitor/keyboard";
import { isNative, isAndroid, isIOS, APP_URL_SCHEME } from "@/lib/platform";

/** Light and dark `--background` from index.css. Keep in step with the theme-color metas. */
const GROUND = { light: "#e6ded2", dark: "#241708" } as const;

/**
 * Match the native status bar to the theme the app is actually painting.
 *
 * `Style.Light` means light CONTENT on a dark bar, which is the opposite of
 * what the name suggests and the usual source of an unreadable clock.
 */
export async function applyNativeTheme(theme: "light" | "dark"): Promise<void> {
  if (!isNative()) return;
  try {
    await StatusBar.setStyle({ style: theme === "dark" ? Style.Light : Style.Dark });
    // Android paints a solid status bar; iOS draws under it, and setting a
    // background colour there is unsupported rather than merely ignored.
    if (isAndroid()) {
      await StatusBar.setBackgroundColor({ color: GROUND[theme] });
    }
  } catch {
    // An older OS without the API. Cosmetic; not worth failing the boot.
  }
}

/**
 * Wires the shell up. Returns a teardown for symmetry — App.tsx mounts once,
 * so it is really only used by fast refresh.
 */
export function initNativeShell(onDeepLink: (path: string) => void): () => void {
  if (!isNative()) return () => {};

  const listeners: Array<{ remove: () => void }> = [];

  /*
   * The Android hardware back button.
   *
   * A webview's default is "go back in history, and if there is none, do
   * nothing" — which strands the user on the first screen they opened with no
   * way out but the task switcher. Exiting only at the root is what Android
   * users expect, and `canGoBack` is Capacitor's own reading of the webview
   * history rather than ours.
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
   * Google and Zoho sign-in leaves for a Custom Tab / SFSafariViewController
   * (capacitor.config.ts keeps `allowNavigation` empty so any non-local
   * navigation goes out to the system browser). The provider finishes at
   * `in.lexpractice.app://portal/callback?...`, the OS hands that URL back
   * here, and the router has to be told — the webview itself never navigated,
   * so nothing else would notice the sign-in completed.
   *
   * Anything that is not our scheme is ignored rather than routed: an
   * `appUrlOpen` can be triggered by any app on the device, and turning a
   * hostile URL into a route would let one drive this app's navigation.
   */
  void CapacitorApp.addListener("appUrlOpen", ({ url }) => {
    if (!url.startsWith(`${APP_URL_SCHEME}://`)) return;
    const rest = url.slice(`${APP_URL_SCHEME}://`.length);
    // The scheme has no host, so everything after "://" is already the path.
    onDeepLink(rest.startsWith("/") ? rest : `/${rest}`);
  }).then((l) => listeners.push(l));

  if (isIOS()) {
    // The accessory bar is a grey strip with Previous/Next/Done above the
    // keyboard. It covers the field it is meant to help with on a short form.
    void Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});
  }

  return () => {
    for (const l of listeners) l.remove();
  };
}

/**
 * Dismiss the splash once React has painted.
 *
 * `launchAutoHide` is off in capacitor.config.ts, so this is the only thing
 * that hides it — a timer either flashes it away before the first paint or
 * holds it after the app is ready, and which one you get depends on the
 * handset.
 */
export async function dismissSplash(): Promise<void> {
  if (!isNative()) return;
  try {
    await SplashScreen.hide();
  } catch {
    /* Already hidden, or no splash configured. */
  }
}
