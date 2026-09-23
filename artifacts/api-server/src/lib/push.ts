import { createSign } from "node:crypto";
import { and, asc, eq, isNull, lt, lte, or } from "drizzle-orm";
import { db, deviceTokensTable, pushOutboxTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Push delivery, through FCM HTTP v1.
 *
 * ── One transport for both platforms ────────────────────────────────────────
 *
 * FCM reaches iOS as well, once the APNs auth key is uploaded to the Firebase
 * project. So there is one integration here, not two — no APNs client, no
 * second token format, no second set of credentials on the server. The cost is
 * one manual step at setup (DEPLOYMENT.md §11) and the saving is an entire
 * delivery path that would otherwise need its own retries and its own bugs.
 *
 * ── Hand-rolled, like the R2 signer ─────────────────────────────────────────
 *
 * A service-account JWT is a signed JSON blob and one POST. `lib/r2.ts` already
 * does SigV4 the same way and for the same reason: a Google SDK to produce one
 * RS256 assertion is a large dependency, a large transitive tree, and a large
 * thing to keep inside `minimumReleaseAge`.
 *
 * ── Unconfigured is a recorded state ────────────────────────────────────────
 *
 * With no FCM credentials, messages are written and marked `suppressed` — never
 * silently dropped, never pretended to have been sent. Exactly what SMTP unset
 * already does, because "we notified them" has to be answerable either way.
 */

type ServiceAccount = { client_email: string; private_key: string; project_id?: string };

function serviceAccount(): ServiceAccount | null {
  const raw = process.env["FCM_SERVICE_ACCOUNT_JSON"]?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch {
    // A malformed key is a configuration error, and a loud one: it looks
    // exactly like "push is switched off" from every other angle.
    logger.error("FCM_SERVICE_ACCOUNT_JSON is set but is not valid JSON — push is disabled");
    return null;
  }
}

function projectId(): string {
  const account = serviceAccount();
  return (process.env["FCM_PROJECT_ID"] ?? account?.project_id ?? "").trim();
}

/** Whether a real transport exists. Reported by /api/readyz, and never gates ready. */
export function pushConfigured(): boolean {
  return serviceAccount() !== null && projectId() !== "";
}

export function pushTransportName(): "fcm" | "none" {
  return pushConfigured() ? "fcm" : "none";
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64url").replace(/=+$/, "");

/**
 * An OAuth2 access token for the FCM scope, from a signed assertion.
 *
 * Cached until shortly before it expires. Google issues these for an hour and
 * rate-limits the exchange; minting one per notification would turn a burst of
 * reminders into a burst of token requests.
 */
let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string | null> {
  const account = serviceAccount();
  if (!account) return null;

  // 60s of slack, so a token that expires mid-flight is renewed before it is
  // used rather than after it has already failed one send.
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  // The key arrives out of an env var, where a real newline cannot survive.
  const pem = account.private_key.replace(/\\n/g, "\n");
  const signature = b64url(signer.sign(pem));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });

  if (!res.ok) {
    throw new Error(`FCM token exchange failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("FCM token exchange returned no access_token");

  cached = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}

/** Errors that mean the token is dead and retrying it is pointless. */
const DEAD_TOKEN = /UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND/i;

async function deliver(message: typeof pushOutboxTable.$inferSelect): Promise<void> {
  const token = await accessToken();
  if (!token) throw new Error("No FCM credentials");

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId()}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        token: message.token,
        notification: { title: message.title, body: message.body },
        // Strings only — FCM rejects a data payload with non-string values,
        // and it is the client's job to read `link` as a path.
        data: { link: message.link, kind: message.kind },
        android: { priority: "HIGH" },
        apns: { headers: { "apns-priority": "10" } },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`FCM send failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}

export type PushPayload = {
  title: string;
  body: string;
  link: string;
  kind: string;
  workspaceId: number;
};

/**
 * Queue a push to every live device this member registered IN THIS WORKSPACE.
 *
 * **The workspace filter is the tenant boundary and it is not optional.** A
 * person in two chambers holds a device row per chamber; without the filter a
 * reminder about one chamber's matter would appear on a lock screen while they
 * are working in the other, which is a cross-tenant disclosure in the most
 * visible place there is.
 *
 * Never throws. A notification failing to queue must not fail the request that
 * produced it, and must not stop the in-app row or the email that go with it.
 */
export async function sendPush(
  workspaceId: number,
  userId: number,
  payload: PushPayload,
): Promise<{ queued: number }> {
  try {
    const devices = await db
      .select()
      .from(deviceTokensTable)
      .where(
        and(
          eq(deviceTokensTable.userId, userId),
          eq(deviceTokensTable.workspaceId, workspaceId),
          isNull(deviceTokensTable.revokedAt),
        ),
      );
    if (devices.length === 0) return { queued: 0 };

    const configured = pushConfigured();
    const rows = devices.map((d) => ({
      workspaceId,
      userId,
      token: d.token,
      platform: d.platform,
      title: payload.title,
      body: payload.body,
      link: payload.link,
      kind: payload.kind,
      transport: pushTransportName(),
      status: configured ? ("queued" as const) : ("suppressed" as const),
      error: configured ? null : "FCM is not configured",
      nextAttemptAt: configured ? new Date() : null,
    }));

    await db.insert(pushOutboxTable).values(rows);
    if (!configured) {
      logger.warn(
        { userId, workspaceId, kind: payload.kind, devices: devices.length },
        "No FCM transport configured — push recorded in the outbox but not delivered",
      );
    }
    return { queued: rows.length };
  } catch (err) {
    logger.error({ err, userId, workspaceId }, "Could not queue push");
    return { queued: 0 };
  }
}

/* ── Retry ─────────────────────────────────────────────────────────────────
 *
 * The same ladder as mail, and the same reasoning: roughly 1 minute, 5, 25,
 * 2 hours, 6 hours, then given up on. A message that exhausts its attempts
 * becomes `abandoned` — a state that exists so somebody can see it.
 */
const MAX_ATTEMPTS = 6;
const BACKOFF_MINUTES = [1, 5, 25, 120, 360];

function dueAfter(attempts: number): Date {
  const mins = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length) - 1] ?? 360;
  return new Date(Date.now() + mins * 60_000);
}

/**
 * Send everything that is due. Never throws — it runs on a timer, and a drain
 * that dies on one bad row stops every later one.
 */
export async function drainPushOutbox(limit = 25): Promise<{
  attempted: number;
  sent: number;
  failed: number;
  abandoned: number;
}> {
  const result = { attempted: 0, sent: 0, failed: 0, abandoned: 0 };
  if (!pushConfigured()) return result;

  let due: (typeof pushOutboxTable.$inferSelect)[] = [];
  try {
    due = await db
      .select()
      .from(pushOutboxTable)
      .where(
        and(
          or(eq(pushOutboxTable.status, "queued"), eq(pushOutboxTable.status, "failed")),
          lte(pushOutboxTable.nextAttemptAt, new Date()),
          lt(pushOutboxTable.attempts, MAX_ATTEMPTS),
        ),
      )
      .orderBy(asc(pushOutboxTable.id))
      .limit(limit);
  } catch (err) {
    logger.error({ err }, "Could not read the push outbox");
    return result;
  }

  for (const message of due) {
    result.attempted += 1;
    const attempts = message.attempts + 1;
    try {
      await deliver(message);
      result.sent += 1;
      await db
        .update(pushOutboxTable)
        .set({ status: "sent", sentAt: new Date(), attempts, nextAttemptAt: null, error: null })
        .where(eq(pushOutboxTable.id, message.id));
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);

      /*
       * A token the device no longer holds is not a failure to retry.
       *
       * Reinstalling the app or restoring to a new handset invalidates the old
       * registration, and FCM says so plainly. Retrying it five more times
       * achieves nothing, so the message is abandoned and the device row is
       * revoked — which also stops every FUTURE reminder queueing against a
       * dead address.
       */
      const dead = DEAD_TOKEN.test(text);
      const spent = dead || attempts >= MAX_ATTEMPTS;
      if (spent) result.abandoned += 1;
      else result.failed += 1;

      await db
        .update(pushOutboxTable)
        .set({
          status: spent ? "abandoned" : "failed",
          error: text.slice(0, 500),
          attempts,
          lastAttemptAt: new Date(),
          nextAttemptAt: spent ? null : dueAfter(attempts),
        })
        .where(eq(pushOutboxTable.id, message.id));

      if (dead) {
        await db
          .update(deviceTokensTable)
          .set({ revokedAt: new Date() })
          .where(eq(deviceTokensTable.token, message.token))
          .catch(() => {});
      }
    }
  }

  return result;
}
