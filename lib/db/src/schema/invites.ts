import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const invitesTable = pgTable("invites", {
  id: serial("id").primaryKey(),
  /** The workspace the invite grants membership of — never firm-wide. */
  workspaceId: integer("workspace_id").notNull(),
  /**
   * The address invited, or null when the invite names a number instead.
   *
   * Nullable since 0012: exactly one of `email` / `phone` is set, enforced in
   * `routes/invites.ts` rather than by a CHECK, so the message can explain
   * which one is missing.
   */
  email: text("email"),
  /** A verified-on-sign-in mobile in E.164. Null when the invite names an address. */
  phone: text("phone"),
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
