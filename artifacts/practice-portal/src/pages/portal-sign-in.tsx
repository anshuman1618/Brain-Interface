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
 * Every route ends in the same place: an identifier the provider has verified —
 * an email address, or a mobile number. That identifier is then checked
 * server-side against the workspace access list, which is the only thing that
 * admits anyone. Choosing Google over Zoho, or SMS over email, changes nothing
 * about what you can reach.
 *
 * The mobile route exists because a chamber's clerks and most of its clients
 * have a phone and no work address. Requiring an address to be admitted
 * excluded exactly the people a practice needs on the system.
 */
/**
 * Same shape the API applies to access-list entries, so an address this screen
 * accepts is one the server can also match. The browser's own `type="email"`
 * check was the only guard here, and it does not run at all when the form is
 * submitted programmatically.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Clerk's one-time codes are six digits, emailed or texted alike. */
const CODE_LENGTH = 6;

/**
 * Loose on purpose: seven to fifteen digits, optionally with a leading +.
 *
 * The server normalises to E.164 and is the authority on what is usable. A
 * stricter rule here would be a second answer to the same question, and the
 * one people meet first — so it checks only for what is obviously not a number.
 */
const PHONE_PATTERN = /^\+?[\d\s\-().]{7,20}$/;

export default function PortalSignInPage() {
  const {
    previewMode,
    signInWithProvider,
    verifyEmailCode,
    resendCode,
    awaitingCode,
    pendingEmail,
    cancelCodeEntry,
    signInError,
    isSigningIn,
  } = useSession();
  // Both paths are the same sign-in; only the framing differs, because a founder
  // and an invited colleague arrive with different expectations.
  const isSetup = new URLSearchParams(useSearch()).get("new") === "1";

  const [chosen, setChosen] = useState<ProviderId | null>(null);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);

  // After a refresh the provider knows the address but this component does not,
  // so the code screen reads from the persisted value first.
  const codeSentTo = pendingEmail || (chosen === "phone" ? phone : email);

  const byPhone = chosen === "phone";
  const identifier = byPhone ? phone : email;

  const validateEmail = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return "Enter your email address.";
    if (!EMAIL_PATTERN.test(trimmed)) return "That doesn't look like an email address.";
    return null;
  };

  const validatePhone = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return "Enter your mobile number.";
    if (!/\d/.test(trimmed) || !PHONE_PATTERN.test(trimmed)) {
      return "That doesn't look like a mobile number.";
    }
    return null;
  };

  const validateIdentifier = (value: string): string | null =>
    byPhone ? validatePhone(value) : validateEmail(value);

  const startProvider = (id: ProviderId) => {
    // Outside preview, Google and Zoho hand off to the identity provider
    // immediately; only the email route needs an address typed here first.
    if (!previewMode && id !== "email" && id !== "phone") {
      void signInWithProvider(id, "");
      return;
    }
    setEmailError(null);
    setChosen(id);
  };

  const submitIdentifier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chosen) return;
    // Checked here rather than left to the browser: the submit button was
    // enabled by any non-empty string, so "abc" reached Clerk and came back as
    // a red banner about a failed request instead of a note under the field.
    const problem = validateIdentifier(identifier);
    setEmailError(problem);
    if (problem) return;
    void signInWithProvider(chosen, identifier.trim(), name.trim());
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
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-card shadow-sm mb-6">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            <span className="text-2xs font-mono font-semibold tracking-wider uppercase text-muted-foreground">
              Chamber Portal
            </span>
          </div>

          <h1 className="text-3xl font-bold tracking-tight mb-2">
            {isSetup ? "Set up your chamber" : "Sign in to your chamber"}
          </h1>
          <p className="text-muted-foreground mb-8 leading-relaxed">
            {isSetup
              ? "Sign in first, then name your chamber and choose whether you run it as Firm Admin or Senior Advocate. You'll invite everyone else afterwards."
              : "Sign in with the address or mobile number your chamber admin invited. A different one will be turned away."}
          </p>

          <p className="text-xs text-muted-foreground mb-6 flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            Passwordless — you'll never be asked to create or remember one.
          </p>

          {signInError && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-4 mb-6 flex gap-3">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{signInError}</p>
            </div>
          )}

          {/* Passwordless: once the code is out, the only thing we ask for is
              the code. There is no password field anywhere in this flow. */}
          {awaitingCode ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void verifyEmailCode(code);
              }}
              className="flex flex-col gap-4"
            >
              <div className="rounded-lg bg-background shadow-[var(--press-sm)] px-4 py-3">
                <p className="text-sm">
                  We sent a one-time code to{" "}
                  <span className="font-mono font-medium break-all">{codeSentTo}</span>.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  It expires shortly. No password is involved — the code is the whole sign-in.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                  One-time code
                </label>
                <Input
                  value={code}
                  // Digits only: pasting a code with a stray space silently
                  // failed the length check and disabled the button with no
                  // explanation of why.
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className="rounded-lg bg-background font-mono tracking-[0.4em] text-center text-lg"
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={CODE_LENGTH}
                  autoFocus
                  required
                />
                <p className="text-xs text-muted-foreground">
                  {CODE_LENGTH} digits, from the {byPhone ? "text message" : "email"} just sent.
                </p>
              </div>

              <Button
                type="submit"
                className="rounded-lg w-full"
                disabled={isSigningIn || code.length !== CODE_LENGTH}
              >
                {isSigningIn ? "Verifying..." : "Verify and continue"}
              </Button>

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    cancelCodeEntry();
                    setCode("");
                  }}
                  className="text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                >
                  {byPhone ? "Use a different number" : "Use a different address"}
                </button>
                <button
                  type="button"
                  onClick={() => void resendCode()}
                  disabled={isSigningIn}
                  className="text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  Resend code
                </button>
              </div>
            </form>
          ) : chosen === null ? (
            <div className="flex flex-col gap-3">
              {AUTH_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => startProvider(p.id)}
                  disabled={isSigningIn}
                  className="flex items-center gap-3 rounded-lg bg-card shadow-sm active:shadow-[var(--press-sm)] px-4 py-3.5 hover:bg-accent transition-colors text-left disabled:opacity-60"
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
            <form onSubmit={submitIdentifier} className="flex flex-col gap-4">
              <button
                type="button"
                onClick={() => setChosen(null)}
                className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors self-start"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Other options
              </button>

              <div className="rounded-lg bg-background shadow-[var(--press-sm)] px-4 py-3 flex items-center gap-3">
                <span className="shrink-0">
                  {AUTH_PROVIDERS.find((p) => p.id === chosen)?.icon}
                </span>
                <span className="text-sm font-medium">
                  {AUTH_PROVIDERS.find((p) => p.id === chosen)?.label}
                </span>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="signin-email"
                  className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider"
                >
                  {byPhone ? "Mobile number" : "Email address"}
                </label>
                <Input
                  id="signin-email"
                  type={byPhone ? "tel" : "email"}
                  value={identifier}
                  onChange={(e) => {
                    if (byPhone) setPhone(e.target.value);
                    else setEmail(e.target.value);
                    // Clear as soon as they start fixing it; re-checked on blur
                    // and again on submit.
                    if (emailError) setEmailError(null);
                  }}
                  onBlur={() => identifier.trim() && setEmailError(validateIdentifier(identifier))}
                  aria-invalid={emailError ? true : undefined}
                  aria-describedby={emailError ? "signin-email-error" : undefined}
                  className="rounded-lg bg-background"
                  placeholder={byPhone ? "+91 98765 43210" : "you@yourchamber.in"}
                  autoComplete={byPhone ? "tel" : "email"}
                  inputMode={byPhone ? "tel" : undefined}
                  autoFocus
                  required
                />
                {byPhone && !emailError && (
                  <p className="text-xs text-muted-foreground">
                    With or without +91 — both work. Standard SMS charges apply.
                  </p>
                )}
                {emailError && (
                  <p
                    id="signin-email-error"
                    role="alert"
                    className="text-xs text-destructive flex items-center gap-1.5"
                  >
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {emailError}
                  </p>
                )}
              </div>

              {previewMode && (
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                    Display name (optional)
                  </label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="rounded-lg bg-background"
                    placeholder="Your name"
                  />
                </div>
              )}

              <Button
                type="submit"
                className="rounded-lg w-full"
                disabled={isSigningIn || !identifier.trim()}
              >
                {isSigningIn ? "Signing in..." : "Continue"}
              </Button>
            </form>
          )}

          {previewMode && (
            <div className="mt-8 rounded-lg bg-warning px-4 py-3">
              <p className="text-xs text-warning-foreground leading-relaxed">
                <strong className="font-semibold">Preview build.</strong> No Google or Zoho tenant
                is connected, so any address you type is treated as verified. Everything after that
                is real: if nobody has admitted your address you will be turned away, and if this is
                a fresh platform you will be offered the chance to create the first chamber.
              </p>
            </div>
          )}
        </div>
      </main>
      {/* Readable before anyone signs in, which is the point of them. */}
      <footer className="border-t border-border px-6 py-5 flex flex-wrap justify-center gap-x-6 gap-y-2 text-2xs font-mono uppercase tracking-widest text-muted-foreground">
        <a href="/legal/terms" className="hover:text-foreground py-2.5 px-1">
          Terms of Service
        </a>
        <a href="/legal/privacy" className="hover:text-foreground py-2.5 px-1">
          Privacy Policy
        </a>
        <a href="/legal/notice" className="hover:text-foreground py-2.5 px-1">
          Data Protection Notice
        </a>
      </footer>
    </div>
  );
}
