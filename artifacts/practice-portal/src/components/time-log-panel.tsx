import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTimeEntries,
  useCreateTimeEntry,
  useDeleteTimeEntry,
  useGetRunningTimer,
  useStartTimer,
  useStopTimer,
  getListTimeEntriesQueryKey,
  getGetRunningTimerQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Play, Square, Plus, Trash2, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/lib/session";
import { formatMinutes } from "@/lib/format";
import { userMessage } from "@/lib/errors";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Log time against a matter: a timer for work happening now, a short form for
 * work already done.
 *
 * Both exist because both are how people actually work. Nobody starts a timer
 * before a corridor conversation, and nobody reconstructs a three-hour drafting
 * session from memory if a timer was running. The form is deliberately four
 * fields — if logging time takes longer than a few seconds it does not get done,
 * and an effort metric built on data nobody enters is worse than no metric.
 */
export function TimeLogPanel({ caseId }: { caseId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { can } = useSession();

  const canWrite = can("time.write");

  const { data: entries = [], isLoading } = useListTimeEntries(
    { caseId },
    { query: { queryKey: getListTimeEntriesQueryKey({ caseId }) } },
  );
  const { data: timer } = useGetRunningTimer({
    query: { queryKey: getGetRunningTimerQueryKey(), enabled: canWrite, refetchInterval: 60_000 },
  });

  const createEntry = useCreateTimeEntry();
  const deleteEntry = useDeleteTimeEntry();
  const startTimer = useStartTimer();
  const stopTimer = useStopTimer();

  const [minutes, setMinutes] = useState("");
  const [workDate, setWorkDate] = useState(today);
  const [description, setDescription] = useState("");
  const [billable, setBillable] = useState(true);

  // Ticks the running timer's display without asking the server every second.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [timer]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListTimeEntriesQueryKey({ caseId }) });
    queryClient.invalidateQueries({ queryKey: getGetRunningTimerQueryKey() });
  };

  const fail = (title: string) => (err: unknown) =>
    toast({ title, description: userMessage(err), variant: "destructive" });

  const runningHere = timer && timer.caseId === caseId;
  const runningElsewhere = timer && timer.caseId !== caseId;

  const liveMinutes = timer
    ? Math.max(0, Math.floor((Date.now() - new Date(timer.startedAt).getTime()) / 60_000))
    : 0;

  const minutesValue = Number(minutes);
  const canSubmit =
    Number.isInteger(minutesValue) && minutesValue >= 1 && minutesValue <= 1440 && !!workDate;

  const submit = () => {
    if (!canSubmit) return;
    createEntry.mutate(
      {
        data: {
          caseId,
          workDate,
          minutes: minutesValue,
          description: description.trim() || undefined,
          billable,
        },
      },
      {
        onSuccess: () => {
          setMinutes("");
          setDescription("");
          refresh();
          toast({ title: "Time logged" });
        },
        onError: fail("Couldn't log that time"),
      },
    );
  };

  const total = entries.reduce((sum, e) => sum + e.minutes, 0);
  const billableTotal = entries.filter((e) => e.billable).reduce((sum, e) => sum + e.minutes, 0);

  return (
    <div className="space-y-6">
      {canWrite && (
        <div className="rounded-lg bg-card shadow-sm p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Clock className="h-5 w-5 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-sm">
                  {runningHere
                    ? `Running — ${formatMinutes(liveMinutes)}`
                    : runningElsewhere
                      ? "A timer is running on another matter"
                      : "No timer running"}
                </p>
                <p className="text-2xs text-muted-foreground">
                  {runningElsewhere
                    ? `Starting one here banks the time on "${timer?.caseTitle}" first.`
                    : "Time is recorded in whole minutes."}
                </p>
              </div>
            </div>

            {runningHere ? (
              <Button
                variant="destructive"
                className="rounded-lg"
                disabled={stopTimer.isPending}
                onClick={() =>
                  stopTimer.mutate(undefined, {
                    onSuccess: (entry) => {
                      refresh();
                      toast({
                        title: "Timer stopped",
                        description: `${formatMinutes(entry.minutes)} logged.`,
                      });
                    },
                    onError: fail("Couldn't stop the timer"),
                  })
                }
              >
                <Square className="mr-2 h-4 w-4" /> Stop
              </Button>
            ) : (
              <Button
                className="rounded-lg"
                disabled={startTimer.isPending}
                onClick={() =>
                  startTimer.mutate(
                    { data: { caseId } },
                    { onSuccess: refresh, onError: fail("Couldn't start the timer") },
                  )
                }
              >
                <Play className="mr-2 h-4 w-4" /> Start timer
              </Button>
            )}
          </div>
        </div>
      )}

      {canWrite && (
        <div className="rounded-lg bg-card shadow-sm p-4 sm:p-5 space-y-4">
          <p className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
            Log time already worked
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="time-minutes">Minutes *</Label>
              <Input
                id="time-minutes"
                type="number"
                inputMode="numeric"
                min={1}
                max={1440}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                placeholder="45"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="time-date">Date *</Label>
              <Input
                id="time-date"
                type="date"
                value={workDate}
                max={today()}
                onChange={(e) => setWorkDate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="time-billable">Billable</Label>
              <div className="flex items-center gap-2 h-9">
                <Checkbox
                  id="time-billable"
                  checked={billable}
                  onCheckedChange={(v) => setBillable(v === true)}
                />
                <span className="text-sm text-muted-foreground">
                  {billable ? "Chargeable" : "Not chargeable"}
                </span>
              </div>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="time-note">What was done</Label>
            <Textarea
              id="time-note"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="rounded-lg resize-none"
              placeholder="Drafting, conference, court attendance…"
            />
          </div>
          <div className="flex justify-end">
            <Button
              className="rounded-lg"
              disabled={!canSubmit || createEntry.isPending}
              onClick={submit}
            >
              <Plus className="mr-2 h-4 w-4" />
              {createEntry.isPending ? "Logging..." : "Log time"}
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-border">
          <p className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
            Logged on this matter
          </p>
          {entries.length > 0 && (
            <p className="text-xs font-mono text-muted-foreground">
              {formatMinutes(total)} total &middot; {formatMinutes(billableTotal)} billable
            </p>
          )}
        </div>

        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-medium text-sm">No time logged yet</p>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed max-w-sm mx-auto">
              Hours recorded here are what the chamber's effort figures are built from. Nothing else
              in the app infers them.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-4 sm:px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{formatMinutes(e.minutes)}</span>
                    <span className="text-muted-foreground"> · {e.userName || "—"}</span>
                    {!e.billable && (
                      <span className="text-2xs font-mono uppercase tracking-wider text-muted-foreground border border-border rounded-lg px-1.5 py-0.5 ml-2">
                        Non-billable
                      </span>
                    )}
                  </p>
                  {e.description && (
                    <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
                      {e.description}
                    </p>
                  )}
                  <p className="text-3xs font-mono uppercase tracking-wider text-muted-foreground mt-1">
                    {e.workDate}
                  </p>
                </div>
                {canWrite && (
                  <button
                    type="button"
                    aria-label="Delete this entry"
                    onClick={() =>
                      deleteEntry.mutate(
                        { id: e.id },
                        { onSuccess: refresh, onError: fail("Couldn't delete that entry") },
                      )
                    }
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0 rounded-lg p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
