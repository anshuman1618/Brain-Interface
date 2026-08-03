import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(), // Clerk user ID of recipient
  type: text("type").notNull(), // reminder | document_request | general
  message: text("message").notNull(),
  read: boolean("read").notNull().default(false),
  link: text("link"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;

export const documentRequestsTable = pgTable("document_requests", {
  id: serial("id").primaryKey(),
  /** Tenant boundary — a request is only ever visible inside the workspace it was raised in. */
  workspaceId: integer("workspace_id").notNull(),
  /** Recipient: the person the document is being requested FROM. */
  clientId: integer("client_id").notNull(), // internal users table id of client
  clientClerkId: text("client_clerk_id").notNull(),
  /** Display name of the recipient, denormalised so the list renders both sides of the request. */
  requestedFromName: text("requested_from_name").notNull().default(""),
  /** Requester: the staff member who raised it. */
  requestedBy: text("requested_by").notNull(),
  requestedByClerkId: text("requested_by_clerk_id").notNull().default(""),
  requestedByRole: text("requested_by_role").notNull().default(""),
  documentName: text("document_name").notNull(),
  note: text("note"),
  /** Optional deadline the recipient is asked to respond by. */
  dueDate: text("due_date"),
  caseId: integer("case_id"),
  status: text("status").notNull().default("pending"), // pending | fulfilled | dismissed
  /** The document the client uploaded to close this request. */
  fulfilledDocumentId: integer("fulfilled_document_id"),
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDocumentRequestSchema = createInsertSchema(documentRequestsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDocumentRequest = z.infer<typeof insertDocumentRequestSchema>;
export type DocumentRequest = typeof documentRequestsTable.$inferSelect;
