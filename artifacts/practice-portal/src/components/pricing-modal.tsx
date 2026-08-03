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
  getGetSubscriptionQueryKey,
  type PlanQuote,
  type SubscriptionInputPlan,
  type SubscriptionInputBillingPeriod,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

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

const PLAN_ORDER: SubscriptionInputPlan[] = ["starter", "pro", "firm"];

const PLAN_COPY: Record<
  SubscriptionInputPlan,
  { name: string; blurb: string; features: string[] }
> = {
  starter: {
    name: "Starter",
    blurb: "A sole practitioner finding their feet.",
    features: ["5 active matters", "2 seats", "Documents and cause list", "Email support"],
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
  },
  firm: {
    name: "Firm",
    blurb: "Multiple benches, multiple practice areas.",
    features: [
      "Unlimited matters",
      "Unlimited seats",
      "Advanced analytics",
      "Audit export",
      "Dedicated support",
    ],
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

  const current = data?.subscription;
  const canManage = data?.canManage ?? false;
  const quoteFor = (plan: SubscriptionInputPlan): PlanQuote | undefined =>
    data?.catalogue.find((q) => q.plan === plan && q.billingPeriod === period);

  const choose = (plan: SubscriptionInputPlan) => {
    setSubscription.mutate(
      { data: { plan, billingPeriod: period } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSubscriptionQueryKey() });
          toast({
            title: "Plan selected",
            description: `${PLAN_COPY[plan].name}, billed ${PERIODS.find((p) => p.value === period)?.label.toLowerCase()}.`,
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
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto rounded-none border-border bg-background p-0">
          <DialogHeader className="p-8 pb-5 border-b border-border bg-muted/30">
            <DialogTitle className="text-2xl font-mono uppercase tracking-widest text-foreground">
              Subscription
            </DialogTitle>
            <DialogDescription className="font-mono text-muted-foreground uppercase text-xs mt-2">
              {current?.status === "active"
                ? `Currently on ${PLAN_COPY[current.plan as SubscriptionInputPlan]?.name ?? current.plan}, billed ${
                    PERIODS.find((p) => p.value === current.billingPeriod)?.label.toLowerCase() ??
                    current.billingPeriod
                  }`
                : "Your chamber is on trial - choose a plan to continue"}
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
                    className={`px-4 py-2.5 font-mono uppercase text-[11px] tracking-widest border-r border-border last:border-r-0 transition-colors ${
                      active
                        ? "bg-foreground text-background"
                        : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    {p.label}
                    {p.note && (
                      <span
                        className={`block text-[9px] tracking-wider mt-0.5 ${
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
          </DialogHeader>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border">
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
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border bg-background">
              {PLAN_ORDER.map((plan) => {
                const q = quoteFor(plan);
                const copy = PLAN_COPY[plan];
                const isCurrent =
                  current?.status === "active" &&
                  current.plan === plan &&
                  current.billingPeriod === period;
                const featured = plan === "pro";

                return (
                  <div
                    key={plan}
                    className={`p-8 flex flex-col relative ${
                      featured ? "bg-muted/40" : "hover:bg-muted/10 transition-colors"
                    }`}
                  >
                    {isCurrent && (
                      <div className="absolute top-0 right-0 bg-foreground text-background text-[10px] font-bold font-mono uppercase tracking-widest px-3 py-1">
                        Current plan
                      </div>
                    )}

                    <h3 className="font-mono uppercase tracking-wider font-bold text-foreground">
                      {copy.name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 mb-4">{copy.blurb}</p>

                    <div className="mb-1">
                      <span className="text-3xl font-mono text-foreground tabular-nums">
                        {q ? rupees(q.effectiveMonthlyMinor) : "-"}
                      </span>
                      <span className="text-sm text-muted-foreground">/mo</span>
                    </div>

                    {/* The real commitment, stated plainly under the headline rate. */}
                    <p className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider min-h-[2.5rem]">
                      {q && q.months > 1 ? (
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
                      className="w-full rounded-none font-mono uppercase tracking-wider"
                      disabled={!canManage || isCurrent || setSubscription.isPending}
                      onClick={() => choose(plan)}
                    >
                      {isCurrent ? "Selected" : setSubscription.isPending ? "Saving..." : "Choose"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="px-8 py-4 border-t border-border bg-muted/30 flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <p>
              {canManage
                ? "Choosing a plan records it against your chamber. No payment provider is connected to this deployment yet, so nothing is charged."
                : "Only a chamber owner or Firm Admin can change the plan. You are seeing the plan your chamber is on."}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </PricingModalContext.Provider>
  );
}
