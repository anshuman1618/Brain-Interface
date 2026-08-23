import { PushNotifications, type Token } from "@capacitor/push-notifications";
import { customFetch } from "@workspace/api-client-react";
import { isNative, isIOS } from "@/lib/platform";

/**
 * Registering this handset to be reminded of a hearing.
 *
 * The server owns everything interesting — which events are notifiable, who
 * receives them, and the tenant boundary that keeps one chamber's matter off
 * another's lock screen (see lib/notify.ts and lib/push.ts on the API side).
 * All this does is hand over a token and route a tap.
 *
 * Permission is requested only when somebody switches notifications on, never
 * at launch. A permission dialog shown before the user knows what the app does
 * is the one most often refused permanently, and on iOS there is no second ask.
 */

export type PushPermission = "granted" | "denied" | "prompt" | "unsupported";

export async function pushPermissionState(): Promise<PushPermission> {
  if (!isNative()) return "unsupported";
  try {
    const status = await PushNotifications.checkPermissions();
    if (status.receive === "granted") return "granted";
    if (status.receive === "denied") return "denied";
    return "prompt";
  } catch {
    return "unsupported";
  }
}

/**
 * Ask, then register with the OS, then tell the server where to reach us.
 *
 * `register()` does not resolve with the token — it triggers a `registration`
 * event that arrives separately, which is why this waits on a listener instead
 * of awaiting the call. The timeout matters: with no network APNs never
 * answers, and without it this promise would hang for the life of the app.
 */
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!isNative()) return { ok: false, reason: "Only available in the mobile app." };

  try {
    const asked = await PushNotifications.requestPermissions();
    if (asked.receive !== "granted") {
      return {
        ok: false,
        reason:
          asked.receive === "denied"
            ? "Notifications are switched off for LEX Practice in your device settings."
            : "Notification permission was not granted.",
      };
    }

    const token = await new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      void PushNotifications.addListener("registration", (t: Token) => finish(t.value));
      void PushNotifications.addListener("registrationError", () => finish(null));
      void PushNotifications.register();

      setTimeout(() => finish(null), 15_000);
    });

    if (!token) {
      return { ok: false, reason: "The device did not return a notification token. Try again." };
    }

    // Not a generated hook: this is called from an imperative flow rather than
    // a component, and customFetch already carries the bearer token and the
    // X-Workspace-* headers that scope the registration to this chamber.
    await customFetch("/api/devices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, platform: isIOS() ? "ios" : "android" }),
    });

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not enable notifications.",
    };
  }
}

/**
 * Route a tapped notification.
 *
 * The server puts an in-app path in `data.link`. Without this the app opens on
 * whatever screen it was last on, which for "hearing tomorrow" is the wrong
 * one — the whole value of the notification is arriving at the thing it names.
 */
export function onPushOpened(navigate: (path: string) => void): () => void {
  if (!isNative()) return () => {};

  const listeners: Array<{ remove: () => void }> = [];
  void PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const link = action.notification.data?.link;
    // Only in-app paths. A notification payload is data from outside the app,
    // and following an arbitrary URL from one would be a redirect the user
    // never asked for.
    if (typeof link === "string" && link.startsWith("/")) navigate(link);
  }).then((l) => listeners.push(l));

  return () => {
    for (const l of listeners) l.remove();
  };
}
