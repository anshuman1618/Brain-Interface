import type { RequestHandler } from "express";

/**
 * Baseline security response headers.
 *
 * Written by hand rather than pulled from a package: these are four static
 * headers and one conditional one, and a dependency to set them would be more
 * surface area than the code it replaces.
 *
 * Deliberately NOT here: Content-Security-Policy. A useful CSP for this app has
 * to name the Clerk domain for the deployment, the font host, and whatever the
 * frontend origin is — get one of those wrong and the app breaks in the browser
 * with no server-side error to find. It belongs at the edge (reverse proxy or
 * CDN) where it can be rolled out in report-only mode first. DEPLOYMENT.md
 * carries a working starting policy.
 */

export function securityHeaders(): RequestHandler {
  const isProd = process.env["NODE_ENV"] === "production";
  // Only meaningful over TLS, and actively harmful in local development, where
  // it would pin http://localhost to https for six months in the developer's
  // browser. Enabled by default in production; opt out with HSTS=off if TLS is
  // terminated somewhere that already sets it.
  const hsts = isProd && process.env["HSTS"] !== "off";

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

    next();
  };
}
