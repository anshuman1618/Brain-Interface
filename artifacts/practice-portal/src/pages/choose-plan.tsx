import { Building2, Check, Info, LogOut, Loader2, Truck, ShieldCheck } from "lucide-react";
import { useGetSubscription, getGetSubscriptionQueryKey } from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { usePricingModal } from "@/components/pricing-modal";

/**
 * The subscription screen, shown once, just after a chamber is set up.
 *
 * ── Why a screen and not a banner ────────────────────────────────────────
 *
 * A chamber that has never taken a plan can read its own shell and nothing
 * else — `planState.neverPaid`, enforced in `requireCapability`. Left on the
 * dashboard, a founder in that state meets a grid of empty modules and a 402
 * on the first thing they click, with the explanation folded into a toast. So
 * the state gets its own screen, and the screen says what to do about it.
 *
 * ── The chamber is never locked, only its features ───────────────────────
 *
 * Nothing here signs anybody out and nothing here is a wall. The chamber
 * exists, the account exists, and "Skip for now" goes to the dashboard, where
 * the plan banner keeps the offer standing. A payment that fails — a declined
 * card, a bank that times out, a person who closes the widget — leaves them
 * inside the product with a button to try again, not outside it with a support
 * ticket. That is the whole reason the gate is on capabilities rather than on
 * the door.
 *
 * ── Two audiences ────────────────────────────────────────────────────────
 *
 * Whoever holds `billing.manage` gets the plans. Everybody else gets told what
 * is happening and who can fix it, because "nothing works and nobody said why"
 * is the worse failure — the same reasoning as `PlanBanner`, which renders for
 * every role and gates only its button.
 */

/** What ninety-nine rupees actually buys, stated before anyone is asked to pay. */
const TRIAL_POINTS = [
  "Two months of every module",
  "10 open matters, 5 seats",
  "Cause lists, invoicing, the client portal",
  "AI drafting on a Rs 40 allowance",
];

const PLAN_LABEL: Record<string, string> = {
  trial: "Trial",
  pro: "Pro",
  firm: "Firm",
  custom: "Custom",
};

export default function ChoosePlanPage({ onSkip }: { onSkip?: () => void }) {
  const { displayName, email, activeWorkspace, signOut, can } = useSession();
  const { setOpen } = usePricingModal();
  const canManage = can("billing.manage");

  const { data, isLoading } = useGetSubscription({
    query: { queryKey: getGetSubscriptionQueryKey() },
  });

  const sub = data?.subscription;
  // The trial's price comes from the server's own catalogue, not from a
  // constant here — the number on this screen and the number Razorpay charges
  // have to be the same one, and a hardcoded "Rs 99" is how they stop being.
  const trialQuote = data?.catalogue.find((q) => q.plan === "trial");
  const trialPrice = trialQuote
    ? new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(trialQuote.amountMinor / 100)
    : "₹99";

  if (isLoading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-y-auto bg-background px-4 py-12 text-foreground">
      <div className="fixed inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSJub25lIiAvPgo8cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJjdXJyZW50Q29sb3IiIG9wYWNpdHk9IjAuMDUiIC8+Cjwvc3ZnPg==')] pointer-events-none opacity-[0.4]" />

      <div className="relative z-10 w-full max-w-2xl">
        <div className="mb-6 inline-flex items-center gap-2 rounded-lg bg-card px-3 py-1 shadow-sm">
          <Building2 className="h-3.5 w-3.5 text-primary" />
          <span className="font-mono text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            {activeWorkspace?.name ?? "Your chamber"}
          </span>
        </div>

        {canManage ? (
          <>
            <h1 className="mb-2 text-3xl font-bold tracking-tight">
              Your chamber is ready. Choose how it runs.
            </h1>
            <p className="mb-8 leading-relaxed text-muted-foreground">
              Signed in as{" "}
              <span className="font-medium text-foreground">{displayName || email}</span>. The
              chamber itself stays yours whatever you decide — a plan is what opens matters,
              drafting and invoicing inside it.
            </p>

            {/* `pending_payment` is its own sentence. A founder who reached the
                card form and did not finish has already tried once, and telling
                them to "choose a plan" reads as though nothing happened. */}
            {sub?.status === "pending_payment" && (
              <div className="mb-6 flex items-start gap-2 rounded-[var(--radius)] bg-warning p-3 text-warning-foreground shadow-[var(--raise)]">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p className="text-sm">
                  {PLAN_LABEL[sub.plan] ?? sub.plan} is selected and the payment has not come
                  through yet. Nothing was lost — open the plans and finish it, or pick a different
                  one.
                </p>
              </div>
            )}

            <div className="rounded-lg bg-card p-6 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-mono uppercase tracking-wider">Start on the two-month Trial</h2>
                <span className="font-mono text-2xl tabular-nums text-foreground">
                  {trialPrice}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Once, not a subscription. One trial per chamber, and one per person.
              </p>

              <ul className="my-5 space-y-2 text-sm text-muted-foreground">
                {TRIAL_POINTS.map((p) => (
                  <li key={p} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    {p}
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap gap-2">
                <Button className="rounded-lg px-8" onClick={() => setOpen(true)}>
                  See the plans and pay
                </Button>
                {onSkip && (
                  <Button variant="outline" className="rounded-lg" onClick={onSkip}>
                    Skip for now
                  </Button>
                )}
              </div>

              <p className="mt-4 flex items-start gap-2 text-2xs text-muted-foreground">
                <Truck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Moving from a spreadsheet or another system? The plans screen has a migration
                enquiry — it is a conversation, not a charge.
              </p>
            </div>

            <p className="mt-6 flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Payment is taken by Razorpay in a window on this page. Card details never reach our
              servers, and the plan comes into force when the payment is confirmed — if a payment
              fails you stay signed in, on this screen, and can try again.
            </p>
          </>
        ) : (
          <>
            <h1 className="mb-2 text-3xl font-bold tracking-tight">
              This chamber has not started a plan yet
            </h1>
            <p className="mb-8 leading-relaxed text-muted-foreground">
              Signed in as{" "}
              <span className="font-medium text-foreground">{displayName || email}</span>. You are
              an active member — nothing is wrong with your account. Matters, drafting and invoicing
              open up once the chamber&rsquo;s owner or Firm Admin chooses a plan.
            </p>
            <div className="flex items-start gap-3 rounded-lg bg-card p-6 shadow-sm">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                Ask whoever set up {activeWorkspace?.name ?? "the chamber"} to open the plan screen.
                It takes a minute and everything you can see now stays as it is.
              </p>
            </div>
            {onSkip && (
              <Button variant="outline" className="mt-6 rounded-lg" onClick={onSkip}>
                Continue anyway
              </Button>
            )}
          </>
        )}

        <button
          type="button"
          onClick={() => signOut()}
          className="mt-8 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>
    </div>
  );
}
