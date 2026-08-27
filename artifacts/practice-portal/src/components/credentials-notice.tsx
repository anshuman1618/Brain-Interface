import { Link } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { Scale } from "lucide-react";

/**
 * The rest of an advocate's credentials, asked for once the chamber is running.
 *
 * ── Why this is a notice and not a gate ──────────────────────────────────
 *
 * The two compulsory fields — state bar council and enrolment number — are
 * already taken at the door, because without them we cannot say who is
 * practising here. Everything else is either not held by most advocates
 * (Certificate of Practice, Advocate-on-Record at either court) or has its own
 * six-month deadline (the All India Bar Examination number). Stopping a
 * chamber that has just paid to demand a number the person may not be able to
 * produce for months would be a wall in front of work they have bought.
 *
 * So it stands on the dashboard, next to the plan banner, and says how long is
 * left. The deadline itself is enforced server-side once it passes — see
 * `barCredentialsComplete()`; this is the warning before that bites, not a
 * substitute for it.
 *
 * ── Silent unless there is something to do ───────────────────────────────
 *
 * Renders nothing for a clerk or a client, nothing once the number is
 * supplied, and nothing before an advocate has declared anything at all — that
 * person is still behind the door gate and has a whole screen about it.
 */

/** How close the deadline has to be before the notice raises its voice. */
const URGENT_DAYS = 30;

export function CredentialsNotice() {
  const { data: me } = useGetMe();

  // Null covers three cases that all mean "say nothing": supplied, no deadline
  // set, or a role that never had one.
  const daysLeft = me?.allIndiaBarDaysLeft ?? null;
  if (daysLeft === null || me?.allIndiaBarNo) return null;

  const overdue = daysLeft < 0;
  const urgent = overdue || daysLeft <= URGENT_DAYS;

  return (
    <div
      // A standing condition, not an interruption — the same reasoning as
      // PlanBanner's role.
      role="status"
      className={`flex flex-col gap-3 rounded-[var(--radius)] p-3 shadow-[var(--raise)] sm:flex-row sm:items-center ${
        urgent ? "bg-warning text-warning-foreground" : "bg-secondary text-secondary-foreground"
      }`}
    >
      <Scale className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="flex-1 text-sm font-medium">
        {overdue
          ? `Your All India Bar Examination number is overdue by ${Math.abs(daysLeft)} ${
              Math.abs(daysLeft) === 1 ? "day" : "days"
            }. The chamber stays closed to you until it is recorded.`
          : `Add your All India Bar Examination number — ${daysLeft} ${
              daysLeft === 1 ? "day" : "days"
            } left. Certificate of Practice and Advocate-on-Record numbers can go in at the same time.`}
      </p>
      <Link
        href="/complete-profile"
        className="shrink-0 font-mono text-xs uppercase tracking-wider underline underline-offset-4"
      >
        Add credentials
      </Link>
    </div>
  );
}
