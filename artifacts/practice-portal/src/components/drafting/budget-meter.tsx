import { useGetAiBudget, getGetAiBudgetQueryKey } from "@workspace/api-client-react";
import { formatMinor } from "@/lib/format";
import { Progress } from "@/components/ui/progress";
import { usePricingModal } from "@/components/pricing-modal";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

/**
 * What is left of the chamber's drafting budget, shown all month.
 *
 * The limit is hard: a draft that would exceed it is refused before anything is
 * spent. A hard limit nobody could see coming is an outage — the same limit
 * with a meter beside it is a budget, and the difference is entirely this
 * component. It is therefore on every screen that can spend, not tucked into
 * settings.
 *
 * **Shown in tokens, billed in rupees.** "₹40 left" says nothing about
 * whether that is one more petition or ten; a token count is the unit the
 * model actually consumes and the one a chamber can plan against. The money
 * is still the money — paise is what is stored, spent and invoiced — so the
 * rupee figure stays beside it in the detail line rather than disappearing.
 * The conversion is a server-side estimate at a 3 input : 1 output blend on
 * the tier's model; see `tokensForMinor` in lib/ai/models.ts for why it is an
 * estimate and not a rate.
 */

/**
 * Tokens, in the shape a person reads rather than the shape a machine stores.
 *
 * 237,000 is noise at a glance; "237k" is a quantity. Below ten thousand the
 * exact figure matters more than the shape of it — that is the range where a
 * chamber is deciding whether one more draft will fit — so it is grouped and
 * printed in full.
 */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString("en-IN");
}
export function BudgetMeter({ compact = false }: { compact?: boolean }) {
  const { data } = useGetAiBudget({ query: { queryKey: getGetAiBudgetQueryKey() } });
  const { setOpen } = usePricingModal();
  const { can } = useSession();
  if (!data) return null;

  /*
   * The chamber has not switched drafting on.
   *
   * A meter showing a full budget on a feature that refuses every request is
   * worse than no meter: it says the money is there and nothing explains why
   * the button does not work. `draftingEnabled` was already in this payload
   * and was being ignored, which is exactly how the off state went unnoticed.
   */
  if (!data.draftingEnabled && !compact) {
    return (
      <div className="flex flex-col gap-3 rounded-[var(--radius)] bg-secondary p-3 text-secondary-foreground shadow-[var(--raise)] sm:flex-row sm:items-center">
        <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="flex-1 text-sm font-medium">
          AI drafting is not switched on for this chamber.{" "}
          {can("access_control.manage")
            ? "Switch it on from the plan screen, after reading what is sent and to whom."
            : "An admin can switch it on from the plan screen."}
        </p>
        {can("access_control.manage") && (
          <Button
            variant="outline"
            size="sm"
            className="w-full shrink-0 font-mono uppercase tracking-wider sm:w-auto"
            onClick={() => setOpen(true)}
          >
            Switch it on
          </Button>
        )}
      </div>
    );
  }

  // The PERCENTAGE is computed from paise, not from the rounded tokens: the
  // bar has to agree with the limit that actually refuses a draft, and the
  // token figures are an estimate that rounds.
  const total = data.allowanceMinor + data.topupMinor;
  const used = total > 0 ? Math.min(100, Math.round((data.spentMinor / total) * 100)) : 100;
  const empty = data.remainingMinor <= 0;
  const totalTokens = data.allowanceTokens + data.topupTokens;

  if (compact) {
    return (
      <span
        className={`font-mono text-2xs uppercase tracking-wider ${
          empty ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {formatTokens(data.remainingTokens)} tokens left
      </span>
    );
  }

  return (
    <div className="rounded-lg bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
          Drafting budget
        </p>
        <p className={`text-sm font-medium ${empty ? "text-destructive" : ""}`}>
          about {formatTokens(data.remainingTokens)} tokens left
        </p>
      </div>

      <Progress value={used} className="mt-2 h-1.5" />

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted-foreground">
        <span>
          {formatTokens(data.spentTokens)} of {formatTokens(totalTokens)} used
        </span>
        {/* The money, kept in sight. A chamber is billed in rupees and tops up
            in rupees, so the unit it pays in should not vanish behind the one
            it plans in. */}
        <span>{formatMinor(data.remainingMinor)} of budget</span>
        {data.topupMinor > 0 && <span>includes {formatTokens(data.topupTokens)} topped up</span>}
        {data.resetsAt && <span>resets {new Date(data.resetsAt).toLocaleDateString()}</span>}
        {/* The trial routes every document to the lighter model. Said here
            rather than left to be inferred from output that reads thinner. */}
        {data.tier === "economy" && <span>trial tier — shorter model</span>}
      </div>

      {empty && (
        <p className="mt-2 text-2xs leading-relaxed text-destructive">
          Drafting is paused until the budget resets. An admin or senior advocate can add more from
          the plan screen.
        </p>
      )}

      {/* Without an API key every draft is served by a local stand-in. Saying so
          costs one line and saves somebody an afternoon wondering why the
          output reads like a placeholder — because it is one. */}
      {data.configured === false && (
        <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">
          No AI provider is configured on this deployment, so drafts are produced by a built-in
          stand-in rather than by a model.
        </p>
      )}
    </div>
  );
}
