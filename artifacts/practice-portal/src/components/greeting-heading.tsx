import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { greet } from "@/lib/greeting";
import { UserPen } from "lucide-react";

/**
 * The dashboard salutation, and the only place that asks for a name.
 *
 * Clerk is passwordless: an email one-time code establishes an address and
 * nothing else, so most people arrive with no name at all and the server now
 * stores that as empty rather than as the placeholder "User". `greet()`
 * already handles it — it drops the name and says "Good evening" — but a
 * greeting that never learns anybody's name is not the end of the story. The
 * name is written onto every record its owner touches, so it is worth one
 * question, asked where they will actually see it.
 *
 * **Asked here rather than gated at sign-in.** The bar-registration gate only
 * applies to practice roles; a client or a clerk would never meet it, and
 * their names appear on document requests and ledger rows just the same.
 * A prompt beside the greeting reaches everyone, on the screen they land on,
 * without standing between them and their work.
 */
export function NameYourselfDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { displayName, refreshSession } = useSession();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateMe = useUpdateMe();
  const [name, setName] = useState(displayName ?? "");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    updateMe.mutate(
      { data: { displayName: trimmed } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          // The greeting reads the SESSION claim, not the `me` query, so the
          // session has to be re-read or the heading keeps saying nothing.
          refreshSession();
          onOpenChange(false);
          toast({ title: "That's better", description: `We'll call you ${trimmed}.` });
        },
        onError: (err: Error) =>
          toast({
            title: "Could not save that",
            description: userMessage(err),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-lg border-border sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="font-mono uppercase tracking-widest">
            What should we call you?
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            Your chamber sees this name on everything you file, request or approve. Signing in by
            email tells us your address and nothing else, which is why we have to ask.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4 pt-2">
          <div className="grid gap-2">
            <Label htmlFor="display-name">Your name</Label>
            <Input
              id="display-name"
              value={name}
              maxLength={120}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Anshuman Chauhan"
              className="rounded-lg"
            />
            <p className="text-2xs leading-relaxed text-muted-foreground">
              The dashboard greets you by your first name; records carry it in full.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-lg"
              onClick={() => onOpenChange(false)}
            >
              Not now
            </Button>
            <Button
              type="submit"
              className="rounded-lg font-mono uppercase tracking-wider"
              disabled={!name.trim() || updateMe.isPending}
            >
              {updateMe.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Good evening, Anshuman" — or "Good evening" with a way to fix that.
 *
 * The prompt is a quiet link rather than a banner or a blocking step. Somebody
 * who does not want to give a name keeps a perfectly working dashboard, and
 * the offer is still there tomorrow.
 */
export function GreetingHeading({ className = "" }: { className?: string }) {
  const { displayName } = useSession();
  const [open, setOpen] = useState(false);
  const hasName = Boolean(displayName?.trim());

  return (
    <>
      <h2 className={`text-3xl font-bold tracking-tight mb-1 ${className}`}>
        {greet(displayName)}
        {!hasName && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="ml-3 inline-flex items-center gap-1.5 align-middle rounded-lg px-2 py-1 font-mono text-2xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <UserPen className="h-3.5 w-3.5" />
            Add your name
          </button>
        )}
      </h2>
      <NameYourselfDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
