import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// PORT and BASE_PATH are injected by the Replit runtime. Static hosts (Netlify,
// Vercel, S3/CloudFront, ...) set neither, and previously the missing vars threw
// here — failing `vite build` at config-load time, before bundling even started.
// Both now fall back to portable defaults so the same config builds anywhere.
const DEFAULT_DEV_PORT = 5173;

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : DEFAULT_DEV_PORT;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Serve from the domain root unless the host mounts the app under a sub-path.
const basePath = process.env.BASE_PATH || "/";

/**
 * A deployment without a Clerk key is one that cannot be signed into, and it
 * fails LATE — the build succeeds, the health check passes, and the first
 * person to open the URL is the one who finds out.
 *
 * `isPreviewMode` in the app is literally `!VITE_CLERK_PUBLISHABLE_KEY`, so
 * omitting it ships the preview sign-in screen. That is not a security hole —
 * the server refuses preview auth whenever NODE_ENV is production, so every
 * such session is rejected — but a silently unusable deployment is its own
 * kind of outage.
 *
 * Gated on an explicit opt-in rather than NODE_ENV: `vite build` sets
 * NODE_ENV=production itself, so keying on that would also break the preview
 * bundles that CI and local development deliberately produce. render.yaml sets
 * REQUIRE_CLERK_KEY, so real deployments get the check without preview builds
 * losing the ability to exist.
 */
if (process.env.REQUIRE_CLERK_KEY === "true" && !process.env.VITE_CLERK_PUBLISHABLE_KEY) {
  throw new Error(
    "VITE_CLERK_PUBLISHABLE_KEY is required when REQUIRE_CLERK_KEY=true.\n\n" +
      "Without it the bundle ships in preview mode, where the sign-in screen " +
      "accepts any address — and the server, correctly, rejects every one of " +
      "those sessions in production. Nobody would be able to sign in.\n\n" +
      "Set it to the same pk_… value as CLERK_PUBLISHABLE_KEY. It is inlined at " +
      "BUILD time, so changing it later needs a redeploy, not a restart.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) => m.devBanner()),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // The whole app used to arrive as one ~1.3MB chunk, so a client opening
    // their portal downloaded the calendar and charting libraries they will
    // never see. Splitting the heavy, rarely-changing dependencies out means
    // they cache independently of application code, and the route-level
    // lazy() calls in dashboard-layout keep the rest off the first paint.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "wouter"],
          query: ["@tanstack/react-query"],
          calendar: ["react-big-calendar", "react-dnd", "react-dnd-html5-backend", "moment"],
          charts: ["recharts"],
          clerk: ["@clerk/react", "@clerk/themes"],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
