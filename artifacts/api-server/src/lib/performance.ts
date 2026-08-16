import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * Chamber performance, aggregated in Postgres.
 *
 * Every figure here is a SQL aggregate over the requested window. Nothing pulls
 * raw rows out to be reduced in JavaScript — the existing `/kpi/summary` route
 * does exactly that (`SELECT *` then `.filter().length`), which is fine at
 * demo volume and becomes a full table scan per page load at real volume.
 *
 * Windows are half-open on the right in SQL terms but inclusive of `to` as a
 * date, because a user asking for "1st to 31st" means the 31st included.
 */

/**
 * Below this many data points a metric reports `enoughData: false` and the UI
 * declines to draw it.
 *
 * Five, because a median of four numbers is an average of the middle two and a
 * trend line through four points is decoration. This is a judgement call, not a
 * statistical result — it is surfaced in the payload so the UI can state it.
 */
export const MINIMUM_SAMPLE = 5;

export type MetricValue = {
  value: number | null;
  previous: number | null;
  sampleSize: number;
  enoughData: boolean;
};

function metric(value: number | null, previous: number | null, sampleSize: number): MetricValue {
  const enoughData = sampleSize >= MINIMUM_SAMPLE;
  return {
    value: enoughData ? value : null,
    previous: enoughData ? previous : null,
    sampleSize,
    enoughData,
  };
}

/** The window immediately before `from`, of identical length. */
export function previousWindow(from: string, to: string): { from: string; to: string } {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const prevEnd = new Date(start.getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86_400_000);
  return { from: prevStart.toISOString().slice(0, 10), to: prevEnd.toISOString().slice(0, 10) };
}

type Row = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export type ChamberPerformance = {
  from: string;
  to: string;
  comparisonFrom: string;
  comparisonTo: string;
  minimumSample: number;
  medianCycleTimeDays: MetricValue;
  medianTimeToFirstActionHours: MetricValue;
  ageingBuckets: { bucket: string; count: number }[];
  overdueHearings: number;
  totalMinutes: MetricValue;
  billableMinutes: number;
  nonBillableMinutes: number;
  minutesPerOpenCase: MetricValue;
  byCategory: { category: string; minutes: number }[];
  byMember: { userId: number; userName: string; minutes: number; billableMinutes: number }[];
  openCases: number;
  hasAnyTimeLogged: boolean;
};

export async function chamberPerformance(
  workspaceId: number,
  from: string,
  to: string,
): Promise<ChamberPerformance> {
  const prev = previousWindow(from, to);

  /**
   * Median cycle time: filing to closure, in days.
   *
   * `percentile_cont` rather than avg — the brief is explicit, and it is right:
   * one matter that sat for three years drags a mean somewhere no real matter
   * lives. Counted against the window by CLOSE date, because that is when the
   * cycle finished.
   */
  const cycle = await db.execute(sql`
    SELECT
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (closed_at - created_at)) / 86400.0
      ) FILTER (WHERE closed_at::date BETWEEN ${from} AND ${to})               AS current_median,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (closed_at - created_at)) / 86400.0
      ) FILTER (WHERE closed_at::date BETWEEN ${prev.from} AND ${prev.to})     AS previous_median,
      count(*) FILTER (WHERE closed_at::date BETWEEN ${from} AND ${to})        AS current_n
    FROM cases
    WHERE workspace_id = ${workspaceId} AND closed_at IS NOT NULL
  `);
  const cycleRow = (cycle.rows[0] ?? {}) as Row;

  /**
   * Time to first action: matter created to its first timeline event that is
   * not the creation entry itself. In hours — for a responsive chamber this is
   * well under a day and a figure in days would round to zero.
   */
  const firstAction = await db.execute(sql`
    WITH first_actions AS (
      SELECT c.id,
             c.created_at,
             MIN(te.created_at) FILTER (WHERE te.event_type <> 'case_created') AS first_at
      FROM cases c
      JOIN timeline_events te ON te.case_id = c.id
      WHERE c.workspace_id = ${workspaceId}
      GROUP BY c.id, c.created_at
    )
    SELECT
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (first_at - created_at)) / 3600.0
      ) FILTER (WHERE created_at::date BETWEEN ${from} AND ${to})           AS current_median,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (first_at - created_at)) / 3600.0
      ) FILTER (WHERE created_at::date BETWEEN ${prev.from} AND ${prev.to}) AS previous_median,
      count(*) FILTER (WHERE created_at::date BETWEEN ${from} AND ${to} AND first_at IS NOT NULL)
                                                                            AS current_n
    FROM first_actions
    WHERE first_at IS NOT NULL
  `);
  const firstRow = (firstAction.rows[0] ?? {}) as Row;

  /**
   * Ageing of matters open RIGHT NOW. Deliberately not windowed: "how old is
   * the work sitting on our desk" is a question about today, and answering it
   * for a period in the past would be a different, less useful question.
   */
  const ageing = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE age_days <= 30)                       AS b0,
      count(*) FILTER (WHERE age_days > 30 AND age_days <= 60)     AS b1,
      count(*) FILTER (WHERE age_days > 60 AND age_days <= 90)     AS b2,
      count(*) FILTER (WHERE age_days > 90)                        AS b3,
      count(*)                                                     AS open_cases
    FROM (
      SELECT EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0 AS age_days
      FROM cases
      WHERE workspace_id = ${workspaceId} AND status <> 'closed'
    ) aged
  `);
  const ageRow = (ageing.rows[0] ?? {}) as Row;

  /** Open matters carrying a hearing or deadline date that has already passed. */
  const overdue = await db.execute(sql`
    SELECT count(DISTINCT c.id) AS n
    FROM cases c
    JOIN calendar_entries ce ON ce.case_id = c.id
    WHERE c.workspace_id = ${workspaceId}
      AND c.status <> 'closed'
      AND ce.kind IN ('hearing', 'deadline')
      AND ce.entry_date < to_char(now(), 'YYYY-MM-DD')
  `);

  /** Effort: one pass over time_entries for both windows. */
  const effort = await db.execute(sql`
    SELECT
      COALESCE(SUM(minutes) FILTER (WHERE work_date BETWEEN ${from} AND ${to}), 0)           AS current_minutes,
      COALESCE(SUM(minutes) FILTER (WHERE work_date BETWEEN ${prev.from} AND ${prev.to}), 0) AS previous_minutes,
      COALESCE(SUM(minutes) FILTER (WHERE work_date BETWEEN ${from} AND ${to} AND billable), 0)     AS billable_minutes,
      COALESCE(SUM(minutes) FILTER (WHERE work_date BETWEEN ${from} AND ${to} AND NOT billable), 0) AS non_billable_minutes,
      count(*) FILTER (WHERE work_date BETWEEN ${from} AND ${to})                            AS current_n,
      count(*)                                                                               AS all_time_n
    FROM time_entries
    WHERE workspace_id = ${workspaceId} AND started_at IS NULL
  `);
  const effortRow = (effort.rows[0] ?? {}) as Row;

  /**
   * Distribution across matter categories. The schema has no `category` column,
   * so `priority` is the only categorical dimension a matter carries — named
   * honestly in the UI rather than dressed up as a matter type.
   */
  const byCategory = await db.execute(sql`
    SELECT c.priority AS category, COALESCE(SUM(te.minutes), 0) AS minutes
    FROM time_entries te
    JOIN cases c ON c.id = te.case_id
    WHERE te.workspace_id = ${workspaceId}
      AND te.started_at IS NULL
      AND te.work_date BETWEEN ${from} AND ${to}
    GROUP BY c.priority
    ORDER BY minutes DESC
  `);

  /** Per-individual effort. The endpoint serving this is admin-only. */
  const byMember = await db.execute(sql`
    SELECT user_id, MAX(user_name) AS user_name,
           COALESCE(SUM(minutes), 0) AS minutes,
           COALESCE(SUM(minutes) FILTER (WHERE billable), 0) AS billable_minutes
    FROM time_entries
    WHERE workspace_id = ${workspaceId}
      AND started_at IS NULL
      AND work_date BETWEEN ${from} AND ${to}
    GROUP BY user_id
    ORDER BY minutes DESC
  `);

  const openCases = num(ageRow["open_cases"]);
  const currentMinutes = num(effortRow["current_minutes"]);
  const previousMinutes = num(effortRow["previous_minutes"]);
  const entryCount = num(effortRow["current_n"]);

  return {
    from,
    to,
    comparisonFrom: prev.from,
    comparisonTo: prev.to,
    minimumSample: MINIMUM_SAMPLE,

    medianCycleTimeDays: metric(
      numOrNull(cycleRow["current_median"]),
      numOrNull(cycleRow["previous_median"]),
      num(cycleRow["current_n"]),
    ),
    medianTimeToFirstActionHours: metric(
      numOrNull(firstRow["current_median"]),
      numOrNull(firstRow["previous_median"]),
      num(firstRow["current_n"]),
    ),
    ageingBuckets: [
      { bucket: "0-30", count: num(ageRow["b0"]) },
      { bucket: "31-60", count: num(ageRow["b1"]) },
      { bucket: "61-90", count: num(ageRow["b2"]) },
      { bucket: "90+", count: num(ageRow["b3"]) },
    ],
    overdueHearings: num((overdue.rows[0] as Row)?.["n"]),

    totalMinutes: metric(currentMinutes, previousMinutes, entryCount),
    billableMinutes: num(effortRow["billable_minutes"]),
    nonBillableMinutes: num(effortRow["non_billable_minutes"]),
    // Guarded: a chamber with hours logged and no open matters would divide by
    // zero, which reads as Infinity on the page.
    minutesPerOpenCase: metric(
      openCases > 0 ? Math.round(currentMinutes / openCases) : null,
      null,
      entryCount,
    ),
    byCategory: byCategory.rows.map((r) => ({
      category: String((r as Row)["category"] ?? "unspecified"),
      minutes: num((r as Row)["minutes"]),
    })),
    byMember: byMember.rows.map((r) => ({
      userId: num((r as Row)["user_id"]),
      userName: String((r as Row)["user_name"] ?? ""),
      minutes: num((r as Row)["minutes"]),
      billableMinutes: num((r as Row)["billable_minutes"]),
    })),
    openCases,
    // Distinguishes "no time in this window" from "this chamber has never
    // logged time", which need different words on the page.
    hasAnyTimeLogged: num(effortRow["all_time_n"]) > 0,
  };
}
