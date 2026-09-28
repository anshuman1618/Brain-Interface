/**
 * Serves the built practice-portal SPA from the API server.
 *
 * This is the single-origin topology: one process serves both `/api/*` and the
 * static frontend, so requests stay same-origin and the Clerk session cookie is
 * sent automatically (no CORS, no bearer-token bridge needed).
 *
 * Mount AFTER the `/api` router so API routes are never shadowed by the SPA
 * fallback. When the frontend has not been built, every hook here is skipped and
 * the process runs as an API-only server.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import express, { type RequestHandler, type Express } from "express";
import { logger } from "../lib/logger";

/** Absolute path to the directory holding the built SPA (index.html + assets). */
export function resolveClientDist(): string {
  const configured = process.env.CLIENT_DIST_PATH?.trim();
  if (configured) return path.resolve(configured);

  // The server runs as a bundle at artifacts/api-server/dist/index.mjs, so the
  // sibling artifact's build output is two levels up.
  return path.resolve(import.meta.dirname, "..", "..", "practice-portal", "dist", "public");
}

export function mountStaticClient(app: Express): void {
  const clientDist = resolveClientDist();
  const indexHtml = path.join(clientDist, "index.html");

  if (!existsSync(indexHtml)) {
    logger.warn(
      { clientDist },
      "Built frontend not found — running API-only. Build it with `pnpm --filter @workspace/practice-portal run build`, or set CLIENT_DIST_PATH.",
    );
    return;
  }

  /*
   * Two cache policies, because this directory holds two kinds of file.
   *
   * Vite fingerprints everything under /assets, so a changed bundle is a
   * changed URL and `immutable` for a year is exactly right. Nothing else here
   * is fingerprinted — favicon.svg, favicon.ico, apple-touch-icon.png,
   * logo.svg, robots.txt all keep their names forever — and this handler was
   * giving those the same year-long `immutable` header.
   *
   * `immutable` is a promise that the body at this URL will never change, and
   * a browser holding one is entitled to skip revalidation even on a reload.
   * So replacing the favicon shipped a new file that nobody would fetch: the
   * old icon stayed in every browser that had already seen it, for a year,
   * and a redeploy could not dislodge it. That is not a caching nicety, it is
   * an un-shippable asset.
   *
   * A day, and revalidate. These files are small, they change rarely, and a
   * conditional request that returns 304 costs a round trip once a day.
   */
  app.use(
    express.static(clientDist, {
      index: false,
      setHeaders: (res, filePath) => {
        const fingerprinted = path
          .relative(clientDist, filePath)
          .split(path.sep)
          .includes("assets");
        res.setHeader(
          "Cache-Control",
          fingerprinted
            ? "public, max-age=31536000, immutable"
            : "public, max-age=86400, must-revalidate",
        );
      },
    }),
  );

  app.use(spaFallback(indexHtml));

  logger.info({ clientDist }, "Serving built frontend");
}

/**
 * Extensions that name a FILE rather than a client route.
 *
 * A closed list, not `/\.[a-z]+$/`, because the cost of the two mistakes is
 * not symmetric: a missing extension here serves an asset request an HTML
 * page, which is the bug below; a route wrongly matched here 404s a page that
 * works. Every client route in this app is static segments plus a numeric id,
 * so none of these can collide with one — and adding a route that ends in a
 * literal dot-something would be the thing to notice, not this list.
 */
const FILE_EXTENSIONS = new Set([
  "avif",
  "css",
  "csv",
  "eot",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "js",
  "json",
  "map",
  "mjs",
  "otf",
  "pdf",
  "png",
  "svg",
  "txt",
  "ttf",
  "webmanifest",
  "webp",
  "woff",
  "woff2",
  "xml",
  "zip",
]);

function looksLikeAFile(pathname: string): boolean {
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  const dot = last.lastIndexOf(".");
  return dot > 0 && FILE_EXTENSIONS.has(last.slice(dot + 1).toLowerCase());
}

/**
 * Returns index.html for client-routed paths (e.g. /dashboard, /cases/12) so a
 * reload or deep link doesn't 404. Anything under /api is passed through to the
 * API's own 404 handling, which keeps missing endpoints from returning HTML.
 *
 * A request that names a file does NOT get index.html. `express.static` above
 * has already had its turn, so reaching here means the file is not in the
 * build — and answering that with an HTML document at status 200 is the worst
 * of the options. It is not a 404 the browser can act on and it is not the
 * thing that was asked for; it is a success carrying the wrong content type.
 *
 * This was not hypothetical. `/favicon.ico` and `/apple-touch-icon.png` were
 * never in the build, so both returned index.html at 200, and a phone looking
 * for a tab icon was handed 2.6 KB of markup. Both files exist now; this stops
 * the next one being silent.
 */
function spaFallback(indexHtml: string): RequestHandler {
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (req.path === "/api" || req.path.startsWith("/api/")) {
      next();
      return;
    }
    if (looksLikeAFile(req.path)) {
      res.status(404).type("txt").send("Not found");
      return;
    }
    // Never cache the entry document: it references fingerprinted bundles, so a
    // cached copy would keep serving a stale build after a deploy.
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexHtml, (err: NodeJS.ErrnoException | undefined) => {
      if (!err) return;
      // The generic handler would turn this into a bare "Internal server
      // error", which says nothing about the one thing that is wrong: the
      // entry document could not be read. Name the path and the errno, because
      // on a managed host this log line is all the evidence there is.
      logger.error(
        { err, indexHtml, code: err.code },
        "Could not serve the SPA entry document — the frontend build is missing or unreadable",
      );
      next(err);
    });
  };
}
