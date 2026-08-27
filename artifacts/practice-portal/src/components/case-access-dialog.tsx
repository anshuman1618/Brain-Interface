import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCaseAccess,
  useSetCaseAccess,
  useListCases,
  getGetCaseAccessQueryKey,
  getListCasesQueryKey,
  type Case,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { userMessage } from "@/lib/errors";

/**
 * Narrowing one junior advocate or clerk to named matters.
 *
 * ── What the switch actually does ────────────────────────────────────────
 *
 * Off, the member's role decides what they see: a junior advocate sees the
 * whole chamber, a clerk sees the matters they hold a task on. On, that is
 * REPLACED — not filtered — by "the matters you are assigned, plus the ones
 * ticked here". Replaced rather than intersected because a junior's row scope
 * is already `all`, and intersecting with `all` would leave the restriction
 * doing nothing at all. The server does the same thing for the same reason;
 * see `visibleCaseIds` in lib/scope.ts.
 *
 * That is why assigned matters are not in the tick list and cannot be
 * un-ticked: a person handed a task must be able to open the file it is on, or
 * the task is unworkable. The list here is the additions on top.
 *
 * ── The list is sent whole ───────────────────────────────────────────────
 *
 * PUT replaces the entire grant set rather than adding and removing. A stale
 * tab cannot silently re-grant a matter an admin has just taken away, because
 * what it sends is a complete picture and the last complete picture wins.
 *
 * Only a junior advocate or a clerk can be narrowed. A senior advocate directs
 * the chamber's work; a client is already confined to their own matter by row
 * scope, and a second mechanism on top would give two places to look when
 * somebody cannot see something. The server refuses anyone else with a 400, so
 * the caller gates the button rather than discovering it here.
 */

export function CaseAccessDialog({
  membershipId,
  memberName,
  open,
  onOpenChange,
}: {
  membershipId: number | null;
  memberName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: access, isLoading } = useGetCaseAccess(membershipId ?? 0, {
    query: {
      enabled: open && membershipId !== null,
      queryKey: getGetCaseAccessQueryKey(membershipId ?? 0),
    },
  });
  const { data: cases = [] } = useListCases(undefined, {
    query: { enabled: open, queryKey: getListCasesQueryKey() },
  });
  const save = useSetCaseAccess();

  const [restricted, setRestricted] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);

  // Seeded from the server each time the dialog opens, never held across
  // openings — a second admin may have changed it in between.
  useEffect(() => {
    if (!access) return;
    setRestricted(access.restricted);
    setPicked(access.grantedCaseIds);
  }, [access]);

  const toggle = (id: number) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = () => {
    if (membershipId === null) return;
    save.mutate(
      // The tick list is sent even when the switch is off, so turning the
      // restriction back on restores what was chosen rather than starting
      // blank. Nothing is enforced while `restricted` is false.
      { id: membershipId, data: { restricted, caseIds: picked } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCaseAccessQueryKey(membershipId) });
          toast({
            title: restricted ? "Access narrowed" : "Restriction lifted",
            description: restricted
              ? `${memberName} sees their assigned matters and ${picked.length} more.`
              : `${memberName} sees what their role allows.`,
          });
          onOpenChange(false);
        },
        onError: (err: Error) =>
          toast({
            title: "Could not change that",
            description: userMessage(err, "Try again."),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Case access — {memberName}</DialogTitle>
          <DialogDescription>
            Limit which matters this person can open. Off, their role decides; on, they see the
            matters they are assigned plus whichever you tick here.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-[var(--radius)] bg-muted/40 p-3">
              <Label htmlFor="restrict-switch" className="text-sm font-medium">
                Limit this person to named matters
              </Label>
              <Switch
                id="restrict-switch"
                checked={restricted}
                onCheckedChange={setRestricted}
                aria-describedby="restrict-note"
              />
            </div>

            <p
              id="restrict-note"
              className="flex items-start gap-1.5 text-2xs text-muted-foreground"
            >
              <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              Matters they hold a task on stay visible whatever is ticked — a person given work must
              be able to open the file it is on.
            </p>

            <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-[var(--radius)] border border-border p-3">
              {cases.length === 0 ? (
                <p className="text-2xs text-muted-foreground">
                  This chamber has no matters yet. There is nothing to grant.
                </p>
              ) : (
                cases.map((c: Case) => (
                  <label
                    key={c.id}
                    className={`flex items-start gap-2 text-2xs ${
                      restricted ? "" : "text-muted-foreground"
                    }`}
                  >
                    <Checkbox
                      checked={picked.includes(c.id)}
                      onCheckedChange={() => toggle(c.id)}
                      disabled={!restricted}
                      aria-label={c.title}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{c.title}</span>
                      <span className="block text-muted-foreground">{c.filingRef}</span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending || isLoading}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
