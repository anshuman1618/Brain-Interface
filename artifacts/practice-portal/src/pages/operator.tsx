import {
  useGetOperatorMetrics,
  getGetOperatorMetricsQueryKey,
  type OperatorMetrics,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { AdaptiveTable } from "@/components/ui/adaptive-table";
import { formatMinor } from "@/lib/format";

/**
 * The platform, from outside every chamber.
 *
 * Reachable by URL only — deliberately absent from the navigation, because the
 * nav is built from capabilities and this screen is not a capability. The
 * control is the server: `/operator/metrics` answers 404 to anyone not on the
 * `OPERATOR_EMAILS` allowlist, and 404 again when no allowlist is configured.
 * Leaving it out of the menu is tidiness, not the lock.
 *
 * Everything here is a count. No matter titles, no client names, no email
 * addresses — see `routes/operator.ts` for why that boundary is drawn where it
 * is, and note that it is drawn in the SQL rather than trusted to this file.
 */

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg bg-card p-4 shadow-sm">
      <p className="font-mono text-3xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-2xs leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
          {title}
        </h3>
        {note && <p className="mt-1 max-w-3xl text-2xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

export default function OperatorPage() {
  const { data, isLoading, isError } = useGetOperatorMetrics({
    query: { queryKey: getGetOperatorMetricsQueryKey(), retry: false },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // A 404 is the ordinary answer for anyone who is not an operator, so this is
  // the common case rather than an error state — say so plainly and give away
  // nothing about what the page would have shown.
  if (isError || !data) {
    return (
      <div className="rounded-lg bg-card p-10 text-center shadow-sm">
        <p className="text-sm font-medium">Not available</p>
        <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
          This view is limited to whoever operates the platform.
        </p>
      </div>
    );
  }

  const m: OperatorMetrics = data;
  const peakSignups = Math.max(1, ...m.signups.map((s) => s.chambers));

  return (
    <div className="animate-in space-y-8 fade-in duration-500">
      <div>
        <h2 className="mb-1 text-3xl font-bold tracking-tight">Platform</h2>
        <p className="text-muted-foreground">
          Every chamber, counted. Read at {new Date(m.generatedAt).toLocaleString()}.
        </p>
      </div>

      <Section
        title="People"
        note="“Not seen yet” counts anyone who has not made a request since activity recording shipped. It is not the same as never having signed in — the column has no backfill and cannot honestly have one."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Registered" value={m.users.total} />
          <Stat label="Active today" value={m.users.seen24h} />
          <Stat label="Active this week" value={m.users.seen7d} />
          <Stat label="Active this month" value={m.users.seen30d} />
          <Stat
            label="Returning"
            value={m.users.returning}
            hint="Joined over a week ago, back within the week"
          />
          <Stat
            label="Gone quiet"
            value={m.users.lapsed}
            hint="Joined over a week ago, not seen since"
          />
        </div>
      </Section>

      <Section title="Chambers">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total" value={m.chambers.total} />
          <Stat label="With a matter" value={m.chambers.withMatters} />
          <Stat label="Never used" value={m.chambers.empty} hint="Founded, no matter ever opened" />
          <Stat label="Not seen yet" value={m.users.neverSeen} hint="People, not chambers" />
        </div>
      </Section>

      <Section
        title="The ₹99 trial"
        note="Bought once per chamber — trial_used_at is what makes this answerable rather than guessed."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Bought" value={m.trial.bought} />
          <Stat label="Still running" value={m.trial.stillInTrial} />
          <Stat label="Converted" value={m.trial.converted} hint="Now on another plan" />
          <Stat
            label="Expired, no plan"
            value={m.trial.expiredUnconverted}
            hint="Tried it and stopped"
          />
        </div>
      </Section>

      <Section title="Money">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Last 30 days" value={formatMinor(m.revenue.last30dMinor)} />
          <Stat label="All time" value={formatMinor(m.revenue.allTimeMinor)} />
          <Stat label="Payments taken" value={m.revenue.payments} />
        </div>
      </Section>

      {m.signups.length > 0 && (
        <Section title="Chambers founded, by week">
          <div className="rounded-lg bg-card p-4 shadow-sm">
            <ul className="space-y-1.5">
              {m.signups.map((s) => (
                <li key={s.week} className="flex items-center gap-3 text-2xs">
                  <span className="w-20 shrink-0 font-mono text-muted-foreground">{s.week}</span>
                  <span
                    className="h-3 rounded-sm bg-foreground/80"
                    style={{ width: `${(s.chambers / peakSignups) * 100}%`, minWidth: "0.5rem" }}
                  />
                  <span className="tabular-nums font-medium">{s.chambers}</span>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      )}

      {m.plans.length > 0 && (
        <Section title="Plans in force">
          <div className="flex flex-wrap gap-2">
            {m.plans.map((p) => (
              <div key={`${p.plan}-${p.status}`} className="rounded-lg bg-card px-3 py-2 shadow-sm">
                <span className="font-mono text-3xs uppercase tracking-wider text-muted-foreground">
                  {p.plan} · {p.status}
                </span>
                <span className="ml-2 text-sm font-bold tabular-nums">{p.chambers}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Chambers, newest first"
        note="Counts and plan state only. Nothing about what is inside a matter reaches this table."
      >
        <div className="rounded-lg bg-card shadow-sm overflow-hidden">
          <AdaptiveTable
            label="Chambers"
            rows={m.chamberRows}
            rowKey={(c) => c.id}
            columns={[
              {
                key: "name",
                header: (
                  <span className="font-mono text-3xs uppercase tracking-wider">Chamber</span>
                ),
                card: "title",
                cellClassName: "p-3 font-medium",
                cell: (c) => c.name,
              },
              {
                key: "plan",
                header: <span className="font-mono text-3xs uppercase tracking-wider">Plan</span>,
                card: "subtitle",
                cellClassName: "p-3 font-mono text-muted-foreground",
                cell: (c) => (
                  <span className="font-mono text-muted-foreground">
                    {c.plan} · {c.status}
                    {c.periodEnd ? ` → ${c.periodEnd}` : ""}
                  </span>
                ),
              },
              {
                key: "founded",
                header: (
                  <span className="font-mono text-3xs uppercase tracking-wider">Founded</span>
                ),
                cellClassName: "p-3 font-mono text-muted-foreground",
                cell: (c) => <span className="font-mono text-muted-foreground">{c.createdAt}</span>,
              },
              {
                key: "seats",
                header: <span className="font-mono text-3xs uppercase tracking-wider">Seats</span>,
                headClassName: "text-right",
                cellClassName: "p-3 text-right tabular-nums",
                cell: (c) => <span className="tabular-nums">{c.seats}</span>,
              },
              {
                key: "matters",
                header: (
                  <span className="font-mono text-3xs uppercase tracking-wider">Matters</span>
                ),
                headClassName: "text-right",
                cellClassName: "p-3 text-right tabular-nums",
                cell: (c) => (
                  // Zero matters in a chamber that exists is the signal an
                  // operator is looking for, so it keeps its colour in both
                  // layouts.
                  <span className={`tabular-nums ${c.matters === 0 ? "text-destructive" : ""}`}>
                    {c.matters}
                  </span>
                ),
              },
              {
                key: "lastSeen",
                header: (
                  <span className="font-mono text-3xs uppercase tracking-wider">Last seen</span>
                ),
                cellClassName: "p-3 font-mono text-muted-foreground",
                cell: (c) => (
                  <span className="font-mono text-muted-foreground">{c.lastSeen ?? "—"}</span>
                ),
              },
            ]}
          />
        </div>
      </Section>
    </div>
  );
}
