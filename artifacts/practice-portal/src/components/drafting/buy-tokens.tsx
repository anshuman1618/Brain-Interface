import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAiTopups,
  useCreateAiTopup,
  getListAiTopupsQueryKey,
  getGetAiBudgetQueryKey,
  useGetBillingConfig,
  type AiTopupPack,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { userMessage } from "@/lib/errors";
import { formatMinor, formatTokens } from "@/lib/format";
import { loadCheckout } from "@/lib/checkout";
import { Coins } from "lucide-react";

/**
 * Buying more drafting, from the screen that spends it.
 *
 * The budget meter used to say "an admin or senior advocate can add more from
 * the plan screen" and stop there — an instruction to go somewhere else,
 * given at the moment somebody is blocked. The plan screen is also the wrong
 * place: it sells PLANS, and a chamber that just wants another ₹500 of
 * drafting has to walk past the subscription to find it.
 *
 * Gated on `ai_topup.purchase`, which admin and senior advocate hold and
 * nobody else does. The button simply does not render otherwise — the server
 * refuses the same call, so this is only about not offering something that
 * will be refused.
 *
 * **Tokens lead, the price follows.** The meter above it is in tokens, and
 * "about 1.3M tokens" is the answer to the question somebody has when the bar
 * is nearly empty. The rupee figure is the amount that will actually be
 * charged, so it is never hidden.
 */
export function BuyTokens({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data } = useListAiTopups({ query: { queryKey: getListAiTopupsQueryKey() } });
  const { data: billing } = useGetBillingConfig();
  const createTopup = useCreateAiTopup();

  const buy = async (what: AiTopupPack | { amountMinor: number }) => {
    const isPack = "code" in what;
    setPaying(isPack ? what.code : "custom");
    try {
      const order = await createTopup.mutateAsync({
        data: isPack ? { pack: what.code } : { pack: "custom", amountMinor: what.amountMinor },
      });
      await loadCheckout();
      if (!window.Razorpay) throw new Error("checkout unavailable");
      const rzp = new window.Razorpay({
        key: billing?.keyId,
        order_id: order.orderId,
        amount: order.amountMinor,
        currency: order.currency,
        name: "LEX Practice",
        description: isPack ? what.label : "Drafting top-up",
        handler: () => {
          /*
           * The widget closing happily is not the grant. The webhook writes
           * it from the provider's signed confirmation, and may land a moment
           * after this — so refetch and report what the server says rather
           * than crediting the budget here.
           */
          queryClient.invalidateQueries({ queryKey: getGetAiBudgetQueryKey() });
          setOpen(false);
          toast({
            title: "Payment received",
            description: "The tokens appear as soon as the payment is confirmed.",
          });
        },
        modal: { ondismiss: () => setPaying(null) },
        theme: { color: "#5b3a1c" },
      });
      rzp.open();
    } catch (err) {
      toast({
        title: "Could not start payment",
        description: userMessage(err),
        variant: "destructive",
      });
    } finally {
      setPaying(null);
    }
  };

  // No packs means the caller lacks `ai_topup.purchase` and the request 403'd,
  // or the deployment sells nothing. Either way there is nothing to offer.
  if (!data || data.packs.length === 0) return null;

  /*
   * The typed amount, in paise, or null when it is not a usable figure.
   *
   * Bounds come from the server rather than being written again here. They
   * are enforced at order creation and once more in the webhook, so this is
   * only about not sending a request that was always going to be refused.
   */
  const typed = Number(custom);
  const customMinor =
    custom !== "" &&
    Number.isInteger(typed) &&
    typed > 0 &&
    typed * 100 >= data.customMinMinor &&
    typed * 100 <= data.customMaxMinor
      ? typed * 100
      : null;

  /*
   * Tokens per paisa, taken from a pack the SERVER priced rather than from a
   * rate written again in the browser. The blend and the tier both live in
   * `tokensForMinor`; copying either here would mean two places to be wrong
   * and one of them invisible to the suites.
   */
  const ref = data.packs[0];
  const customTokens =
    customMinor !== null && ref && ref.grantMinor > 0
      ? Math.floor((ref.grantTokens / ref.grantMinor) * customMinor)
      : 0;

  return (
    <>
      <Button
        variant={compact ? "ghost" : "outline"}
        size="sm"
        className="rounded-lg font-mono uppercase tracking-wider"
        onClick={() => setOpen(true)}
      >
        <Coins className="mr-1.5 h-3.5 w-3.5" />
        Buy tokens
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-lg border-border sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-widest">Buy tokens</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              Added to this chamber&rsquo;s drafting budget. Top-ups do not expire with the
              month&rsquo;s allowance — they carry forward until they are spent.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 pt-2">
            {data.packs.map((p: AiTopupPack) => (
              <button
                key={p.code}
                type="button"
                disabled={!data.paymentsEnabled || paying !== null}
                onClick={() => void buy(p)}
                className="flex w-full items-center justify-between gap-4 rounded-[var(--radius)] bg-card p-4 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <span className="text-base font-semibold">
                  about {formatTokens(p.grantTokens)} tokens
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-medium">{formatMinor(p.priceMinor)}</span>
                  <span className="block text-3xs font-mono uppercase tracking-wider text-muted-foreground">
                    {paying === p.code ? "Opening…" : "all-in"}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {/*
            An amount the buyer chooses, because the three packs are a
            convenience rather than a price list — a chamber that wants ₹700
            of drafting should not have to buy ₹1,000 of it.

            Rupees in, tokens shown. The charge is in rupees and so is the
            receipt, so that is what gets typed; the token figure is the
            answer to "will this be enough", recomputed live from the same
            per-chamber rate the packs use. Bounds come from the server and
            are enforced there and in the webhook as well — this only saves a
            round trip on an amount that was never going to be accepted.
          */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (customMinor !== null) void buy({ amountMinor: customMinor });
            }}
            className="rounded-[var(--radius)] bg-card p-4 shadow-sm"
          >
            <label
              htmlFor="topup-custom"
              className="block font-mono text-2xs uppercase tracking-wider text-muted-foreground"
            >
              Or an amount of your own
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  ₹
                </span>
                <Input
                  id="topup-custom"
                  inputMode="numeric"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder={String(Math.round(data.customMinMinor / 100))}
                  className="w-36 rounded-lg pl-7"
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="rounded-lg font-mono uppercase tracking-wider"
                disabled={customMinor === null || !data.paymentsEnabled || paying !== null}
              >
                {paying === "custom" ? "Opening…" : "Buy"}
              </Button>
            </div>
            <p
              className={`mt-2 text-2xs leading-relaxed ${
                custom && customMinor === null ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {customMinor !== null
                ? `about ${formatTokens(customTokens)} tokens, all-in`
                : `Whole rupees, ${formatMinor(data.customMinMinor)} to ${formatMinor(data.customMaxMinor)}.`}
            </p>
          </form>

          {/*
            "All-in" is a statement of fact, not a marketing line, and it is
            the honest form of "tax inclusive" for this business today. Terms
            §6: prices are exclusive of GST, which is added if and when we are
            registered — and we are not. An unregistered supplier may not
            collect GST at all, so there is no tax component to include or to
            break out. What a chamber pays is what is shown.
          */}
          <p className="text-2xs leading-relaxed text-muted-foreground">
            The price shown is the whole amount — nothing is added at checkout.
          </p>

          {!data.paymentsEnabled && (
            <p className="text-2xs leading-relaxed text-destructive">
              Payments are not configured on this deployment, so nothing can be bought here yet.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
