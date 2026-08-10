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

  // Vite fingerprints filenames under /assets, so those are safe to cache
  // immutably. `index: false` keeps index.html out of this handler entirely —
  // it is always served by the fallback below, which sets its own no-cache.
  app.use(
    express.static(clientDist, {
      index: false,
      setHeaders: (res) => {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );

  app.use(spaFallback(indexHtml));

  logger.info({ clientDist }, "Serving built frontend");
}

/**
 * Returns index.html for client-routed paths (e.g. /dashboard, /cases/12) so a
 * reload or deep link doesn't 404. Anything under /api is passed through to the
 * API's own 404 handling, which keeps missing endpoints from returning HTML.
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
