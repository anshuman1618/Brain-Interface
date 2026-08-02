import { useState } from "react";
import { Link, useSearch } from "wouter";
import { ArrowLeft, Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AUTH_PROVIDERS, type ProviderId } from "@/lib/auth-providers";
import { useSession } from "@/lib/session";

/**
 * The sign-in layer, reached from "Chamber Portal" on the landing page.
 *
 * All three routes end in the same place: an email address the provider has
 * verified. That address is then checked server-side against the workspace
 * access list, which is the only thing that admits anyone. Choosing Google over
 * Zoho changes nothing about what you can reach.
 */
export default function PortalSignInPage() {
  const { previewMode, signInWithProvider, signInError, isSigningIn } = useSession();
  // Both paths are the same sign-in; only the framing differs, because a founder
  // and an invited colleague arrive with different expectations.
  const isSetup = new URLSearchParams(useSearch()).get("new") === "1";

  const [chosen, setChosen] = useState<ProviderId | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  const startProvider = (id: ProviderId) => {
    // Outside preview, Google and Zoho hand off to the identity provider
    // immediately; only the email route needs an address typed here first.
    if (!previewMode && id !== "email") {
      void signInWithProvider(id, "");
      return;
    }
    setChosen(id);
  };

  const submitEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chosen || !email.trim()) return;
    void signInWithProvider(chosen, email.trim(), name.trim());
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col">
      <header className="h-20 border-b border-border flex items-center px-8">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="h-10 w-10 bg-primary text-primary-foreground flex items-center justify-center font-mono font-bold text-lg tracking-tighter">
            LEX
          </div>
          <span className="font-mono font-bold tracking-tight text-xl group-hover:text-primary transition-colors">
            PRACTICE
          </span>
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSJub25lIiAvPgo8cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJjdXJyZW50Q29sb3IiIG9wYWNpdHk9IjAuMDUiIC8+Cjwvc3ZnPg==')] pointer-events-none" />

        <div className="relative z-10 w-full max-w-[440px]">
          <div className="inline-flex items-center gap-2 px-3 py-1 border border-border bg-background mb-6">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] font-mono font-semibold tracking-wider uppercase text-muted-foreground">
              Chamber Portal
            </span>
          </div>

          <h1 className="text-3xl font-bold tracking-tight mb-2">
            {isSetup ? "Set up your chamber" : "Sign in to your chamber"}
          </h1>
          <p className="text-muted-foreground mb-8 leading-relaxed">
            {isSetup
              ? "Sign in first, then name your chamber and choose whether you run it as Firm Admin or Senior Advocate. You'll invite everyone else afterwards."
              : "Sign in with the address your chamber admin invited. A different address will be turned away."}
          </p>

          {signInError && (
            <div className="border border-destructive bg-destructive/5 p-4 mb-6 flex gap-3">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{signInError}</p>
            </div>
          )}

          {chosen === null ? (
            <div className="flex flex-col gap-3">
              {AUTH_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => startProvider(p.id)}
                  disabled={isSigningIn}
                  className="flex items-center gap-3 border border-border bg-background px-4 py-3.5 hover:bg-accent hover:border-primary/40 transition-colors text-left disabled:opacity-60"
                >
                  <span className="shrink-0">{p.icon}</span>
                  <span className="flex flex-col min-w-0">
                    <span className="text-sm font-semibold truncate">{p.label}</span>
                    <span className="text-xs text-muted-foreground truncate">{p.hint}</span>
                  </span>
                  {isSigningIn && <Loader2 className="h-4 w-4 animate-spin ml-auto shrink-0" />}
                </button>
              ))}
            </div>
          ) : (
            <form onSubmit={submitEmail} className="flex flex-col gap-4">
              <button
                type="button"
                onClick={() => setChosen(null)}
                className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors self-start"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Other options
              </button>

              <div className="border border-border bg-muted/30 px-4 py-3 flex items-center gap-3">
                <span className="shrink-0">{AUTH_PROVIDERS.find((p) => p.id === chosen)?.icon}</span>
                <span className="text-sm font-medium">
                  {AUTH_PROVIDERS.find((p) => p.id === chosen)?.label}
                </span>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                  Email address
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded-none bg-background"
                  placeholder="you@yourchamber.in"
                  autoFocus
                  required
                />
              </div>

              {previewMode && (
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                    Display name (optional)
                  </label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="rounded-none bg-background"
                    placeholder="Your name"
                  />
                </div>
              )}

              <Button type="submit" className="rounded-none w-full" disabled={isSigningIn || !email.trim()}>
                {isSigningIn ? "Signing in..." : "Continue"}
              </Button>
            </form>
          )}

          {previewMode && (
            <div className="mt-8 border border-amber-500/40 bg-amber-500/10 px-4 py-3">
              <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                <strong className="font-semibold">Preview build.</strong> No Google or Zoho tenant is
                connected, so any address you type is treated as verified. Everything after that is
                real: if nobody has admitted your address you will be turned away, and if this is a
                fresh platform you will be offered the chance to create the first chamber.
              </p>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
