import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCaseStages,
  useAddCaseStage,
  getListCaseStagesQueryKey,
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

/** The Select's stand-in for null. Radix treats "" as "no value selected". */
const NONE = "__none__";
/** Chosen from the list to reveal the add-a-stage field. */
const ADD = "__add__";

/**
 * Picks which stage of the matter a paper belongs to.
 *
 * The vocabulary comes from the server — the standard stages for the matter's
 * forum group plus whatever this chamber has added — rather than being a
 * hardcoded list in the browser. That is what lets a chamber's addition show up
 * on the next matter of the same kind without a deploy, and it is why this
 * component takes a `caseId` rather than a list of options.
 *
 * ── Why adding a stage lives inside the picker ────────────────────────────
 *
 * The moment somebody discovers the list is missing a stage is the moment they
 * are trying to file a paper under it. Sending them to a settings page to add
 * one and then back to the upload they abandoned is how a controlled vocabulary
 * gets abandoned in favour of typing it into the filename. `cases.write` gates
 * the add, so a client uploading a document sees the list without the option to
 * extend it.
 */
export function StagePicker({
  caseId,
  value,
  onChange,
  disabled,
  className,
  placeholder = "No stage",
}: {
  caseId: number;
  /** The stage key, or null for unfiled. */
  value: string | null;
  onChange: (stage: string | null) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const { can } = useSession();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");

  const { data: stages, isLoading } = useListCaseStages(caseId, {
    query: { enabled: !!caseId, queryKey: getListCaseStagesQueryKey(caseId) },
  });
  const addStage = useAddCaseStage();

  const canAdd = can("cases.write");
  const options = stages?.options ?? [];

  const submitNew = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    addStage.mutate(
      { caseId, data: { label: trimmed } },
      {
        onSuccess: (result) => {
          setAdding(false);
          setLabel("");
          queryClient.setQueryData(getListCaseStagesQueryKey(caseId), result);
          // Select what they just added. Anything else means typing a stage and
          // then having to find it in the list.
          const added = result.options.find((o) => o.label === trimmed);
          if (added) onChange(added.key);
        },
        onError: (err) => {
          toast({
            title: "Could not add that stage",
            description: userMessage(err),
            variant: "destructive",
          });
        },
      },
    );
  };

  if (adding) {
    return (
      <div className={`flex items-center gap-2 ${className ?? ""}`}>
        <Input
          autoFocus
          value={label}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitNew();
            }
            if (e.key === "Escape") setAdding(false);
          }}
          placeholder="e.g. Caveat"
          className="h-10 rounded-lg"
          aria-label="New stage name"
        />
        <Button
          size="sm"
          className="rounded-lg shrink-0"
          disabled={!label.trim() || addStage.isPending}
          onClick={submitNew}
        >
          Add
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="rounded-lg shrink-0"
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
      value={value ?? NONE}
      onValueChange={(v) => {
        if (v === ADD) {
          setAdding(true);
          return;
        }
        onChange(v === NONE ? null : v);
      }}
    >
      <SelectTrigger className={`rounded-lg ${className ?? ""}`}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.key} value={o.key}>
            {o.label}
          </SelectItem>
        ))}
        {canAdd && (
          <>
            <SelectSeparator />
            <SelectItem value={ADD}>
              <span className="flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add a stage…
              </span>
            </SelectItem>
          </>
        )}
      </SelectContent>
    </Select>
  );
}
