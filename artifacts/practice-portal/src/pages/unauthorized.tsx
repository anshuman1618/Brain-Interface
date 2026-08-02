import { Link, useSearch } from "wouter";
import { ShieldAlert } from "lucide-react";
import { useSession } from "@/lib/session";

const CAPABILITY_LABELS: Record<string, string> = {
  "kpi.read": "KPI engine",
  "billing.manage": "Billing & subscription",
  "access_control.manage": "Access control",
  "team.manage": "Team roles",
  "cases.read": "Case files",
  "cases.write": "Case editing",
  "tasks.write": "Task assignment",
  "consultations.read": "Consultation recorder",
  "document_requests.create": "Document requests",
};

/**
 * The 401 page. Reached when a user navigates directly to a restricted route
 * without the backend claim that permits it.
 */
export default function UnauthorizedPage() {
  const search = useSearch();
  const { displayRole, activeWorkspace } = useSession();
  const required = new URLSearchParams(search).get("required");
  const label = required ? (CAPABILITY_LABELS[required] ?? required) : null;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center px-4">
      <div className="border border-destructive/30 bg-destructive/5 p-10 max-w-lg w-full">
        <ShieldAlert className="h-10 w-10 text-destructive mx-auto mb-6" />
        <p className="font-mono text-xs uppercase tracking-widest text-destructive mb-2">
          401 · Unauthorized
        </p>
        <h1 className="text-2xl font-bold tracking-tight mb-3">
          This area isn't part of your access
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          {label ? (
            <>
              <span className="font-medium text-foreground">{label}</span> requires a permission your
              role does not hold
            </>
          ) : (
            "Your role does not hold the permission this area requires"
          )}
          {displayRole && activeWorkspace ? (
            <>
              {" "}
              — you are signed in as <span className="font-medium text-foreground">{displayRole}</span>{" "}
              in <span className="font-medium text-foreground">{activeWorkspace.name}</span>.
            </>
          ) : (
            "."
          )}
        </p>
        <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-8">
          Ask a workspace admin to change your role
        </p>
        <Link
          href="/dashboard"
          className="inline-block border border-border px-6 py-2.5 text-sm font-mono uppercase tracking-wider hover:bg-accent transition-colors"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
