import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { GetOperatorMetricsResponse } from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { requireOperator } from "../lib/operator";

/**
 * The platform, seen from outside every chamber.
 *
 * This is the one router in the server that reads across tenants on purpose,
 * so two rules govern what it may return, and both are about restraint rather
 * than access:
 *
 *  1. **Counts, never content.** A chamber's name, its plan and how many
 *     matters it holds are facts about a *customer*. A matter's title, a
 *     client's name, a document — those are facts about somebody who never
 *     agreed to be seen by anyone outside their advocate's chamber, and the
 *     DPA says so in writing. Nothing here selects them.
 *  2. **No addresses.** Knowing that four chambers went quiet is an operations
 *     question. Knowing who to email about it is a marketing one, and it would
 *     turn this screen into a mailing list built out of other people's
 *     professional records. Look the address up deliberately if you need it.
 *
 * The numbers are computed in SQL rather than in JavaScript because the whole
 * point is that it stays cheap as the platform grows: one round trip, aggregate
 * work done by the database, nothing loaded into memory that scales with users.
 */

const router: IRouter = Router();

/** Every metric in one round trip. Each CTE answers one question and nothing else. */
const METRICS = sql`
with
  user_activity as (
    select
      count(*)::int                                                              as total,
      count(*) filter (where last_seen_at > now() - interval '1 day')::int       as seen_24h,
      count(*) filter (where last_seen_at > now() - interval '7 days')::int      as seen_7d,
      count(*) filter (where last_seen_at > now() - interval '30 days')::int     as seen_30d,
      count(*) filter (where last_seen_at is null)::int                          as never_seen,
      -- Registered more than a week ago and back inside the last week: someone
      -- who did not merely try it once.
      count(*) filter (
        where created_at < now() - interval '7 days'
          and last_seen_at > now() - interval '7 days'
      )::int                                                                     as returning,
      -- Registered more than a week ago and not seen since. The churn cohort.
      count(*) filter (
        where created_at < now() - interval '7 days'
          and (last_seen_at is null or last_seen_at < now() - interval '7 days')
      )::int                                                                     as lapsed
    from users
  ),
  chamber_totals as (
    select
      count(*)::int as total,
      count(*) filter (where exists (select 1 from cases c where c.workspace_id = w.id))::int
        as with_matters
    from workspaces w
    where w.kind = 'chamber'
  ),
  plan_split as (
    select coalesce(json_agg(row_to_json(t) order by t.chambers desc), '[]'::json) as rows
    from (
      select coalesce(s.plan, 'none') as plan,
             coalesce(s.status, 'none') as status,
             count(*)::int as chambers
      from workspaces w
      left join subscriptions s on s.workspace_id = w.id
      where w.kind = 'chamber'
      group by 1, 2
    ) t
  ),
  trial_funnel as (
    select
      count(*) filter (where s.trial_used_at is not null)::int as bought,
      -- Took the trial and is now on something else: the conversion.
      count(*) filter (where s.trial_used_at is not null and s.plan <> 'trial')::int
        as converted,
      -- Took the trial, still on trial, and the period has run out.
      count(*) filter (
        where s.trial_used_at is not null
          and s.plan = 'trial'
          and s.current_period_end is not null
          and s.current_period_end <= now()
      )::int as expired_unconverted,
      count(*) filter (
        where s.trial_used_at is not null
          and s.plan = 'trial'
          and (s.current_period_end is null or s.current_period_end > now())
      )::int as still_in_trial
    from subscriptions s
  ),
  signups as (
    select coalesce(json_agg(row_to_json(t) order by t.week), '[]'::json) as rows
    from (
      select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') as week,
             count(*)::int as chambers
      from workspaces
      where kind = 'chamber' and created_at > now() - interval '12 weeks'
      group by 1
    ) t
  ),
  revenue as (
    select
      coalesce(sum(amount_minor) filter (where outcome = 'applied'), 0)::bigint as all_time_minor,
      coalesce(
        sum(amount_minor) filter (
          where outcome = 'applied' and received_at > now() - interval '30 days'
        ), 0
      )::bigint as last_30d_minor,
      count(*) filter (where outcome = 'applied')::int as payments
    from payment_events
  ),
  chamber_rows as (
    select coalesce(json_agg(row_to_json(t) order by t.created_at desc), '[]'::json) as rows
    from (
      select
        w.id,
        w.name,
        to_char(w.created_at, 'YYYY-MM-DD') as created_at,
        coalesce(s.plan, 'none')   as plan,
        coalesce(s.status, 'none') as status,
        to_char(s.current_period_end, 'YYYY-MM-DD') as period_end,
        (select count(*) from workspace_memberships m
           where m.workspace_id = w.id and m.status = 'active')::int as seats,
        (select count(*) from cases c where c.workspace_id = w.id)::int as matters,
        -- The most recent sign of life from anyone in the chamber. Nulls when
        -- nobody has been seen since last_seen_at shipped, which is not the
        -- same as nobody having been here.
        to_char(
          (select max(u.last_seen_at) from workspace_memberships m
             join users u on u.id = m.user_id
            where m.workspace_id = w.id and m.status = 'active'),
          'YYYY-MM-DD'
        ) as last_seen
      from workspaces w
      left join subscriptions s on s.workspace_id = w.id
      where w.kind = 'chamber'
      order by w.created_at desc
      limit 200
    ) t
  )
select
  (select row_to_json(user_activity)  from user_activity)  as users,
  (select row_to_json(chamber_totals) from chamber_totals) as chambers,
  (select row_to_json(trial_funnel)   from trial_funnel)   as trial,
  (select row_to_json(revenue)        from revenue)        as revenue,
  (select rows from plan_split)   as plans,
  (select rows from signups)      as signups,
  (select rows from chamber_rows) as chamber_rows
`;

type MetricsRow = {
  users: {
    total: number;
    seen_24h: number;
    seen_7d: number;
    seen_30d: number;
    never_seen: number;
    returning: number;
    lapsed: number;
  };
  chambers: { total: number; with_matters: number };
  trial: {
    bought: number;
    converted: number;
    expired_unconverted: number;
    still_in_trial: number;
  };
  revenue: { all_time_minor: string | number; last_30d_minor: string | number; payments: number };
  plans: { plan: string; status: string; chambers: number }[];
  signups: { week: string; chambers: number }[];
  chamber_rows: {
    id: number;
    name: string;
    created_at: string;
    plan: string;
    status: string;
    period_end: string | null;
    seats: number;
    matters: number;
    last_seen: string | null;
  }[];
};

router.get(
  "/operator/metrics",
  requireAuth,
  requireOperator,
  async (_req: AuthRequest, res): Promise<void> => {
    const result = await db.execute(METRICS);
    // Postgres returns `rows`; PGlite's driver matches it. One row, always.
    const row = (result as unknown as { rows: MetricsRow[] }).rows[0];

    res.json(
      GetOperatorMetricsResponse.parse({
        generatedAt: new Date().toISOString(),
        users: {
          total: row.users.total,
          seen24h: row.users.seen_24h,
          seen7d: row.users.seen_7d,
          seen30d: row.users.seen_30d,
          neverSeen: row.users.never_seen,
          returning: row.users.returning,
          lapsed: row.users.lapsed,
        },
        chambers: {
          total: row.chambers.total,
          withMatters: row.chambers.with_matters,
          // Founded and never used: the number that says onboarding is broken.
          empty: row.chambers.total - row.chambers.with_matters,
        },
        trial: {
          bought: row.trial.bought,
          converted: row.trial.converted,
          expiredUnconverted: row.trial.expired_unconverted,
          stillInTrial: row.trial.still_in_trial,
        },
        revenue: {
          allTimeMinor: Number(row.revenue.all_time_minor),
          last30dMinor: Number(row.revenue.last_30d_minor),
          payments: row.revenue.payments,
        },
        plans: row.plans,
        signups: row.signups,
        chamberRows: row.chamber_rows.map((c) => ({
          id: c.id,
          name: c.name,
          createdAt: c.created_at,
          plan: c.plan,
          status: c.status,
          periodEnd: c.period_end,
          seats: c.seats,
          matters: c.matters,
          lastSeen: c.last_seen,
        })),
      }),
    );
  },
);

export default router;
