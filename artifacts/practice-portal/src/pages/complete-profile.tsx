import { useEffect, useState } from "react";
import { Scale, LogOut, AlertCircle, ArrowRight } from "lucide-react";
import { useGetMe, useSetBarRegistration } from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { userMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The bar-registration gate, and the advocate's credentials.
 *
 * Renders in two situations that look identical but are reached differently:
 * as a hard gate before the dashboard (dashboard-layout.tsx, when
 * `profileComplete` is false), and as a page someone reaches deliberately
 * to correct or complete what they declared — see the "Edit" link on their own
 * row in Team Roles, and the credentials notice on the dashboard. `onDone`
 * distinguishes them: the gate has none and relies on `refreshSession()`
 * re-evaluating `profileComplete`, while a deliberate visit is given a way
 * back out.
 *
 * ── Two tiers, because they are not all obtainable on the same day ───────
 *
 * **Now:** the state bar council and the enrolment number. Every enrolled
 * advocate has both from the day they are enrolled, and without them we cannot
 * say who is practising here at all.
 *
 * **Whenever they exist:** Certificate of Practice, and Advocate-on-Record at
 * the Supreme Court or a High Court. Most advocates hold none of these, and a
 * form that demanded them would be asking most of its users to invent numbers.
 *
 * **Within six months:** the All India Bar Examination certificate number. It
 * is asked for from the start and enforced only once its own deadline passes,
 * which is what the countdown under that field is counting. The deadline is
 * stamped once, server-side, on the first declaration — re-saving this form
 * cannot move it.
 *
 * Nothing here is verified against a bar council — this records what the
 * person typed, not proof of it. See `bar_declared_at` on the schema.
 */
export default function CompleteProfilePage({ onDone }: { onDone?: () => void }) {
  const { displayName, email, displayRole, signOut, refreshSession } = useSession();
  const setBarRegistration = useSetBarRegistration();
  // Reached two ways: as the hard gate (nothing declared yet, starts blank)
  // and as a deliberate revisit from Team Roles to correct what was declared
  // — this is what fills the form with the latter's current values.
  const { data: me } = useGetMe();

  const [barCouncilState, setBarCouncilState] = useState("");
  const [barEnrolmentNo, setBarEnrolmentNo] = useState("");
  const [aorNo, setAorNo] = useState("");
  const [aorHighCourtNo, setAorHighCourtNo] = useState("");
  const [copNo, setCopNo] = useState("");
  const [allIndiaBarNo, setAllIndiaBarNo] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    setBarCouncilState(me.barCouncilState ?? "");
    setBarEnrolmentNo(me.barEnrolmentNo ?? "");
    setAorNo(me.aorNo ?? "");
    setAorHighCourtNo(me.aorHighCourtNo ?? "");
    setCopNo(me.copNo ?? "");
    setAllIndiaBarNo(me.allIndiaBarNo ?? "");
  }, [me]);

  // Null once supplied, or before anything has been declared at all. Negative
  // means the six months are up and the gate is already refusing requests.
  const daysLeft = me?.allIndiaBarDaysLeft ?? null;

  const canSubmit = !!barCouncilState.trim() && !!barEnrolmentNo.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    try {
      await setBarRegistration.mutateAsync({
        data: {
          barCouncilState: barCouncilState.trim(),
          barEnrolmentNo: barEnrolmentNo.trim(),
          // Sent only when filled. An empty string would be stored as an empty
          // string, which reads as "declared, and blank" rather than "not held".
          ...(aorNo.trim() ? { aorNo: aorNo.trim() } : {}),
          ...(aorHighCourtNo.trim() ? { aorHighCourtNo: aorHighCourtNo.trim() } : {}),
          ...(copNo.trim() ? { copNo: copNo.trim() } : {}),
          ...(allIndiaBarNo.trim() ? { allIndiaBarNo: allIndiaBarNo.trim() } : {}),
        },
      });
      refreshSession();
      onDone?.();
    } catch (err) {
      setError(userMessage(err, "Could not record that. Try again."));
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex items-center justify-center px-4 py-12 relative overflow-y-auto">
      <div className="fixed inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSJub25lIiAvPgo8cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJjdXJyZW50Q29sb3IiIG9wYWNpdHk9IjAuMDUiIC8+Cjwvc3ZnPg==')] opacity-[0.4] pointer-events-none" />

      <div className="relative z-10 w-full max-w-lg">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-card shadow-sm mb-6">
          <Scale className="h-3.5 w-3.5 text-primary" />
          <span className="text-2xs font-mono font-semibold tracking-wider uppercase text-muted-foreground">
            Bar registration
          </span>
        </div>

        <h1 className="text-3xl font-bold tracking-tight mb-2">
          Before you continue as {displayRole || "an advocate"}
        </h1>
        <p className="text-muted-foreground mb-8 leading-relaxed">
          Signed in as <span className="font-medium text-foreground">{displayName || email}</span>.
          Practice roles on LEX Practice declare their bar enrolment once — it is recorded as you
          state it, not checked against a bar council.
        </p>

        {error && (
          <div className="border border-destructive bg-destructive/5 p-4 mb-6 flex gap-3">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <form onSubmit={submit} className="rounded-lg bg-card shadow-sm p-6 flex flex-col gap-5">
          <div className="space-y-2">
            <Label htmlFor="bar-state">State Bar Council</Label>
            <Input
              id="bar-state"
              value={barCouncilState}
              onChange={(e) => setBarCouncilState(e.target.value)}
              placeholder="e.g. Bar Council of Delhi"
              autoFocus
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bar-enrolment">Enrolment Number</Label>
            <Input
              id="bar-enrolment"
              value={barEnrolmentNo}
              onChange={(e) => setBarEnrolmentNo(e.target.value)}
              placeholder="e.g. D/1234/2015"
              required
            />
            <p className="text-3xs text-muted-foreground font-mono uppercase tracking-wider">
              Formats vary by state bar — enter it as printed on your certificate.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cop-no">Certificate of Practice number (optional)</Label>
            <Input
              id="cop-no"
              value={copNo}
              onChange={(e) => setCopNo(e.target.value)}
              placeholder="Leave blank if you do not hold one"
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="aor-no">Supreme Court AOR number (optional)</Label>
              <Input
                id="aor-no"
                value={aorNo}
                onChange={(e) => setAorNo(e.target.value)}
                placeholder="Advocate-on-Record, SCI"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="aor-hc-no">High Court AOR number (optional)</Label>
              <Input
                id="aor-hc-no"
                value={aorHighCourtNo}
                onChange={(e) => setAorHighCourtNo(e.target.value)}
                placeholder="Where that court keeps a roll"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="aibe-no">All India Bar Examination certificate number</Label>
            <Input
              id="aibe-no"
              value={allIndiaBarNo}
              onChange={(e) => setAllIndiaBarNo(e.target.value)}
              placeholder="e.g. AIBE-XVIII-0001234"
              aria-describedby="aibe-note"
            />
            {/* The countdown, in the one place the number can be supplied.
                Server-computed: the browser's clock is not what the gate uses,
                and the two disagreeing would show a deadline that has already
                passed as though it had not. */}
            <p
              id="aibe-note"
              className={`text-3xs font-mono uppercase tracking-wider ${
                daysLeft !== null && daysLeft < 0 ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {allIndiaBarNo.trim()
                ? "Recorded as you state it."
                : daysLeft === null
                  ? "Required within six months of declaring your enrolment."
                  : daysLeft < 0
                    ? `Overdue by ${Math.abs(daysLeft)} ${Math.abs(daysLeft) === 1 ? "day" : "days"} — the chamber is closed to you until it is supplied.`
                    : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left to supply it.`}
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 pt-2">
            <button
              type="button"
              onClick={() => (onDone ? onDone() : signOut())}
              className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" /> {onDone ? "Cancel" : "Sign out"}
            </button>
            <Button
              type="submit"
              className="rounded-lg px-8"
              disabled={!canSubmit || setBarRegistration.isPending}
            >
              {setBarRegistration.isPending ? "Saving..." : "Continue"}
              {!setBarRegistration.isPending && <ArrowRight className="h-4 w-4 ml-2" />}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
