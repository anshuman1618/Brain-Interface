/**
 * Where this bundle is running, and what that changes.
 *
 * The same React tree is served three ways — from the API server's own origin,
 * from a static host pointed at a separate API, and from inside a native shell
 * — and only the third one needs the app to behave differently. This module is
 * the single place that asks "am I native?", so the answer cannot be tested
 * inconsistently in five components.
 *
 * Everything here is safe to call on the web: with no Capacitor bridge present
 * `isNativePlatform()` is false and each function falls back to the browser
 * behaviour that was there before.
 */

/** The custom URL scheme registered by the native apps. Must match capacitor.config.ts, AndroidManifest.xml and Info.plist. */
export const APP_URL_SCHEME = "in.lexpractice.app";

type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

function bridge(): CapacitorBridge | null {
  if (typeof window === "undefined") return null;
  // Read through the global rather than importing @capacitor/core, so the web
  // bundle does not carry the runtime at all. The shell injects it before any
  // application code runs.
  return (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor ?? null;
}

/** True inside the Android or iOS shell; false in every browser. */
export function isNative(): boolean {
  return bridge()?.isNativePlatform?.() === true;
}

/** "android" | "ios" | "web". */
export function platformName(): string {
  return bridge()?.getPlatform?.() ?? "web";
}

export function isAndroid(): boolean {
  return platformName() === "android";
}

export function isIOS(): boolean {
  return platformName() === "ios";
}

/**
 * The origin an OAuth provider should send the user back to.
 *
 * On the web this is simply where the app is served from. In the native shell
 * it is NOT: the webview's own origin is `https://localhost` on Android and
 * `capacitor://localhost` on iOS, and no OAuth provider will redirect to
 * either — they are not registrable, not unique to this app, and Google
 * refuses embedded webviews outright.
 *
 * So native builds hand the provider a custom scheme instead. The OS routes it
 * back to this app, `@capacitor/app` reports it as an `appUrlOpen`, and the
 * shell forwards the callback into the router. The scheme must also be listed
 * in Clerk's allowed redirect URLs, or Clerk refuses the round trip before the
 * provider is ever reached.
 */
export function authRedirectBase(): string {
  if (isNative()) return `${APP_URL_SCHEME}://`;
  return window.location.origin;
}

/**
 * A base for absolute asset URLs handed to third-party UI (Clerk's appearance
 * options, for one).
 *
 * On native, `window.location.origin` is a localhost URL that means nothing
 * outside the webview, so anything rendered by a remote service cannot fetch
 * from it. Returning "" makes those callers fall back to a relative path, which
 * the webview does resolve.
 */
export function assetOrigin(): string {
  return isNative() ? "" : window.location.origin;
}
