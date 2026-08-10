import type { RequestHandler, Request } from "express";
import { logger } from "../lib/logger";

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
 * Trust the proxy's first hop only when we are actually behind one. Taking the
 * whole X-Forwarded-For chain would let a client prepend a fake address and
 * rotate its own key at will.
 */
function clientKey(req: Request): string {
  const behindProxy = process.env["TRUST_PROXY"] !== "off";
  const fwd = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return (behindProxy && fwd) || req.socket?.remoteAddress || "unknown";
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

export function rateLimit(opts: LimitOptions): RequestHandler {
  return (req, res, next) => {
    // Preflight carries no credentials and does no work; counting it would
    // halve every real budget for cross-origin clients.
    if (req.method === "OPTIONS") return next();

    const now = Date.now();
    if (Math.random() < 0.01) sweep(now);

    const subject =
      opts.perUser && (req as Request & { userId?: string }).userId
        ? `u:${(req as Request & { userId?: string }).userId}`
        : `a:${clientKey(req)}`;
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
