import { useState } from "react";
import { Building2, ShieldCheck, Scale, LogOut, ArrowRight, AlertCircle } from "lucide-react";
import { useSession } from "@/lib/session";
import { userMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Matches the minimum the API enforces, so the two cannot disagree. */
const MIN_NAME_LENGTH = 2;

const FOUNDER_ROLES = [
  {
    value: "admin" as const,
    label: "Firm Admin",
    description: "You run the chamber's operations — team, billing and oversight.",
    icon: ShieldCheck,
  },
  {
    value: "senior_advocate" as const,
    label: "Senior Advocate",
    description: "You lead the practice and direct the work. You can still invite your team.",
    icon: Scale,
  },
];

/**
 * Self-serve sign-up: found a chamber.
 *
 * This is the one screen where a person chooses their own role, and it is safe
 * for one reason — the workspace does not exist yet. Becoming Admin of a chamber
 * you just created grants nothing over anyone else's. Picking a role in an
 * *existing* chamber remains impossible; that stays an admin's decision.
 *
 * Whichever of the two roles is chosen, the founder is also the owner, so a
 * Senior Advocate who sets up their own chamber can still invite their clerk.
 */
export default function CreateChamberPage({ onCancel }: { onCancel?: () => void }) {
  const { displayName, email, signOut, createWorkspace, isCreatingWorkspace, refreshSession } =
    useSession();

  const [name, setName] = useState("");
  const [role, setRole] = useState<"admin" | "senior_advocate">("admin");
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  // The server refuses anything shorter than this. The form used to accept a
  // single character and let the 400 come back as a red banner.
  const nameProblem = (value: string): string | null =>
    value.trim().length < MIN_NAME_LENGTH
      ? `Give the chamber a name of at least ${MIN_NAME_LENGTH} characters.`
      : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = nameProblem(name);
    setNameError(problem);
    if (problem) return;
    setError(null);
    try {
      await createWorkspace(name.trim(), role);
      refreshSession();
    } catch (err) {
      setError(userMessage(err, "Could not create the chamber. Try again."));
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex items-center justify-center px-4 py-12 relative overflow-y-auto">
      <div className="fixed inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSJub25lIiAvPgo8cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJjdXJyZW50Q29sb3IiIG9wYWNpdHk9IjAuMDUiIC8+Cjwvc3ZnPg==')] opacity-[0.4] pointer-events-none" />

      <div className="relative z-10 w-full max-w-2xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-card shadow-sm mb-6">
          <Building2 className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] font-mono font-semibold tracking-wider uppercase text-muted-foreground">
            Set up your chamber
          </span>
        </div>

        <h1 className="text-3xl font-bold tracking-tight mb-2">Create your chamber</h1>
        <p className="text-muted-foreground mb-8 leading-relaxed">
          Signed in as <span className="font-medium text-foreground">{displayName || email}</span>.
          Your chamber starts empty — no matters, no tasks, no team. You add your own work and
          invite everyone else.
        </p>

        {error && (
          <div className="border border-destructive bg-destructive/5 p-4 mb-6 flex gap-3">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <form onSubmit={submit} className="rounded-lg bg-card shadow-sm p-6 flex flex-col gap-6">
          <div className="space-y-2">
            <label
              htmlFor="chamber-name"
              className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider"
            >
              Chamber name
            </label>
            <Input
              id="chamber-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
              onBlur={() => name.trim() && setNameError(nameProblem(name))}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? "chamber-name-error" : undefined}
              className="rounded-lg bg-background"
              placeholder="e.g. Raghavan Chambers"
              autoFocus
              required
            />
            {nameError && (
              <p
                id="chamber-name-error"
                role="alert"
                className="text-xs text-destructive flex items-center gap-1.5"
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {nameError}
              </p>
            )}
          </div>

          <div className="space-y-3">
            <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
              Your role
            </label>
            <div className="grid sm:grid-cols-2 gap-3">
              {FOUNDER_ROLES.map((opt) => {
                const selected = role === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setRole(opt.value)}
                    className={`text-left border p-4 transition-colors ${
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <opt.icon className="h-5 w-5 mb-2" />
                    <div className="font-semibold mb-1">{opt.label}</div>
                    <div className="text-sm text-muted-foreground">{opt.description}</div>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Either way you own this chamber, so you can invite your team and set their roles.
              Everyone else joins by invitation only.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 pt-2">
            <button
              type="button"
              onClick={() => (onCancel ? onCancel() : signOut())}
              className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" /> {onCancel ? "Back" : "Sign out"}
            </button>
            <Button
              type="submit"
              className="rounded-lg px-8"
              disabled={isCreatingWorkspace || !name.trim()}
            >
              {isCreatingWorkspace ? "Creating..." : "Create chamber"}
              {!isCreatingWorkspace && <ArrowRight className="h-4 w-4 ml-2" />}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
