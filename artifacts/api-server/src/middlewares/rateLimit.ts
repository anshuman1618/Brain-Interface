import type { RequestHandler, Request } from "express";
import { logger } from "../lib/logger";
import { resolveClerkId } from "../lib/jit";
import { clientAddress } from "../lib/client-address";

/**
 * A fixed-window rate limiter, in process memory.
 *
 * No dependency and no Redis: this is one process's share of the traffic, and
 * across replicas each one enforces its own window. That is weaker than a
 * shared counter — N replicas allow roughly N times the limit — but it is a
 * genuine brake on the thing that matters here, which is somebody hammering
 * the sign-in endpoint from one machine. The alternative was shipping nothing
 * until infrastructure existed for it.
 *
 * If you put this behind a load balancer at real scale, move the counter to
 * Redis and keep this interface.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Bounded so a flood of distinct keys cannot itself become the memory leak.
const MAX_KEYS = 20_000;

function sweep(now: number): void {
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  if (buckets.size > MAX_KEYS) {
    const excess = buckets.size - MAX_KEYS;
    let i = 0;
    for (const k of buckets.keys()) {
      buckets.delete(k);
      if (++i >= excess) break;
    }
  }
}

/**
 * Which address this request counts against.
 *
 * `clientAddress` reads X-Forwarded-For from the right, which is the whole
 * point — see the comment there. Keying on the leftmost entry, as this did,
 * let a client rotate the header and get a fresh budget every request, so the
 * sign-in limit counted nothing.
 */
function clientKey(req: Request): string {
  return clientAddress(req) || "unknown";
}

export type LimitOptions = {
  /** Requests allowed per window. */
  max: number;
  windowMs: number;
  /** Distinguishes buckets so one limiter cannot exhaust another's budget. */
  name: string;
  /**
   * Key on the authenticated subject as well as the address where we have one.
   * Two colleagues behind one chamber's NAT should not share a write budget.
   */
  perUser?: boolean;
};

/**
 * Who this request counts against.
 *
 * `req.userId` is set by requireAuth / requireWorkspace, which run *inside* the
 * routers — later than the limiters mounted on `/api`. So a limiter reading only
 * that field would find it unset and silently key every request on the client
 * address, which is not what `perUser` claims and lumps a whole chamber behind
 * one NAT into a single budget.
 *
 * resolveClerkId reads the identity that is already available at this point:
 * clerkMiddleware runs before the limiters, and in preview mode the identity is
 * in the bearer token. It resolves identity only and grants nothing — what the
 * caller may reach is still decided later from workspace_memberships.
 */
function subjectFor(req: Request, perUser: boolean | undefined): string {
  if (perUser) {
    const known = (req as Request & { userId?: string }).userId ?? resolveClerkId(req);
    if (known) return `u:${known}`;
  }
  return `a:${clientKey(req)}`;
}

export function rateLimit(opts: LimitOptions): RequestHandler {
  return (req, res, next) => {
    // Preflight carries no credentials and does no work; counting it would
    // halve every real budget for cross-origin clients.
    if (req.method === "OPTIONS") return next();

    const now = Date.now();
    if (Math.random() < 0.01) sweep(now);

    const subject = subjectFor(req, opts.perUser);
    const key = `${opts.name}|${subject}`;

    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, b);
    }
    b.count += 1;

    const remaining = Math.max(0, opts.max - b.count);
    res.setHeader("RateLimit-Limit", String(opts.max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil((b.resetAt - now) / 1000)));

    if (b.count > opts.max) {
      const retry = Math.ceil((b.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retry));
      logger.warn({ limiter: opts.name, subject }, "Rate limit exceeded");
      res.status(429).json({
        error: "Too Many Requests",
        reason: "rate_limited",
        message: `Too many requests. Try again in ${retry} second${retry === 1 ? "" : "s"}.`,
      });
      return;
    }

    next();
  };
}

/** Exposed for tests, which must not inherit counters from each other. */
export function resetRateLimits(): void {
  buckets.clear();
}
