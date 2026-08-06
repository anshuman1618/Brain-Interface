import { useState } from "react";
import {
  useListErasureRequests,
  useRequestErasure,
  useDecideErasure,
  getListErasureRequestsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/lib/session";
import { customFetch } from "@workspace/api-client-react";
import { Download, ShieldOff, Info } from "lucide-react";
import { formatDateTime } from "@/lib/utils";

/**
 * Data rights, on one screen.
 *
 * Export is immediate and self-service. Erasure is a request, because a
 * chamber has retention obligations over the files of matters it fought and a
 * client cannot unilaterally remove them — what erasure removes is the link
 * between those records and a named person.
 */
export default function PrivacyPage() {
  const { can } = useSession();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [downloading, setDownloading] = useState(false);

  const canManage = can("privacy.manage");
  const { data: requests, isLoading } = useListErasureRequests({
    query: { queryKey: getListErasureRequestsQueryKey() },
  });
  const request = useRequestErasure();
  const decide = useDecideErasure();

  const mine = requests?.find((r) => r.status === "pending");

  /**
   * Fetched rather than linked: the export needs the session and workspace
   * headers the API client attaches, which a plain anchor would not send.
   */
  const download = async () => {
    setDownloading(true);
    try {
      // customFetch carries the same auth and workspace headers as every
      // generated call; a bare fetch would send neither and 401.
      const blob = await customFetch<Blob>("/api/privacy/export", { responseType: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "lex-practice-export.json";
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export downloaded" });
    } catch (err) {
      toast({
        title: "Could not export",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  };

  const ask = () => {
    request.mutate(
      { data: { reason: reason.trim() || undefined } },
      {
        onSuccess: () => {
          setReason("");
          queryClient.invalidateQueries({ queryKey: getListErasureRequestsQueryKey() });
          toast({ title: "Erasure requested", description: "Your chamber will review it." });
        },
        onError: (e: Error) =>
          toast({
            title: "Could not request erasure",
            description: e.message,
            variant: "destructive",
          }),
      },
    );
  };

  const settle = (id: number, decision: "complete" | "reject") => {
    decide.mutate(
      { id, data: { decision, note: note.trim() || undefined } },
      {
        onSuccess: () => {
          setNote("");
          queryClient.invalidateQueries({ queryKey: getListErasureRequestsQueryKey() });
          toast({ title: decision === "complete" ? "Data erased" : "Request declined" });
        },
        onError: (e: Error) =>
          toast({ title: "Could not decide", description: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-1">Your data</h2>
        <p className="text-muted-foreground text-sm">
          Take a copy of everything this chamber holds about you, or ask for it to be erased.
        </p>
      </div>

      <section className="border border-border bg-background p-5 sm:p-6">
        <h3 className="font-mono uppercase tracking-widest text-xs font-bold mb-2">
          Download a copy
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          A JSON file with your profile, your matters, the documents on them, the requests addressed
          to you, and any feedback you left.
        </p>
        <Button onClick={download} disabled={downloading} className="rounded-none w-full sm:w-auto">
          <Download className="mr-2 h-4 w-4" />
          {downloading ? "Preparing..." : "Download my data"}
        </Button>
      </section>

      <section className="border border-border bg-background p-5 sm:p-6">
        <h3 className="font-mono uppercase tracking-widest text-xs font-bold mb-2">
          Ask for erasure
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Your name and email are removed and your access is revoked. Case files the chamber is
          required to retain remain, but stop being linked to you.
        </p>

        {mine ? (
          <div className="border border-primary bg-primary/5 p-4 text-sm">
            <strong className="font-mono uppercase tracking-wider text-xs">
              Awaiting a decision
            </strong>
            <p className="mt-1 text-muted-foreground">
              Requested {formatDateTime(mine.createdAt)}
              {mine.reason ? ` — "${mine.reason}"` : ""}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional)"
              rows={2}
              className="rounded-none"
            />
            <Button
              variant="outline"
              onClick={ask}
              disabled={request.isPending}
              className="rounded-none w-full sm:w-auto text-destructive border-destructive hover:bg-destructive/10"
            >
              <ShieldOff className="mr-2 h-4 w-4" />
              {request.isPending ? "Sending..." : "Request erasure"}
            </Button>
          </div>
        )}
      </section>

      {canManage && (
        <section className="border border-border bg-background">
          <div className="px-5 sm:px-6 py-4 border-b border-border bg-muted/30">
            <h3 className="font-mono uppercase tracking-widest text-xs font-bold">
              Erasure requests
            </h3>
          </div>
          {isLoading ? (
            <div className="p-6 space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : !requests?.length ? (
            <p className="p-8 text-center font-mono uppercase tracking-widest text-xs text-muted-foreground">
              None received
            </p>
          ) : (
            <div className="divide-y divide-border">
              {requests.map((r) => (
                <div key={r.id} className="p-5 sm:p-6 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.requestedName || r.requestedEmail}</span>
                    <span
                      className={`font-mono text-[10px] uppercase tracking-widest px-2 py-0.5 border ${
                        r.status === "pending"
                          ? "border-primary text-primary"
                          : r.status === "completed"
                            ? "border-destructive text-destructive"
                            : "border-border text-muted-foreground"
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>
                  {r.reason && <p className="text-sm text-muted-foreground">"{r.reason}"</p>}
                  {r.decisionNote && (
                    <p className="text-sm border-l-2 border-border pl-3">{r.decisionNote}</p>
                  )}
                  {r.status === "pending" && (
                    <div className="space-y-2">
                      <Textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Note to the requester (optional)"
                        rows={2}
                        className="rounded-none"
                      />
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Button
                          className="rounded-none"
                          disabled={decide.isPending}
                          onClick={() => settle(r.id, "complete")}
                        >
                          Erase their data
                        </Button>
                        <Button
                          variant="outline"
                          className="rounded-none"
                          disabled={decide.isPending}
                          onClick={() => settle(r.id, "reject")}
                        >
                          Decline
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="flex items-start gap-2 text-xs text-muted-foreground border border-border bg-muted/30 p-3">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <p>
          Erasure cannot remove records the chamber must retain under its professional obligations.
          It removes the link between those records and you.
        </p>
      </div>
    </div>
  );
}
