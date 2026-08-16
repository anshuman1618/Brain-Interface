import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBillingSettings,
  useUpdateBillingSettings,
  getGetBillingSettingsQueryKey,
  type BillingSettings,
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
import { useToast } from "@/hooks/use-toast";
import { userMessage } from "@/lib/errors";
import { parseRupeesToMinor } from "@/lib/format";

/**
 * The chamber's billing identity and tax defaults.
 *
 * These are the CURRENT values. Every invoice snapshots them at issue, so
 * correcting an address here does not rewrite a document already sent — which
 * is the behaviour a client would expect and the one a tax authority requires.
 *
 * Nothing here defaults to a tax rate. Legal services in India carry rules this
 * application is in no position to decide, including reverse charge in some
 * matters, so an unconfigured chamber issues a zero-tax invoice that says so
 * rather than a confidently wrong one.
 */

type Form = {
  firmAddress: string;
  firmGstin: string;
  firmPlaceOfSupply: string;
  defaultSacCode: string;
  cgst: string;
  sgst: string;
  igst: string;
  hourlyRate: string;
  defaultPaymentTerms: string;
  defaultPaymentDays: string;
};

const bpToText = (bp: number | undefined) => String((bp ?? 0) / 100);

function textToBp(text: string): number | null {
  const t = text.trim();
  if (t === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const bp = Math.round(Number(t) * 100);
  return bp > 10000 ? null : bp;
}

export function BillingSettingsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings } = useGetBillingSettings({
    query: { queryKey: getGetBillingSettingsQueryKey(), enabled: open },
  });
  const update = useUpdateBillingSettings();

  const [form, setForm] = useState<Form | null>(null);

  useEffect(() => {
    if (!open || !settings) return;
    setForm({
      firmAddress: settings.firmAddress ?? "",
      firmGstin: settings.firmGstin ?? "",
      firmPlaceOfSupply: settings.firmPlaceOfSupply ?? "",
      defaultSacCode: settings.defaultSacCode ?? "",
      cgst: bpToText(settings.defaultCgstRateBp),
      sgst: bpToText(settings.defaultSgstRateBp),
      igst: bpToText(settings.defaultIgstRateBp),
      hourlyRate: String((settings.defaultHourlyRateMinor ?? 0) / 100),
      defaultPaymentTerms: settings.defaultPaymentTerms ?? "",
      defaultPaymentDays: String(settings.defaultPaymentDays ?? 30),
    });
  }, [open, settings]);

  if (!form) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Billing settings</DialogTitle>
            <DialogDescription>Loading…</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const cgstBp = textToBp(form.cgst);
  const sgstBp = textToBp(form.sgst);
  const igstBp = textToBp(form.igst);
  const hourlyMinor = form.hourlyRate.trim() === "" ? 0 : parseRupeesToMinor(form.hourlyRate);
  const days = /^\d{1,3}$/.test(form.defaultPaymentDays.trim())
    ? Number(form.defaultPaymentDays)
    : null;

  const valid =
    cgstBp !== null &&
    sgstBp !== null &&
    igstBp !== null &&
    hourlyMinor !== null &&
    days !== null &&
    days <= 365;

  const submit = () => {
    if (!valid) return;
    const payload: BillingSettings = {
      firmAddress: form.firmAddress.trim(),
      firmGstin: form.firmGstin.trim(),
      firmPlaceOfSupply: form.firmPlaceOfSupply.trim(),
      defaultSacCode: form.defaultSacCode.trim(),
      defaultCgstRateBp: cgstBp,
      defaultSgstRateBp: sgstBp,
      defaultIgstRateBp: igstBp,
      defaultHourlyRateMinor: hourlyMinor,
      defaultPaymentTerms: form.defaultPaymentTerms.trim(),
      defaultPaymentDays: days,
    };
    update.mutate(
      { data: payload },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBillingSettingsQueryKey() });
          toast({ title: "Billing settings saved" });
          onOpenChange(false);
        },
        onError: (err) =>
          toast({
            title: "Could not save",
            description: userMessage(err),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Billing settings</DialogTitle>
          <DialogDescription>
            What appears on the invoice as the chamber's own details, and the defaults a new invoice
            starts from. An invoice already issued keeps the values it was issued with.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="firm-address">Chamber address</Label>
            <Textarea
              id="firm-address"
              rows={3}
              value={form.firmAddress}
              onChange={(e) => set({ firmAddress: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firm-gstin">GSTIN</Label>
              <Input
                id="firm-gstin"
                value={form.firmGstin}
                onChange={(e) => set({ firmGstin: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="firm-pos">Place of supply</Label>
              <Input
                id="firm-pos"
                value={form.firmPlaceOfSupply}
                onChange={(e) => set({ firmPlaceOfSupply: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="firm-sac">Default SAC code</Label>
              <Input
                id="firm-sac"
                value={form.defaultSacCode}
                onChange={(e) => set({ defaultSacCode: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="default-cgst">Default CGST %</Label>
              <Input
                id="default-cgst"
                inputMode="decimal"
                value={form.cgst}
                onChange={(e) => set({ cgst: e.target.value })}
                aria-invalid={cgstBp === null}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="default-sgst">Default SGST %</Label>
              <Input
                id="default-sgst"
                inputMode="decimal"
                value={form.sgst}
                onChange={(e) => set({ sgst: e.target.value })}
                aria-invalid={sgstBp === null}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="default-igst">Default IGST %</Label>
              <Input
                id="default-igst"
                inputMode="decimal"
                value={form.igst}
                onChange={(e) => set({ igst: e.target.value })}
                aria-invalid={igstBp === null}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            These are defaults for new invoices, not advice. Which treatment applies to a given
            matter is your accountant's decision — leave them at zero until you have one.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="hourly-rate">Default hourly rate (₹)</Label>
              <Input
                id="hourly-rate"
                inputMode="decimal"
                value={form.hourlyRate}
                onChange={(e) => set({ hourlyRate: e.target.value })}
                aria-invalid={hourlyMinor === null}
              />
              <p className="text-xs text-muted-foreground">
                Used to price logged time when it is pulled onto an invoice.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-days">Payment days</Label>
              <Input
                id="payment-days"
                inputMode="numeric"
                value={form.defaultPaymentDays}
                onChange={(e) => set({ defaultPaymentDays: e.target.value })}
                aria-invalid={days === null}
              />
              <p className="text-xs text-muted-foreground">
                Days from issue to due date, when a due date is not set by hand.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment-terms">Default payment terms</Label>
            <Textarea
              id="payment-terms"
              rows={2}
              value={form.defaultPaymentTerms}
              onChange={(e) => set({ defaultPaymentTerms: e.target.value })}
            />
          </div>

          {settings?.nextInvoiceRef && (
            <p className="text-sm text-muted-foreground">
              The next invoice you issue will be numbered{" "}
              <span className="font-mono">{settings.nextInvoiceRef}</span>.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || update.isPending}>
            {update.isPending ? "Saving…" : "Save settings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
