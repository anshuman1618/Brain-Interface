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
  /**
   * Self-declared practice credentials — required for admin, senior_advocate
   * and junior_advocate before they reach the dashboard; see
   * `lib/permissions.ts`'s `needsBarRegistration()`.
   *
   * Enrolment formats vary by state bar and are not standardised, so these are
   * validated loosely (non-empty) rather than against a pattern — what is
   * typed is what is stored.
   */
  barCouncilState: text("bar_council_state"),
  barEnrolmentNo: text("bar_enrolment_no"),
  /** Supreme Court Advocate-on-Record number. Optional — most advocates never hold one. */
  aorNo: text("aor_no"),
  /**
   * When the two required fields above were last declared complete. Named
   * `_declared_at`, not `_verified_at`: nothing here is checked against a bar
   * council, and the column name must not let a future reader mistake
   * self-declaration for proof.
   */
  barDeclaredAt: timestamp("bar_declared_at", { withTimezone: true }),
  /**
   * The last time this person made an authenticated request, to the hour.
   *
   * The only record that anyone came *back*. Everything else here says who
   * registered; without this, someone who opens the diary every morning and
   * writes nothing is indistinguishable from someone who signed up once and
   * never returned — the audit log only sees privileged writes.
   *
   * Deliberately coarse. It is written at most once an hour per person
   * (`lib/last-seen.ts`), which is enough for "active this week" and far short
   * of a record of when somebody was at their desk. Nothing derives a session
   * from it and nothing shows it to another chamber.
   */
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
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
