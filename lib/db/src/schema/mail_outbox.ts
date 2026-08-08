import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Every message the platform tried to send.
 *
 * Written before the transport is called and updated with the outcome, so a
 * message that failed to send is still visible rather than vanishing into a
 * log line. That matters here more than in most apps: the things this system
 * emails about are filing deadlines and hearing dates.
 *
 * `status` is the delivery attempt, not the recipient's behaviour - nothing
 * here tracks opens or clicks, and nothing should.
 */
/**
 * `failed` is not terminal — it means "the last attempt failed and another is
 * due". A message that has exhausted its attempts becomes `abandoned`, which is
 * the state a human needs to look at.
 */
export const MAIL_STATUSES = ["queued", "sent", "failed", "abandoned", "suppressed"] as const;
export type MailStatus = (typeof MAIL_STATUSES)[number];

export const mailOutboxTable = pgTable("mail_outbox", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id"),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  /** reminder | invite | document_request | erasure — what prompted it. */
  kind: text("kind").notNull().default("notice"),
  status: text("status").notNull().default("queued"),
  /** Which transport handled it: smtp, or log when none is configured. */
  transport: text("transport").notNull().default(""),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  /** When the next retry becomes due. Null once the message is settled. */
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

export type MailMessage = typeof mailOutboxTable.$inferSelect;
