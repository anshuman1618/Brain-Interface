import { createContext, useContext, useState, ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Info } from "lucide-react";
import {
  useGetSubscription,
  useSetSubscription,
  useGetBillingConfig,
  useCreateCheckout,
  getGetBillingConfigQueryKey,
  getGetSubscriptionQueryKey,
  type PlanQuote,
  type SubscriptionInputPlan,
  type SubscriptionInputBillingPeriod,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

/**
 * Razorpay's checkout script, loaded on demand.
 *
 * Deliberately not in index.html: a third-party script on every page load is
 * exactly the disclosure the fonts were removed for. It is fetched the moment
 * somebody chooses to pay, and not before. The deployment's CSP has to allow
 * checkout.razorpay.com — see DEPLOYMENT.md.
 */
const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("checkout script failed to load")));
      return;
    }
    const el = document.createElement("script");
    el.src = CHECKOUT_SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("checkout script failed to load"));
    document.head.appendChild(el);
  });
}

interface PricingModalContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const PricingModalContext = createContext<PricingModalContextType | undefined>(undefined);

export function usePricingModal() {
  const context = useContext(PricingModalContext);
  if (!context) {
    throw new Error("usePricingModal must be used within a PricingModalProvider");
  }
  return context;
}

const PERIODS: { value: SubscriptionInputBillingPeriod; label: string; note: string | null }[] = [
  { value: "monthly", label: "Monthly", note: null },
  { value: "half_yearly", label: "Half-yearly", note: "1 month free" },
  { value: "yearly", label: "Yearly", note: "2 months free" },
];

const PLAN_ORDER: SubscriptionInputPlan[] = ["trial", "pro", "firm", "custom"];

/**
 * `metered` marks the plans the billing-period selector governs. The trial is
 * a one-off two-month pack and the custom plan is quoted, so neither moves
 * when the term changes — and a control that visibly does nothing to half the
 * cards needs the sentence under it that explains its scope.
 */
const PLAN_COPY: Record<
  SubscriptionInputPlan,
  { name: string; blurb: string; features: string[]; metered: boolean }
> = {
  trial: {
    name: "Trial",
    blurb: "Two months to decide, at the price of a coffee.",
    features: ["5 open matters", "2 seats", "Every module unlocked", "Runs two months, then stops"],
    metered: false,
  },
  pro: {
    name: "Pro",
    blurb: "A working chamber with juniors and clerks.",
    features: [
      "Unlimited matters",
      "10 seats",
      "Client portal and feedback",
      "KPI engine",
      "Priority support",
    ],
    metered: true,
  },
  firm: {
    name: "Firm",
    blurb: "Multiple benches, multiple practice areas.",
    features: [
      "Unlimited matters",
      "Unlimited seats",
      "KPI engine and audit log",
      "Audit export",
      "Dedicated support",
    ],
    metered: true,
  },
  custom: {
    name: "Custom",
    blurb: "A curated deployment, scoped to your chamber.",
    features: [
      "Everything in Firm",
      "Migration from your existing files",
      "Bespoke roles and workflows",
      "Named contact and onboarding",
    ],
    metered: false,
  },
};

/** Paise to rupees. Prices are integers server-side; only display divides. */
function rupees(minor: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

export function PricingModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<SubscriptionInputBillingPeriod>("yearly");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useGetSubscription({
    query: { enabled: open, queryKey: getGetSubscriptionQueryKey() },
  });
  const setSubscription = useSetSubscription();
  const { data: billing } = useGetBillingConfig({
    query: { enabled: open, queryKey: getGetBillingConfigQueryKey() },
  });
  const createCheckout = useCreateCheckout();
  const [paying, setPaying] = useState<SubscriptionInputPlan | null>(null);

  // Only the plans that cost money, and only when a provider is configured.
  // Everywhere else the button records the selection as it always did, which is
  // what keeps preview mode and self-hosted deployments working.
  const payable = (plan: SubscriptionInputPlan) => {
    const q = quoteFor(plan);
    return (billing?.enabled ?? false) && q && q.amountMinor > 0;
  };

  const current = data?.subscription;
  const canManage = data?.canManage ?? false;
  // A plan that is not metered publishes exactly one quote, under `one_time`.
  // Looking it up by the selected period would find nothing and render "-".
  const quoteFor = (plan: SubscriptionInputPlan): PlanQuote | undefined =>
    data?.catalogue.find(
      (q) => q.plan === plan && q.billingPeriod === (PLAN_COPY[plan].metered ? period : "one_time"),
    );

  /**
   * Pay for a plan.
   *
   * The order is created server-side for an amount the server computed; this
   * only hands the resulting id to the provider's widget. Success here means
   * "the widget closed happily", NOT "the subscription is active" — that is
   * decided by the signed webhook, so the UI refetches and reports what the
   * server says rather than assuming.
   */
  const pay = async (plan: SubscriptionInputPlan) => {
    const copy = PLAN_COPY[plan];
    setPaying(plan);
    try {
      const order = await createCheckout.mutateAsync({
        data: { plan, billingPeriod: copy.metered ? period : "one_time" },
      });
      await loadCheckout();
      if (!window.Razorpay) throw new Error("checkout unavailable");

      const rzp = new window.Razorpay({
        key: billing?.keyId,
        order_id: order.orderId,
        amount: order.amountMinor,
        currency: order.currency,
        name: "LEX Practice",
        description: `${copy.name} plan`,
        handler: () => {
          // The webhook is the source of truth and may land a moment later.
          queryClient.invalidateQueries({ queryKey: getGetSubscriptionQueryKey() });
          toast({
            title: "Payment received",
            description: "Your plan activates as soon as the payment is confirmed.",
          });
        },
        modal: { ondismiss: () => setPaying(null) },
        theme: { color: "#5b3a1c" },
      });
      rzp.open();
    } catch (err) {
      toast({
        title: "Could not start payment",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPaying(null);
    }
  };

  const choose = (plan: SubscriptionInputPlan) => {
    const copy = PLAN_COPY[plan];
    setSubscription.mutate(
      // The server normalises the period for the plans that do not have one,
      // so what is sent here for those two does not matter. It is sent anyway
      // because the field is required, not because it is honoured.
      { data: { plan, billingPeriod: copy.metered ? period : "one_time" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSubscriptionQueryKey() });
          toast({
            title: plan === "custom" ? "Enquiry recorded" : "Plan selected",
            description:
              plan === "custom"
                ? "We will be in touch. Your current allowance is unchanged until the quote is agreed."
                : copy.metered
                  ? `${copy.name}, billed ${PERIODS.find((p) => p.value === period)?.label.toLowerCase()}.`
                  : `${copy.name}, a one-off two-month pack.`,
          });
        },
        onError: (err: Error) => {
          toast({
            title: "Could not change the plan",
            description: err.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <PricingModalContext.Provider value={{ open, setOpen }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto rounded-lg border-border bg-background p-0">
          <DialogHeader className="p-8 pb-5 border-b border-border bg-muted/30">
            <DialogTitle className="text-2xl font-mono uppercase tracking-widest text-foreground">
              Subscription
            </DialogTitle>
            <DialogDescription className="font-mono text-muted-foreground uppercase text-xs mt-2">
              {current?.status === "active"
                ? `Currently on ${PLAN_COPY[current.plan as SubscriptionInputPlan]?.name ?? current.plan}${
                    PLAN_COPY[current.plan as SubscriptionInputPlan]?.metered
                      ? `, billed ${
                          PERIODS.find(
                            (p) => p.value === current.billingPeriod,
                          )?.label.toLowerCase() ?? current.billingPeriod
                        }`
                      : ""
                  }`
                : current?.plan === "custom"
                  ? "A custom quote is with our team - your current allowance is unchanged"
                  : "No plan chosen yet - start on the two-month Trial, or commit for longer and pay less"}
            </DialogDescription>

            {/* Billing period. Commit longer, pay for fewer months. */}
            <div
              className="flex flex-wrap items-stretch border border-border mt-5 w-fit"
              role="group"
              aria-label="Billing period"
            >
              {PERIODS.map((p) => {
                const active = p.value === period;
                return (
                  <button
                    key={p.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setPeriod(p.value)}
                    className={`px-4 py-2.5 font-mono uppercase text-2xs tracking-widest border-r border-border last:border-r-0 transition-colors ${
                      active
                        ? "bg-foreground text-background"
                        : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    {p.label}
                    {p.note && (
                      <span
                        className={`block text-3xs tracking-wider mt-0.5 ${
                          active ? "text-background/70" : "text-primary"
                        }`}
                      >
                        {p.note}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-2xs text-muted-foreground mt-2">
              The billing period applies to Pro and Firm. Trial is a one-off two-month pack; Custom
              is quoted.
            </p>
          </DialogHeader>

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border">
              {PLAN_ORDER.map((p) => (
                <div key={p} className="p-8 space-y-4">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-9 w-32" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border bg-background">
              {PLAN_ORDER.map((plan) => {
                const q = quoteFor(plan);
                const copy = PLAN_COPY[plan];
                const quoteOnly = q?.quoteOnly ?? false;
                // A custom plan never goes active — selecting it records an
                // enquiry — so "current" for that card means "we have your
                // enquiry", which is a different sentence.
                const isCurrent = quoteOnly
                  ? current?.plan === plan
                  : current?.status === "active" &&
                    current.plan === plan &&
                    (!copy.metered || current.billingPeriod === period);
                const featured = plan === "pro";

                return (
                  <div
                    key={plan}
                    className={`p-8 flex flex-col relative ${
                      featured ? "bg-muted/40" : "hover:bg-muted/10 transition-colors"
                    }`}
                  >
                    {isCurrent && (
                      <div className="absolute top-0 right-0 bg-foreground text-background text-3xs font-bold font-mono uppercase tracking-widest px-3 py-1">
                        {quoteOnly ? "Enquiry sent" : "Current plan"}
                      </div>
                    )}

                    <h3 className="font-mono uppercase tracking-wider font-bold text-foreground">
                      {copy.name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 mb-4">{copy.blurb}</p>

                    <div className="mb-1">
                      {quoteOnly ? (
                        <span className="text-3xl font-mono text-foreground">On request</span>
                      ) : (
                        <>
                          <span className="text-3xl font-mono text-foreground tabular-nums">
                            {q ? rupees(q.effectiveMonthlyMinor) : "-"}
                          </span>
                          <span className="text-sm text-muted-foreground">/mo</span>
                        </>
                      )}
                    </div>

                    {/* The real commitment, stated plainly under the headline rate. */}
                    <p className="text-2xs font-mono text-muted-foreground uppercase tracking-wider min-h-[2.5rem]">
                      {quoteOnly ? (
                        "Priced against what you actually need"
                      ) : q && !q.renews ? (
                        `${rupees(q.amountMinor)} once, covering ${q.months} months`
                      ) : q && q.months > 1 ? (
                        <>
                          {rupees(q.amountMinor)} billed every {q.months} months
                          {q.freeMonths > 0 && (
                            <span className="block text-primary normal-case tracking-normal font-sans mt-0.5">
                              Pay for {q.paidMonths}, get {q.months} - saves{" "}
                              {rupees(q.savingsMinor)}
                            </span>
                          )}
                        </>
                      ) : (
                        <>{q ? `${rupees(q.amountMinor)} billed monthly` : ""}</>
                      )}
                    </p>

                    <ul className="text-sm text-muted-foreground space-y-2 my-6 flex-1">
                      {copy.features.map((f) => (
                        <li key={f} className="flex items-start gap-2">
                          <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
                          {f}
                        </li>
                      ))}
                    </ul>

                    <Button
                      variant={featured ? "default" : "outline"}
                      className="w-full rounded-lg font-mono uppercase tracking-wider"
                      disabled={
                        !canManage || isCurrent || setSubscription.isPending || paying !== null
                      }
                      onClick={() => (payable(plan) ? void pay(plan) : choose(plan))}
                    >
                      {isCurrent
                        ? quoteOnly
                          ? "Enquiry sent"
                          : "Selected"
                        : paying === plan
                          ? "Opening..."
                          : setSubscription.isPending
                            ? "Saving..."
                            : quoteOnly
                              ? "Talk to us"
                              : payable(plan)
                                ? "Subscribe"
                                : "Choose"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="px-8 py-4 border-t border-border bg-muted/30 flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <p>
              {!canManage
                ? "Only a chamber owner or Firm Admin can change the plan. You are seeing the plan your chamber is on."
                : billing?.enabled
                  ? "Payment is taken by Razorpay. Card details never reach our servers, and your plan activates once the payment is confirmed."
                  : "Choosing a plan records it against your chamber. No payment provider is connected to this deployment, so nothing is charged."}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </PricingModalContext.Provider>
  );
}
