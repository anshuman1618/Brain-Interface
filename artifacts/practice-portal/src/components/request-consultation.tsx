import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useRequestConsultation,
  useListConsultations,
  getListConsultationsQueryKey,
  type Consultation,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useSession } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { userMessage } from "@/lib/errors";
import { CalendarPlus, Clock } from "lucide-react";

/**
 * A client asking their chamber for a consultation.
 *
 * Gated on `consultations.request`, which only the client role holds — staff
 * create consultations outright and do not need to ask. Rendered on the matter
 * it concerns, because "which matter is this about" is the one thing a client
 * would otherwise get wrong and the chamber would have to chase.
 *
 * It asks for a preferred time and is explicit that it is a preference. A
 * request is not a booking: the server puts it in the notes and leaves
 * `scheduledAt` null until the chamber confirms. Saying so here stops a client
 * turning up on a day nobody agreed to.
 */
export function RequestConsultation({ caseId }: { caseId: number }) {
  const { can } = useSession();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [preferredAt, setPreferredAt] = useState("");

  const request = useRequestConsultation();
  const { data: consultations = [] } = useListConsultations(undefined, {
    query: { queryKey: getListConsultationsQueryKey(), enabled: can("consultations.read") },
  });

  if (!can("consultations.request")) return null;

  const pending = consultations.filter(
    (c: Consultation) => c.caseId === caseId && c.status === "requested",
  );
  const upcoming = consultations.filter(
    (c: Consultation) => c.caseId === caseId && c.status === "scheduled",
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length < 3) return;
    request.mutate(
      {
        data: {
          caseId,
          title: trimmed,
          notes: notes.trim() || undefined,
          ...(preferredAt ? { preferredAt: new Date(preferredAt).toISOString() } : {}),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListConsultationsQueryKey() });
          setOpen(false);
          setTitle("");
          setNotes("");
          setPreferredAt("");
          toast({
            title: "Request sent",
            description: "Your chamber will confirm a time.",
          });
        },
        onError: (err: Error) =>
          toast({
            title: "Could not send that",
            description: userMessage(err),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="rounded-lg" onClick={() => setOpen(true)}>
          <CalendarPlus className="mr-1.5 h-3.5 w-3.5" />
          Request a consultation
        </Button>
        {pending.length > 0 && (
          <span className="flex items-center gap-1.5 font-mono text-3xs uppercase tracking-wider text-muted-foreground">
            <Clock className="h-3 w-3" />
            {pending.length} awaiting a time
          </span>
        )}
        {upcoming.length > 0 && (
          <span className="font-mono text-3xs uppercase tracking-wider text-muted-foreground">
            {upcoming.length} confirmed
          </span>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-lg border-border sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-widest">
              Request a consultation
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              Your chamber will confirm a time. Anything you put here is added to this
              matter&rsquo;s record.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4 pt-2">
            <div className="grid gap-2">
              <Label htmlFor="consult-title">What would you like to discuss? *</Label>
              <Input
                id="consult-title"
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. The notice received on 12 March"
                className="rounded-lg"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="consult-notes">Anything else</Label>
              <Textarea
                id="consult-notes"
                value={notes}
                maxLength={2000}
                rows={3}
                onChange={(e) => setNotes(e.target.value)}
                className="resize-none rounded-lg"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="consult-when">A time that would suit you</Label>
              <Input
                id="consult-when"
                type="datetime-local"
                value={preferredAt}
                onChange={(e) => setPreferredAt(e.target.value)}
                className="rounded-lg"
              />
              {/* Said plainly, because a client who reads this as a booking
                  turns up on a day nobody agreed to. */}
              <p className="text-2xs leading-relaxed text-muted-foreground">
                A preference, not an appointment — nothing is fixed until your chamber confirms it.
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="rounded-lg"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="rounded-lg font-mono uppercase tracking-wider"
                disabled={title.trim().length < 3 || request.isPending}
              >
                {request.isPending ? "Sending..." : "Send request"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
