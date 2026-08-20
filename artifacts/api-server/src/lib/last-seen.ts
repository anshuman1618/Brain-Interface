import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Recording that somebody came back.
 *
 * The gap this closes: every other record says who *registered*. The audit log
 * records privileged writes, so an advocate who opens the diary each morning
 * and writes nothing looks exactly like an account that signed up once and
 * vanished. That is the single distinction the operator view needs, and there
 * was no column that could answer it.
 *
 * Three properties it has to have, because this runs on the hot path of every
 * authenticated request:
 *
 *  1. **It never delays a request.** The caller does not await it. The write
 *     goes out alongside the response, not before it.
 *  2. **It never fails a request.** A rejected promise here would be an
 *     unhandled rejection, which can take the process down; the catch is the
 *     whole point of the function, not decoration.
 *  3. **It writes at most once an hour per person.** A busy user makes hundreds
 *     of requests an hour and every one of them would otherwise be an UPDATE on
 *     the same row — pure write amplification for a number nobody reads at that
 *     resolution.
 *
 * The hourly floor is also a privacy decision, and the reason this is a single
 * column rather than a session log. "Seen this week" is what the product needs.
 * A minute-accurate record of when an advocate was at their desk is a different
 * and more sensitive thing, and it is not collected.
 *
 * The throttle lives in process memory, so with several instances each writes
 * once per hour per user. That is a handful of extra writes a day, not a
 * correctness problem: the column means "seen around then", and every reader
 * treats it that way.
 */

const WINDOW_MS = 60 * 60 * 1000;

/** clerkId → when we last wrote for them. */
const written = new Map<string, number>();

/**
 * Bound the map so a long-running instance cannot accumulate a row per user
 * who ever signed in. Anything older than the window is due a write anyway, so
 * dropping it costs one extra UPDATE and nothing else.
 */
const MAX_TRACKED = 5_000;

function prune(now: number): void {
  for (const [id, at] of written) {
    if (now - at >= WINDOW_MS) written.delete(id);
  }
  // Still oversized after pruning: a genuinely large active set. Start over
  // rather than grow without limit — the cost is one write per user, once.
  if (written.size > MAX_TRACKED) written.clear();
}

/**
 * Fire-and-forget. Call it, do not await it.
 *
 * Exported for the suite, which needs to force a write on the next request
 * rather than wait an hour for one.
 */
export function resetLastSeenThrottle(): void {
  written.clear();
}

export function touchLastSeen(clerkId: string): void {
  if (!clerkId) return;

  const now = Date.now();
  const previous = written.get(clerkId);
  if (previous !== undefined && now - previous < WINDOW_MS) return;

  // Recorded before the write, not after: two concurrent requests from the same
  // person must not both decide they are the one to write.
  written.set(clerkId, now);
  if (written.size > MAX_TRACKED) prune(now);

  void db
    .update(usersTable)
    .set({ lastSeenAt: new Date(now) })
    .where(eq(usersTable.clerkId, clerkId))
    .returning({ id: usersTable.id })
    .then((rows) => {
      // Nothing updated means the user row does not exist yet: this middleware
      // runs before `getOrCreateUser` creates it, so a person's very first
      // request always misses. Without dropping the throttle entry here the
      // miss would be remembered for an hour, and since the SPA's opening
      // requests all fall inside that hour, a brand-new account would read as
      // never seen — the column would look implemented and always be null.
      if (rows.length === 0) written.delete(clerkId);
    })
    .catch((err: unknown) => {
      // Not being able to record this is never worth failing a request over.
      // Forget the throttle entry so the next request tries again.
      written.delete(clerkId);
      logger.warn({ err: String(err) }, "could not record last_seen_at");
    });
}
