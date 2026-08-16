import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  date,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Invoicing.
 *
 * MONEY IS INTEGER PAISE, everywhere, with no exceptions. Every column holding
 * an amount ends `_minor`. This follows the rule `lib/plans.ts` already states
 * for subscription pricing — "money never touches a float" — and extends it to
 * client billing. A rupee value is only ever produced at the moment of display.
 *
 * QUANTITIES ARE THOUSANDTHS. 1.5 hours is 1500, not 1.5. Same reason: an
 * invoice line for 7.7 hours at ₹4,500 must not depend on binary floating point
 * to reach the same total twice.
 */

/**
 * The gapless counter, one row per chamber per financial year.
 *
 * A sequence would be simpler and would be wrong: Postgres sequences are
 * explicitly NOT gapless — a rolled-back transaction consumes a value and never
 * gives it back. Tax authorities expect an unbroken run, so the counter is an
 * ordinary row that is locked, read, incremented and released inside the same
 * transaction that writes the invoice. If that transaction rolls back, the
 * increment rolls back with it.
 *
 * The unique constraint is what makes two concurrent first-invoices safe: the
 * loser of the insert race falls back to locking the row the winner created.
 */
export const invoiceSeriesTable = pgTable(
  "invoice_series",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull(),
    /** Indian financial year, 1 April to 31 March, written "2026-27". */
    financialYear: text("financial_year").notNull(),
    /** The number the NEXT issued invoice will take. Starts at 1. */
    nextNumber: integer("next_number").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("invoice_series_workspace_year_key").on(t.workspaceId, t.financialYear)],
);

/**
 * An invoice.
 *
 * A draft carries NO number. Numbers are handed out at issue time and never
 * before — that is what keeps the series gapless when somebody creates three
 * drafts and deletes two. `invoiceNumber` and `financialYear` are null until
 * issued, and the unique constraint below therefore constrains only real,
 * issued invoices.
 *
 * The client and firm details are SNAPSHOTS, deliberately duplicated rather
 * than joined. A client who moves office after being invoiced must not
 * retrospectively change the address on an invoice they have already received;
 * the document has to keep saying what it said when it was sent.
 */
export const invoicesTable = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull(),

    // ── identity ────────────────────────────────────────────────────────────
    /** Sequential within the financial year. Null while draft. */
    invoiceNumber: integer("invoice_number"),
    /** "2026-27". Null while draft. */
    financialYear: text("financial_year"),
    /** Rendered form, e.g. "RC/2026-27/0007". Null while draft. */
    invoiceRef: text("invoice_ref"),

    // ── lifecycle ───────────────────────────────────────────────────────────
    /**
     * draft | issued | sent | paid | void
     *
     * "Overdue" is deliberately NOT stored. It is issued-or-sent with a due date
     * in the past, which is a question about today's date — storing it would
     * mean a scheduled job whose only purpose is to keep a derived value from
     * going stale, and an invoice that is overdue only because the job ran.
     */
    status: text("status").notNull().default("draft"),

    // ── who did what, and when ──────────────────────────────────────────────
    createdBy: text("created_by").notNull().default(""),
    createdByClerkId: text("created_by_clerk_id").notNull().default(""),
    issuedBy: text("issued_by"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedBy: text("voided_by"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    /** Set on a credit note or reissue, pointing at what it corrects. */
    supersedesInvoiceId: integer("supersedes_invoice_id"),

    // ── dates ───────────────────────────────────────────────────────────────
    issueDate: date("issue_date"),
    dueDate: date("due_date"),

    // ── client snapshot, taken at issue ─────────────────────────────────────
    /** Lookup only. Never joined to for anything printed. */
    clientId: integer("client_id"),
    clientName: text("client_name").notNull().default(""),
    clientAddress: text("client_address").notNull().default(""),
    clientEmail: text("client_email").notNull().default(""),
    clientGstin: text("client_gstin"),

    // ── firm snapshot, taken at issue ───────────────────────────────────────
    firmName: text("firm_name").notNull().default(""),
    firmAddress: text("firm_address").notNull().default(""),
    firmGstin: text("firm_gstin"),

    // ── tax, configurable, nothing assumed ──────────────────────────────────
    /**
     * Which treatment applies: intra | inter | exempt | reverse_charge.
     *
     * NOT decided by this code. Legal services in India carry specific rules
     * including reverse charge in some cases, and the firm's accountant settles
     * which applies. The field records their decision; the rates below record
     * the numbers they gave. Nothing here is defaulted to 9/9 or 18.
     */
    taxTreatment: text("tax_treatment").notNull().default("unspecified"),
    /** State or UT that determines the split. Free text — the list changes. */
    placeOfSupply: text("place_of_supply"),
    /** Service accounting code for the line of business. */
    sacCode: text("sac_code"),
    /** Rates in BASIS POINTS. 9% is 900. Integer, so no float in the tax maths. */
    cgstRateBp: integer("cgst_rate_bp").notNull().default(0),
    sgstRateBp: integer("sgst_rate_bp").notNull().default(0),
    igstRateBp: integer("igst_rate_bp").notNull().default(0),

    // ── totals, all integer paise ───────────────────────────────────────────
    subtotalMinor: integer("subtotal_minor").notNull().default(0),
    cgstMinor: integer("cgst_minor").notNull().default(0),
    sgstMinor: integer("sgst_minor").notNull().default(0),
    igstMinor: integer("igst_minor").notNull().default(0),
    totalMinor: integer("total_minor").notNull().default(0),
    currency: text("currency").notNull().default("INR"),

    notes: text("notes"),
    paymentTerms: text("payment_terms"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Two issued invoices can never share a number within a year. Drafts hold
    // nulls here, and Postgres does not treat nulls as equal, so any number of
    // drafts coexist without tripping this.
    unique("invoices_workspace_year_number_key").on(
      t.workspaceId,
      t.financialYear,
      t.invoiceNumber,
    ),
    index("invoices_workspace_status_idx").on(t.workspaceId, t.status),
    index("invoices_client_idx").on(t.clientId),
  ],
);

/**
 * A line on an invoice.
 *
 * `amountMinor` is stored rather than derived on read. The stored figure is what
 * was totalled, printed and sent; recomputing it later from quantity × rate
 * risks a different answer if the rounding rule is ever adjusted, and the
 * invoice has to keep agreeing with the paper the client is holding.
 */
export const invoiceLineItemsTable = pgTable(
  "invoice_line_items",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id").notNull(),
    /** Ordering on the printed document. */
    position: integer("position").notNull().default(0),
    description: text("description").notNull(),
    /** Thousandths. 1.5 hours or units is 1500. */
    quantityMilli: integer("quantity_milli").notNull().default(1000),
    /** "hour" | "item" | "day" — display only. */
    unit: text("unit").notNull().default("hour"),
    /** Paise per whole unit. */
    unitRateMinor: integer("unit_rate_minor").notNull().default(0),
    /** Paise. quantity × rate, rounded once, at the time the line was written. */
    amountMinor: integer("amount_minor").notNull().default(0),
    sacCode: text("sac_code"),
    /**
     * The time entry this line was built from, when it was.
     *
     * Lets the invoice builder exclude already-billed time without a separate
     * "billed" flag on time_entries that could drift out of step with reality.
     */
    timeEntryId: integer("time_entry_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invoice_line_items_invoice_idx").on(t.invoiceId),
    // One time entry can back at most one invoice line, which is what makes
    // "unbilled time" answerable by a left join rather than by bookkeeping.
    unique("invoice_line_items_time_entry_key").on(t.timeEntryId),
  ],
);

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
export type InvoiceLineItem = typeof invoiceLineItemsTable.$inferSelect;
export type InvoiceSeries = typeof invoiceSeriesTable.$inferSelect;
