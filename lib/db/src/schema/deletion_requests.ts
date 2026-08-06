import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * A person asking a chamber to erase what it holds about them.
 *
 * Erasure in a legal practice is not a delete statement. A chamber has its own
 * retention obligations over matter records, and a client cannot unilaterally
 * remove the file of a case that was fought. So this is a *request* an admin
 * actions, and completing it anonymises the person rather than deleting the
 * matters they appear in: name and email are replaced, the membership is
 * revoked, and the matter history survives without identifying them.
 *
 * The request itself is retained after completion. Being able to show that an
 * erasure was asked for and honoured is the point of honouring it.
 */
export const DELETION_STATUSES = ["pending", "completed", "rejected"] as const;
export type DeletionStatus = (typeof DELETION_STATUSES)[number];

export const deletionRequestsTable = pgTable("deletion_requests", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  userId: integer("user_id").notNull(),
  clerkId: text("clerk_id").notNull(),
  /** Captured at request time so the queue still reads correctly afterwards. */
  requestedEmail: text("requested_email").notNull().default(""),
  requestedName: text("requested_name").notNull().default(""),
  reason: text("reason"),
  status: text("status").notNull().default("pending"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeletionRequest = typeof deletionRequestsTable.$inferSelect;
