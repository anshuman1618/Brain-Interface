import { useEffect, useState } from "react";
import { Scale, LogOut, AlertCircle, ArrowRight } from "lucide-react";
import { useGetMe, useSetBarRegistration } from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { userMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The bar-registration gate.
 *
 * Renders in two situations that look identical but are reached differently:
 * as a hard gate before the dashboard (dashboard-layout.tsx, when
 * `profileComplete` is false), and as a page someone reaches deliberately
 * to correct what they declared — see the "Edit" link on their own row in
 * Team Roles. `onDone` distinguishes them: the gate has none and relies on
 * `refreshSession()` re-evaluating `profileComplete`, while a deliberate
 * visit is given a way back out.
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    setBarCouncilState(me.barCouncilState ?? "");
    setBarEnrolmentNo(me.barEnrolmentNo ?? "");
    setAorNo(me.aorNo ?? "");
  }, [me]);

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
          ...(aorNo.trim() ? { aorNo: aorNo.trim() } : {}),
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
            <Label htmlFor="aor-no">Supreme Court AOR Number (optional)</Label>
            <Input
              id="aor-no"
              value={aorNo}
              onChange={(e) => setAorNo(e.target.value)}
              placeholder="Leave blank if you are not an Advocate-on-Record"
            />
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
