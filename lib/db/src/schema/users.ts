import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  role: text("role").notNull().default("client"), // admin | senior_advocate | junior_advocate | clerk_intern | client
  roleSelected: boolean("role_selected").notNull().default(false), // true once user has picked a role at sign-up
  displayName: text("display_name").notNull().default(""),
  email: text("email").notNull().default(""),
  /** How they last signed in: google | zoho | email. Display only — never authorization. */
  authProvider: text("auth_provider").notNull().default(""),
  /**
   * Billing details, used when this user is a client being invoiced.
   *
   * Current values only — an invoice snapshots them at issue, so a client who
   * moves office does not retrospectively change an invoice already sent.
   */
  billingAddress: text("billing_address").notNull().default(""),
  billingGstin: text("billing_gstin"),
  /** State or UT of the client — the other half of the tax split. */
  billingPlaceOfSupply: text("billing_place_of_supply"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
