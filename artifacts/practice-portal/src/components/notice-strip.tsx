import { useCallback, useMemo, useState } from "react";
import { NoticeSlotContext } from "@/lib/notice-slot";
import { AlertCircle, ChevronDown } from "lucide-react";

/**
 * One strip where three stacked banners used to be.
 *
 * The dashboard opened with a queue: the plan banner, the bar-credentials
 * notice and the AI-drafting notice, each a full-width alert, each pushing the
 * greeting and the actual work further down. Every one of them is real and
 * worth surfacing — a chamber that misses the six-month bar deadline has a
 * genuine problem — but three alerts before any content is a screen that opens
 * by making demands, and people learn to scroll past all three together.
 *
 * They now collapse into a single row that says how many there are and expands
 * on click. Nothing is removed, and nothing is dropped by a priority rule the
 * reader cannot see.
 *
 * ── How the count works ──────────────────────────────────────────────────
 *
 * Each notice decides for itself whether it applies — the credentials one from
 * the bar deadline, the drafting one from a budget query, the plan one from the
 * subscription. None of that is visible from out here, so the strip cannot
 * count by inspection. Each notice calls `useNoticeSlot(id, applies)` instead,
 * which registers it while it applies and deregisters when it stops.
 *
 * The notices always render their body when they apply. **Showing and hiding is
 * the strip's job, done with one wrapper**, rather than each notice returning
 * null when collapsed — two sources of truth for the same decision is how they
 * drift apart.
 */

export function NoticeStrip({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);

  const register = useCallback((id: string) => {
    setIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);
  const deregister = useCallback((id: string) => {
    setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev));
  }, []);

  const value = useMemo(() => ({ register, deregister }), [register, deregister]);
  const count = ids.length;

  return (
    <NoticeSlotContext.Provider value={value}>
      {count > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mb-3 flex w-full items-center gap-3 rounded-[var(--radius)] bg-secondary px-3 py-2.5 text-left text-secondary-foreground shadow-[var(--raise)] min-h-11"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 text-sm font-medium">
            {count === 1 ? "1 thing needs your attention" : `${count} things need your attention`}
          </span>
          <span className="font-mono text-2xs uppercase tracking-wider">
            {expanded ? "Hide" : "Show"}
          </span>
          {/* The only transform in the signed-in application. A caret that does
              not turn is a caret people click twice — it is a state indicator,
              not decoration, which is why it survives the no-motion rule. */}
          <ChevronDown
            className={`h-4 w-4 shrink-0 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      )}

      {/*
        Always mounted, so the notices can run their queries and register.
        `hidden` rather than unmounting: unmounting would deregister them, the
        count would fall to zero, the strip would disappear, and they would
        mount again — a loop.
      */}
      <div className={count > 0 && expanded ? "space-y-3 mb-3" : "hidden"}>{children}</div>
    </NoticeSlotContext.Provider>
  );
}
