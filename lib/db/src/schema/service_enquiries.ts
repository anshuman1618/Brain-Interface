import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * A request for a service the pricing screen names but does not sell —
 * currently just "help moving from what you use today". The card sits below
 * the plan tiers, visually distinct from them, because it is not a plan: it
 * is a lead into a conversation a person has to have, not a checkbox a
 * subscription can turn on.
 *
 * Deliberately unopinionated about what happens next. There is no admin
 * screen yet — this table is the record, readable straight from the
 * database, until enough enquiries arrive to justify building one. `status`
 * exists so that screen has somewhere to write when it does, without another
 * migration.
 */
export const SERVICE_ENQUIRY_KINDS = ["migration"] as const;
export type ServiceEnquiryKind = (typeof SERVICE_ENQUIRY_KINDS)[number];

export const CONTACT_PREFERENCES = ["email", "phone"] as const;
export type ContactPreference = (typeof CONTACT_PREFERENCES)[number];

export const SERVICE_ENQUIRY_STATUSES = ["new", "contacted", "closed"] as const;
export type ServiceEnquiryStatus = (typeof SERVICE_ENQUIRY_STATUSES)[number];

export const serviceEnquiriesTable = pgTable("service_enquiries", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  userId: integer("user_id").notNull(),
  clerkId: text("clerk_id").notNull(),
  /** Denormalised so a reviewer can reply without joining, matching beta_feedback. */
  email: text("email").notNull().default(""),
  displayName: text("display_name").notNull().default(""),
  serviceKind: text("service_kind").notNull().default("migration"),
  message: text("message").notNull(),
  contactPreference: text("contact_preference").notNull().default("email"),
  /** Only meaningful when contactPreference is "phone". */
  contactPhone: text("contact_phone"),
  status: text("status").notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertServiceEnquirySchema = createInsertSchema(serviceEnquiriesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertServiceEnquiry = z.infer<typeof insertServiceEnquirySchema>;
export type ServiceEnquiry = typeof serviceEnquiriesTable.$inferSelect;

export function isServiceEnquiryKind(v: unknown): v is ServiceEnquiryKind {
  return typeof v === "string" && (SERVICE_ENQUIRY_KINDS as readonly string[]).includes(v);
}
export function isContactPreference(v: unknown): v is ContactPreference {
  return typeof v === "string" && (CONTACT_PREFERENCES as readonly string[]).includes(v);
}
