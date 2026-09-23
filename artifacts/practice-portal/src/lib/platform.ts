import { Capacitor } from "@capacitor/core";

/**
 * Which shell the SPA is running inside, and what follows from that.
 *
 * One import for every native-vs-web decision in the app, so the answer cannot
 * be given two different ways in two different files. Everything here is safe
 * to call on the web: `Capacitor.isNativePlatform()` is false in a browser and
 * the package is a no-op shim there, so nothing below needs a build-time flag
 * or a separate web entry point.
 */

/**
 * The custom URL scheme the OS routes back to this app.
 *
 * **This string exists in five places** and they all have to agree, with no
 * compiler between them:
 *
 *   1. here
 *   2. `appId` in each platform repo's `capacitor.config.ts`
 *   3. the `<intent-filter>` in AndroidManifest.xml
 *   4. `CFBundleURLTypes` in Info.plist
 *   5. Clerk's list of allowed redirect URLs
 *
 * Change it in one and sign-in fails only in the native build, only after the
 * provider has already accepted the credentials — which is the most expensive
 * place in the flow to discover a typo.
 */
export const APP_URL_SCHEME = "in.lexpractice.app";

/** True inside the Android or iOS shell; false in any browser. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export function isIOS(): boolean {
  return Capacitor.getPlatform() === "ios";
}

export function isAndroid(): boolean {
  return Capacitor.getPlatform() === "android";
}

/**
 * Where an OAuth provider should send the browser back to.
 *
 * On the web this is the page's own origin, as it always was. In the native
 * shell the page's origin is `https://localhost` (Android) or
 * `capacitor://localhost` (iOS) — an origin that exists only inside the
 * webview, that no provider can redirect to, and that is shared with every
 * other Capacitor app on the device.
 *
 * So the native build hands the provider the app's custom scheme instead. The
 * OS matches it against the registered intent-filter / CFBundleURLTypes, brings
 * this app back to the foreground, and `lib/native.ts` turns the URL into a
 * route.
 */
export function authRedirectBase(): string {
  return isNative() ? `${APP_URL_SCHEME}://` : window.location.origin;
}
