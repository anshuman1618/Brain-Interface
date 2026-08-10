import { Skeleton } from "@/components/ui/skeleton";

/** Loading placeholder shaped like the calendar grid it replaces. */
export function CalendarSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="flex justify-between gap-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-36" />
      </div>
      <Skeleton className="h-[560px] w-full" />
      <span className="sr-only">Loading calendar…</span>
    </div>
  );
}

/** Loading placeholder shaped like a document list. */
export function DocumentsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border border-border bg-background p-4 flex items-center gap-4">
          <Skeleton className="h-9 w-9 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-8 w-24 shrink-0" />
        </div>
      ))}
      <span className="sr-only">Loading documents…</span>
    </div>
  );
}

/** Loading placeholder shaped like a feedback card list. */
export function FeedbackSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border border-border bg-background p-5 space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
      <span className="sr-only">Loading feedback…</span>
    </div>
  );
}
