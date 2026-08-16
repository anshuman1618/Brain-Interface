import { and, eq, sql } from "drizzle-orm";
import { db, invoiceSeriesTable, invoicesTable, type Invoice } from "@workspace/db";

/**
 * Invoice numbering.
 *
 * The requirement is sequential, gapless, and immutable per financial year.
 * Each word rules something out:
 *
 *   SEQUENTIAL rules out random or hash-derived identifiers.
 *
 *   GAPLESS rules out a Postgres sequence. Sequences are explicitly documented
 *   as non-gapless: a transaction that rolls back has already consumed its
 *   value and does not return it. That is the right trade for a surrogate key
 *   and the wrong one for a legal document series.
 *
 *   PER FINANCIAL YEAR means the counter resets on 1 April, so two invoices in
 *   different years may both be number 1 and are told apart by the year.
 *
 *   IMMUTABLE means a number, once issued, is never reused, reassigned or
 *   edited. Corrections are a credit note or a void-and-reissue, both of which
 *   consume a NEW number and leave the original in place.
 *
 * The mechanism is a counter row locked with SELECT … FOR UPDATE inside the
 * same transaction that writes the invoice. Concurrent issuers serialise on
 * that lock; if the invoice write fails, the increment rolls back with it and
 * the number is handed to the next caller instead of being burned.
 */

/**
 * The Indian financial year containing a date: 1 April to 31 March.
 *
 * A date in Jan–Mar belongs to the year that STARTED the previous April, so
 * 2027-02-14 is "2026-27".
 */
export function financialYearOf(date: Date): string {
  const y = date.getUTCFullYear();
  const startYear = date.getUTCMonth() >= 3 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** "RC/2026-27/0007" — a prefix, the year, and the number zero-padded to four. */
export function formatInvoiceRef(prefix: string, financialYear: string, n: number): string {
  return `${prefix}/${financialYear}/${String(n).padStart(4, "0")}`;
}

/**
 * A chamber's invoice prefix, derived from its name.
 *
 * "Raghavan Chambers" becomes "RC". Deterministic, so a chamber's invoices all
 * carry the same prefix without anyone configuring one, and short enough to
 * read on a printed document.
 */
export function prefixFor(workspaceName: string): string {
  const letters = workspaceName
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  return (letters || "INV").slice(0, 4);
}

export type IssuedNumber = {
  invoiceNumber: number;
  financialYear: string;
  invoiceRef: string;
};

/**
 * Reserve the next number in a chamber's series.
 *
 * MUST be called inside a transaction that also writes the invoice — the `tx`
 * parameter is not a convenience, it is the correctness condition. Called on
 * its own, the increment commits immediately and a subsequent failure leaves a
 * gap, which is the exact defect this function exists to prevent.
 */
export async function reserveInvoiceNumber(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  workspaceId: number,
  workspaceName: string,
  issueDate: Date,
): Promise<IssuedNumber> {
  const financialYear = financialYearOf(issueDate);

  // Make sure the row exists before locking it. Two chambers issuing their very
  // first invoice of a year at the same moment both reach here; the unique
  // constraint means one insert wins and the other no-ops, and both then lock
  // the same surviving row.
  await tx
    .insert(invoiceSeriesTable)
    .values({ workspaceId, financialYear, nextNumber: 1 })
    .onConflictDoNothing({
      target: [invoiceSeriesTable.workspaceId, invoiceSeriesTable.financialYear],
    });

  // The lock. Everything after this point is serialised per (chamber, year)
  // until the surrounding transaction ends.
  const locked = await tx.execute(sql`
    SELECT next_number
    FROM invoice_series
    WHERE workspace_id = ${workspaceId} AND financial_year = ${financialYear}
    FOR UPDATE
  `);

  const invoiceNumber = Number((locked.rows[0] as { next_number: number }).next_number);

  await tx
    .update(invoiceSeriesTable)
    .set({ nextNumber: invoiceNumber + 1 })
    .where(
      and(
        eq(invoiceSeriesTable.workspaceId, workspaceId),
        eq(invoiceSeriesTable.financialYear, financialYear),
      ),
    );

  return {
    invoiceNumber,
    financialYear,
    invoiceRef: formatInvoiceRef(prefixFor(workspaceName), financialYear, invoiceNumber),
  };
}

/** Statuses an invoice may hold. "Overdue" is derived, never stored. */
export const INVOICE_STATUSES = ["draft", "issued", "sent", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * Only a draft may be edited or deleted.
 *
 * An issued invoice is a document somebody else is holding. Changing it after
 * the fact means the copy on their desk and the copy in this database disagree,
 * and the database is not the one they will produce in a dispute.
 */
export function isEditable(invoice: Pick<Invoice, "status">): boolean {
  return invoice.status === "draft";
}

/**
 * Whether a status transition is allowed.
 *
 * draft → issued → sent → paid, with void reachable from any issued state.
 * Nothing returns to draft: once a number is spent it is spent.
 */
const ALLOWED: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["issued", "void"],
  issued: ["sent", "paid", "void"],
  sent: ["paid", "void"],
  paid: [],
  void: [],
};

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

/**
 * Overdue is a question about today, not a stored fact: an issued or sent
 * invoice whose due date has passed.
 */
export function isOverdue(
  invoice: Pick<Invoice, "status" | "dueDate">,
  today = new Date(),
): boolean {
  if (invoice.status !== "issued" && invoice.status !== "sent") return false;
  if (!invoice.dueDate) return false;
  return invoice.dueDate < today.toISOString().slice(0, 10);
}

/**
 * Line amount, rounded exactly once.
 *
 * quantityMilli is thousandths, unitRateMinor is paise per whole unit, so the
 * product is in thousandths of a paisa and is divided back down. Rounding here
 * and storing the result means the printed line, the stored line and the total
 * can never disagree — which they would if each reader re-derived it.
 */
export function lineAmountMinor(quantityMilli: number, unitRateMinor: number): number {
  return Math.round((quantityMilli * unitRateMinor) / 1000);
}

/**
 * Totals from lines and the configured rates.
 *
 * Tax is computed on the subtotal, not per line, and each component is rounded
 * once. No rate is assumed: whatever the firm's accountant configured is what
 * gets applied, and zeros produce a zero-tax invoice rather than a guess.
 */
export function computeTotals(
  lineAmounts: number[],
  rates: { cgstRateBp: number; sgstRateBp: number; igstRateBp: number },
): {
  subtotalMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  totalMinor: number;
} {
  const subtotalMinor = lineAmounts.reduce((sum, a) => sum + a, 0);
  const bp = (rate: number) => Math.round((subtotalMinor * rate) / 10_000);
  const cgstMinor = bp(rates.cgstRateBp);
  const sgstMinor = bp(rates.sgstRateBp);
  const igstMinor = bp(rates.igstRateBp);
  return {
    subtotalMinor,
    cgstMinor,
    sgstMinor,
    igstMinor,
    totalMinor: subtotalMinor + cgstMinor + sgstMinor + igstMinor,
  };
}

/** The next number a chamber would use, for display before issuing. */
export async function peekNextNumber(
  workspaceId: number,
  workspaceName: string,
  issueDate = new Date(),
): Promise<IssuedNumber> {
  const financialYear = financialYearOf(issueDate);
  const [row] = await db
    .select()
    .from(invoiceSeriesTable)
    .where(
      and(
        eq(invoiceSeriesTable.workspaceId, workspaceId),
        eq(invoiceSeriesTable.financialYear, financialYear),
      ),
    );
  const n = row?.nextNumber ?? 1;
  return {
    invoiceNumber: n,
    financialYear,
    invoiceRef: formatInvoiceRef(prefixFor(workspaceName), financialYear, n),
  };
}

/** Issued invoices in a chamber's year, in number order. For gap auditing. */
export async function issuedNumbers(workspaceId: number, financialYear: string): Promise<number[]> {
  const rows = await db
    .select({ n: invoicesTable.invoiceNumber })
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.workspaceId, workspaceId),
        eq(invoicesTable.financialYear, financialYear),
      ),
    );
  return rows
    .map((r) => r.n)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
}
