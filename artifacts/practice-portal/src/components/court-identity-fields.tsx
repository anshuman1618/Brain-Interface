import { useListCourts, getListCourtsQueryKey, type Court } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle } from "lucide-react";
import { courtIdentityProblem, type CourtIdentity } from "@/lib/court-identity";

/**
 * How a court names a matter: court, type, number, year.
 *
 * Shared between opening a matter and correcting one later, because they are
 * the same four fields under the same all-or-none rule and the server enforces
 * that rule once. Two copies of this form would be two places for the rule to
 * drift out of step with `courtIdentity()` in `routes/cases.ts`.
 *
 * The four travel as a unit. A number with no court matches nothing; a court
 * with no number would match everything the parser failed to read. So the form
 * refuses a partial set rather than letting the server refuse it — the advocate
 * finds out while the field is still in front of them.
 */

function courtLabel(c: Court): string {
  return c.bench ? `${c.name} (${c.bench})` : c.name;
}

export function CourtIdentityFields({
  value,
  onChange,
  idPrefix = "court",
}: {
  value: CourtIdentity;
  onChange: (next: CourtIdentity) => void;
  idPrefix?: string;
}) {
  const { data: courts = [] } = useListCourts({
    query: { queryKey: getListCourtsQueryKey() },
  });
  const problem = courtIdentityProblem(value);

  /** An empty box is absent, not zero — `Number("")` is 0 and would stick. */
  const num = (raw: string): number | undefined =>
    raw.trim() === "" ? undefined : Number(raw.replace(/[^0-9]/g, ""));

  return (
    <div className="grid gap-3 rounded-[var(--radius)] border border-dashed border-border p-3">
      <div>
        <p className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
          Court listing identity — optional
        </p>
        <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
          How the court names this matter on its cause list. Fill it in and published listings for
          it turn up under Court Listings for you to accept.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-court`}>Court</Label>
        <Select
          value={value.courtId ? String(value.courtId) : "none"}
          // Choosing "not filed" empties the rest with it. The four are one
          // fact, so leaving three behind would only produce the partial the
          // form then refuses — and taking a matter out of matching is the
          // whole reason somebody opens this.
          onValueChange={(v) => onChange(v === "none" ? {} : { ...value, courtId: Number(v) })}
        >
          <SelectTrigger id={`${idPrefix}-court`}>
            <SelectValue placeholder="Not filed in a listed court" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Not filed in a listed court</SelectItem>
            {courts.map((c: Court) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {courtLabel(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-type`}>Case type</Label>
          <Input
            id={`${idPrefix}-type`}
            value={value.caseType ?? ""}
            onChange={(e) => onChange({ ...value, caseType: e.target.value })}
            placeholder="W.P.(C)"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-number`}>Number</Label>
          <Input
            id={`${idPrefix}-number`}
            inputMode="numeric"
            value={value.caseNumber ?? ""}
            onChange={(e) => onChange({ ...value, caseNumber: num(e.target.value) })}
            placeholder="1234"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-year`}>Year</Label>
          <Input
            id={`${idPrefix}-year`}
            inputMode="numeric"
            value={value.caseYear ?? ""}
            onChange={(e) => onChange({ ...value, caseYear: num(e.target.value) })}
            placeholder="2026"
          />
        </div>
      </div>

      {problem && (
        <p role="alert" className="flex items-center gap-1.5 text-2xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {problem}
        </p>
      )}
    </div>
  );
}
