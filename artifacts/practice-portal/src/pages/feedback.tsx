import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListFeedback,
  useCreateFeedback,
  useRespondToFeedback,
  useListCases,
  getListFeedbackQueryKey,
  getListCasesQueryKey,
  type Feedback,
} from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { FeedbackSkeleton } from "@/components/module-skeleton";
import { useToast } from "@/hooks/use-toast";
import { Star, MessageSquare, AlertCircle, Reply } from "lucide-react";

function Stars({
  value,
  onChange,
  size = "h-5 w-5",
}: {
  value: number;
  onChange?: (n: number) => void;
  size?: string;
}) {
  const interactive = typeof onChange === "function";
  return (
    <div
      className="flex items-center gap-0.5"
      role={interactive ? "radiogroup" : undefined}
      aria-label={interactive ? "Rating" : undefined}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        const star = (
          <Star
            className={`${size} ${filled ? "fill-current text-foreground" : "text-muted-foreground/40"}`}
            aria-hidden="true"
          />
        );
        if (!interactive) return <span key={n}>{star}</span>;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} of 5`}
            onClick={() => onChange(n)}
            className="p-0.5 hover:scale-110 transition-transform"
          >
            {star}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Client feedback on matters.
 *
 * The two sides of this screen are genuinely different, not a filtered list:
 *  • A client rates their own matters and reads the chamber's reply.
 *  • Staff read every rating and may respond — but cannot edit or delete what a
 *    client wrote. A review the subject can silently rewrite is not feedback,
 *    so the reply is a separate field rather than an edit.
 */
export default function FeedbackPage() {
  const { can, activeWorkspace } = useSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const canLeave = can("feedback.write");
  const canRespond = can("feedback.respond");

  const {
    data: feedback = [],
    isLoading,
    isError,
    error,
  } = useListFeedback({
    query: { queryKey: getListFeedbackQueryKey() },
  });
  const { data: cases = [] } = useListCases(undefined, {
    query: { queryKey: getListCasesQueryKey(), enabled: canLeave },
  });

  const create = useCreateFeedback();
  const respond = useRespondToFeedback();

  const [isOpen, setIsOpen] = useState(false);
  const [caseId, setCaseId] = useState("");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [replyTo, setReplyTo] = useState<Feedback | null>(null);
  const [replyText, setReplyText] = useState("");

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListFeedbackQueryKey() });

  const rated = useMemo(() => new Set(feedback.map((f) => f.caseId)), [feedback]);
  const unrated = useMemo(() => cases.filter((c) => !rated.has(c.id)), [cases, rated]);

  const average = feedback.length
    ? (feedback.reduce((sum, f) => sum + f.rating, 0) / feedback.length).toFixed(1)
    : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!caseId || rating < 1) return;
    create.mutate(
      { data: { caseId: Number(caseId), rating, comment: comment.trim() || undefined } },
      {
        onSuccess: () => {
          refresh();
          toast({ title: "Thank you", description: "Your feedback has been sent to the chamber." });
          setIsOpen(false);
          setCaseId("");
          setRating(0);
          setComment("");
        },
        onError: (err: unknown) =>
          toast({
            title: "Couldn't send that",
            description: err instanceof Error ? err.message : undefined,
            variant: "destructive",
          }),
      },
    );
  };

  const submitReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyTo || !replyText.trim()) return;
    respond.mutate(
      { id: replyTo.id, data: { response: replyText.trim() } },
      {
        onSuccess: () => {
          refresh();
          toast({ title: "Reply sent" });
          setReplyTo(null);
          setReplyText("");
        },
        onError: () => toast({ title: "Couldn't send that reply", variant: "destructive" }),
      },
    );
  };

  if (isLoading) return <FeedbackSkeleton />;

  if (isError) {
    return (
      <div className="border border-destructive/40 bg-destructive/5 p-10 text-center">
        <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-3" />
        <p className="font-medium mb-1">Couldn't load feedback</p>
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "The request failed."}
        </p>
        <Button variant="outline" className="rounded-none mt-5" onClick={refresh}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-1">
            {canRespond || !canLeave ? "Client Feedback" : "Your Feedback"}
          </h2>
          <p className="text-muted-foreground">
            {canLeave
              ? "Rate how your matters are being handled. Your chamber can reply but cannot change what you wrote."
              : `What clients of ${activeWorkspace?.name} say about their matters.`}
          </p>
        </div>
        {canLeave && unrated.length > 0 && (
          <Button
            className="rounded-none shrink-0"
            onClick={() => {
              setCaseId(String(unrated[0].id));
              setIsOpen(true);
            }}
          >
            <Star className="mr-2 h-4 w-4" /> Rate a matter
          </Button>
        )}
      </div>

      {average && (
        <div className="border border-border bg-background p-5 flex flex-wrap items-center gap-4">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
              Average rating
            </p>
            <div className="flex items-center gap-3">
              <span className="text-3xl font-bold tracking-tighter tabular-nums">{average}</span>
              <Stars value={Math.round(Number(average))} />
            </div>
          </div>
          <span className="text-sm text-muted-foreground ml-auto">
            {feedback.length} {feedback.length === 1 ? "rating" : "ratings"}
          </span>
        </div>
      )}

      {feedback.length === 0 ? (
        <div className="border border-border bg-background p-14 text-center">
          <MessageSquare className="h-9 w-9 text-muted-foreground mx-auto mb-4" />
          <p className="text-lg font-medium mb-1">No feedback yet</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {canLeave
              ? unrated.length > 0
                ? "Rate a matter to tell your chamber how it's going."
                : "You'll be able to rate a matter once one is opened for you."
              : "Ratings your clients leave will appear here."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {feedback.map((f) => (
            <article key={f.id} className="border border-border bg-background p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <Stars value={f.rating} size="h-4 w-4" />
                    <span className="text-sm font-medium truncate">
                      {f.caseTitle ?? `Matter ${f.caseId}`}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 font-mono uppercase tracking-wider">
                    {canLeave && !canRespond ? "You" : f.clientName || "Client"}
                    {` · ${new Date(f.createdAt).toLocaleDateString()}`}
                  </p>
                </div>
                {f.response ? (
                  <Badge
                    variant="outline"
                    className="rounded-none text-[9px] uppercase font-mono tracking-wider px-1 py-0"
                  >
                    Replied
                  </Badge>
                ) : canRespond ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-none shrink-0"
                    onClick={() => {
                      setReplyTo(f);
                      setReplyText("");
                    }}
                  >
                    <Reply className="h-3.5 w-3.5 mr-1.5" /> Reply
                  </Button>
                ) : null}
              </div>

              {f.comment && <p className="text-sm mt-3 leading-relaxed">{f.comment}</p>}

              {f.response && (
                <div className="mt-4 border-l-2 border-primary/40 pl-4">
                  <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
                    {f.respondedBy ? `${f.respondedBy} replied` : "Chamber replied"}
                    {f.respondedAt ? ` · ${new Date(f.respondedAt).toLocaleDateString()}` : ""}
                  </p>
                  <p className="text-sm leading-relaxed">{f.response}</p>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {/* Leave feedback */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[440px] rounded-none border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-widest">
              Rate this matter
            </DialogTitle>
            <DialogDescription className="font-mono text-xs uppercase tracking-wider">
              Your chamber sees this, and may reply
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4 pt-2">
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                Matter
              </label>
              <Select value={caseId} onValueChange={setCaseId}>
                <SelectTrigger className="rounded-none bg-background font-mono text-sm">
                  <SelectValue placeholder="SELECT MATTER" />
                </SelectTrigger>
                <SelectContent className="rounded-none">
                  {unrated.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)} className="font-mono text-sm">
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                Rating *
              </label>
              <Stars value={rating} onChange={setRating} size="h-7 w-7" />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                Comment (optional)
              </label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="rounded-none font-mono text-sm bg-background resize-none h-24"
                placeholder="How has your matter been handled?"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-none"
                onClick={() => setIsOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="rounded-none font-mono uppercase tracking-wider"
                disabled={create.isPending || !caseId || rating < 1}
              >
                {create.isPending ? "Sending..." : "Send feedback"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reply */}
      <Dialog open={replyTo !== null} onOpenChange={(o) => !o && setReplyTo(null)}>
        <DialogContent className="sm:max-w-[440px] rounded-none border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-widest">
              Reply to feedback
            </DialogTitle>
            <DialogDescription className="font-mono text-xs uppercase tracking-wider">
              {replyTo?.clientName ?? "Client"} · {replyTo?.caseTitle ?? ""}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submitReply} className="space-y-4 pt-2">
            {replyTo?.comment && (
              <blockquote className="border-l-2 border-border pl-4 text-sm text-muted-foreground italic">
                {replyTo.comment}
              </blockquote>
            )}
            <Textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              className="rounded-none font-mono text-sm bg-background resize-none h-24"
              placeholder="Thank them, or address what they raised..."
              autoFocus
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="rounded-none"
                onClick={() => setReplyTo(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="rounded-none font-mono uppercase tracking-wider"
                disabled={respond.isPending || !replyText.trim()}
              >
                {respond.isPending ? "Sending..." : "Send reply"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
