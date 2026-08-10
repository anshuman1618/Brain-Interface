import { useState } from "react";
import { MailX, LogOut, Send, Check, Building2 } from "lucide-react";
import { useCreateAccessRequest } from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RoleOptionsGrid } from "@/components/auth/role-options-grid";
import { useToast } from "@/hooks/use-toast";
import { providerLabel } from "@/lib/auth-providers";
import {
  clearAccessRequestIntent,
  getAccessRequestIntent,
  type RoleValue,
} from "@/lib/role-options";
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
 */
export default function AccessDeniedPage({
  defaultWorkspaceSlug = "raghavan-chambers",
}: {
  defaultWorkspaceSlug?: string;
}) {
  const { displayName, email, authProvider, signOut, refreshSession } = useSession();
  const createRequest = useCreateAccessRequest();
  const { toast } = useToast();

  const [asking, setAsking] = useState(false);
  const [founding, setFounding] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [selected, setSelected] = useState<RoleValue | null>(() => getAccessRequestIntent());
  const [note, setNote] = useState("");

  const provider = providerLabel(authProvider);

  if (founding) {
    return <CreateChamberPage onCancel={() => setFounding(false)} />;
  }

  const submit = () => {
    if (!selected) return;
    createRequest.mutate(
      {
        data: {
          workspaceSlug: defaultWorkspaceSlug,
          requestedRole: selected,
          note: note || undefined,
        },
      },
      {
        onSuccess: () => {
          clearAccessRequestIntent();
          setSubmitted(true);
          refreshSession();
        },
        onError: (err: unknown) => {
          toast({
            title: "Couldn't send the request",
            description: err instanceof Error ? err.message : undefined,
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col items-center justify-center px-4 py-12 relative overflow-y-auto">
      <div className="fixed inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSJub25lIiAvPgo8cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJjdXJyZW50Q29sb3IiIG9wYWNpdHk9IjAuMDUiIC8+Cjwvc3ZnPg==')] opacity-[0.4] pointer-events-none" />

      <div className="relative z-10 w-full max-w-2xl">
        <div className="border border-destructive/40 bg-destructive/5 p-8">
          <div className="flex items-start gap-4">
            <div className="h-10 w-10 bg-destructive/10 flex items-center justify-center shrink-0">
              <MailX className="h-5 w-5 text-destructive" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-mono text-xs uppercase tracking-widest text-destructive mb-1">
                Access denied
              </p>
              <h1 className="text-2xl font-bold tracking-tight mb-3">
                This email isn't on the chamber's access list
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                You signed in successfully{provider ? ` with ${provider}` : ""} as{" "}
                <span className="font-mono font-medium text-foreground break-all">{email}</span>
                {displayName ? ` (${displayName})` : ""}. That proves who you are, but a chamber
                admin has not admitted this address, so there is nothing here for you yet.
              </p>
              <div className="border border-border bg-background p-4">
                <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
                  What to do
                </p>
                <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-4">
                  <li>
                    If your chamber uses a work address, sign out and sign in with that one instead
                    — a personal Gmail or Zoho account won't match.
                  </li>
                  <li>
                    Otherwise ask your chamber admin to invite this address, or request access
                    below.
                  </li>
                  <li>Setting up a new practice? Create your own chamber instead.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {submitted ? (
          <div className="border border-border bg-background p-6 mt-4 flex items-start gap-3">
            <Check className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Request sent</p>
              <p className="text-sm text-muted-foreground mt-1">
                An admin will review it. Nothing is granted until they approve, and the role you
                asked for is a request only — they choose what you get.
              </p>
            </div>
          </div>
        ) : asking ? (
          <div className="border border-border bg-background p-6 mt-4">
            <h2 className="text-lg font-bold tracking-tight mb-1">Request access</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Tell the admin what you need. They decide the role you're given.
            </p>

            <div className="mb-6">
              <RoleOptionsGrid selected={selected} onSelect={setSelected} />
            </div>

            <div className="space-y-2 mb-6">
              <label className="text-xs font-mono uppercase font-bold text-muted-foreground tracking-wider">
                Why do you need access? (optional)
              </label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="rounded-none resize-none h-20 bg-background"
                placeholder="e.g. Joining as practice manager from 1 September."
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => setAsking(false)}
                className="text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <Button
                className="rounded-none px-8"
                disabled={!selected || createRequest.isPending}
                onClick={submit}
              >
                <Send className="h-4 w-4 mr-2" />
                {createRequest.isPending ? "Sending..." : "Send request"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4 mt-6">
            <button
              type="button"
              onClick={() => signOut()}
              className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign in with a different address
            </button>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="rounded-none" onClick={() => setAsking(true)}>
                Request access
              </Button>
              {/* The first person on a fresh platform lands here — there is no
                  chamber to admit them yet, so founding one is the way in. */}
              <Button className="rounded-none" onClick={() => setFounding(true)}>
                <Building2 className="h-4 w-4 mr-2" /> Create a chamber
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
