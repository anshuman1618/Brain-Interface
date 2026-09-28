import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCaseStatuses,
  useAddCaseStatus,
  getListCaseStatusesQueryKey,
  type StatusOption,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { userMessage } from "@/lib/errors";
import { Plus } from "lucide-react";

/**
 * The register's status filter, as chips rather than a dropdown, with "Add
 * status" at the end.
 *
 * ── Why chips and not the Select it replaced ──────────────────────────────
 *
 * The filter was a four-value dropdown, which hides both the vocabulary and
 * the distribution: you could not see that a chamber has eleven matters in
 * review without opening it and clicking through. A register is a screen
 * somebody scans, and the counts are the useful part.
 *
 * It is also the screen where the vocabulary is most obviously missing
 * something. `StagePicker` puts "Add a stage…" inside the picker for the same
 * reason — the moment somebody notices a status is absent is the moment they
 * are looking for it — so the add lives here rather than on a settings page
 * nobody visits.
 *
 * Counts come from the caller, not from a second query: the register already
 * holds every matter it is about to render, and asking the server for numbers
 * it just sent would be a round trip to recount rows in memory.
 */
export function StatusChips({
  value,
  onChange,
  counts,
  total,
}: {
  /** The selected status key, or null for "all". */
  value: string | null;
  onChange: (status: string | null) => void;
  /** How many matters carry each status key, from the rows already loaded. */
  counts: Record<string, number>;
  total: number;
}) {
  const { can } = useSession();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");

  const { data: statuses } = useListCaseStatuses({
    query: { queryKey: getListCaseStatusesQueryKey() },
  });
  const addStatus = useAddCaseStatus();

  const canAdd = can("cases.write");
  const options: StatusOption[] = statuses?.options ?? [];

  const submitNew = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    addStatus.mutate(
      { data: { label: trimmed } },
      {
        onSuccess: (result) => {
          setAdding(false);
          setLabel("");
          queryClient.setQueryData(getListCaseStatusesQueryKey(), result);
          // Select what was just added, the same as StagePicker does. Adding a
          // status and then having to find it in the row is a worse ending.
          const added = result.options.find((o) => o.label === trimmed);
          if (added) onChange(added.key);
        },
        onError: (err) =>
          toast({
            title: "Could not add that status",
            description: userMessage(err),
            variant: "destructive",
          }),
      },
    );
  };

  if (adding) {
    return (
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={label}
          maxLength={40}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitNew();
            }
            if (e.key === "Escape") setAdding(false);
          }}
          placeholder="e.g. On hold"
          className="h-10 w-[200px] rounded-lg"
          aria-label="New status name"
        />
        <Button
          size="sm"
          className="shrink-0 rounded-lg"
          disabled={!label.trim() || addStatus.isPending}
          onClick={submitNew}
        >
          Add
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 rounded-lg"
          onClick={() => setAdding(false)}
        >
          Cancel
        </Button>
      </div>
    );
  }

  const chip = (active: boolean) =>
    `rounded-[var(--radius)] px-3 py-1.5 font-mono text-2xs uppercase tracking-widest transition-colors ${
      active
        ? "bg-foreground text-background"
        : "bg-card text-muted-foreground shadow-sm hover:text-foreground"
    }`;

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
      <button
        type="button"
        aria-pressed={value === null}
        onClick={() => onChange(null)}
        className={chip(value === null)}
      >
        All ({total})
      </button>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          // Clicking the selected chip clears it, so there is a way back to All
          // without travelling to the other end of the row.
          onClick={() => onChange(value === o.key ? null : o.key)}
          className={chip(value === o.key)}
        >
          {o.label} ({counts[o.key] ?? 0})
        </button>
      ))}
      {canAdd && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-[var(--radius)] border border-dashed border-border px-3 py-1.5 font-mono text-2xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="flex items-center gap-1.5">
            <Plus className="h-3 w-3" /> Add status
          </span>
        </button>
      )}
    </div>
  );
}
