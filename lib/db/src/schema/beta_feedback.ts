import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Product feedback from beta users: "this page is confusing", "this button did
 * nothing".
 *
 * Deliberately NOT the `feedback` table. That one is a client rating a matter
 * out of five — it requires a case, requires a rating, and is written only by
 * the client the matter belongs to. This is a different thing with a different
 * author, a different lifetime and a different audience, and folding the two
 * together would mean loosening the constraints that make the other one
 * trustworthy.
 *
 * The page path is the whole point. "The thing on the left is broken" is
 * unactionable; the same sentence with `/cases/14` attached is a bug report.
 */
export const betaFeedbackTable = pgTable("beta_feedback", {
  id: serial("id").primaryKey(),
  /** users.id of whoever sent it. Always known — the widget is behind sign-in. */
  userId: integer("user_id").notNull(),
  clerkId: text("clerk_id").notNull(),
  /** Denormalised so a reviewer can reply without joining, and so it survives
   *  the user being deleted under a privacy request. */
  email: text("email").notNull().default(""),
  displayName: text("display_name").notNull().default(""),
  /**
   * Nullable on purpose: the people most worth hearing from are the ones stuck
   * on the access-denied and pending-approval screens, who belong to no
   * workspace at all. A NOT NULL here would silence exactly them.
   */
  workspaceId: integer("workspace_id"),
  message: text("message").notNull(),
  /** Where they were when they hit send, e.g. "/cases/14". */
  pagePath: text("page_path").notNull(),
  /** Browser string, for the "only broken on my phone" reports. */
  userAgent: text("user_agent").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBetaFeedbackSchema = createInsertSchema(betaFeedbackTable).omit({
  id: true,
  createdAt: true,
});
export type InsertBetaFeedback = z.infer<typeof insertBetaFeedbackSchema>;
export type BetaFeedback = typeof betaFeedbackTable.$inferSelect;
