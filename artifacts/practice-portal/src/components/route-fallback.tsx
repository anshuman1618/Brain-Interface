import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * What fills the page while a route's chunk is still downloading.
 *
 * ── Why it is delayed ─────────────────────────────────────────────────────
 *
 * Every page here is lazy-loaded, so every first visit to a route waits on a
 * network fetch. Measured on this build, warm navigations land in **53–93 ms**
 * and a cold one — the first visit to a route, chunk not yet cached — in about
 * **380 ms**. A spinner shown immediately therefore appears and vanishes inside
 * 60 ms on most navigations, which reads as a flicker, not as progress: the eye
 * registers that something happened without registering what.
 *
 * So nothing renders for the first 150 ms. Under that, the page simply arrives.
 * Over it, the reader gets a skeleton — and by then they have waited long enough
 * to want one. 150 ms is above every warm navigation measured and well below the
 * cold one, which is the gap the threshold is chosen to sit in.
 *
 * ── Why it is shaped ──────────────────────────────────────────────────────
 *
 * A centred spinner tells you the app is busy. A skeleton in the shape of the
 * page tells you what is coming, so the layout does not jump when it lands and
 * the wait does not feel like a blank. One `<Suspense>` wraps every route, so it
 * cannot know which page is loading from its children — it reads the path
 * instead. `shapeFor()` is the whole of that mapping, and an unrecognised path
 * gets the list shape, which is what most pages here are.
 *
 * This is deliberately NOT a per-page skeleton component. The pages already own
 * those, for their own data loading (`DocumentsSkeleton` and friends); this one
 * runs before the page's code exists to render anything at all.
 */
const DELAY_MS = 150;

type Shape = "stats" | "list" | "detail" | "calendar" | "editor" | "form";

/**
 * Which skeleton a path gets. Order matters: the specific before the general.
 *
 * Not exported — this module exports a component and nothing else, or Fast
 * Refresh stops working for the whole file.
 */
function shapeFor(path: string): Shape {
  if (path === "/dashboard" || path.startsWith("/kpi")) return "stats";
  if (path.startsWith("/calendar")) return "calendar";
  if (path.startsWith("/drafting")) return "editor";
  // A matter's own page, not the register: "/cases" is a list, "/cases/12" is a
  // detail, and the two look nothing alike.
  if (/^\/cases\/[^/]+/.test(path)) return "detail";
  if (
    path.startsWith("/complete-profile") ||
    path.startsWith("/create-chamber") ||
    path.startsWith("/choose-plan")
  ) {
    return "form";
  }
  return "list";
}

function Rows({ count, className }: { count: number; className?: string }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={className ?? "h-16 w-full"} />
      ))}
    </>
  );
}

/** A page heading and its subtitle — every page here opens with one. */
function Heading() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
    </div>
  );
}

function Body({ shape }: { shape: Shape }) {
  switch (shape) {
    case "stats":
      return (
        <div className="space-y-6">
          <Heading />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Rows count={4} className="h-28 w-full" />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        </div>
      );
    case "calendar":
      return (
        <div className="space-y-4">
          <div className="flex justify-between gap-4">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-9 w-36" />
          </div>
          <Skeleton className="h-[560px] w-full" />
        </div>
      );
    case "editor":
      return (
        <div className="space-y-6">
          <Heading />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      );
    case "detail":
      return (
        <div className="space-y-6">
          {/* The matter header block, then the tab bar, then the vault rows —
              the three things a matter page opens with, in that order. */}
          <Skeleton className="h-32 w-full" />
          <div className="flex gap-8">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-20" />
          </div>
          <div className="space-y-3">
            <Rows count={4} />
          </div>
        </div>
      );
    case "form":
      return (
        <div className="mx-auto max-w-xl space-y-6">
          <Heading />
          <div className="space-y-4">
            <Rows count={4} className="h-11 w-full" />
          </div>
          <Skeleton className="h-11 w-40" />
        </div>
      );
    case "list":
    default:
      return (
        <div className="space-y-6">
          <Heading />
          <div className="space-y-3">
            <Rows count={6} />
          </div>
        </div>
      );
  }
}

export function RouteFallback() {
  const [location] = useLocation();
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Reset on every navigation, so a slow route after a fast one still gets
    // its own quiet 150 ms rather than inheriting the last one's timer.
    setShow(false);
    const t = window.setTimeout(() => setShow(true), DELAY_MS);
    return () => window.clearTimeout(t);
  }, [location]);

  if (!show) return null;

  return (
    // `aria-busy` and the live region are what a screen reader gets; the
    // skeleton itself is decorative and says nothing.
    <div aria-busy="true" aria-live="polite">
      <Body shape={shapeFor(location)} />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
