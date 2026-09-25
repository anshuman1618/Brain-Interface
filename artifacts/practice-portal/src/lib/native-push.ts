import { FirebaseMessaging } from "@capacitor-firebase/messaging";
import type { PluginListenerHandle } from "@capacitor/core";
import { isNative } from "@/lib/platform";

/**
 * Device-side push: asking permission, getting a token, and opening the right
 * screen when one is tapped.
 *
 * Deliberately does NOT talk to the API. The token is handed back to the caller,
 * which registers it through the generated client so the request carries the
 * same bearer token and workspace headers as every other call — a `fetch` here
 * would be a second, quietly different way of authenticating.
 *
 * ── Why this is the Firebase plugin and not `@capacitor/push-notifications` ──
 *
 * The server sends through FCM HTTP v1 (`api-server/src/lib/push.ts`), and that
 * API accepts an **FCM registration token** — nothing else. On Android the
 * stock Capacitor plugin returns exactly that, so it worked. On iOS it returns
 * the raw **APNs device token**, hex-encoded, which FCM rejects: every send
 * would come back `INVALID_ARGUMENT`, the outbox would mark the token dead and
 * revoke the device, and the switch in Settings would appear to work while the
 * handset received nothing, for ever.
 *
 * `@capacitor-firebase/messaging` returns an FCM token on both platforms,
 * because the Firebase SDK is what exchanges the APNs token for one. So this is
 * a single code path for both, rather than a platform branch here and a second
 * sender on the server.
 *
 * It also brings the Firebase iOS SDK in as its own Swift Package dependency,
 * which is the part that matters for maintenance: `cap sync` regenerates
 * `CapApp-SPM/Package.swift` from the installed plugins, so anything added to
 * that file by hand is erased on the next sync. Coming in as a plugin is the
 * only way the dependency survives.
 */

/**
 * Ask for permission and register with FCM. Resolves the token, or null.
 *
 * Null covers every refusal identically — permission denied, no Google Play
 * Services, a simulator with no push entitlement, a missing
 * `GoogleService-Info.plist` — because the caller's response to all of them is
 * the same: leave notifications switched off and say so. Distinguishing them
 * would mean surfacing OS-specific error codes to an advocate, which helps
 * nobody.
 *
 * The timeout is the outcome the platform does not model. On a handset with no
 * network at launch, `getToken()` can sit waiting for a registration that never
 * completes, and without this the settings toggle would spin for ever.
 */
export async function registerForPush(timeoutMs = 15_000): Promise<string | null> {
  if (!isNative()) return null;

  const status = await FirebaseMessaging.checkPermissions();
  const granted =
    status.receive === "granted"
      ? true
      : (await FirebaseMessaging.requestPermissions()).receive === "granted";
  if (!granted) return null;

  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const token = FirebaseMessaging.getToken()
    .then((r) => r.token || null)
    .catch(() => null);

  return Promise.race([token, timeout]);
}

/**
 * Route to the screen a tapped notification points at.
 *
 * The server puts an in-app path in `data.link`. Without this the app opens on
 * whatever screen it was last showing, which makes a "hearing tomorrow" alert a
 * notification about nothing in particular.
 *
 * **`startsWith("/")` is the guard and it is not optional.** A push payload is
 * attacker-influenced in the same way a deep link is: anything that reached the
 * FCM project could put `https://…` or `javascript:` in that field. Only an
 * in-app path is ever followed, so the worst a bad payload achieves is opening
 * a screen the user could have opened themselves.
 */
export function onPushOpened(navigate: (path: string) => void): () => void {
  if (!isNative()) return () => {};

  let handle: PluginListenerHandle | undefined;
  void FirebaseMessaging.addListener("notificationActionPerformed", (action) => {
    // `data` is typed `unknown` by the plugin, because it is whatever the
    // sender put there — which is the honest type for it.
    const data = action.notification.data as Record<string, unknown> | undefined;
    const link = data?.["link"];
    if (typeof link === "string" && link.startsWith("/")) navigate(link);
  }).then((h) => {
    handle = h;
  });

  return () => {
    void handle?.remove();
  };
}

/**
 * Stop this handset receiving anything further. Safe to call on the web.
 *
 * `deleteToken()` invalidates the registration at Firebase rather than merely
 * forgetting it locally. The caller revokes the server-side row first — see
 * `mobile-settings.tsx` — so there is no window where the chamber believes it
 * is still reaching a device that has stopped listening.
 */
export async function unregisterFromPush(): Promise<void> {
  if (!isNative()) return;
  await FirebaseMessaging.removeAllListeners().catch(() => {});
  await FirebaseMessaging.deleteToken().catch(() => {});
}
