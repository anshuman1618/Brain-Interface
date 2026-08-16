import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
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
  /**
   * Billing identity and tax defaults for the chamber.
   *
   * These are the CURRENT values. An invoice snapshots them at issue, so
   * editing an address here never rewrites a document already sent.
   *
   * Every tax field defaults to empty or zero on purpose. Legal services in
   * India carry specific rules including reverse charge in some cases, and
   * which applies is the firm's accountant's decision, not this code's. An
   * unconfigured chamber issues a zero-tax invoice and shows that plainly,
   * rather than assuming 9/9 or 18 and being quietly wrong on a document that
   * goes to a tax authority.
   */
  firmAddress: text("firm_address").notNull().default(""),
  firmGstin: text("firm_gstin"),
  /** The chamber's own state or UT — one half of what decides the tax split. */
  firmPlaceOfSupply: text("firm_place_of_supply"),
  /** Service accounting code the chamber bills under. */
  defaultSacCode: text("default_sac_code"),
  /** Basis points. 9% is 900. Zero until an accountant says otherwise. */
  defaultCgstRateBp: integer("default_cgst_rate_bp").notNull().default(0),
  defaultSgstRateBp: integer("default_sgst_rate_bp").notNull().default(0),
  defaultIgstRateBp: integer("default_igst_rate_bp").notNull().default(0),
  /** Hourly rate in paise, used to price time entries onto an invoice. */
  defaultHourlyRateMinor: integer("default_hourly_rate_minor").notNull().default(0),
  defaultPaymentTerms: text("default_payment_terms").notNull().default(""),
  /** Days from issue to due date. */
  defaultPaymentDays: integer("default_payment_days").notNull().default(30),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWorkspaceSchema = createInsertSchema(workspacesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertWorkspace = z.infer<typeof insertWorkspaceSchema>;
export type Workspace = typeof workspacesTable.$inferSelect;
