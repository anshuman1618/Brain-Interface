import { useListAuditEvents, getListAuditEventsQueryKey } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/utils";
import { ShieldCheck, Info } from "lucide-react";

/**
 * The chamber's audit log.
 *
 * Read-only by design — there is no edit or delete affordance anywhere on this
 * screen, because a log that can be changed is not evidence of anything. The
 * API has no such endpoint either.
 */

const TONE: Record<string, string> = {
  "access.granted": "text-primary",
  "access.revoked": "text-destructive",
  "member.removed": "text-destructive",
  "erasure.completed": "text-destructive",
  "case.conflict_acknowledged": "text-destructive",
  "document.downloaded": "text-muted-foreground",
};

function label(action: string): string {
  return action.replace(/[._]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function ActivityPage() {
  const { data, isLoading } = useListAuditEvents(
    { limit: 200 },
    { query: { queryKey: getListAuditEventsQueryKey({ limit: 200 }) } },
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-1">Activity</h2>
        <p className="text-muted-foreground text-sm">
          Every privileged action in this chamber, newest first. This record cannot be edited or
          deleted from anywhere in the application.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !data?.length ? (
        <div className="rounded-lg bg-card shadow-sm p-8 sm:p-12 text-center">
          <ShieldCheck className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="font-mono uppercase tracking-widest text-xs text-muted-foreground">
            Nothing recorded yet
          </p>
        </div>
      ) : (
        <div className="rounded-lg bg-card shadow-sm overflow-hidden divide-y divide-border">
          {data.map((e) => (
            <div key={e.id} className="p-4 flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4">
              <div className="sm:w-44 shrink-0 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                {formatDateTime(e.at)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`font-mono text-[10px] uppercase tracking-widest font-semibold ${
                      TONE[e.action] ?? "text-foreground"
                    }`}
                  >
                    {label(e.action)}
                  </span>
                  {e.actorName && (
                    <span className="text-xs text-muted-foreground">
                      by {e.actorName}
                      {e.actorRole ? ` (${e.actorRole.replace(/_/g, " ")})` : ""}
                    </span>
                  )}
                </div>
                <p className="text-sm mt-0.5 break-words">{e.summary}</p>
              </div>
              {e.ip && (
                <div className="font-mono text-[10px] text-muted-foreground shrink-0">{e.ip}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-start gap-2 text-xs text-muted-foreground border border-border bg-muted/30 p-3">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <p>
          Addresses are recorded to the network only, never the exact host — enough to spot an
          anomaly, not enough to track where someone was.
        </p>
      </div>
    </div>
  );
}
