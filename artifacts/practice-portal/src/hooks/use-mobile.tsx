import * as React from "react";

/**
 * 768px — Tailwind's `md`, and deliberately the same line `AdaptiveTable`
 * switches between cards and a real table. One number so a page cannot be in
 * "phone" layout while a component on it thinks otherwise.
 */
const MOBILE_BREAKPOINT = 768;

function measure(): boolean {
  // This is a client-only SPA (Vite, no SSR), so `window` is always there. The
  // guard is for the one case that is not a browser: the Playwright suite
  // evaluating module scope before a page exists.
  if (typeof window === "undefined") return false;
  return window.innerWidth < MOBILE_BREAKPOINT;
}

/**
 * True while the viewport is narrower than `md`.
 *
 * Measured synchronously for the FIRST render, not from an effect. This used to
 * initialise to `undefined` and correct itself afterwards, which is invisible
 * for anything that only styles — but wrong for anything that reads it once to
 * seed state. The calendar picks its initial view from this: with the old
 * hook every phone got the month grid, because the effect had not run yet when
 * `useState` took its initial value.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(measure);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(measure());
    mql.addEventListener("change", onChange);
    // Re-read on mount: the viewport can change between module evaluation and
    // the effect firing (a rotation during startup, or a restored window size).
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
