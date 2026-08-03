import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * A case document. Deliberately bi-directional: the same table holds files the
 * chamber puts in front of a client and files the client sends back.
 *
 * Two fields carry that distinction:
 *  - `visibility` — 'firm' is internal working material a client never sees;
 *    'shared' is visible to the client on the matter. Uploads by a client are
 *    always 'shared', since a client cannot create firm-internal material.
 *  - `documentRequestId` — set when the upload fulfils a specific request, which
 *    is what closes the loop between "we asked for X" and "here is X".
 */
export const DOCUMENT_VISIBILITIES = ["firm", "shared"] as const;
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull(),
  name: text("name").notNull(),
  /** Where the file actually lives. External object storage in production. */
  url: text("url"),
  fileType: text("file_type"),
  fileSize: integer("file_size"),
  encrypted: boolean("encrypted").notNull().default(true),
  storagePath: text("storage_path"),
  visibility: text("visibility").notNull().default("firm"),
  uploadedBy: text("uploaded_by").notNull().default(""),
  uploadedByClerkId: text("uploaded_by_clerk_id").notNull().default(""),
  uploadedByRole: text("uploaded_by_role").notNull().default(""),
  /** Set when this upload answers a document request. */
  documentRequestId: integer("document_request_id"),
  note: text("note"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({ id: true, uploadedAt: true });
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
