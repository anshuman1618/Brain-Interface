import { useGetAiBudget, getGetAiBudgetQueryKey } from "@workspace/api-client-react";
import { formatMinor } from "@/lib/format";
import { Progress } from "@/components/ui/progress";

/**
 * What is left of the chamber's drafting budget, shown all month.
 *
 * The limit is hard: a draft that would exceed it is refused before anything is
 * spent. A hard limit nobody could see coming is an outage — the same limit
 * with a meter beside it is a budget, and the difference is entirely this
 * component. It is therefore on every screen that can spend, not tucked into
 * settings.
 *
 * Amounts come from the server in integer paise and are rendered by
 * `formatMinor`, the one place in the frontend that turns either unit into
 * text.
 */
export function BudgetMeter({ compact = false }: { compact?: boolean }) {
  const { data } = useGetAiBudget({ query: { queryKey: getGetAiBudgetQueryKey() } });
  if (!data) return null;

  const total = data.allowanceMinor + data.topupMinor;
  const used = total > 0 ? Math.min(100, Math.round((data.spentMinor / total) * 100)) : 100;
  const empty = data.remainingMinor <= 0;

  if (compact) {
    return (
      <span
        className={`font-mono text-2xs uppercase tracking-wider ${
          empty ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {formatMinor(data.remainingMinor)} drafting left
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
          {formatMinor(data.remainingMinor)} left
        </p>
      </div>

      <Progress value={used} className="mt-2 h-1.5" />

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted-foreground">
        <span>
          {formatMinor(data.spentMinor)} of {formatMinor(total)} used
        </span>
        {data.topupMinor > 0 && <span>includes {formatMinor(data.topupMinor)} topped up</span>}
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
