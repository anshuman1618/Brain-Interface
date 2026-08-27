import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAiBudget,
  useSetDraftingEnabled,
  getGetAiBudgetQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Sparkles, ShieldCheck, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { userMessage } from "@/lib/errors";
import { useSession } from "@/lib/session";

/**
 * The chamber's opt-in to AI drafting.
 *
 * ── Why this component had to exist ──────────────────────────────────────
 *
 * `workspaces.drafting_enabled` defaults to false and only
 * `POST /workspace/drafting` can change it. That gate is deliberate — nothing
 * reaches a model until the chamber has said yes, which is the whole basis on
 * which sending privileged client material to a third party is defensible.
 *
 * But the switch was never built. The pages shipped, the routes shipped, the
 * suites passed by calling the endpoint directly, and the refusal message told
 * admins to "enable it from the plan screen" — where there was nothing to
 * click. The feature was complete and unreachable. This is the missing half.
 *
 * ── What the acknowledgement is for ──────────────────────────────────────
 *
 * Not a legal shield. It is there so the person switching this on has read,
 * once, what leaves the server and what does not — because the honest answer
 * is "only what an advocate ticks", and that is a claim worth someone having
 * actually read before it is relied on.
 */

const WHAT_IS_SENT = [
  "The matter's own fields, chronology and listed dates",
  "Only the documents an advocate ticks, one draft at a time",
  "This chamber's insights, and style examples a person has approved",
];

const WHAT_IS_NOT = [
  "No document is sent because it happens to be on the matter",
  "Nothing is filed, served, or shown to a client",
  "No chamber's material is ever used for another chamber",
];

export function DraftingOptIn() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [acknowledged, setAcknowledged] = useState(false);

  // `/ai/budget` already reports `draftingEnabled`; it was fetched and ignored
  // until now. No second endpoint for one boolean.
  const { data } = useGetAiBudget({ query: { queryKey: getGetAiBudgetQueryKey() } });
  const setEnabled = useSetDraftingEnabled();

  // Switching it on is an admin decision about the practice's obligations, and
  // the route enforces `access_control.manage` regardless of what renders.
  const canManage = can("access_control.manage");
  if (!data) return null;

  const on = data.draftingEnabled;

  const flip = (next: boolean) => {
    setEnabled.mutate(
      {
        data: {
          enabled: next,
          ...(next ? { acknowledgement: "Read what is sent and to whom." } : {}),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAiBudgetQueryKey() });
          toast({
            title: next ? "AI drafting is on" : "AI drafting is off",
            description: next
              ? "Advocates can now draft from this chamber's own records."
              : "Nothing further will be sent to a model.",
          });
        },
        onError: (err: Error) =>
          toast({
            title: "Could not change that",
            description: userMessage(err, "Try again."),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <div className="rounded-lg bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <h3 className="font-mono uppercase tracking-wider">AI drafting</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Draft from this chamber&rsquo;s own records, and be briefed on a matter before it is
              filed. Off until you switch it on.
            </p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-md px-2 py-1 font-mono text-3xs uppercase tracking-widest ${
            on ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"
          }`}
        >
          {on ? "On" : "Off"}
        </span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="flex items-center gap-1.5 font-mono text-2xs uppercase tracking-wider text-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> What is sent
          </p>
          <ul className="mt-2 space-y-1 text-2xs text-muted-foreground">
            {WHAT_IS_SENT.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="flex items-center gap-1.5 font-mono text-2xs uppercase tracking-wider text-foreground">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> What is not
          </p>
          <ul className="mt-2 space-y-1 text-2xs text-muted-foreground">
            {WHAT_IS_NOT.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      </div>

      {!canManage ? (
        <p className="mt-5 text-2xs text-muted-foreground">
          Only an admin can switch this on. {on ? "It is on for this chamber." : ""}
        </p>
      ) : on ? (
        <div className="mt-5 flex items-center justify-between rounded-[var(--radius)] bg-muted/40 p-3">
          <Label htmlFor="drafting-switch" className="text-sm font-medium">
            AI drafting is on for this chamber
          </Label>
          <Switch
            id="drafting-switch"
            checked
            disabled={setEnabled.isPending}
            onCheckedChange={() => flip(false)}
          />
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {/* The acknowledgement gates the button rather than being a box to
              tick afterwards, so the sentence is read before it is agreed to. */}
          <label className="flex items-start gap-2 text-2xs text-muted-foreground">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(v === true)}
              aria-label="I have read what is sent and to whom"
            />
            <span>
              I have read what is sent and to whom, and I am responsible for what this chamber
              files. Everything produced is unverified and must be checked before it is relied on.
            </span>
          </label>
          <Button
            className="rounded-lg"
            disabled={!acknowledged || setEnabled.isPending}
            onClick={() => flip(true)}
          >
            {setEnabled.isPending ? "Switching on…" : "Switch AI drafting on"}
          </Button>
        </div>
      )}
    </div>
  );
}
