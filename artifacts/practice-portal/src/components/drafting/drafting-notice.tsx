import { Link } from "wouter";
import { useGetAiBudget, getGetAiBudgetQueryKey } from "@workspace/api-client-react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePricingModal } from "@/components/pricing-modal";
import { useSession } from "@/lib/session";

/**
 * AI drafting exists and is switched off — said on the dashboard.
 *
 * ── Why this is not just a nav item ──────────────────────────────────────
 *
 * The feature was reachable in principle: a "Draft a Document" tile among nine
 * quick actions, and two entries behind the three-dot navigation menu. In
 * practice a chamber admin looked at the dashboard, saw nothing that said AI,
 * and concluded it had not shipped — which is a fair reading of a screen that
 * mentions it nowhere.
 *
 * The off state is the moment worth spending a banner on. Once drafting is on
 * this renders nothing and the tile is enough, the same discipline as
 * `PlanBanner`: a notice that is always there is furniture, and furniture is
 * not read.
 *
 * Everyone who could use drafting sees it, not only admins — being unable to
 * find a feature nobody told you was off is the worse failure. Only the button
 * is gated, so a junior is told what is happening and who can change it.
 */
export function DraftingNotice() {
  const { setOpen } = usePricingModal();
  const { can } = useSession();

  // Not requested for anyone who could not use drafting anyway — a clerk or a
  // client would be shown a switch that is none of their business.
  const mayDraft = can("drafting.use");
  const { data } = useGetAiBudget({
    query: { queryKey: getGetAiBudgetQueryKey(), enabled: mayDraft },
  });

  if (!mayDraft || !data || data.draftingEnabled) return null;

  const canManage = can("access_control.manage");

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-[var(--radius)] bg-secondary p-3 text-secondary-foreground shadow-[var(--raise)] sm:flex-row sm:items-center"
    >
      <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="flex-1 text-sm font-medium">
        AI drafting is available on this plan and is switched off.{" "}
        {canManage
          ? "Turn it on to draft petitions and applications from this chamber’s own records, and to be briefed on a matter before it is filed."
          : "An admin can switch it on."}
      </p>
      {canManage ? (
        <Button
          variant="outline"
          size="sm"
          className="w-full shrink-0 font-mono uppercase tracking-wider sm:w-auto"
          onClick={() => setOpen(true)}
        >
          Switch it on
        </Button>
      ) : (
        <Link
          href="/drafting"
          className="shrink-0 font-mono text-xs uppercase tracking-wider underline underline-offset-4"
        >
          See what it does
        </Link>
      )}
    </div>
  );
}
