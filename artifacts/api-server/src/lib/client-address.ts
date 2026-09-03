import type { Request } from "express";

/**
 * The caller's address, as far as it can be trusted.
 *
 * **X-Forwarded-For is read from the RIGHT.** The header is append-only: each
 * proxy adds the address it received the connection from, so the rightmost
 * entry is the one our own proxy observed and the only entry no client can
 * write. Everything to its left arrived from whoever came before — including,
 * at the far left, the caller themselves.
 *
 * Reading `[0]` therefore reads a client-supplied value. Both call sites here
 * used to, and both were wrong in the same way:
 *
 *   - the rate limiter keyed its buckets on it, so rotating the header gave a
 *     fresh budget every request and the sign-in limit — the one that stops
 *     address enumeration and one-time-code spam — counted nothing;
 *   - the audit log stored it, so the chamber's accountability record could be
 *     made to name an address of the caller's choosing.
 *
 * `TRUST_PROXY` is how many proxies sit in front of this process. **The default
 * follows deployment reality rather than being a fixed number:** 1 in
 * production, where Render fronts the service and appends the address it saw,
 * and 0 everywhere else, where the server is reached directly and nothing
 * appends anything.
 *
 * That distinction is the whole fix. Trusting one hop when no proxy exists
 * trusts an entry the caller wrote and nobody appended to — the chain is one
 * element long, the rightmost entry IS the forgery, and reading from the right
 * buys nothing. A number is only safe when that many proxies genuinely add an
 * entry; every hop claimed beyond them is another entry a client may forge.
 *
 * Set it explicitly (`TRUST_PROXY=2`, or `off`) when the topology is not one of
 * those two.
 */
export function clientAddress(req: Request): string | undefined {
  const raw = process.env["TRUST_PROXY"]?.trim();
  const hops =
    raw === "off"
      ? 0
      : raw && Number.isFinite(Number(raw))
        ? Math.max(0, Number(raw))
        : process.env["NODE_ENV"] === "production"
          ? 1
          : 0;

  if (hops > 0) {
    const chain = (req.headers["x-forwarded-for"] as string | undefined)
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (chain?.length) {
      // The nth from the right, clamped. A chain shorter than the configured
      // hop count means something upstream is not appending what we expect; the
      // leftmost entry is then the closest thing to the truth available, and it
      // is no worse than the old behaviour.
      return chain[Math.max(0, chain.length - hops)] ?? chain[0];
    }
  }
  return req.socket?.remoteAddress ?? undefined;
}
