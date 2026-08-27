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
   * Advocate-on-Record at a High Court, where the court maintains such a roll.
   *
   * Separate from `aorNo`, which is the Supreme Court one, because they are
   * different rolls with different numbers and an advocate may hold either,
   * both or neither. Collapsing them into one field would make "which court is
   * this number from" unanswerable the moment somebody holds two.
   */
  aorHighCourtNo: text("aor_high_court_no"),
  /** Certificate of Practice number, issued by the state bar council. */
  copNo: text("cop_no"),
  /**
   * All India Bar Examination certificate number.
   *
   * Nullable, and deliberately not required at first declaration: an advocate
   * enrolled before the examination existed may not hold one, and a newly
   * enrolled advocate has a statutory window to sit it. Required by
   * `allIndiaBarDueAt` below rather than immediately.
   */
  allIndiaBarNo: text("all_india_bar_no"),
  /**
   * When the All India Bar number stops being optional.
   *
   * Set six months out when bar registration is first declared. Until then the
   * field is requested and not enforced; after it, the same gate that blocks a
   * practice role without an enrolment number blocks one without this.
   *
   * Stored as a date rather than derived from `barDeclaredAt` on read, because
   * the window belongs to the person: extending it for somebody whose
   * examination was postponed should be one operator update, not a code change
   * that moves the deadline for everybody.
   */
  allIndiaBarDueAt: timestamp("all_india_bar_due_at", { withTimezone: true }),
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
  /**
   * A verified mobile number in E.164, or null.
   *
   * The second identifier this platform admits people by. Written only from a
   * Clerk-**verified** number, exactly like `email` — an unverified one is
   * attacker-supplied text, and matching it against the access list would let
   * anyone claim a colleague's number and inherit their role.
   *
   * Not unique, matching `email`. Normalised on write by `normalisePhone()` so
   * access-list matching stays a plain equality check.
   */
  phone: text("phone"),
  /**
   * When this person last claimed the two-month trial pack, in any chamber.
   *
   * On the USER, not the subscription, and that is the whole point. The trial
   * is one per person: a founder who has used it and then creates a second
   * chamber must not get another, and a per-workspace record would reset every
   * time somebody founded one. Written by the payment webhook when a trial
   * purchase is applied, so it records a payment that actually happened rather
   * than an intent.
   */
  trialClaimedAt: timestamp("trial_claimed_at", { withTimezone: true }),
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
