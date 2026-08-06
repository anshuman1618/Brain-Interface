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
  /** Optional external link, for material that lives somewhere else entirely. */
  url: text("url"),
  fileType: text("file_type"),
  fileSize: integer("file_size"),
  encrypted: boolean("encrypted").notNull().default(true),
  /**
   * Opaque key into the blob store — NOT a path the client supplies or sees.
   * It is generated server-side, so a crafted filename cannot escape the
   * storage root, and the original name is kept separately in `name`.
   * Null means the row is a stub with no bytes behind it.
   */
  storagePath: text("storage_path"),
  /** SHA-256 of the stored bytes. Detects silent corruption, and lets an
   *  identical re-upload be recognised rather than duplicated blindly. */
  checksum: text("checksum"),
  visibility: text("visibility").notNull().default("firm"),
  uploadedBy: text("uploaded_by").notNull().default(""),
  uploadedByClerkId: text("uploaded_by_clerk_id").notNull().default(""),
  uploadedByRole: text("uploaded_by_role").notNull().default(""),
  /** Set when this upload answers a document request. */
  documentRequestId: integer("document_request_id"),
  note: text("note"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({
  id: true,
  uploadedAt: true,
});
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
