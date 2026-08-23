import { createSign } from "node:crypto";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { db, deviceTokensTable, pushOutboxTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Push notifications, by the same rules as the mail outbox.
 *
 * ONE transport for both platforms. FCM's HTTP v1 API delivers to iOS as well
 * as Android once the APNs key is uploaded to the Firebase project, so there is
 * a single integration here rather than a second one speaking APNs directly.
 *
 * No SDK. `firebase-admin` is a large dependency tree for what is, in the end,
 * a signed JWT and one POST — the same reasoning that keeps lib/r2.ts talking
 * SigV4 to Cloudflare with plain `fetch`.
 *
 * With nothing configured every message is recorded and marked `suppressed`,
 * exactly as mail is with no SMTP host. That is the ordinary state of a
 * deployment that has not set Firebase up, and it must not look like an error.
 */

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

type ServiceAccount = { projectId: string; clientEmail: string; privateKey: string };

/**
 * Reads FCM_SERVICE_ACCOUNT_JSON — the JSON blob Firebase hands you when you
 * create a service-account key.
 *
 * All-or-nothing, like `r2Config()`: a partly configured push transport that
 * silently degrades to "no notifications" is worse than one that says so.
 * Returns null when unset; throws when set but unusable.
 */
export function fcmConfig(): ServiceAccount | null {
  const raw = process.env["FCM_SERVICE_ACCOUNT_JSON"]?.trim();
  if (!raw) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(
      "FCM_SERVICE_ACCOUNT_JSON is set but is not valid JSON. Paste the whole service-account key file.",
    );
  }

  const projectId = String(parsed["project_id"] ?? process.env["FCM_PROJECT_ID"] ?? "").trim();
  const clientEmail = String(parsed["client_email"] ?? "").trim();
  // The key arrives with literal "\n" in it when it has been through an env
  // var, which every JWT library and every hand-rolled signer chokes on.
  const privateKey = String(parsed["private_key"] ?? "")
    .replace(/\\n/g, "\n")
    .trim();

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "FCM_SERVICE_ACCOUNT_JSON is missing project_id, client_email or private_key — refusing to start a half-configured push transport.",
    );
  }
  return { projectId, clientEmail, privateKey };
}

export function pushConfigured(): boolean {
  try {
    return fcmConfig() !== null;
  } catch {
    // Misconfigured is not configured, for the purposes of a health probe.
    return false;
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Google's OAuth access token, from a signed assertion.
 *
 * Cached until shortly before it expires. Minting one costs a round trip and a
 * signature, and the drain runs every minute — re-minting each time would turn
 * a token endpoint into a rate limit.
 */
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // 60s of slack: a token that expires in transit reads as an auth failure.
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value;

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: sa.clientEmail,
      scope: FCM_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(sa.privateKey));
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Google refused the service-account assertion: ${res.status} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("Google returned no access_token.");

  cachedToken = { value: body.access_token, expiresAt: now + (body.expires_in ?? 3600) };
  return cachedToken.value;
}

/** A token FCM has told us is dead, so the device row can be revoked rather than retried forever. */
class DeadTokenError extends Error {}

async function deliver(sa: ServiceAccount, msg: PushPayload & { token: string }): Promise<void> {
  const token = await accessToken(sa);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.projectId}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        token: msg.token,
        notification: { title: msg.title, body: msg.body },
        // The tap target. Read by the app to route in-app rather than just
        // opening the dashboard.
        data: { link: msg.link ?? "" },
        android: { priority: "high", notification: { click_action: "FLUTTER_NOTIFICATION_CLICK" } },
        apns: { payload: { aps: { sound: "default" } } },
      },
    }),
  });

  if (res.ok) return;

  const text = await res.text();
  // UNREGISTERED / INVALID_ARGUMENT on the token means the app was uninstalled
  // or the token rotated. Retrying that forever is pure noise.
  if (res.status === 404 || (res.status === 400 && /registration token/i.test(text))) {
    throw new DeadTokenError(text.slice(0, 300));
  }
  throw new Error(`FCM refused the message: ${res.status} ${text.slice(0, 300)}`);
}

export type PushPayload = {
  title: string;
  body: string;
  link?: string;
  kind?: string;
  workspaceId?: number | null;
};

/**
 * Queue a notification to every live device a user has registered IN THIS
 * WORKSPACE, then try to deliver it.
 *
 * The workspace filter is the tenant boundary and is not optional: somebody who
 * belongs to two chambers has a row per chamber, and a matter from one must
 * never surface on a lock screen while they are working in the other.
 *
 * Never throws — a reminder failing to send must not fail the scheduler tick
 * that produced it.
 */
export async function sendPush(
  workspaceId: number,
  userId: number,
  payload: PushPayload,
): Promise<{ queued: number }> {
  let sa: ServiceAccount | null = null;
  let configError: string | null = null;
  try {
    sa = fcmConfig();
  } catch (err) {
    configError = err instanceof Error ? err.message : String(err);
  }

  const devices = await db
    .select()
    .from(deviceTokensTable)
    .where(
      and(
        eq(deviceTokensTable.workspaceId, workspaceId),
        eq(deviceTokensTable.userId, userId),
        isNull(deviceTokensTable.revokedAt),
      ),
    );

  if (devices.length === 0) return { queued: 0 };

  for (const device of devices) {
    const [row] = await db
      .insert(pushOutboxTable)
      .values({
        workspaceId: payload.workspaceId ?? workspaceId,
        deviceTokenId: device.id,
        token: device.token,
        title: payload.title,
        body: payload.body,
        link: payload.link ?? "",
        kind: payload.kind ?? "notice",
        status: "queued",
        transport: sa ? "fcm" : "log",
        attempts: 1,
      })
      .returning();

    const id = row!.id;

    if (!sa) {
      await db
        .update(pushOutboxTable)
        .set({
          status: "suppressed",
          error: configError ?? "FCM_SERVICE_ACCOUNT_JSON is not configured",
        })
        .where(eq(pushOutboxTable.id, id));
      continue;
    }

    await attempt(sa, id, device.id, { ...payload, token: device.token }, 1);
  }

  return { queued: devices.length };
}

const MAX_ATTEMPTS = 6;
const BACKOFF_MINUTES = [1, 5, 25, 120, 360];

function dueAfter(attempts: number): Date {
  const mins = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length) - 1] ?? 360;
  return new Date(Date.now() + mins * 60_000);
}

async function attempt(
  sa: ServiceAccount,
  outboxId: number,
  deviceTokenId: number,
  msg: PushPayload & { token: string },
  attempts: number,
): Promise<"sent" | "failed" | "abandoned"> {
  try {
    await deliver(sa, msg);
    await db
      .update(pushOutboxTable)
      .set({ status: "sent", sentAt: new Date(), lastAttemptAt: new Date() })
      .where(eq(pushOutboxTable.id, outboxId));
    return "sent";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof DeadTokenError) {
      // Not a delivery failure to retry — the device is gone. Revoke it so
      // every future notification skips it too.
      await db
        .update(deviceTokensTable)
        .set({ revokedAt: new Date() })
        .where(eq(deviceTokensTable.id, deviceTokenId));
      await db
        .update(pushOutboxTable)
        .set({
          status: "abandoned",
          error: `device unregistered: ${message}`,
          lastAttemptAt: new Date(),
        })
        .where(eq(pushOutboxTable.id, outboxId));
      return "abandoned";
    }

    const exhausted = attempts >= MAX_ATTEMPTS;
    await db
      .update(pushOutboxTable)
      .set({
        status: exhausted ? "abandoned" : "failed",
        error: message.slice(0, 500),
        attempts,
        lastAttemptAt: new Date(),
        nextAttemptAt: exhausted ? null : dueAfter(attempts),
      })
      .where(eq(pushOutboxTable.id, outboxId));
    return exhausted ? "abandoned" : "failed";
  }
}

/**
 * Retry whatever is due. Called once a minute from the reminder scheduler,
 * alongside the mail drain. Never throws.
 */
export async function drainPushOutbox(
  limit = 25,
): Promise<{ attempted: number; sent: number; failed: number; abandoned: number }> {
  const result = { attempted: 0, sent: 0, failed: 0, abandoned: 0 };

  let sa: ServiceAccount | null = null;
  try {
    sa = fcmConfig();
  } catch {
    return result;
  }
  if (!sa) return result;

  const due = await db
    .select()
    .from(pushOutboxTable)
    .where(
      and(
        eq(pushOutboxTable.status, "failed"),
        or(isNull(pushOutboxTable.nextAttemptAt), lte(pushOutboxTable.nextAttemptAt, new Date())),
      ),
    )
    .limit(limit);

  for (const msg of due) {
    result.attempted += 1;
    const outcome = await attempt(
      sa,
      msg.id,
      msg.deviceTokenId,
      { title: msg.title, body: msg.body, link: msg.link, token: msg.token },
      msg.attempts + 1,
    );
    result[outcome] += 1;
  }

  if (result.attempted > 0) logger.info(result, "Drained the push outbox");
  return result;
}
