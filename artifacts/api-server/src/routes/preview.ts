import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, subscriptionsTable, isPreviewDatabase, isSubscriptionPlan } from "@workspace/db";
import { isPreviewAuth } from "../lib/preview-mode";
import { requireWorkspace, ctx, type AuthRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

/**
 * Lets the SPA discover, at runtime, that it is talking to a preview backend so
 * it can mock auth to match and show a preview banner. Unauthenticated by
 * design — it reveals only whether external services are configured, never any
 * key material or data.
 */
router.get("/preview-status", (_req, res): void => {
  res.json({
    previewAuth: isPreviewAuth(),
    previewDatabase: isPreviewDatabase(),
  });
});

/**
 * Move this workspace's subscription period to an arbitrary point.
 *
 * Where the period ends is the one input to enforcement that no public API can
 * set — the only way a plan lapses, or comes close to renewing, is for time to
 * pass, and a test cannot wait two months. Negative `daysFromNow` puts it in
 * the past (lapsed); positive puts it in the future, which is what makes the
 * "renews in N days" state reachable at all.
 *
 * Three things keep it out of production:
 *
 *   1. `isPreviewAuth()` is hard-false when NODE_ENV=production, and the server
 *      refuses to boot into preview mode there at all. This route 404s rather
 *      than 403s in that case, so it does not even advertise its own existence.
 *   2. It is behind `requireWorkspace`, so it can only ever touch the caller's
 *      own workspace — the id comes from the verified context, never the body.
 *   3. It moves a date. It cannot grant a plan, change a status or add a seat,
 *      so the worst it can do to a preview database is misdate one row.
 */
router.post(
  "/preview/set-period-end",
  requireWorkspace,
  async (req: AuthRequest, res): Promise<void> => {
    if (!isPreviewAuth() || !isPreviewDatabase()) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const c = ctx(req);
    const daysFromNow = Number(req.body?.daysFromNow ?? -1);
    if (!Number.isFinite(daysFromNow)) {
      res.status(400).json({ error: "daysFromNow must be a number" });
      return;
    }

    const when = new Date(Date.now() + daysFromNow * 86_400_000);
    const [updated] = await db
      .update(subscriptionsTable)
      .set({ currentPeriodEnd: when })
      .where(eq(subscriptionsTable.workspaceId, c.workspaceId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "This workspace has no subscription row to move." });
      return;
    }

    res.json({ workspaceId: c.workspaceId, currentPeriodEnd: when.toISOString() });
  },
);

/**
 * Put this workspace's plan in force, without taking a payment.
 *
 * The paid gate is real in preview mode, deliberately — a gate that is switched
 * off wherever it is testable is a gate nobody has tested. But preview has no
 * payment provider at all: `paymentsEnabled()` is false, checkout returns 503,
 * and the webhook that normally activates a plan is never called. Without this
 * route a preview chamber could never open a matter, and `pnpm run preview` —
 * documented as the fastest way to see a change — would show a paywall.
 *
 * The same three things keep it out of production as the route above:
 *
 *   1. `isPreviewAuth()` is hard-false when NODE_ENV=production, and the server
 *      refuses to boot into preview mode there. This 404s in that case, so it
 *      does not advertise its own existence.
 *   2. It is behind `requireWorkspace`, so it can only touch the caller's own
 *      workspace — the id comes from the verified context, never the body.
 *   3. It grants a plan from the real catalogue and nothing invented. Pro and
 *      Firm are off the public storefront (see OFFERED_PLANS) but still exist
 *      and are still enforced, and the suites that cover seat caps, lapse and
 *      renewal have to be able to reach them. Doing that here rather than by
 *      widening what production sells keeps CI testing the shipped
 *      configuration.
 *
 * It does NOT write either once-only marker — `users.trial_claimed_at` or
 * `subscriptions.trial_used_at`. One trial per person, and one per chamber, are
 * commercial rules about real money; burning somebody's real entitlement from a
 * preview route would be a bug, and leaving both unwritten is what lets the
 * suites that test those rules still reach a genuinely unclaimed trial after
 * calling this.
 */
router.post(
  "/preview/activate-plan",
  requireWorkspace,
  async (req: AuthRequest, res): Promise<void> => {
    if (!isPreviewAuth() || !isPreviewDatabase()) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const c = ctx(req);
    const body = (req.body ?? {}) as { plan?: unknown };
    const plan = isSubscriptionPlan(body.plan) ? body.plan : "trial";
    const now = new Date();
    const end = new Date(now);
    // The trial is a two-month pack; everything else is quoted monthly here,
    // which is all these suites need — they assert on caps and expiry, not on
    // the term.
    end.setMonth(end.getMonth() + (plan === "trial" ? 2 : 1));

    // A chamber has no subscription row until it selects something — see
    // plan.mjs §1, which asserts that a row-less chamber is not treated as
    // lapsed. So this inserts when there is nothing to update; writing only the
    // UPDATE looks like it works and silently does nothing, which is exactly
    // how it was got wrong the first time.
    const fields = {
      plan,
      billingPeriod: "one_time" as const,
      status: "active" as const,
      paidMonths: plan === "trial" ? 2 : 1,
      amountMinor: 9_900,
      startedAt: now,
      currentPeriodEnd: end,
      updatedAt: now,
    } as const;

    const updated = await db
      .update(subscriptionsTable)
      .set(fields)
      .where(eq(subscriptionsTable.workspaceId, c.workspaceId))
      .returning({ id: subscriptionsTable.id });

    if (updated.length === 0) {
      await db.insert(subscriptionsTable).values({ workspaceId: c.workspaceId, ...fields });
    }

    res.json({ activated: true, plan, currentPeriodEnd: end.toISOString() });
  },
);

/**
 * Four real error messages, each one a shape this codebase has been seen to
 * produce and each carrying something that must not leave the host.
 *
 * Constants, selected by name. The request never contributes a character to
 * the thrown message — a caller picks which of these four is raised and
 * nothing more — so the route cannot be used to inject arbitrary text into
 * whatever `ERROR_WEBHOOK_URL` points at.
 *
 * Four rather than one because the reporter de-duplicates on the message, so a
 * single constant would let the suite observe exactly one delivery. Distinct
 * messages are what make it possible to check four redactions and four path
 * shapes in one server lifetime.
 */
const THROW_VARIANTS: Record<string, string> = {
  /** A Postgres unique violation quotes the value that collided. */
  email:
    'duplicate key value violates unique constraint "users_email_unique" — ' +
    "Key (email)=(partner@chamber.in) already exists.",
  /** `r2.ts` builds its failure message around the object key. */
  blobkey:
    "R2 putObject failed with 403 for object " +
    "a3f5c9e1b7d24068af13c5e29b74d0116c8ea52f93b7d4c081fa6e2537b9c40d",
  /** A driver error carries the connection string, password included. */
  credentials: "connect ETIMEDOUT postgres://lex_app:s3cr3t-pw@db.internal.example:5432/lex",
  /** Some drivers return the whole offending statement. Must be capped. */
  long:
    "insert or update on table violates foreign key constraint — " +
    "detail: ".repeat(60) +
    "END-OF-A-VERY-LONG-MESSAGE",
};

/**
 * Throw, so the error reporter's redaction can be tested end to end.
 *
 * `scripts/ci/suites/error-reporting.mjs` needs a real 500 travelling the real
 * path — through the terminal handler in `app.ts`, which is where `req.path`
 * and the error's message are handed to `reportError`. Unit-testing the two
 * redaction functions in isolation would not catch the thing that actually
 * went wrong here, which was not a bad regular expression but a payload nobody
 * had looked at.
 *
 * The `:matterId` segment stands in for the matter id a 500 on `/api/cases/42`
 * used to forward, and the suite calls it with a number, a UUID, a Clerk id and
 * a long opaque token to pin each branch of `redactPath`.
 *
 * Unauthenticated, unlike the two routes above, and that is a deliberate
 * narrowing rather than an oversight: it reads nothing, writes nothing and
 * touches no workspace, so `requireWorkspace` would only mean the suite has to
 * spend a chamber and two of the auth limiter's thirty requests to reach a
 * route that does nothing but throw. The preview gate is the whole protection
 * it needs, and it is the same gate — hard-false under NODE_ENV=production,
 * where the server also refuses to boot into preview mode at all. It 404s
 * there rather than 403ing, so it does not advertise its own existence.
 */
router.get("/preview/throw/:matterId", (req, res): void => {
  if (!isPreviewAuth() || !isPreviewDatabase()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const variant = String(req.query["variant"] ?? "email");
  throw new Error(THROW_VARIANTS[variant] ?? THROW_VARIANTS["email"]);
});

export default router;
