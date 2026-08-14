import { useState } from "react";
import { useLocation } from "wouter";
import { MessageSquarePlus, Send } from "lucide-react";
import { useSendBetaFeedback } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/lib/session";
import { userMessage } from "@/lib/errors";

const MIN_MESSAGE = 3;

/**
 * The beta feedback widget.
 *
 * Always reachable, on every signed-in screen including the two dead ends —
 * access-denied and pending-approval — because someone who cannot get in is
 * exactly who you want to hear from and has no other way to tell you.
 *
 * It sends the current route with the message. "The button doesn't work" is
 * unactionable; the same words with `/cases/14` attached is a bug report.
 */
export function BetaFeedbackWidget() {
  const { isSignedIn } = useSession();
  const [location] = useLocation();
  const { toast } = useToast();
  const send = useSendBetaFeedback();

  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");

  // Nothing to attribute the feedback to, and the API would refuse it.
  if (!isSignedIn) return null;

  const submit = () => {
    const trimmed = message.trim();
    if (trimmed.length < MIN_MESSAGE) return;
    send.mutate(
      { data: { message: trimmed, pagePath: location || "/" } },
      {
        onSuccess: () => {
          setMessage("");
          setOpen(false);
          toast({
            title: "Thank you — that's logged",
            description: "We can see which page you were on, so there's no need to describe it.",
          });
        },
        onError: (err: unknown) => {
          toast({
            title: "Couldn't send that",
            description: userMessage(err),
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <>
      {/* Bottom-left: the bottom-right corner is where toasts land, and a button
          that gets covered by its own confirmation is a button people stop
          trusting. Above the safe-area inset so it clears the home indicator. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Send feedback about this page"
        className="fixed left-4 z-40 flex items-center gap-2 rounded-lg bg-card text-card-foreground shadow-md hover:bg-accent hover:text-accent-foreground active:shadow-[var(--press-sm)] px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        style={{ bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <MessageSquarePlus className="h-4 w-4 shrink-0" />
        <span className="text-3xs font-mono uppercase tracking-wider font-bold hidden sm:inline">
          Feedback
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-lg border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-widest">Send feedback</DialogTitle>
            <DialogDescription className="font-mono text-xs uppercase tracking-wider">
              Beta &middot; {location || "/"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 pt-2">
            <label
              htmlFor="beta-feedback-message"
              className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider"
            >
              What happened? *
            </label>
            <Textarea
              id="beta-feedback-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              maxLength={4000}
              autoFocus
              className="rounded-lg resize-none bg-background"
              placeholder="Anything — something broken, something confusing, something missing."
            />
            <p className="text-2xs text-muted-foreground leading-relaxed">
              We record the page you were on and who you are, so you don't need to explain either.
            </p>
          </div>

          <DialogFooter>
            <Button
              className="rounded-lg"
              disabled={message.trim().length < MIN_MESSAGE || send.isPending}
              onClick={submit}
            >
              <Send className="mr-2 h-4 w-4" />
              {send.isPending ? "Sending..." : "Send feedback"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
