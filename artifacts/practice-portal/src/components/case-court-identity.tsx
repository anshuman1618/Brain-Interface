import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateCase,
  getGetCaseQueryKey,
  getListCasesQueryKey,
  type Case,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Gavel, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { userMessage } from "@/lib/errors";
import { useSession } from "@/lib/session";
import { CourtIdentityFields } from "@/components/court-identity-fields";
import { courtIdentityPatch, courtIdentityProblem, type CourtIdentity } from "@/lib/court-identity";

/**
 * The matter's court identity, on the matter itself.
 *
 * Every matter opened before cause-list matching existed has these four fields
 * empty, and there is no other screen that can fill them in — without this the
 * feature only ever works for matters filed after the deploy, which is nearly
 * none of them. So this sits on the matter rather than in a settings screen:
 * it is a property of the filing, and it is read here in the one place someone
 * has the filing in front of them.
 *
 * Read-only for anyone without `cases.write` — a clerk should see why a matter
 * is or is not being matched without being able to change what it matches.
 */
export function CaseCourtIdentity({ caseData }: { caseData: Case }) {
  const { can } = useSession();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateCase = useUpdateCase();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CourtIdentity>({});

  const current: CourtIdentity = {
    courtId: caseData.courtId ?? undefined,
    caseType: caseData.caseType ?? undefined,
    caseNumber: caseData.caseNumber ?? undefined,
    caseYear: caseData.caseYear ?? undefined,
  };
  const isSet = current.courtId != null;
  const canEdit = can("cases.write");

  const handleOpen = (next: boolean) => {
    if (next) setDraft(current);
    setOpen(next);
  };

  const save = () => {
    updateCase.mutate(
      { id: caseData.id, data: courtIdentityPatch(draft) },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(caseData.id) });
          queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() });
          toast({
            title: draft.courtId ? "Court identity saved" : "Court identity cleared",
            description: draft.courtId
              ? "Published listings for this matter will now be proposed to you."
              : "This matter is no longer matched against cause lists.",
          });
          setOpen(false);
        },
        onError: (err: unknown) =>
          toast({
            title: "Could not save that",
            description: userMessage(err),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-card p-4 shadow-sm">
        <div className="flex min-w-0 items-start gap-3">
          <Gavel className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
              Court listing identity
            </p>
            {isSet ? (
              <p className="mt-1 truncate text-sm font-medium">
                {caseData.caseType} {caseData.caseNumber}/{caseData.caseYear}
                <span className="font-normal text-muted-foreground"> · {caseData.courtName}</span>
              </p>
            ) : (
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Not recorded. Published cause lists cannot be matched to this matter until it
                carries a court, case type, number and year.
              </p>
            )}
          </div>
        </div>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 rounded-lg"
            onClick={() => handleOpen(true)}
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            {isSet ? "Change" : "Add it"}
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={handleOpen}>
        <DialogContent className="rounded-lg border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-widest">
              Court listing identity
            </DialogTitle>
            <DialogDescription className="text-xs">
              As the court prints it. Clearing the court removes this matter from cause-list
              matching.
            </DialogDescription>
          </DialogHeader>
          <CourtIdentityFields value={draft} onChange={setDraft} idPrefix={`case-${caseData.id}`} />
          <DialogFooter>
            <Button
              className="rounded-lg"
              disabled={courtIdentityProblem(draft) !== null || updateCase.isPending}
              onClick={save}
            >
              {updateCase.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
