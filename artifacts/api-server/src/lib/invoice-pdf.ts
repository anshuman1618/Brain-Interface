import PDFDocument from "pdfkit";
import type { Invoice, InvoiceLineItem } from "@workspace/db";
import { isOverdue } from "./invoice-number";

/**
 * The invoice as a PDF, rendered server-side.
 *
 * Server-side and not in the browser for two reasons: the document must be
 * byte-identical whoever downloads it, and a client-rendered PDF would be built
 * from whatever the browser happened to have in memory rather than from the row.
 *
 * NOTHING IS RECOMPUTED HERE. Every figure printed is read straight off the
 * stored invoice and its lines. If this file multiplied quantity by rate to get
 * a line total, a later change to the rounding rule would make the paper and
 * the database disagree, and the paper is the copy the client is holding.
 */

/** Paise to "₹1,23,456.78" — Indian digit grouping, two decimals, always. */
function rupees(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const paise = String(abs % 100).padStart(2, "0");
  // Indian grouping: last three digits, then pairs.
  const s = String(whole);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${negative ? "-" : ""}Rs ${grouped}.${paise}`;
}

/** Thousandths to a plain decimal: 1500 -> "1.5", 2000 -> "2". */
function quantity(milli: number): string {
  const s = (milli / 1000).toFixed(3).replace(/\.?0+$/, "");
  return s === "" ? "0" : s;
}

/** Basis points to a percentage label: 900 -> "9%". */
function pct(bp: number): string {
  return `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;
}

export async function renderInvoicePdf(
  invoice: Invoice,
  lines: InvoiceLineItem[],
): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const LEFT = 50;
  const RIGHT = 545;
  const ink = "#241708";
  const muted = "#6b5942";
  const rule = "#d3c7b6";

  // ── letterhead ────────────────────────────────────────────────────────────
  doc
    .fillColor(ink)
    .fontSize(18)
    .font("Helvetica-Bold")
    .text(invoice.firmName || "—", LEFT, 50);
  doc.fontSize(9).font("Helvetica").fillColor(muted);
  if (invoice.firmAddress) doc.text(invoice.firmAddress, LEFT, doc.y + 2, { width: 280 });
  if (invoice.firmGstin) doc.text(`GSTIN: ${invoice.firmGstin}`, LEFT, doc.y + 2);

  // Title block, right-aligned.
  doc.fillColor(ink).fontSize(20).font("Helvetica-Bold");
  const isVoid = invoice.status === "void";
  doc.text(isVoid ? "INVOICE (VOID)" : "TAX INVOICE", 300, 50, { width: 245, align: "right" });
  doc.fontSize(10).font("Helvetica").fillColor(muted);
  doc.text(invoice.invoiceRef ?? "DRAFT — not issued", 300, doc.y + 4, {
    width: 245,
    align: "right",
  });
  if (invoice.issueDate)
    doc.text(`Issued: ${invoice.issueDate}`, 300, doc.y + 2, { width: 245, align: "right" });
  if (invoice.dueDate)
    doc.text(`Due: ${invoice.dueDate}`, 300, doc.y + 2, { width: 245, align: "right" });
  if (isOverdue(invoice))
    doc
      .fillColor("#8a2318")
      .text("OVERDUE", 300, doc.y + 2, { width: 245, align: "right" })
      .fillColor(muted);

  let y = Math.max(doc.y, 150) + 15;
  doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor(rule).stroke();
  y += 18;

  // ── bill to ───────────────────────────────────────────────────────────────
  doc.fontSize(8).fillColor(muted).font("Helvetica-Bold").text("BILL TO", LEFT, y);
  doc
    .fontSize(11)
    .fillColor(ink)
    .font("Helvetica-Bold")
    .text(invoice.clientName || "—", LEFT, y + 12);
  doc.fontSize(9).font("Helvetica").fillColor(muted);
  let by = y + 27;
  if (invoice.clientAddress) {
    doc.text(invoice.clientAddress, LEFT, by, { width: 260 });
    by = doc.y;
  }
  if (invoice.clientEmail) {
    doc.text(invoice.clientEmail, LEFT, by + 2);
    by = doc.y;
  }
  if (invoice.clientGstin) {
    doc.text(`GSTIN: ${invoice.clientGstin}`, LEFT, by + 2);
    by = doc.y;
  }

  // Tax context, right column.
  doc.fontSize(8).fillColor(muted).font("Helvetica-Bold").text("TAX DETAILS", 320, y);
  doc.fontSize(9).font("Helvetica");
  let ty = y + 12;
  const detail = (label: string, value: string) => {
    doc.text(`${label}: ${value}`, 320, ty, { width: 225 });
    ty = doc.y + 2;
  };
  detail("Treatment", invoice.taxTreatment);
  if (invoice.placeOfSupply) detail("Place of supply", invoice.placeOfSupply);
  if (invoice.sacCode) detail("SAC", invoice.sacCode);

  y = Math.max(by, ty) + 20;

  // ── lines ─────────────────────────────────────────────────────────────────
  const COL = { desc: LEFT, qty: 320, rate: 385, amount: 465 };
  doc.fontSize(8).fillColor(muted).font("Helvetica-Bold");
  doc.text("DESCRIPTION", COL.desc, y);
  doc.text("QTY", COL.qty, y, { width: 55, align: "right" });
  doc.text("RATE", COL.rate, y, { width: 70, align: "right" });
  doc.text("AMOUNT", COL.amount, y, { width: 80, align: "right" });
  y += 12;
  doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor(rule).stroke();
  y += 8;

  doc.font("Helvetica").fontSize(9).fillColor(ink);
  for (const l of [...lines].sort((a, b) => a.position - b.position)) {
    if (y > 690) {
      doc.addPage();
      y = 50;
    }
    const top = y;
    doc.text(l.description, COL.desc, y, { width: 255 });
    const afterDesc = doc.y;
    doc.text(`${quantity(l.quantityMilli)} ${l.unit}`, COL.qty, top, {
      width: 55,
      align: "right",
    });
    doc.text(rupees(l.unitRateMinor), COL.rate, top, { width: 70, align: "right" });
    // Straight from the stored column. Never quantity × rate.
    doc.text(rupees(l.amountMinor), COL.amount, top, { width: 80, align: "right" });
    y = Math.max(afterDesc, top + 12) + 6;
  }

  doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor(rule).stroke();
  y += 10;

  // ── totals ────────────────────────────────────────────────────────────────
  const total = (label: string, value: string, bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9);
    doc.fillColor(bold ? ink : muted);
    doc.text(label, 320, y, { width: 145, align: "right" });
    doc.fillColor(ink).text(value, COL.amount, y, { width: 80, align: "right" });
    y = doc.y + 4;
  };

  total("Subtotal", rupees(invoice.subtotalMinor));
  // Only the components that actually apply are printed. A zero CGST line on an
  // inter-state invoice is noise that invites a question.
  if (invoice.cgstMinor > 0 || invoice.cgstRateBp > 0)
    total(`CGST ${pct(invoice.cgstRateBp)}`, rupees(invoice.cgstMinor));
  if (invoice.sgstMinor > 0 || invoice.sgstRateBp > 0)
    total(`SGST ${pct(invoice.sgstRateBp)}`, rupees(invoice.sgstMinor));
  if (invoice.igstMinor > 0 || invoice.igstRateBp > 0)
    total(`IGST ${pct(invoice.igstRateBp)}`, rupees(invoice.igstMinor));

  y += 2;
  doc.moveTo(320, y).lineTo(RIGHT, y).strokeColor(rule).stroke();
  y += 8;
  total("Total", rupees(invoice.totalMinor), true);

  if (
    invoice.cgstRateBp === 0 &&
    invoice.sgstRateBp === 0 &&
    invoice.igstRateBp === 0 &&
    invoice.taxTreatment === "unspecified"
  ) {
    y += 6;
    doc
      .font("Helvetica-Oblique")
      .fontSize(8)
      .fillColor(muted)
      .text(
        "No tax treatment has been configured for this chamber, so no tax has been applied.",
        LEFT,
        y,
        { width: 495 },
      );
    y = doc.y;
  }

  // ── terms and notes ───────────────────────────────────────────────────────
  y += 20;
  if (invoice.paymentTerms) {
    doc.font("Helvetica-Bold").fontSize(8).fillColor(muted).text("PAYMENT TERMS", LEFT, y);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(ink)
      .text(invoice.paymentTerms, LEFT, doc.y + 3, {
        width: 495,
      });
    y = doc.y + 12;
  }
  if (invoice.notes) {
    doc.font("Helvetica-Bold").fontSize(8).fillColor(muted).text("NOTES", LEFT, y);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(ink)
      .text(invoice.notes, LEFT, doc.y + 3, {
        width: 495,
      });
    y = doc.y + 12;
  }
  if (isVoid) {
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#8a2318")
      .text(
        `This invoice was voided${invoice.voidedBy ? ` by ${invoice.voidedBy}` : ""}${
          invoice.voidReason ? `: ${invoice.voidReason}` : ""
        }.`,
        LEFT,
        y,
        { width: 495 },
      );
  }

  doc.end();
  return done;
}
