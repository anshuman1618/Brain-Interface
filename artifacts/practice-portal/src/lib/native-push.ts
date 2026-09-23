import { PushNotifications } from "@capacitor/push-notifications";
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
 */

/**
 * Ask for permission and register with APNs / FCM. Resolves the token, or null.
 *
 * Null covers every refusal identically — permission denied, no Google Play
 * Services, a simulator with no push entitlement — because the caller's
 * response to all of them is the same: leave notifications switched off and
 * say so. Distinguishing them would mean surfacing OS-specific error codes to
 * an advocate, which helps nobody.
 *
 * The token arrives on an EVENT rather than as a return value, so this wraps
 * `register()` in a promise over the `registration` / `registrationError`
 * listeners. The timeout is the third outcome the platform does not model: on a
 * handset with no network at launch, neither event ever fires, and without it
 * the settings toggle would spin forever.
 */
export async function registerForPush(timeoutMs = 15_000): Promise<string | null> {
  if (!isNative()) return null;

  const status = await PushNotifications.checkPermissions();
  const granted =
    status.receive === "granted"
      ? true
      : (await PushNotifications.requestPermissions()).receive === "granted";
  if (!granted) return null;

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const handles: PluginListenerHandle[] = [];

    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const h of handles) void h.remove();
      resolve(token);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    void PushNotifications.addListener("registration", (t) => finish(t.value)).then((h) =>
      handles.push(h),
    );
    void PushNotifications.addListener("registrationError", () => finish(null)).then((h) =>
      handles.push(h),
    );

    void PushNotifications.register().catch(() => finish(null));
  });
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
  void PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const link = action.notification.data?.link;
    if (typeof link === "string" && link.startsWith("/")) navigate(link);
  }).then((h) => {
    handle = h;
  });

  return () => {
    void handle?.remove();
  };
}

/** Stop this handset receiving anything further. Safe to call on the web. */
export async function unregisterFromPush(): Promise<void> {
  if (!isNative()) return;
  await PushNotifications.removeAllListeners().catch(() => {});
  await PushNotifications.unregister().catch(() => {});
}
