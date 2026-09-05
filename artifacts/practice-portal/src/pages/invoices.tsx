import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListInvoices,
  useIssueInvoice,
  useSetInvoiceStatus,
  useDeleteInvoice,
  useListWorkspaceMembers,
  getInvoicePdf,
  getListInvoicesQueryKey,
  getGetBillingSettingsQueryKey,
  getListWorkspaceMembersQueryKey,
  type Invoice,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  Settings2,
  MoreHorizontal,
  Download,
  FileText,
  AlertTriangle,
  IndianRupee,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { userMessage } from "@/lib/errors";
import { formatMinor, formatMinorShort, formatMilli } from "@/lib/format";
import { InvoiceFormModal } from "@/components/invoice-form-modal";
import { BillingSettingsModal } from "@/components/billing-settings-modal";

/**
 * Invoicing, admin only.
 *
 * The page is deliberately built around one distinction: a draft is a working
 * document and everything else is a record. Drafts can be edited, deleted and
 * issued; anything past that offers status changes, a PDF, and voiding — never
 * an edit. The server enforces this with a 409; the UI simply stops offering
 * what would be refused, so the rule is visible before it is hit.
 */

/** Shown on the badge. `overdue` is derived by the API, never stored. */
function statusLabel(invoice: Invoice): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
} {
  if (invoice.status === "void") return { label: "Void", variant: "outline" };
  if (invoice.status === "paid") return { label: "Paid", variant: "default" };
  if (invoice.isOverdue) return { label: "Overdue", variant: "destructive" };
  if (invoice.status === "sent") return { label: "Sent", variant: "secondary" };
  if (invoice.status === "issued") return { label: "Issued", variant: "secondary" };
  return { label: "Draft", variant: "outline" };
}

export default function InvoicesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [viewing, setViewing] = useState<Invoice | null>(null);
  const [voiding, setVoiding] = useState<Invoice | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const params = status === "all" ? undefined : { status };
  const { data, isLoading } = useListInvoices(params, {
    query: { queryKey: getListInvoicesQueryKey(params) },
  });

  const { data: members = [] } = useListWorkspaceMembers({
    query: { queryKey: getListWorkspaceMembersQueryKey() },
  });

  /**
   * Who an invoice is addressed to.
   *
   * An issued invoice carries its own snapshot and that is what is shown — it is
   * the name actually printed on the document. A draft has no snapshot yet, so
   * the current member record stands in; without this a draft raised moments ago
   * for a named client reads as "—".
   */
  const addressedTo = (invoice: Invoice): string => {
    if (invoice.clientName) return invoice.clientName;
    const member = members.find((m) => m.userId === invoice.clientId);
    return member?.displayName || member?.email || "—";
  };

  const issue = useIssueInvoice();
  const setInvoiceStatus = useSetInvoiceStatus();
  const remove = useDeleteInvoice();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    // The next number moves when one is issued, and it is shown in two places.
    queryClient.invalidateQueries({ queryKey: getGetBillingSettingsQueryKey() });
  };

  const failed = (title: string) => (err: unknown) =>
    toast({ title, description: userMessage(err), variant: "destructive" });

  const doIssue = (invoice: Invoice) =>
    issue.mutate(
      { id: invoice.id },
      {
        onSuccess: (issued) => {
          refresh();
          toast({
            title: `Issued as ${issued.invoiceRef}`,
            description: "The client and chamber details on it are now fixed.",
          });
        },
        onError: failed("Could not issue this invoice"),
      },
    );

  const move = (invoice: Invoice, next: string, reason?: string) =>
    setInvoiceStatus.mutate(
      { id: invoice.id, data: { status: next as never, ...(reason ? { reason } : {}) } },
      {
        onSuccess: () => {
          refresh();
          toast({ title: `Marked ${next}` });
          setVoiding(null);
          setVoidReason("");
        },
        onError: failed("Could not change the status"),
      },
    );

  const doDelete = (invoice: Invoice) =>
    remove.mutate(
      { id: invoice.id },
      {
        onSuccess: () => (refresh(), toast({ title: "Draft deleted" })),
        onError: failed("Could not delete"),
      },
    );

  /**
   * Download the PDF.
   *
   * Fetched through the API client rather than linked to directly, because the
   * route is behind the workspace header the client attaches — a plain anchor
   * would arrive without it and be refused.
   */
  const download = async (invoice: Invoice) => {
    try {
      const blob = await getInvoicePdf(invoice.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(invoice.invoiceRef ?? `draft-${invoice.id}`).replace(/\//g, "-")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: "Could not download the PDF",
        description: userMessage(err),
        variant: "destructive",
      });
    }
  };

  const invoices = data?.invoices ?? [];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-1">Invoices</h2>
          <p className="text-muted-foreground">
            Bill clients, and keep an unbroken numbered record of what was billed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="h-4 w-4 mr-2" /> Billing settings
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" /> New invoice
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <IndianRupee className="h-4 w-4" /> Outstanding
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tighter tabular-nums">
              {isLoading ? (
                <Skeleton className="h-8 w-32" />
              ) : (
                formatMinorShort(data?.outstandingMinor ?? 0)
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Issued or sent, not yet paid</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Overdue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tighter tabular-nums">
              {isLoading ? (
                <Skeleton className="h-8 w-32" />
              ) : (
                formatMinorShort(data?.overdueMinor ?? 0)
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Of the outstanding, past due</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileText className="h-4 w-4" /> Paid
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tighter tabular-nums">
              {isLoading ? (
                <Skeleton className="h-8 w-32" />
              ) : (
                formatMinorShort(data?.paidMinor ?? 0)
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Voided invoices count towards neither
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle>All invoices</CardTitle>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="draft">Drafts</SelectItem>
              <SelectItem value="issued">Issued</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="void">Void</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-3 opacity-50" />
              <p>
                {status === "all"
                  ? "No invoices yet. Set the chamber's billing details first, then raise one."
                  : "No invoices with that status."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => {
                    const badge = statusLabel(invoice);
                    return (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-mono text-sm">
                          {invoice.invoiceRef ?? (
                            <span className="text-muted-foreground">— draft</span>
                          )}
                        </TableCell>
                        <TableCell>{addressedTo(invoice)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {invoice.issueDate ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {invoice.dueDate ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMinor(invoice.totalMinor)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label="Invoice actions">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setViewing(invoice)}>
                                View
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void download(invoice)}>
                                <Download className="h-4 w-4 mr-2" /> Download PDF
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {invoice.isEditable ? (
                                <>
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setEditing(invoice);
                                      setFormOpen(true);
                                    }}
                                  >
                                    Edit draft
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => doIssue(invoice)}>
                                    Issue — assigns the number
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={() => doDelete(invoice)}
                                  >
                                    Delete draft
                                  </DropdownMenuItem>
                                </>
                              ) : (
                                <>
                                  {invoice.status === "issued" && (
                                    <DropdownMenuItem onClick={() => move(invoice, "sent")}>
                                      Mark sent
                                    </DropdownMenuItem>
                                  )}
                                  {(invoice.status === "issued" || invoice.status === "sent") && (
                                    <>
                                      <DropdownMenuItem onClick={() => move(invoice, "paid")}>
                                        Mark paid
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        className="text-destructive"
                                        onClick={() => {
                                          setVoidReason("");
                                          setVoiding(invoice);
                                        }}
                                      >
                                        Void
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <InvoiceFormModal open={formOpen} onOpenChange={setFormOpen} editing={editing} />
      <BillingSettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />

      {/* ── the record, read-only ─────────────────────────────────────────── */}
      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {viewing && (
            <>
              <DialogHeader>
                <DialogTitle className="font-mono">
                  {viewing.invoiceRef ?? "Draft — not yet issued"}
                </DialogTitle>
                <DialogDescription>
                  {viewing.isEditable
                    ? "A draft. Nothing here is fixed until it is issued."
                    : "Issued. These figures cannot change — voiding is the only retraction."}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground font-mono mb-1">
                    Bill to
                  </div>
                  <div className="font-medium">{addressedTo(viewing)}</div>
                  {viewing.clientAddress && (
                    <div className="text-muted-foreground whitespace-pre-line">
                      {viewing.clientAddress}
                    </div>
                  )}
                  {viewing.clientEmail && (
                    <div className="text-muted-foreground">{viewing.clientEmail}</div>
                  )}
                  {viewing.clientGstin && (
                    <div className="text-muted-foreground">GSTIN: {viewing.clientGstin}</div>
                  )}
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground font-mono mb-1">
                    Details
                  </div>
                  <div className="text-muted-foreground">Issued: {viewing.issueDate ?? "—"}</div>
                  <div className="text-muted-foreground">Due: {viewing.dueDate ?? "—"}</div>
                  <div className="text-muted-foreground">Treatment: {viewing.taxTreatment}</div>
                  {viewing.placeOfSupply && (
                    <div className="text-muted-foreground">
                      Place of supply: {viewing.placeOfSupply}
                    </div>
                  )}
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viewing.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>{line.description}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMilli(line.quantityMilli)} {line.unit}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMinor(line.unitRateMinor)}
                      </TableCell>
                      {/* Straight from the stored column — never quantity × rate. */}
                      <TableCell className="text-right tabular-nums">
                        {formatMinor(line.amountMinor)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="space-y-1 text-sm tabular-nums">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatMinor(viewing.subtotalMinor)}</span>
                </div>
                {(viewing.cgstMinor ?? 0) > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>CGST {(viewing.cgstRateBp ?? 0) / 100}%</span>
                    <span>{formatMinor(viewing.cgstMinor ?? 0)}</span>
                  </div>
                )}
                {(viewing.sgstMinor ?? 0) > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>SGST {(viewing.sgstRateBp ?? 0) / 100}%</span>
                    <span>{formatMinor(viewing.sgstMinor ?? 0)}</span>
                  </div>
                )}
                {(viewing.igstMinor ?? 0) > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>IGST {(viewing.igstRateBp ?? 0) / 100}%</span>
                    <span>{formatMinor(viewing.igstMinor ?? 0)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-base pt-1 border-t border-border">
                  <span>Total</span>
                  <span>{formatMinor(viewing.totalMinor)}</span>
                </div>
              </div>

              {viewing.paymentTerms && (
                <p className="text-sm text-muted-foreground">{viewing.paymentTerms}</p>
              )}
              {viewing.notes && <p className="text-sm text-muted-foreground">{viewing.notes}</p>}
              {viewing.status === "void" && (
                <p className="text-sm text-destructive">
                  Voided{viewing.voidedBy ? ` by ${viewing.voidedBy}` : ""}
                  {viewing.voidReason ? `: ${viewing.voidReason}` : ""}. The number stays spent, so
                  the series has no gap.
                </p>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => void download(viewing)}>
                  <Download className="h-4 w-4 mr-2" /> Download PDF
                </Button>
                <Button onClick={() => setViewing(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── voiding ───────────────────────────────────────────────────────── */}
      <Dialog open={voiding !== null} onOpenChange={(open) => !open && setVoiding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void {voiding?.invoiceRef}</DialogTitle>
            <DialogDescription>
              The invoice keeps its number and stops counting towards what is owed. Nothing is
              deleted — voiding is what keeps the numbered run unbroken after a mistake.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              aria-label="Reason for voiding"
              placeholder="Raised against the wrong matter"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The reason is recorded against the invoice, alongside who voided it.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoiding(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={voidReason.trim().length === 0 || setInvoiceStatus.isPending}
              onClick={() => voiding && move(voiding, "void", voidReason.trim())}
            >
              Void this invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
