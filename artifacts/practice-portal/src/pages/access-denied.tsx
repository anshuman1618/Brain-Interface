import { useState } from "react";
import { MailX, LogOut, Building2, ShieldAlert } from "lucide-react";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { providerLabel } from "@/lib/auth-providers";
import CreateChamberPage from "@/pages/create-chamber";

/**
 * Shown when sign-in succeeded but the verified address is on no access list.
 *
 * This is the error the brief asks for, and it is deliberately specific: it
 * names the address that was refused, because "access denied" alone leaves
 * someone who signed in with the wrong one of their two Google accounts with no
 * idea what went wrong.
 *
 * It reveals nothing it shouldn't. It does not say which chambers exist, whether
 * a similar address is listed, or what role anyone holds — only that *this*
 * address is not admitted.
 *
 * There is deliberately no "request access" form here. It used to post to a
 * chamber slug hardcoded in this file, which existed on no deployment, so every
 * request 404'd. Joining an existing chamber is by admin invitation; founding a
 * new one is the self-serve path.
 */
export default function AccessDeniedPage() {
  const { displayName, email, phone, authProvider, signOut } = useSession();

  const [founding, setFounding] = useState(false);

  const provider = providerLabel(authProvider);
  /*
   * Which identifier this person actually holds decides the whole screen.
   *
   * Somebody who signed in by SMS has no address at all, and that is their
   * finished state, not a failure — telling them "we didn't get a verified
   * email address" would send them off to fix something that is not broken.
   * So the copy below names whichever identifier they have, and only the
   * genuinely empty case gets the "nothing was verified" wording.
   */
  const identifier = email || phone;
  const identifierNoun = email ? "email address" : "mobile number";
  // Nothing verified at all: the account exists but there is nothing to match
  // against a list. Without this the screen said "you signed in as" and then
  // named nobody, which reads like a bug rather than a thing to act on.
  const identifierMissing = !identifier;

  if (founding) {
    return <CreateChamberPage onCancel={() => setFounding(false)} />;
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col items-center justify-center px-4 py-12 relative overflow-y-auto">
      <div className="fixed inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSJub25lIiAvPgo8cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJjdXJyZW50Q29sb3IiIG9wYWNpdHk9IjAuMDUiIC8+Cjwvc3ZnPg==')] opacity-[0.4] pointer-events-none" />

      <div className="relative z-10 w-full max-w-2xl">
        <div className="border border-destructive/40 bg-destructive/5 p-8">
          <div className="flex items-start gap-4">
            <div className="h-10 w-10 bg-destructive/10 flex items-center justify-center shrink-0">
              {identifierMissing ? (
                <ShieldAlert className="h-5 w-5 text-destructive" />
              ) : (
                <MailX className="h-5 w-5 text-destructive" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-mono text-xs uppercase tracking-widest text-destructive mb-1">
                {identifierMissing ? "Identity not verified" : "Access denied"}
              </p>

              {identifierMissing ? (
                <>
                  <h1 className="text-2xl font-bold tracking-tight mb-3">
                    We didn't get a verified email address or mobile number
                  </h1>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                    You signed in{provider ? ` with ${provider}` : ""}, but the provider did not
                    give us an address or a number it has confirmed belongs to you. Access is
                    granted per identifier, so there is nothing here to match yet.
                  </p>
                  <div className="rounded-lg bg-card shadow-sm p-4">
                    <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
                      What to do
                    </p>
                    <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-4">
                      <li>
                        Verify your email address with{provider ? ` ${provider}` : " your provider"}
                        , then sign out and sign in again.
                      </li>
                      <li>
                        Or sign in with the email or mobile option, which verifies the identifier
                        directly with a one-time code.
                      </li>
                    </ul>
                  </div>
                </>
              ) : (
                <>
                  <h1 className="text-2xl font-bold tracking-tight mb-3">
                    This {identifierNoun} isn't on the chamber's access list
                  </h1>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                    You signed in successfully{provider ? ` with ${provider}` : ""} as{" "}
                    <span className="font-mono font-medium text-foreground break-all">
                      {identifier}
                    </span>
                    {displayName ? ` (${displayName})` : ""}. That proves who you are, but a chamber
                    admin has not admitted this {identifierNoun}, so there is nothing here for you
                    yet.
                  </p>
                  <div className="rounded-lg bg-card shadow-sm p-4">
                    <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
                      What to do
                    </p>
                    <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-4">
                      {email && (
                        <li>
                          If your chamber uses a work address, sign out and sign in with that one
                          instead — a personal Gmail or Zoho account won't match.
                        </li>
                      )}
                      <li>
                        Otherwise ask your chamber admin to add{" "}
                        <span className="font-mono text-foreground break-all">{identifier}</span> to
                        the access list, then sign in again.
                      </li>
                      <li>Setting up a new practice? Create your own chamber instead.</li>
                    </ul>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 mt-6">
          <button
            type="button"
            onClick={() => signOut()}
            className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign in with a different address
          </button>
          {/* The first person on a fresh platform lands here — there is no
              chamber to admit them yet, so founding one is the way in. */}
          <Button className="rounded-lg" onClick={() => setFounding(true)}>
            <Building2 className="h-4 w-4 mr-2" /> Create a chamber
          </Button>
        </div>
      </div>
    </div>
  );
}
