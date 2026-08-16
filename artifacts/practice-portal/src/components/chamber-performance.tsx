import { useMemo, useState } from "react";
import {
  useGetChamberPerformance,
  getGetChamberPerformanceQueryKey,
  type MetricValue,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, ArrowUp, ArrowDown, Minus, Clock } from "lucide-react";
import { formatMinutes } from "@/lib/format";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

const RANGES = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "12 months", days: 365 },
] as const;

/**
 * Every metric states what it measures.
 *
 * "Average handling time" means nothing until it says what it averages, over
 * what, counted from when. These are the definitions, next to the number.
 */
const DEFINITIONS: Record<string, string> = {
  cycle:
    "The median number of days from a matter being filed to it being closed, counting only matters CLOSED inside the selected period. Median, not mean — one matter that sat for three years would drag an average somewhere no real matter lives.",
  firstAction:
    "The median hours between a matter being opened and the first thing that happened on it that was not its own creation. Counted for matters OPENED inside the selected period.",
  ageing:
    "How old the matters currently open are, measured from their filing date to today. Not affected by the selected period — this is a question about the desk right now.",
  overdue:
    "Open matters carrying a hearing or deadline date that has already passed. Counted from the master calendar.",
  totalHours:
    "Hours logged against matters with a work date inside the selected period, from manual entries and stopped timers. Running timers are not counted until stopped.",
  perCase:
    "Hours logged in the period divided by the number of matters currently open. A rough load indicator, not a per-matter total.",
  billable:
    "The share of logged hours marked chargeable when they were entered. It reflects how time was tagged, not what was invoiced.",
  category:
    "Hours split by the matter's priority. The schema has no separate matter-type field, so priority is the only category a matter carries.",
  member:
    "Hours logged per person in the period. Visible to chamber admins only — this page requires the kpi.read capability, which no other role holds.",
};

function Define({ id }: { id: keyof typeof DEFINITIONS | string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="What this measures"
          className="text-muted-foreground hover:text-foreground transition-colors rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs leading-relaxed">{DEFINITIONS[id]}</TooltipContent>
    </Tooltip>
  );
}

/** Direction of travel against the previous window of equal length. */
function Delta({
  current,
  previous,
  lowerIsBetter,
}: {
  current: number | null;
  previous: number | null;
  lowerIsBetter?: boolean;
}) {
  if (current === null || previous === null || previous === 0) {
    return <span className="text-2xs font-mono text-muted-foreground">no comparison</span>;
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) {
    return (
      <span className="text-2xs font-mono text-muted-foreground flex items-center gap-1">
        <Minus className="h-3 w-3" /> unchanged
      </span>
    );
  }
  const up = pct > 0;
  const good = lowerIsBetter ? !up : up;
  return (
    <span
      className={`text-2xs font-mono flex items-center gap-1 ${good ? "text-success-foreground" : "text-warning-foreground"}`}
    >
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(pct)}% vs previous
    </span>
  );
}

/** A metric that refuses to draw itself when there is too little behind it. */
function Metric({
  label,
  definitionId,
  metric,
  render,
  lowerIsBetter,
  minimumSample,
}: {
  label: string;
  definitionId: string;
  metric: MetricValue;
  render: (value: number) => string;
  lowerIsBetter?: boolean;
  minimumSample: number;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase font-mono tracking-wider flex items-center gap-2">
          {label} <Define id={definitionId} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!metric.enoughData ? (
          <>
            <div className="text-lg font-semibold tracking-tight text-muted-foreground">
              Not enough data yet
            </div>
            <p className="text-2xs text-muted-foreground mt-1 leading-relaxed">
              {metric.sampleSize} of {minimumSample} data points needed. A figure drawn through
              fewer would not mean anything.
            </p>
          </>
        ) : (
          <>
            <div className="text-3xl font-bold tracking-tighter">
              {render(metric.value as number)}
            </div>
            <div className="mt-1">
              <Delta
                current={metric.value ?? null}
                previous={metric.previous ?? null}
                lowerIsBetter={lowerIsBetter}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Chamber performance on time and effort.
 *
 * Rendered only inside the KPI page, which is gated on `kpi.read` — a capability
 * held by admin alone. That is why the per-member breakdown can appear here
 * without a second check: there is no role that reaches this page and should not
 * see it. If `kpi.read` is ever widened, the member table needs its own gate.
 */
export function ChamberPerformance() {
  const [days, setDays] = useState<number>(30);
  const range = useMemo(() => ({ from: daysAgo(days), to: iso(new Date()) }), [days]);

  const { data, isLoading } = useGetChamberPerformance(range, {
    query: { queryKey: getGetChamberPerformanceQueryKey(range) },
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (!data) return null;

  const billableShare =
    data.billableMinutes + data.nonBillableMinutes > 0
      ? Math.round((data.billableMinutes / (data.billableMinutes + data.nonBillableMinutes)) * 100)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold tracking-tight">Chamber performance</h3>
          <p className="text-2xs font-mono uppercase tracking-wider text-muted-foreground mt-1">
            {data.from} to {data.to} &middot; compared with {data.comparisonFrom} to{" "}
            {data.comparisonTo}
          </p>
        </div>
        <div className="flex gap-2">
          {RANGES.map((r) => (
            <Button
              key={r.days}
              size="sm"
              variant={days === r.days ? "default" : "outline"}
              className="rounded-lg"
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      {/* ---- time ---- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric
          label="Median cycle time"
          definitionId="cycle"
          metric={data.medianCycleTimeDays}
          minimumSample={data.minimumSample}
          lowerIsBetter
          render={(v) => `${Math.round(v)} days`}
        />
        <Metric
          label="Time to first action"
          definitionId="firstAction"
          metric={data.medianTimeToFirstActionHours}
          minimumSample={data.minimumSample}
          lowerIsBetter
          render={(v) => (v < 48 ? `${Math.round(v)} hrs` : `${Math.round(v / 24)} days`)}
        />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase font-mono tracking-wider flex items-center gap-2">
              Past-date hearings <Define id="overdue" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-3xl font-bold tracking-tighter ${data.overdueHearings > 0 ? "text-destructive" : ""}`}
            >
              {data.overdueHearings}
            </div>
            <p className="text-2xs text-muted-foreground mt-1">on open matters</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase font-mono tracking-wider flex items-center gap-2">
              Open matters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tighter">{data.openCases}</div>
          </CardContent>
        </Card>
      </div>

      {/* ---- ageing ---- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase font-mono tracking-wider flex items-center gap-2">
            Ageing of open matters <Define id="ageing" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.openCases === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing open to age.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {data.ageingBuckets.map((b) => (
                <div
                  key={b.bucket}
                  className="rounded-lg bg-background shadow-[var(--press-sm)] p-3"
                >
                  <div className="text-2xl font-bold tracking-tighter">{b.count}</div>
                  <div className="text-3xs font-mono uppercase tracking-wider text-muted-foreground mt-1">
                    {b.bucket} days
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- effort ---- */}
      {!data.hasAnyTimeLogged ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No time has been logged yet</p>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed max-w-md mx-auto">
              Effort figures are built only from hours recorded against matters — nothing here is
              inferred from task counts. Open a matter, use the Time tab, and this fills in.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Metric
              label="Hours logged"
              definitionId="totalHours"
              metric={data.totalMinutes}
              minimumSample={data.minimumSample}
              render={(v) => formatMinutes(v)}
            />
            <Metric
              label="Hours per open matter"
              definitionId="perCase"
              metric={data.minutesPerOpenCase}
              minimumSample={data.minimumSample}
              render={(v) => formatMinutes(v)}
            />
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase font-mono tracking-wider flex items-center gap-2">
                  Billable share <Define id="billable" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                {billableShare === null ? (
                  <div className="text-lg font-semibold text-muted-foreground">No hours yet</div>
                ) : (
                  <>
                    <div className="text-3xl font-bold tracking-tighter">{billableShare}%</div>
                    <p className="text-2xs text-muted-foreground mt-1">
                      {formatMinutes(data.billableMinutes)} billable &middot;{" "}
                      {formatMinutes(data.nonBillableMinutes)} not
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase font-mono tracking-wider flex items-center gap-2">
                  Hours by matter priority <Define id="category" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.byCategory.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hours in this period.</p>
                ) : (
                  <ul className="space-y-2">
                    {data.byCategory.map((c) => (
                      <li key={c.category} className="flex justify-between text-sm">
                        <span className="capitalize">{c.category}</span>
                        <span className="font-mono">{formatMinutes(c.minutes)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase font-mono tracking-wider flex items-center gap-2">
                  Hours by member <Define id="member" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.byMember.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hours in this period.</p>
                ) : (
                  <ul className="space-y-2">
                    {data.byMember.map((m) => (
                      <li key={m.userId} className="flex justify-between text-sm gap-3">
                        <span className="truncate">{m.userName || "—"}</span>
                        <span className="font-mono shrink-0">
                          {formatMinutes(m.minutes)}
                          <span className="text-muted-foreground">
                            {" "}
                            ({formatMinutes(m.billableMinutes)} billable)
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-3xs text-muted-foreground mt-4 leading-relaxed">
                  Admin only. No other role can reach this page.
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
