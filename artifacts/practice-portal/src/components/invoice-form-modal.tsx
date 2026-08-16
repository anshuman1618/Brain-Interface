import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateInvoice,
  useUpdateInvoice,
  useListWorkspaceMembers,
  useListUnbilledTime,
  useGetBillingSettings,
  getListInvoicesQueryKey,
  getGetInvoiceQueryKey,
  getListUnbilledTimeQueryKey,
  getGetBillingSettingsQueryKey,
  getListWorkspaceMembersQueryKey,
  type Invoice,
  type InvoiceLineInput,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Clock, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { userMessage } from "@/lib/errors";
import {
  formatMinor,
  formatMinorShort,
  parseRupeesToMinor,
  parseQuantityToMilli,
  formatMinutes,
} from "@/lib/format";

/**
 * Compose a draft invoice.
 *
 * Only drafts are ever edited here. An issued invoice is immutable and the
 * server refuses to change one, so this dialog is never opened against one —
 * see the read-only detail view on the invoices page.
 *
 * Every figure shown is computed with the SAME rule the server stores:
 * round(quantityMilli × unitRateMinor / 1000), once, per line. The preview is a
 * courtesy, not the source of truth — the amounts that end up on the document
 * are the ones the server writes back, and this dialog re-reads them.
 */

/** A line while it is being typed. Text, not numbers — "4,5" is a real state. */
type DraftLine = {
  key: number;
  description: string;
  quantity: string;
  unit: string;
  rate: string;
  timeEntryId?: number;
};

let nextKey = 1;
const blankLine = (): DraftLine => ({
  key: nextKey++,
  description: "",
  quantity: "",
  unit: "hour",
  rate: "",
});

/** The server's rounding rule, restated so the preview cannot disagree with it. */
function lineAmountMinor(quantityMilli: number, unitRateMinor: number): number {
  return Math.round((quantityMilli * unitRateMinor) / 1000);
}

const today = () => new Date().toISOString().slice(0, 10);

/** Basis points as a percentage in a text field: 900 <-> "9". */
const bpToText = (bp: number) => String(bp / 100);
function textToBp(text: string): number | null {
  const t = text.trim();
  if (t === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const bp = Math.round(Number(t) * 100);
  return bp > 10000 ? null : bp;
}

export function InvoiceFormModal({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A draft to edit. Absent means a new one. */
  editing?: Invoice | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings } = useGetBillingSettings({
    query: { queryKey: getGetBillingSettingsQueryKey(), enabled: open },
  });
  const { data: members = [] } = useListWorkspaceMembers({
    query: { queryKey: getListWorkspaceMembersQueryKey(), enabled: open },
  });

  const createInvoice = useCreateInvoice();
  const updateInvoice = useUpdateInvoice();

  const [clientId, setClientId] = useState<string>("");
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [notes, setNotes] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [taxTreatment, setTaxTreatment] = useState("unspecified");
  const [placeOfSupply, setPlaceOfSupply] = useState("");
  const [sacCode, setSacCode] = useState("");
  const [cgst, setCgst] = useState("0");
  const [sgst, setSgst] = useState("0");
  const [igst, setIgst] = useState("0");
  const [showTime, setShowTime] = useState(false);

  /**
   * Reset on every open, from the draft being edited or from chamber defaults.
   *
   * Keyed on `open` rather than done in the click handler so that whichever
   * button opens the dialog gets the same state — a form that remembers the
   * last invoice is a form that quietly bills the wrong client.
   */
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setClientId(editing.clientId ? String(editing.clientId) : "");
      setIssueDate(editing.issueDate ?? today());
      setDueDate(editing.dueDate ?? "");
      setNotes(editing.notes ?? "");
      setPaymentTerms(editing.paymentTerms ?? "");
      setTaxTreatment(editing.taxTreatment || "unspecified");
      setPlaceOfSupply(editing.placeOfSupply ?? "");
      setSacCode(editing.sacCode ?? "");
      setCgst(bpToText(editing.cgstRateBp ?? 0));
      setSgst(bpToText(editing.sgstRateBp ?? 0));
      setIgst(bpToText(editing.igstRateBp ?? 0));
      setLines(
        editing.lines.length
          ? editing.lines.map((l) => ({
              key: nextKey++,
              description: l.description,
              quantity: String(l.quantityMilli / 1000),
              unit: l.unit || "hour",
              rate: String(l.unitRateMinor / 100),
              timeEntryId: l.timeEntryId ?? undefined,
            }))
          : [blankLine()],
      );
    } else {
      setClientId("");
      setIssueDate(today());
      setDueDate("");
      setNotes("");
      setPaymentTerms(settings?.defaultPaymentTerms ?? "");
      setTaxTreatment("unspecified");
      setPlaceOfSupply(settings?.firmPlaceOfSupply ?? "");
      setSacCode(settings?.defaultSacCode ?? "");
      setCgst(bpToText(settings?.defaultCgstRateBp ?? 0));
      setSgst(bpToText(settings?.defaultSgstRateBp ?? 0));
      setIgst(bpToText(settings?.defaultIgstRateBp ?? 0));
      setLines([blankLine()]);
    }
    setShowTime(false);
  }, [open, editing, settings]);

  const clientIdNumber = clientId ? Number(clientId) : null;

  const { data: unbilled = [] } = useListUnbilledTime(
    clientIdNumber ? { clientId: clientIdNumber } : undefined,
    {
      query: {
        queryKey: getListUnbilledTimeQueryKey(
          clientIdNumber ? { clientId: clientIdNumber } : undefined,
        ),
        enabled: open && showTime && clientIdNumber !== null,
      },
    },
  );

  /**
   * Who can be billed.
   *
   * Clients first, because that is who an invoice is addressed to, but the list
   * is not restricted to them — a chamber may bill an instructing solicitor who
   * holds a staff role, and hiding them would send the user to the database.
   */
  const billable = useMemo(() => {
    const seen = new Set<number>();
    return members
      .filter((m) => (seen.has(m.userId) ? false : (seen.add(m.userId), true)))
      .sort((a, b) => Number(b.role === "client") - Number(a.role === "client"));
  }, [members]);

  const priced = lines.map((l) => {
    const quantityMilli = parseQuantityToMilli(l.quantity);
    const unitRateMinor = parseRupeesToMinor(l.rate);
    const valid =
      l.description.trim().length > 0 &&
      quantityMilli !== null &&
      quantityMilli > 0 &&
      unitRateMinor !== null;
    return {
      line: l,
      quantityMilli,
      unitRateMinor,
      valid,
      amountMinor: valid ? lineAmountMinor(quantityMilli!, unitRateMinor!) : 0,
    };
  });

  const usable = priced.filter((p) => p.valid);
  const subtotalMinor = usable.reduce((sum, p) => sum + p.amountMinor, 0);
  const cgstBp = textToBp(cgst);
  const sgstBp = textToBp(sgst);
  const igstBp = textToBp(igst);
  const taxOf = (bp: number | null) => (bp === null ? 0 : Math.round((subtotalMinor * bp) / 10000));
  const totalMinor = subtotalMinor + taxOf(cgstBp) + taxOf(sgstBp) + taxOf(igstBp);

  const ratesValid = cgstBp !== null && sgstBp !== null && igstBp !== null;
  const canSubmit = clientIdNumber !== null && usable.length > 0 && ratesValid;

  const setLine = (key: number, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const addTimeEntry = (entry: (typeof unbilled)[number]) => {
    const rate = settings?.defaultHourlyRateMinor ?? 0;
    setLines((current) => [
      ...current.filter((l) => l.description.trim() || l.quantity || l.rate),
      {
        key: nextKey++,
        description: `${entry.caseTitle} — ${entry.description || "Professional services"} (${entry.workDate})`,
        // Minutes to hours in thousandths, so 95 minutes is 1.583 hours and the
        // rounding happens once, here, rather than twice on the way to paise.
        quantity: String(Math.round((entry.minutes / 60) * 1000) / 1000),
        unit: "hour",
        rate: String(rate / 100),
        timeEntryId: entry.id,
      },
    ]);
  };

  const submit = () => {
    if (!canSubmit || clientIdNumber === null) return;
    const payload = {
      clientId: clientIdNumber,
      ...(issueDate ? { issueDate } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(paymentTerms.trim() ? { paymentTerms: paymentTerms.trim() } : {}),
      taxTreatment,
      ...(placeOfSupply.trim() ? { placeOfSupply: placeOfSupply.trim() } : {}),
      ...(sacCode.trim() ? { sacCode: sacCode.trim() } : {}),
      cgstRateBp: cgstBp ?? 0,
      sgstRateBp: sgstBp ?? 0,
      igstRateBp: igstBp ?? 0,
      lines: usable.map<InvoiceLineInput>((p) => ({
        description: p.line.description.trim(),
        quantityMilli: p.quantityMilli!,
        unit: p.line.unit || "hour",
        unitRateMinor: p.unitRateMinor!,
        ...(p.line.timeEntryId ? { timeEntryId: p.line.timeEntryId } : {}),
      })),
    };

    const done = (title: string) => () => {
      queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListUnbilledTimeQueryKey() });
      if (editing) queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(editing.id) });
      toast({ title });
      onOpenChange(false);
    };
    const failed = (err: unknown) =>
      toast({ title: "Could not save", description: userMessage(err), variant: "destructive" });

    if (editing) {
      updateInvoice.mutate(
        { id: editing.id, data: payload },
        { onSuccess: done("Draft updated"), onError: failed },
      );
    } else {
      createInvoice.mutate(
        { data: payload },
        { onSuccess: done("Draft created"), onError: failed },
      );
    }
  };

  const saving = createInvoice.isPending || updateInvoice.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit draft" : "New invoice"}</DialogTitle>
          <DialogDescription>
            Saved as a draft. No number is assigned until you issue it — that is what keeps the
            series unbroken if a draft is later deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1 space-y-2">
              <Label htmlFor="invoice-client">Bill to</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger id="invoice-client">
                  <SelectValue placeholder="Choose a client" />
                </SelectTrigger>
                <SelectContent>
                  {billable.map((m) => (
                    <SelectItem key={m.userId} value={String(m.userId)}>
                      {m.displayName || m.email || `User ${m.userId}`}
                      {m.role !== "client" ? ` · ${m.role.replace("_", " ")}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-issue-date">Issue date</Label>
              <Input
                id="invoice-issue-date"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-due-date">Due date</Label>
              <Input
                id="invoice-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Left blank, it follows the chamber's payment terms.
              </p>
            </div>
          </div>

          {/* ── lines ────────────────────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Lines</Label>
              {clientIdNumber !== null && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowTime((s) => !s)}
                >
                  <Clock className="h-4 w-4 mr-1" />
                  {showTime ? "Hide unbilled time" : "Add unbilled time"}
                </Button>
              )}
            </div>

            {showTime && (
              <div className="rounded-[var(--radius)] border border-border p-3 space-y-2">
                {unbilled.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No billable time recorded against this client that is not already invoiced.
                  </p>
                ) : (
                  unbilled.map((entry) => (
                    <div key={entry.id} className="flex items-center gap-3 text-sm">
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{entry.caseTitle}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {entry.workDate} · {entry.userName} · {formatMinutes(entry.minutes)}
                          {entry.description ? ` · ${entry.description}` : ""}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addTimeEntry(entry)}
                        disabled={lines.some((l) => l.timeEntryId === entry.id)}
                      >
                        {lines.some((l) => l.timeEntryId === entry.id) ? "Added" : "Add"}
                      </Button>
                    </div>
                  ))
                )}
                {(settings?.defaultHourlyRateMinor ?? 0) === 0 && unbilled.length > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    No default hourly rate is set, so added time comes in at zero. Set one in
                    billing settings, or type the rate on the line.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              {priced.map(({ line, valid, amountMinor }) => (
                <div key={line.key} className="flex flex-wrap items-start gap-2">
                  <Input
                    aria-label="Description"
                    className="flex-1 min-w-[14rem]"
                    placeholder="Drafting the plaint"
                    value={line.description}
                    onChange={(e) => setLine(line.key, { description: e.target.value })}
                  />
                  <Input
                    aria-label="Quantity"
                    className="w-20"
                    inputMode="decimal"
                    placeholder="1.5"
                    value={line.quantity}
                    onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                  />
                  <Input
                    aria-label="Unit"
                    className="w-20"
                    placeholder="hour"
                    value={line.unit}
                    onChange={(e) => setLine(line.key, { unit: e.target.value })}
                  />
                  <Input
                    aria-label="Rate in rupees"
                    className="w-28"
                    inputMode="decimal"
                    placeholder="4500"
                    value={line.rate}
                    onChange={(e) => setLine(line.key, { rate: e.target.value })}
                  />
                  <div className="w-28 text-right text-sm tabular-nums pt-2">
                    {valid ? (
                      formatMinor(amountMinor)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove line"
                    onClick={() =>
                      setLines((c) =>
                        c.length === 1 ? [blankLine()] : c.filter((l) => l.key !== line.key),
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLines((c) => [...c, blankLine()])}
              >
                <Plus className="h-4 w-4 mr-1" /> Add line
              </Button>
            </div>
          </div>

          {/* ── tax ──────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="invoice-treatment">Tax treatment</Label>
              <Select value={taxTreatment} onValueChange={setTaxTreatment}>
                <SelectTrigger id="invoice-treatment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unspecified">Unspecified</SelectItem>
                  <SelectItem value="intra">Intra-state (CGST + SGST)</SelectItem>
                  <SelectItem value="inter">Inter-state (IGST)</SelectItem>
                  <SelectItem value="exempt">Exempt</SelectItem>
                  <SelectItem value="reverse_charge">Reverse charge</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-pos">Place of supply</Label>
              <Input
                id="invoice-pos"
                value={placeOfSupply}
                onChange={(e) => setPlaceOfSupply(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-sac">SAC code</Label>
              <Input
                id="invoice-sac"
                value={sacCode}
                onChange={(e) => setSacCode(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-cgst">CGST %</Label>
              <Input
                id="invoice-cgst"
                inputMode="decimal"
                value={cgst}
                onChange={(e) => setCgst(e.target.value)}
                aria-invalid={cgstBp === null}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-sgst">SGST %</Label>
              <Input
                id="invoice-sgst"
                inputMode="decimal"
                value={sgst}
                onChange={(e) => setSgst(e.target.value)}
                aria-invalid={sgstBp === null}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-igst">IGST %</Label>
              <Input
                id="invoice-igst"
                inputMode="decimal"
                value={igst}
                onChange={(e) => setIgst(e.target.value)}
                aria-invalid={igstBp === null}
              />
            </div>
          </div>
          {!ratesValid && (
            <p className="text-sm text-destructive">
              A tax rate must be a percentage between 0 and 100.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="invoice-terms">Payment terms</Label>
              <Textarea
                id="invoice-terms"
                rows={2}
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-notes">Notes</Label>
              <Textarea
                id="invoice-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* ── preview ──────────────────────────────────────────────────── */}
          <div className="rounded-[var(--radius)] border border-border p-4 space-y-1 text-sm tabular-nums">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>{formatMinor(subtotalMinor)}</span>
            </div>
            {(cgstBp ?? 0) > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>CGST {cgst}%</span>
                <span>{formatMinor(taxOf(cgstBp))}</span>
              </div>
            )}
            {(sgstBp ?? 0) > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>SGST {sgst}%</span>
                <span>{formatMinor(taxOf(sgstBp))}</span>
              </div>
            )}
            {(igstBp ?? 0) > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>IGST {igst}%</span>
                <span>{formatMinor(taxOf(igstBp))}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-base pt-1 border-t border-border">
              <span>Total</span>
              <span>{formatMinorShort(totalMinor)}</span>
            </div>
            {settings?.nextInvoiceRef && !editing && (
              <p className="text-xs text-muted-foreground pt-2">
                Issuing would number this {settings.nextInvoiceRef}.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || saving}>
            {saving ? "Saving…" : editing ? "Save draft" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
