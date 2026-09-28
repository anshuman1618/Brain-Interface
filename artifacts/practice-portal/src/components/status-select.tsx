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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSession } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { userMessage } from "@/lib/errors";
import { Plus } from "lucide-react";

/** Chosen from the list to reveal the add-a-status field. */
const ADD = "__add__";

/**
 * Picks a matter's workflow status from the chamber's own list.
 *
 * The sibling of `StagePicker`, and deliberately the same shape: the
 * vocabulary comes from the server rather than being hardcoded in the browser,
 * and adding to it happens inside the picker rather than on a settings page,
 * because the moment somebody notices a status is missing is the moment they
 * are trying to set it.
 *
 * It replaced two hardcoded four-item dropdowns — one on the new-matter form,
 * one on the matter page. Those were unreachable by a chamber's own additions
 * and would have shown four options while the register showed six.
 *
 * Unlike StagePicker there is no "none": a matter always has a status, and the
 * column has never been nullable.
 */
export function StatusSelect({
  value,
  onChange,
  disabled,
  className,
  /** Renders "STATUS: OPEN" rather than "Open", for the matter page's header. */
  prefixed = false,
}: {
  value: string;
  onChange: (status: string) => void;
  disabled?: boolean;
  className?: string;
  prefixed?: boolean;
}) {
  const { can } = useSession();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");

  const { data: statuses, isLoading } = useListCaseStatuses({
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
      <div className={`flex items-center gap-2 ${className ?? ""}`}>
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
          className="h-10 rounded-lg"
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

  return (
    <Select
      disabled={disabled || isLoading}
      value={value}
      onValueChange={(v) => {
        if (v === ADD) {
          setAdding(true);
          return;
        }
        onChange(v);
      }}
    >
      <SelectTrigger className={className ?? "rounded-lg"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.key} value={o.key}>
            {prefixed ? `STATUS: ${o.label.toUpperCase()}` : o.label}
          </SelectItem>
        ))}
        {canAdd && (
          <>
            <SelectSeparator />
            <SelectItem value={ADD}>
              <span className="flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add a status…
              </span>
            </SelectItem>
          </>
        )}
      </SelectContent>
    </Select>
  );
}
