import {
  useGetSubscription,
  getGetSubscriptionQueryKey,
  type Subscription,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useNoticeSlot } from "@/lib/notice-slot";
import { usePricingModal } from "@/components/pricing-modal";
import { AlertTriangle, Info } from "lucide-react";

/**
 * What the chamber's plan is doing, said once, at the top of the dashboard.
 *
 * This replaces a hardcoded "1-Month Free Trial Active — Upgrade Now" that read
 * no subscription data at all. It was wrong twice over — the trial runs two
 * months and costs Rs 99, so it is neither one month nor free — and it rendered
 * forever, including for chambers paying for the Firm plan.
 *
 * Two decisions worth keeping:
 *
 * A healthy plan renders NOTHING. A banner that is always there is furniture,
 * and furniture is not read; the lapsed and unpaid states are only legible
 * because the ordinary state is silent. The one exception is a renewal inside
 * a fortnight, which is a thing somebody has to act on.
 *
 * It renders for EVERYONE, not just `billing.manage`. A junior advocate who
 * cannot save a file needs to know the chamber's plan lapsed — being unable to
 * work with no explanation is the worse failure. Only the button is gated, so
 * they are told what is wrong without being handed a control they cannot use.
 */

/** Days out from renewal at which a healthy plan starts saying so. */
const RENEWAL_NOTICE_DAYS = 14;

const PLAN_NAMES: Record<string, string> = {
  trial: "Trial",
  pro: "Pro",
  firm: "Firm",
  custom: "Custom",
};

type BannerState = {
  tone: "info" | "warning";
  message: string;
  cta: string;
};

/**
 * The subscription reduced to at most one sentence.
 *
 * Returns null for every state nobody needs to act on. `lapsed` and `daysLeft`
 * are read from the payload rather than derived from `currentPeriodEnd` here:
 * the server computes them against the clock enforcement actually uses, and a
 * browser with a skewed clock would otherwise contradict the 402 it is about
 * to receive.
 */
function bannerFor(sub: Subscription | undefined): BannerState | null {
  if (!sub) return null;

  const planName = PLAN_NAMES[sub.plan] ?? sub.plan;
  const ended = sub.currentPeriodEnd
    ? new Date(sub.currentPeriodEnd).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  if (sub.lapsed) {
    return {
      tone: "warning",
      message:
        sub.plan === "trial"
          ? `Your two-month trial ended ${ended}. Records stay readable; new entries need a plan.`
          : `Your ${planName} plan lapsed ${ended}. Records stay readable; renew to make new entries.`,
      cta: sub.plan === "trial" ? "Choose a plan" : "Renew",
    };
  }

  if (sub.status === "pending_payment") {
    return {
      tone: "warning",
      message: `${planName} selected — payment not completed. Your chamber is on the trial allowance until it clears.`,
      cta: "Complete payment",
    };
  }

  // A custom enquiry sits at `trialing` deliberately — it is a request for a
  // quote, not a plan in force — so it must not be mistaken for "no plan".
  if (sub.status === "trialing" && sub.plan === "custom") {
    return {
      tone: "info",
      message:
        "Your custom quote is with our team. Your current allowance is unchanged until it is agreed.",
      cta: "See plans",
    };
  }

  if (sub.status === "trialing") {
    return {
      tone: "info",
      message: "No plan in force — ₹99 buys two months of everything.",
      cta: "Choose a plan",
    };
  }

  if (sub.status === "active") {
    const left = sub.daysLeft;
    if (sub.plan === "trial") {
      return {
        tone: "info",
        message:
          left === null
            ? "Paid trial active."
            : `Paid trial active — ${left} ${left === 1 ? "day" : "days"} left of your two months.`,
        cta: "Upgrade",
      };
    }
    // A paid plan in good standing says nothing until renewal is close enough
    // to be worth planning around.
    if (left !== null && left !== undefined && left <= RENEWAL_NOTICE_DAYS) {
      return {
        tone: "info",
        message: `Your ${planName} plan renews in ${left} ${left === 1 ? "day" : "days"}.`,
        cta: "Manage",
      };
    }
    return null;
  }

  if (sub.status === "past_due" || sub.status === "cancelled") {
    return {
      tone: "warning",
      message: `Your ${planName} plan is ${sub.status === "past_due" ? "past due" : "cancelled"}. Records stay readable; new entries need a plan.`,
      cta: sub.status === "past_due" ? "Complete payment" : "Choose a plan",
    };
  }

  return null;
}

export function PlanBanner({ canManage }: { canManage: boolean }) {
  const { setOpen } = usePricingModal();
  const { data } = useGetSubscription({ query: { queryKey: getGetSubscriptionQueryKey() } });

  const state = bannerFor(data?.subscription);
  const show = useNoticeSlot("plan", state !== null);
  if (!show || !state) return null;

  const warning = state.tone === "warning";
  const Icon = warning ? AlertTriangle : Info;

  return (
    <div
      // `role="status"` rather than `alert`: this is a standing condition a
      // screen reader should mention in turn, not an interruption.
      role="status"
      className={`flex flex-col gap-3 rounded-[var(--radius)] p-3 shadow-[var(--raise)] sm:flex-row sm:items-center ${
        warning ? "bg-warning text-warning-foreground" : "bg-secondary text-secondary-foreground"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="flex-1 text-sm font-medium">{state.message}</p>
      {canManage && (
        <Button
          variant={warning ? "default" : "outline"}
          size="sm"
          className="w-full shrink-0 font-mono uppercase tracking-wider sm:w-auto"
          onClick={() => setOpen(true)}
        >
          {state.cta}
        </Button>
      )}
    </div>
  );
}
