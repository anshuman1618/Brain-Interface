import { pgTable, text, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Where a notification goes when it has to reach somebody who is not looking
 * at the app.
 *
 * The in-app bell already exists and polls every thirty seconds; email already
 * exists and is written to `mail_outbox` before the transport is called. Push
 * is the third channel, deliberately built to the same shape as the second
 * rather than a new one — the things this system notifies about are filing
 * deadlines and hearing dates, and a message that failed to send has to stay
 * visible instead of becoming a log line nobody reads.
 */

/**
 * One device, one row.
 *
 * The token is the address, and it is NOT stable: the OS reissues it on
 * reinstall, on restore to a new handset, and occasionally on its own. So the
 * app re-registers on every launch and this table is written upsert-style,
 * with `lastSeenAt` as the evidence a row is still real.
 */
export const deviceTokensTable = pgTable(
  "device_tokens",
  {
    id: serial("id").primaryKey(),
    /**
     * The workspace this registration belongs to.
     *
     * A device is registered per chamber, not per person, and that is the whole
     * tenant boundary for push: somebody who belongs to two chambers has two
     * rows, and a notification for chamber A can only ever select the row that
     * names A. Without this column the send path would have to re-derive the
     * boundary from the notification's contents, which is exactly the kind of
     * inference that leaks one chamber's matter into another's lock screen.
     */
    workspaceId: integer("workspace_id").notNull(),
    /** Internal users.id of the owner. */
    userId: integer("user_id").notNull(),
    /** Denormalised, matching workspace_memberships — the send path is a hot loop. */
    clerkId: text("clerk_id").notNull().default(""),
    /** The FCM registration token. Opaque, and long. */
    token: text("token").notNull(),
    /** ios | android. Recorded for diagnosis, never for routing — FCM handles both. */
    platform: text("platform").notNull().default(""),
    /** Refreshed every launch. A row that stops moving is a device that is gone. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Set when the user turns notifications off, or when FCM tells us the
     * token is dead. Never deleted, so "they had this switched off" stays
     * answerable.
     */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One row per token per workspace. The same handset signed into two
    // chambers legitimately holds two rows; the same handset re-registering in
    // one chamber must update, not accumulate.
    unique("device_tokens_ws_token_key").on(table.workspaceId, table.token),
  ],
);

export type DeviceToken = typeof deviceTokensTable.$inferSelect;

/**
 * `failed` is not terminal — it means "the last attempt failed and another is
 * due". A message that has exhausted its attempts becomes `abandoned`, which is
 * the state a human needs to look at. `suppressed` means no transport was
 * configured, which is the ordinary state of a deployment that has not set up
 * Firebase yet and must not look like an error.
 *
 * Deliberately identical to MAIL_STATUSES. Two delivery channels with two
 * different vocabularies for the same five outcomes would be a trap.
 */
export const PUSH_STATUSES = ["queued", "sent", "failed", "abandoned", "suppressed"] as const;
export type PushStatus = (typeof PUSH_STATUSES)[number];

export const pushOutboxTable = pgTable("push_outbox", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id"),
  /** The device row this was addressed to, so a dead token can be traced back. */
  deviceTokenId: integer("device_token_id").notNull(),
  /** Copied at queue time: the device row may be revoked before this is drained. */
  token: text("token").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  /** In-app path to open on tap, e.g. "/tasks". */
  link: text("link").notNull().default(""),
  /** reminder | document_request | hearing — what prompted it. */
  kind: text("kind").notNull().default("notice"),
  status: text("status").notNull().default("queued"),
  /** Which transport handled it: fcm, or log when none is configured. */
  transport: text("transport").notNull().default(""),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  /** When the next retry becomes due. Null once the message is settled. */
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

export type PushMessage = typeof pushOutboxTable.$inferSelect;
