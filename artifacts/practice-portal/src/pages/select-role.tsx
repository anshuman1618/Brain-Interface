import { useState } from "react";
import { useSelectRole, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, Scale, Gavel, ClipboardList, User, Check } from "lucide-react";

const ROLE_OPTIONS = [
  {
    value: "admin",
    label: "Firm Admin",
    description: "Full control: manage the team, billing, and every case in the firm.",
    icon: ShieldCheck,
  },
  {
    value: "senior_advocate",
    label: "Senior Advocate",
    description: "Lead cases, oversee junior advocates, and access KPI reporting.",
    icon: Scale,
  },
  {
    value: "junior_advocate",
    label: "Junior Advocate",
    description: "Manage assigned cases, tasks, and client consultations.",
    icon: Gavel,
  },
  {
    value: "clerk_intern",
    label: "Clerk / Intern",
    description: "Support the team with tasks, scheduling, and document handling.",
    icon: ClipboardList,
  },
  {
    value: "client",
    label: "Client",
    description: "View your case status, documents, and upcoming consultations.",
    icon: User,
  },
] as const;

export default function SelectRolePage() {
  const [selected, setSelected] = useState<string | null>(null);
  const selectRole = useSelectRole();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { signOut } = useAuth();

  const handleContinue = () => {
    if (!selected) return;
    selectRole.mutate({ data: { role: selected as any } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      },
      onError: () => {
        toast({ title: "Couldn't save your role", description: "Please try again.", variant: "destructive" });
      },
    });
  };

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center px-4 py-12 relative overflow-hidden">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSJub25lIiAvPgo8cmVjdCB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJjdXJyZW50Q29sb3IiIG9wYWNpdHk9IjAuMDUiIC8+Cjwvc3ZnPg==')] opacity-[0.4] pointer-events-none" />
      <div className="relative z-10 w-full max-w-3xl">
        <div className="mb-8 text-center">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">Step 1 of 1</p>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Choose your workspace role</h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            This determines what you can see and do in the portal. An admin can change it later from Team Settings.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-8">
          {ROLE_OPTIONS.map((opt) => {
            const isSelected = selected === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSelected(opt.value)}
                className={`text-left border p-5 transition-colors relative ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border bg-background hover:border-primary/50"
                }`}
              >
                {isSelected && (
                  <div className="absolute top-3 right-3 h-5 w-5 bg-primary text-primary-foreground flex items-center justify-center">
                    <Check className="h-3.5 w-3.5" />
                  </div>
                )}
                <opt.icon className="h-6 w-6 mb-3 text-foreground" />
                <div className="font-semibold mb-1">{opt.label}</div>
                <div className="text-sm text-muted-foreground">{opt.description}</div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => signOut()}
            className="text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign out
          </button>
          <Button
            className="rounded-none px-8"
            disabled={!selected || selectRole.isPending}
            onClick={handleContinue}
          >
            {selectRole.isPending ? "Saving..." : "Continue to dashboard"}
          </Button>
        </div>
      </div>
    </div>
  );
}
