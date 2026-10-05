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
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data } = useListAiTopups({ query: { queryKey: getListAiTopupsQueryKey() } });
  const { data: billing } = useGetBillingConfig();
  const createTopup = useCreateAiTopup();

  const buy = async (pack: AiTopupPack) => {
    setPaying(pack.code);
    try {
      const order = await createTopup.mutateAsync({ data: { pack: pack.code } });
      await loadCheckout();
      if (!window.Razorpay) throw new Error("checkout unavailable");
      const rzp = new window.Razorpay({
        key: billing?.keyId,
        order_id: order.orderId,
        amount: order.amountMinor,
        currency: order.currency,
        name: "LEX Practice",
        description: pack.label,
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
                <span>
                  <span className="block text-base font-semibold">
                    about {formatTokens(p.grantTokens)} tokens
                  </span>
                  <span className="block text-2xs text-muted-foreground">
                    Carries forward. Spent at the same rate as the monthly allowance.
                  </span>
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
            "All-in" is a statement of fact, not a marketing line, and it is
            the honest form of "tax inclusive" for this business today. Terms
            §6: prices are exclusive of GST, which is added if and when we are
            registered — and we are not. An unregistered supplier may not
            collect GST at all, so there is no tax component to include or to
            break out. What a chamber pays is what is shown.
          */}
          <p className="text-2xs leading-relaxed text-muted-foreground">
            The price shown is the whole amount — nothing is added at checkout. No GST is charged,
            and none may be claimed as input credit, because LEX Practice is not GST-registered. See{" "}
            <a href="/legal/terms" className="underline underline-offset-2">
              Terms §6
            </a>
            .
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
