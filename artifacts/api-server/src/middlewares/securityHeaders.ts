import type { RequestHandler } from "express";
import { logger } from "../lib/logger";

/**
 * Baseline security response headers.
 *
 * Written by hand rather than pulled from a package: these are four static
 * headers and two conditional ones, and a dependency to set them would be more
 * surface area than the code it replaces.
 *
 * ── Content-Security-Policy ───────────────────────────────────────────────
 *
 * This used to say a CSP belonged at the edge and nowhere else, and that
 * argument had one true half. The true half: a useful policy has to name this
 * deployment's Clerk domain, and a policy baked into the code breaks every
 * deployment that differs from the one it was written for. The false half was
 * the conclusion — "so it is not set by the app", which in practice meant it
 * was not set at all, on a platform holding privileged legal material, for as
 * long as nobody got round to configuring a proxy that does not exist. A header
 * nobody owns is a header nobody sets.
 *
 * So it is here, **off by default**, driven by two variables in the same idiom
 * as `HSTS` and `TRUST_PROXY`:
 *
 *   CSP=off          no header at all. The default, and the current behaviour.
 *   CSP=report-only  Content-Security-Policy-Report-Only. Violations show in
 *                    the browser console and break nothing.
 *   CSP=enforce      Content-Security-Policy. Violations are blocked.
 *
 *   CSP_CLERK_ORIGIN the deployment's Clerk host, e.g.
 *                    https://clerk.lexpractice.co, or
 *                    https://<slug>.clerk.accounts.dev on a development
 *                    instance. Required by the two live modes — see the
 *                    startup guard, which refuses rather than shipping a policy
 *                    that logs everyone out the moment it is enforced.
 *   CSP_REPORT_URI   optional. Where the browser posts violation reports.
 *
 * **Go through report-only first.** The failure mode of a wrong CSP is silent
 * in the server logs and total in the browser: the sign-in widget does not
 * render, the pay button does nothing, and there is no 500 anywhere to find.
 */

/** Every mode the CSP variable accepts. Anything else is a startup error. */
export const CSP_MODES = ["off", "report-only", "enforce"] as const;
export type CspMode = (typeof CSP_MODES)[number];

export function cspMode(): CspMode {
  const raw = process.env["CSP"]?.trim().toLowerCase();
  if (!raw) return "off";
  return (CSP_MODES as readonly string[]).includes(raw) ? (raw as CspMode) : "off";
}

/**
 * The policy, with the deployment's Clerk origin substituted in.
 *
 * Exported so `startup-guards.mjs` and a future admin screen can print the
 * exact string that will be sent, rather than a transcription of it.
 *
 * Every entry below is here because something in this application would break
 * without it. In source order:
 *
 *  - **Clerk** serves the sign-in widget's script, opens an iframe to complete
 *    the handshake, calls its own API from the page, and serves avatars from
 *    `img.clerk.com`. `challenges.cloudflare.com` is Clerk's bot protection; it
 *    is a script and a frame, and omitting it breaks sign-in only for the
 *    visitors Clerk decides to challenge — which is the worst possible way to
 *    find out.
 *  - **Razorpay** is loaded on demand by `pricing-modal.tsx` from
 *    `checkout.razorpay.com`, then opens its own iframe from
 *    `api.razorpay.com` and posts telemetry to `lumberjack.razorpay.com`.
 *    DEPLOYMENT.md's published policy omitted all three, so enforcing it as
 *    written would have broken payment and nothing else — the one failure
 *    nobody tests on a Tuesday.
 *  - **`blob:`** in `img-src` and `object-src`: `documents.tsx`,
 *    `invoices.tsx` and `client-portal.tsx` all download through
 *    `URL.createObjectURL`, which is how a decrypted file reaches the browser
 *    without a path-addressable URL existing.
 *  - **`'unsafe-inline'` in `style-src`** is not optional and is worth being
 *    honest about. Radix sets inline styles for positioning, and
 *    react-big-calendar lays the grid out the same way. Removing it needs
 *    per-response nonces through both libraries, which is a real project.
 *  - **No font or style host.** `index.html` deliberately loads no webfont
 *    CDN — disclosing every visitor's address to a font host before they sign
 *    in is difficult to reconcile with the DPDP notice — so the published
 *    policy naming `fonts.googleapis.com` and `fonts.gstatic.com` was
 *    describing a different application.
 */
export function cspPolicy(clerkOrigin: string, reportUri?: string): string {
  const clerk = clerkOrigin.replace(/\/+$/, "");
  const directives = [
    "default-src 'self'",
    `script-src 'self' ${clerk} https://challenges.cloudflare.com https://checkout.razorpay.com`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src 'self' data: blob: https://img.clerk.com ${clerk}`,
    `connect-src 'self' ${clerk} https://api.razorpay.com https://lumberjack.razorpay.com`,
    `frame-src 'self' ${clerk} https://challenges.cloudflare.com https://api.razorpay.com`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    // Belt and braces with X-Frame-Options: the header is what old browsers
    // honour, this is what current ones do.
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  if (reportUri) directives.push(`report-uri ${reportUri}`);
  return directives.join("; ");
}

export function securityHeaders(): RequestHandler {
  const isProd = process.env["NODE_ENV"] === "production";
  // Only meaningful over TLS, and actively harmful in local development, where
  // it would pin http://localhost to https for six months in the developer's
  // browser. Enabled by default in production; opt out with HSTS=off if TLS is
  // terminated somewhere that already sets it.
  const hsts = isProd && process.env["HSTS"] !== "off";

  // Read once at construction, not per request: the policy is a string concat
  // and the mode cannot change without a restart anyway.
  const mode = cspMode();
  const clerkOrigin = process.env["CSP_CLERK_ORIGIN"]?.trim();
  const reportUri = process.env["CSP_REPORT_URI"]?.trim();
  const policy = mode !== "off" && clerkOrigin ? cspPolicy(clerkOrigin, reportUri) : null;
  const cspHeader =
    mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

  // Production refuses to boot in this state — see `preflight.ts`. Outside
  // production the preflight does not run at all, so say it here: somebody
  // testing a policy locally who gets no header and no message will conclude
  // the CSP is working.
  if (mode !== "off" && !policy) {
    logger.warn(
      { mode },
      "CSP is switched on but CSP_CLERK_ORIGIN is unset, so NO policy is being sent",
    );
  } else if (policy) {
    logger.info({ mode, header: cspHeader }, "Content-Security-Policy active");
  }

  return (_req, res, next) => {
    // Do not let a browser second-guess a declared Content-Type. Stops a JSON
    // response that happens to contain markup being sniffed as HTML.
    res.setHeader("X-Content-Type-Options", "nosniff");
    // The app is never meant to be framed; a chamber's matter list inside
    // someone else's page is a clickjacking target.
    res.setHeader("X-Frame-Options", "DENY");
    // Send the origin to other sites, the full path only to ourselves — matter
    // ids and workspace ids live in URLs and should not leak in Referer.
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    // Nothing in this app uses these, so refuse them rather than leave the
    // decision to a future embedded iframe.
    res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=()");

    if (hsts) {
      res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
    if (policy) {
      res.setHeader(cspHeader, policy);
    }

    next();
  };
}
