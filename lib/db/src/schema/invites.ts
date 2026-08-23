import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const invitesTable = pgTable("invites", {
  id: serial("id").primaryKey(),
  /** The workspace the invite grants membership of — never firm-wide. */
  workspaceId: integer("workspace_id").notNull(),
  /**
   * Who the invite is addressed to. Exactly one of `email` / `phone` carries a
   * value; the other is "".
   *
   * `email` keeps its NOT NULL and gains a default rather than becoming
   * nullable, so this stayed an additive migration — a phone invite simply
   * stores the empty string, which is already how `users.email` represents
   * "no address".
   */
  email: text("email").notNull().default(""),
  /** E.164, normalised on write. See `normalisePhone` in workspace_access_list.ts. */
  phone: text("phone").notNull().default(""),
  token: text("token").notNull().unique(),
  role: text("role").notNull().default("client"), // admin | clerk | client
  caseId: integer("case_id"),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const insertInviteSchema = createInsertSchema(invitesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertInvite = z.infer<typeof insertInviteSchema>;
export type Invite = typeof invitesTable.$inferSelect;
