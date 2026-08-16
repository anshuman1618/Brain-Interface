import { Router, type IRouter } from "express";
import { and, eq, gte, lte, isNull, inArray, desc, SQL } from "drizzle-orm";
import {
  db,
  invoicesTable,
  invoiceLineItemsTable,
  timeEntriesTable,
  casesTable,
  usersTable,
  workspacesTable,
  type Invoice,
  type InvoiceLineItem,
} from "@workspace/db";
import {
  CreateInvoiceBody,
  UpdateInvoiceBody,
  ListInvoicesQueryParams,
  SetInvoiceStatusBody,
  UpdateBillingSettingsBody,
  ListUnbilledTimeQueryParams,
} from "@workspace/api-zod";
import {
  requireWorkspace,
  requireCapability,
  ctx,
  type AuthRequest,
  type WorkspaceContext,
} from "../middlewares/requireAuth";
import { zodMessage } from "../lib/validation";
import { recordAudit } from "../lib/audit";
import { renderInvoicePdf } from "../lib/invoice-pdf";
import {
  reserveInvoiceNumber,
  canTransition,
  isEditable,
  isOverdue,
  lineAmountMinor,
  computeTotals,
  peekNextNumber,
  type InvoiceStatus,
} from "../lib/invoice-number";

const router: IRouter = Router();

/**
 * Invoicing is admin-only.
 *
 * `billing.manage` is held by admin and by a workspace owner — the same
 * capability that already gates the subscription screen. An advocate who can
 * open matters and log time still cannot issue a document in the firm's name.
 */
const requireBilling = [requireWorkspace, requireCapability("billing.manage")] as const;

function view(invoice: Invoice, lines: InvoiceLineItem[]) {
  return {
    ...invoice,
    issuedAt: invoice.issuedAt?.toISOString() ?? null,
    sentAt: invoice.sentAt?.toISOString() ?? null,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    voidedAt: invoice.voidedAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
    isOverdue: isOverdue(invoice),
    isEditable: isEditable(invoice),
    lines: lines
      .sort((a, b) => a.position - b.position)
      .map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
  };
}

async function loadInvoice(c: WorkspaceContext, id: number) {
  const [invoice] = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.workspaceId, c.workspaceId)));
  if (!invoice) return null;
  const lines = await db
    .select()
    .from(invoiceLineItemsTable)
    .where(eq(invoiceLineItemsTable.invoiceId, invoice.id));
  return { invoice, lines };
}

/** Replace a draft's lines and recompute its totals. One place, both callers. */
async function writeLines(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  invoiceId: number,
  lines: {
    description: string;
    quantityMilli: number;
    unit?: string;
    unitRateMinor: number;
    sacCode?: string;
    timeEntryId?: number;
  }[],
  rates: { cgstRateBp: number; sgstRateBp: number; igstRateBp: number },
) {
  await tx.delete(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, invoiceId));

  const amounts: number[] = [];
  for (const [i, l] of lines.entries()) {
    const amountMinor = lineAmountMinor(l.quantityMilli, l.unitRateMinor);
    amounts.push(amountMinor);
    await tx.insert(invoiceLineItemsTable).values({
      invoiceId,
      position: i,
      description: l.description,
      quantityMilli: l.quantityMilli,
      unit: l.unit ?? "hour",
      unitRateMinor: l.unitRateMinor,
      amountMinor,
      sacCode: l.sacCode ?? null,
      timeEntryId: l.timeEntryId ?? null,
    });
  }

  const totals = computeTotals(amounts, rates);
  await tx.update(invoicesTable).set(totals).where(eq(invoicesTable.id, invoiceId));
  return totals;
}

// ── list, with period totals ────────────────────────────────────────────────
router.get("/invoices", ...requireBilling, async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);
  const params = ListInvoicesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: "invalid_request", message: zodMessage(params.error) });
    return;
  }

  const where: SQL[] = [eq(invoicesTable.workspaceId, c.workspaceId)];
  if (params.data.status) where.push(eq(invoicesTable.status, params.data.status));
  if (params.data.clientId) where.push(eq(invoicesTable.clientId, Number(params.data.clientId)));
  if (params.data.from) where.push(gte(invoicesTable.issueDate, params.data.from));
  if (params.data.to) where.push(lte(invoicesTable.issueDate, params.data.to));

  const rows = await db
    .select()
    .from(invoicesTable)
    .where(and(...where))
    .orderBy(desc(invoicesTable.id));

  const allLines = rows.length
    ? await db
        .select()
        .from(invoiceLineItemsTable)
        .where(
          inArray(
            invoiceLineItemsTable.invoiceId,
            rows.map((r) => r.id),
          ),
        )
    : [];

  // Totals over the filtered set, so the figures always describe what is on
  // screen rather than the whole ledger.
  let outstandingMinor = 0;
  let overdueMinor = 0;
  let paidMinor = 0;
  for (const r of rows) {
    if (r.status === "paid") paidMinor += r.totalMinor;
    else if (r.status === "issued" || r.status === "sent") {
      outstandingMinor += r.totalMinor;
      if (isOverdue(r)) overdueMinor += r.totalMinor;
    }
  }

  res.json({
    invoices: rows.map((r) =>
      view(
        r,
        allLines.filter((l) => l.invoiceId === r.id),
      ),
    ),
    outstandingMinor,
    overdueMinor,
    paidMinor,
    currency: "INR",
  });
});

// ── billable time not yet on any invoice ────────────────────────────────────
router.get(
  "/invoices/unbilled",
  ...requireBilling,
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const params = ListUnbilledTimeQueryParams.safeParse(req.query);
    if (!params.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(params.error) });
      return;
    }

    const where: SQL[] = [
      eq(timeEntriesTable.workspaceId, c.workspaceId),
      // A running timer is not billable time yet.
      isNull(timeEntriesTable.startedAt),
      eq(timeEntriesTable.billable, true),
      // Unbilled IS the absence of a line pointing at this entry. Derived from
      // the join rather than from a "billed" flag on the entry, which would be
      // a second source of truth free to drift from the first.
      isNull(invoiceLineItemsTable.id),
    ];
    if (params.data.caseId) where.push(eq(timeEntriesTable.caseId, Number(params.data.caseId)));
    if (params.data.clientId) where.push(eq(casesTable.clientId, Number(params.data.clientId)));

    const rows = await db
      .select({
        id: timeEntriesTable.id,
        caseId: timeEntriesTable.caseId,
        caseTitle: casesTable.title,
        clientId: casesTable.clientId,
        userName: timeEntriesTable.userName,
        workDate: timeEntriesTable.workDate,
        minutes: timeEntriesTable.minutes,
        description: timeEntriesTable.description,
        billable: timeEntriesTable.billable,
      })
      .from(timeEntriesTable)
      .innerJoin(casesTable, eq(casesTable.id, timeEntriesTable.caseId))
      .leftJoin(invoiceLineItemsTable, eq(invoiceLineItemsTable.timeEntryId, timeEntriesTable.id))
      .where(and(...where))
      .orderBy(timeEntriesTable.workDate);

    res.json(rows);
  },
);

// ── billing settings ────────────────────────────────────────────────────────
router.get("/billing-settings", ...requireBilling, async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);
  const [ws] = await db.select().from(workspacesTable).where(eq(workspacesTable.id, c.workspaceId));
  const next = await peekNextNumber(c.workspaceId, ws.name);
  res.json({
    firmName: ws.name,
    firmAddress: ws.firmAddress,
    firmGstin: ws.firmGstin ?? "",
    firmPlaceOfSupply: ws.firmPlaceOfSupply ?? "",
    defaultSacCode: ws.defaultSacCode ?? "",
    defaultCgstRateBp: ws.defaultCgstRateBp,
    defaultSgstRateBp: ws.defaultSgstRateBp,
    defaultIgstRateBp: ws.defaultIgstRateBp,
    defaultHourlyRateMinor: ws.defaultHourlyRateMinor,
    defaultPaymentTerms: ws.defaultPaymentTerms,
    defaultPaymentDays: ws.defaultPaymentDays,
    nextInvoiceRef: next.invoiceRef,
  });
});

router.patch(
  "/billing-settings",
  ...requireBilling,
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const parsed = UpdateBillingSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(parsed.error) });
      return;
    }
    const d = parsed.data;
    // Explicit field mapping, never a spread of the body.
    await db
      .update(workspacesTable)
      .set({
        firmAddress: d.firmAddress ?? undefined,
        firmGstin: d.firmGstin ?? undefined,
        firmPlaceOfSupply: d.firmPlaceOfSupply ?? undefined,
        defaultSacCode: d.defaultSacCode ?? undefined,
        defaultCgstRateBp: d.defaultCgstRateBp ?? undefined,
        defaultSgstRateBp: d.defaultSgstRateBp ?? undefined,
        defaultIgstRateBp: d.defaultIgstRateBp ?? undefined,
        defaultHourlyRateMinor: d.defaultHourlyRateMinor ?? undefined,
        defaultPaymentTerms: d.defaultPaymentTerms ?? undefined,
        defaultPaymentDays: d.defaultPaymentDays ?? undefined,
      })
      .where(eq(workspacesTable.id, c.workspaceId));

    await recordAudit(req, c, {
      action: "billing.settings_updated",
      entityType: "workspace",
      entityId: c.workspaceId,
      summary: "Updated the chamber's billing identity or tax defaults",
    });

    const [ws] = await db
      .select()
      .from(workspacesTable)
      .where(eq(workspacesTable.id, c.workspaceId));
    const next = await peekNextNumber(c.workspaceId, ws.name);
    res.json({
      firmName: ws.name,
      firmAddress: ws.firmAddress,
      firmGstin: ws.firmGstin ?? "",
      firmPlaceOfSupply: ws.firmPlaceOfSupply ?? "",
      defaultSacCode: ws.defaultSacCode ?? "",
      defaultCgstRateBp: ws.defaultCgstRateBp,
      defaultSgstRateBp: ws.defaultSgstRateBp,
      defaultIgstRateBp: ws.defaultIgstRateBp,
      defaultHourlyRateMinor: ws.defaultHourlyRateMinor,
      defaultPaymentTerms: ws.defaultPaymentTerms,
      defaultPaymentDays: ws.defaultPaymentDays,
      nextInvoiceRef: next.invoiceRef,
    });
  },
);

// ── create a draft ──────────────────────────────────────────────────────────
router.post("/invoices", ...requireBilling, async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);
  const parsed = CreateInvoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", message: zodMessage(parsed.error) });
    return;
  }
  const d = parsed.data;

  const [ws] = await db.select().from(workspacesTable).where(eq(workspacesTable.id, c.workspaceId));
  const [client] = await db.select().from(usersTable).where(eq(usersTable.id, d.clientId));
  if (!client) {
    res.status(400).json({ error: "invalid_request", message: "That client does not exist." });
    return;
  }

  const rates = {
    cgstRateBp: d.cgstRateBp ?? ws.defaultCgstRateBp,
    sgstRateBp: d.sgstRateBp ?? ws.defaultSgstRateBp,
    igstRateBp: d.igstRateBp ?? ws.defaultIgstRateBp,
  };

  const created = await db.transaction(async (tx) => {
    const [invoice] = await tx
      .insert(invoicesTable)
      .values({
        workspaceId: c.workspaceId,
        status: "draft",
        createdBy: c.user.displayName,
        createdByClerkId: c.user.clerkId,
        issueDate: d.issueDate ?? null,
        dueDate: d.dueDate ?? null,
        clientId: client.id,
        notes: d.notes ?? null,
        paymentTerms: d.paymentTerms ?? ws.defaultPaymentTerms,
        taxTreatment: d.taxTreatment ?? "unspecified",
        placeOfSupply: d.placeOfSupply ?? client.billingPlaceOfSupply ?? null,
        sacCode: d.sacCode ?? ws.defaultSacCode ?? null,
        ...rates,
      })
      .returning();

    await writeLines(tx, invoice.id, d.lines, rates);
    return invoice;
  });

  await recordAudit(req, c, {
    action: "invoice.created",
    entityType: "invoice",
    entityId: created.id,
    summary: `Created draft invoice for ${client.displayName}`,
  });

  const loaded = await loadInvoice(c, created.id);
  res.status(201).json(view(loaded!.invoice, loaded!.lines));
});

// ── read one ────────────────────────────────────────────────────────────────
router.get("/invoices/:id", ...requireBilling, async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  const loaded = await loadInvoice(c, id);
  if (!loaded) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  res.json(view(loaded.invoice, loaded.lines));
});

// ── edit a draft ────────────────────────────────────────────────────────────
router.patch("/invoices/:id", ...requireBilling, async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);
  const id = Number(req.params.id);
  const parsed = UpdateInvoiceBody.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({
      error: "invalid_request",
      message: parsed.success ? undefined : zodMessage(parsed.error),
    });
    return;
  }

  const loaded = await loadInvoice(c, id);
  if (!loaded) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  // The rule the whole feature rests on.
  if (!isEditable(loaded.invoice)) {
    res.status(409).json({
      error: "not_editable",
      message: "An issued invoice cannot be edited. Void it and reissue, or raise a credit note.",
    });
    return;
  }

  const d = parsed.data;
  const rates = {
    cgstRateBp: d.cgstRateBp ?? loaded.invoice.cgstRateBp,
    sgstRateBp: d.sgstRateBp ?? loaded.invoice.sgstRateBp,
    igstRateBp: d.igstRateBp ?? loaded.invoice.igstRateBp,
  };

  await db.transaction(async (tx) => {
    await tx
      .update(invoicesTable)
      .set({
        clientId: d.clientId ?? loaded.invoice.clientId,
        issueDate: d.issueDate ?? loaded.invoice.issueDate,
        dueDate: d.dueDate ?? loaded.invoice.dueDate,
        notes: d.notes ?? loaded.invoice.notes,
        paymentTerms: d.paymentTerms ?? loaded.invoice.paymentTerms,
        taxTreatment: d.taxTreatment ?? loaded.invoice.taxTreatment,
        placeOfSupply: d.placeOfSupply ?? loaded.invoice.placeOfSupply,
        sacCode: d.sacCode ?? loaded.invoice.sacCode,
        ...rates,
      })
      .where(eq(invoicesTable.id, id));
    await writeLines(tx, id, d.lines, rates);
  });

  const after = await loadInvoice(c, id);
  res.json(view(after!.invoice, after!.lines));
});

// ── delete a draft ──────────────────────────────────────────────────────────
router.delete("/invoices/:id", ...requireBilling, async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);
  const id = Number(req.params.id);
  const loaded = Number.isInteger(id) ? await loadInvoice(c, id) : null;
  if (!loaded) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  if (!isEditable(loaded.invoice)) {
    res.status(409).json({
      error: "not_editable",
      message: "An issued invoice is never deleted. Void it instead — the record has to survive.",
    });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.delete(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, id));
    await tx.delete(invoicesTable).where(eq(invoicesTable.id, id));
  });
  await recordAudit(req, c, {
    action: "invoice.draft_deleted",
    entityType: "invoice",
    entityId: id,
    summary: "Deleted a draft invoice",
  });
  res.status(204).end();
});

// ── issue ───────────────────────────────────────────────────────────────────
/**
 * Assign the number and freeze the document.
 *
 * Everything happens in ONE transaction: reserving the number, snapshotting
 * both parties, and flipping the status. If any of it fails the number is
 * returned to the series rather than burned, which is the whole reason the
 * counter is a locked row and not a sequence.
 */
router.post(
  "/invoices/:id/issue",
  ...requireBilling,
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const id = Number(req.params.id);
    const loaded = Number.isInteger(id) ? await loadInvoice(c, id) : null;
    if (!loaded) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    if (loaded.invoice.status !== "draft") {
      res.status(409).json({
        error: "not_a_draft",
        message: "This invoice has already been issued.",
      });
      return;
    }
    if (loaded.lines.length === 0) {
      res.status(400).json({
        error: "no_lines",
        message: "An invoice needs at least one line before it can be issued.",
      });
      return;
    }

    const [ws] = await db
      .select()
      .from(workspacesTable)
      .where(eq(workspacesTable.id, c.workspaceId));
    const [client] = loaded.invoice.clientId
      ? await db.select().from(usersTable).where(eq(usersTable.id, loaded.invoice.clientId))
      : [null];
    if (!client) {
      res.status(400).json({
        error: "no_client",
        message: "This invoice has no client to address.",
      });
      return;
    }

    const issueDate = loaded.invoice.issueDate
      ? new Date(`${loaded.invoice.issueDate}T00:00:00Z`)
      : new Date();
    const dueDate =
      loaded.invoice.dueDate ??
      new Date(issueDate.getTime() + ws.defaultPaymentDays * 86_400_000).toISOString().slice(0, 10);

    await db.transaction(async (tx) => {
      const number = await reserveInvoiceNumber(tx, c.workspaceId, ws.name, issueDate);
      await tx
        .update(invoicesTable)
        .set({
          invoiceNumber: number.invoiceNumber,
          financialYear: number.financialYear,
          invoiceRef: number.invoiceRef,
          status: "issued",
          issuedBy: c.user.displayName,
          issuedAt: new Date(),
          issueDate: issueDate.toISOString().slice(0, 10),
          dueDate,
          // The snapshot. Taken now, never refreshed — the client's address on
          // this document must keep saying what it said when it was sent.
          clientName: client.displayName,
          clientAddress: client.billingAddress,
          clientEmail: client.email,
          clientGstin: client.billingGstin ?? null,
          firmName: ws.name,
          firmAddress: ws.firmAddress,
          firmGstin: ws.firmGstin ?? null,
        })
        .where(eq(invoicesTable.id, id));
    });

    const after = await loadInvoice(c, id);
    await recordAudit(req, c, {
      action: "invoice.issued",
      entityType: "invoice",
      entityId: id,
      summary: `Issued ${after!.invoice.invoiceRef} to ${client.displayName}`,
    });
    res.json(view(after!.invoice, after!.lines));
  },
);

// ── sent / paid / void ──────────────────────────────────────────────────────
router.post(
  "/invoices/:id/status",
  ...requireBilling,
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const id = Number(req.params.id);
    const parsed = SetInvoiceStatusBody.safeParse(req.body);
    if (!Number.isInteger(id) || !parsed.success) {
      res.status(400).json({
        error: "invalid_request",
        message: parsed.success ? undefined : zodMessage(parsed.error),
      });
      return;
    }
    const loaded = await loadInvoice(c, id);
    if (!loaded) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const to = parsed.data.status as InvoiceStatus;
    if (!canTransition(loaded.invoice.status as InvoiceStatus, to)) {
      res.status(409).json({
        error: "bad_transition",
        message: `An invoice that is ${loaded.invoice.status} cannot become ${to}.`,
      });
      return;
    }

    const now = new Date();
    await db
      .update(invoicesTable)
      .set({
        status: to,
        sentAt: to === "sent" ? now : loaded.invoice.sentAt,
        paidAt: to === "paid" ? now : loaded.invoice.paidAt,
        voidedAt: to === "void" ? now : loaded.invoice.voidedAt,
        voidedBy: to === "void" ? c.user.displayName : loaded.invoice.voidedBy,
        voidReason: to === "void" ? (parsed.data.reason ?? null) : loaded.invoice.voidReason,
      })
      .where(eq(invoicesTable.id, id));

    await recordAudit(req, c, {
      action: `invoice.${to}` as "invoice.sent" | "invoice.paid" | "invoice.void",
      entityType: "invoice",
      entityId: id,
      summary: `${loaded.invoice.invoiceRef ?? "Draft"} marked ${to}${
        parsed.data.reason ? `: ${parsed.data.reason}` : ""
      }`,
    });

    const after = await loadInvoice(c, id);
    res.json(view(after!.invoice, after!.lines));
  },
);

// ── PDF ─────────────────────────────────────────────────────────────────────
router.get("/invoices/:id/pdf", ...requireBilling, async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);
  const id = Number(req.params.id);
  const loaded = Number.isInteger(id) ? await loadInvoice(c, id) : null;
  if (!loaded) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const pdf = await renderInvoicePdf(loaded.invoice, loaded.lines);
  res
    .status(200)
    .type("application/pdf")
    .setHeader(
      "Content-Disposition",
      `inline; filename="${(loaded.invoice.invoiceRef ?? `draft-${id}`).replace(/\//g, "-")}.pdf"`,
    );
  res.send(pdf);
});

export default router;
