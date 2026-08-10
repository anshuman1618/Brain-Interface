import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * A workspace is the tenant boundary. Every case, task, document, consultation
 * and document request belongs to exactly one workspace, and a user can only
 * reach a workspace through an ACTIVE row in `workspace_memberships`.
 *
 * `slug` is the stable public identifier; ids are never guessable-by-design but
 * are also never trusted on their own — see middlewares/workspaceGuard.ts.
 */
export const workspacesTable = pgTable("workspaces", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("chamber"), // chamber | client_portal
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWorkspaceSchema = createInsertSchema(workspacesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertWorkspace = z.infer<typeof insertWorkspaceSchema>;
export type Workspace = typeof workspacesTable.$inferSelect;
