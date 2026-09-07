import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { userMessage } from "@/lib/errors";

/**
 * What a list shows when its query failed.
 *
 * ── The gap this closes ───────────────────────────────────────────────────
 *
 * No page handled `isError`. Every list rendered its loading skeleton, then
 * its data, then — if the request failed — its **empty state**. A dropped
 * connection, a 500, or a session that expired mid-session all produced "No
 * matters yet", which is not merely unhelpful but actively wrong: it tells a
 * chamber its files are gone.
 *
 * `ErrorBoundary` does not catch this. It catches a component that throws
 * during render; TanStack Query does not throw by default, it returns an error
 * and keeps rendering. So the boundary sat there looking like coverage and
 * covering nothing.
 *
 * ── Why one component rather than a block per page ────────────────────────
 *
 * Twenty pages writing their own failure state is twenty chances to phrase it
 * differently, forget the retry, or leak `ApiError.message` — which leads with
 * a status code and is written for a console. `userMessage()` is the one place
 * that turns an error into something a person should read, and routing every
 * failure through here is what keeps that true.
 *
 * Deliberately not a toast: a toast disappears, and the empty screen it leaves
 * behind is the same lie. This stays where the data would have been.
 */
export function LoadFailed({
  error,
  onRetry,
  what = "this",
}: {
  error: unknown;
  onRetry: () => void;
  /** Named in the sentence: "Could not load your matters." */
  what?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-[var(--radius)] bg-card p-5 shadow-[var(--raise)] sm:flex-row sm:items-center"
    >
      <AlertCircle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Could not load {what}.</p>
        {/* The cause, in words written for a person. Never the raw message —
            that leads with a status code and is meant for a console. */}
        <p className="mt-0.5 text-sm text-muted-foreground">{userMessage(error)}</p>
      </div>
      <Button variant="outline" size="sm" className="shrink-0 rounded-lg" onClick={onRetry}>
        <RotateCw className="mr-2 h-4 w-4" /> Try again
      </Button>
    </div>
  );
}
