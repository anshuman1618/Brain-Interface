import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Client feedback on a matter: a rating and a comment, optionally answered by
 * the chamber.
 *
 * Written only by the client the matter belongs to — a chamber cannot rate
 * itself, and one client cannot rate another's matter. Staff read it and may
 * respond; they cannot edit or delete what a client wrote, because a review the
 * subject can silently rewrite is not feedback.
 */
export const feedbackTable = pgTable("feedback", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  caseId: integer("case_id").notNull(),
  /** users.id of the client who left it. */
  clientId: integer("client_id").notNull(),
  clientClerkId: text("client_clerk_id").notNull(),
  clientName: text("client_name").notNull().default(""),
  /** 1–5. Validated at the route as well as here. */
  rating: integer("rating").notNull(),
  comment: text("comment"),
  /** The chamber's reply, if any. */
  response: text("response"),
  respondedBy: text("responded_by"),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertFeedbackSchema = createInsertSchema(feedbackTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;
export type Feedback = typeof feedbackTable.$inferSelect;
