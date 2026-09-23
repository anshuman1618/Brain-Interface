import { pgTable, text, serial, integer, timestamp, index, unique } from "drizzle-orm/pg-core";

/**
 * Handsets a chamber member has registered, and every push aimed at one.
 *
 * Two tables for the same reason mail has two: a token is an ADDRESS, and a
 * message is an ATTEMPT to reach one. Keeping them apart means revoking a
 * device does not erase the record of what was sent to it.
 */

/**
 * A device a member has switched notifications on for.
 *
 * ── Why `workspace_id` is on the token and not just the user ────────────────
 *
 * A person can hold memberships in several chambers. The row is per (user,
 * workspace, token) so a reminder about chamber A's hearing is delivered to
 * the registration made while working in A — and a member removed from A stops
 * receiving A's matters on the next send, without touching their registration
 * in B. It is the same tenant boundary every other table here carries, applied
 * to a lock screen.
 *
 * ── Revoked, not deleted ────────────────────────────────────────────────────
 *
 * `revokedAt` rather than a DELETE, so "why did notifications stop" stays
 * answerable afterwards.
 */
export const DEVICE_PLATFORMS = ["ios", "android"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const deviceTokensTable = pgTable(
  "device_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    workspaceId: integer("workspace_id").notNull(),
    /** The FCM registration token. Opaque to us. */
    token: text("token").notNull(),
    /** ios | android — see DEVICE_PLATFORMS. */
    platform: text("platform").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Touched on every re-registration. The OS reissues a token on reinstall
     * and on restore to a new handset, so the app registers on every launch —
     * which makes this the answer to "is this handset still in use".
     */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    /**
     * The upsert key. Without it, re-registering on every launch accumulates a
     * row per launch and every reminder goes out N times — which is how a
     * push integration turns into the thing people switch off.
     */
    deviceTokenUnique: unique("device_tokens_ws_token_key").on(t.workspaceId, t.token),
    deviceTokensUserIdx: index("device_tokens_user_idx").on(t.userId),
    deviceTokensWorkspaceIdx: index("device_tokens_workspace_idx").on(t.workspaceId),
  }),
);

export type DeviceToken = typeof deviceTokensTable.$inferSelect;

/**
 * Every push the platform tried to send.
 *
 * Modelled on `mail_outbox` down to the five statuses and the retry ladder,
 * deliberately and not by copy-paste inertia: the things this system notifies
 * about are filing deadlines and hearing dates, and a message that failed has
 * to stay visible instead of becoming a log line. A second delivery channel
 * with a different failure model would mean two places to look when somebody
 * says they were never told.
 *
 * `failed` is not terminal — it means "the last attempt failed and another is
 * due". A message that exhausts its attempts becomes `abandoned`, which is the
 * state a human needs to look at. `suppressed` means no transport was
 * configured, so nothing was ever sent and nothing will be.
 */
export const PUSH_STATUSES = ["queued", "sent", "failed", "abandoned", "suppressed"] as const;
export type PushStatus = (typeof PUSH_STATUSES)[number];

export const pushOutboxTable = pgTable(
  "push_outbox",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id"),
    userId: integer("user_id"),
    /** The registration token at send time, kept even if the device is revoked. */
    token: text("token").notNull(),
    platform: text("platform").notNull().default(""),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /**
     * An in-app path the app routes to when the notification is tapped.
     *
     * A path, never a URL. The client refuses anything not starting with "/"
     * — see lib/native-push.ts — so this column cannot be turned into an open
     * redirect by whatever writes it.
     */
    link: text("link").notNull().default(""),
    /** reminder | document_request | general — what prompted it. */
    kind: text("kind").notNull().default("notice"),
    status: text("status").notNull().default("queued"),
    /** Which transport handled it: fcm, or none when unconfigured. */
    transport: text("transport").notNull().default(""),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    /** When the next retry becomes due. Null once the message is settled. */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => ({
    pushOutboxDueIdx: index("push_outbox_due_idx").on(t.status, t.nextAttemptAt),
  }),
);

export type PushMessage = typeof pushOutboxTable.$inferSelect;
