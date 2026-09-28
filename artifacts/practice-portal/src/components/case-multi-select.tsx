import { useMemo, useState } from "react";
import { useListCases, getListCasesQueryKey, type Case } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, X, Check } from "lucide-react";

/**
 * Browse and tick the matters a client is admitted to.
 *
 * It replaced a `type="number"` box that took one id and ran `parseInt` on
 * whatever was typed. Two problems with that, and the second is the one that
 * matters: an admin had to know a matter's numeric id, which is not shown
 * anywhere they would be looking, and a typo admitted somebody to a different
 * client's file. A wrong id was indistinguishable from a right one until the
 * client rang up about a matter that was not theirs.
 *
 * ── Why it filters in the browser ────────────────────────────────────────
 *
 * The register is already loaded on this screen's sibling pages and a chamber
 * has tens of matters, not thousands. A search endpoint would be a round trip
 * per keystroke to filter a list the client already holds. If a chamber ever
 * outgrows that, this is the one component to change.
 *
 * Selected matters stay pinned to the top even when they fall out of the
 * search, so narrowing the list cannot silently hide what is already ticked —
 * which on an access-control screen would be the difference between granting
 * two matters and thinking you had granted three.
 */
export function CaseMultiSelect({
  value,
  onChange,
  disabled,
}: {
  value: number[];
  onChange: (caseIds: number[]) => void;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const { data: cases = [], isLoading } = useListCases(undefined, {
    query: { queryKey: getListCasesQueryKey() },
  });

  const selected = useMemo(() => new Set(value), [value]);

  const { pinned, rest } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (c: Case) =>
      !q ||
      c.title.toLowerCase().includes(q) ||
      (c.filingRef ?? "").toLowerCase().includes(q) ||
      (c.clientName ?? "").toLowerCase().includes(q);
    return {
      pinned: cases.filter((c: Case) => selected.has(c.id)),
      rest: cases.filter((c: Case) => !selected.has(c.id) && matches(c)),
    };
  }, [cases, search, selected]);

  const toggle = (id: number) => {
    if (disabled) return;
    onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  const row = (c: Case, isOn: boolean) => (
    <button
      key={c.id}
      type="button"
      disabled={disabled}
      aria-pressed={isOn}
      onClick={() => toggle(c.id)}
      className={`flex w-full items-center gap-2 rounded-[var(--radius)] px-2 py-2 text-left transition-colors ${
        isOn ? "bg-accent text-accent-foreground" : "hover:bg-muted/50"
      }`}
    >
      <span
        aria-hidden
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border ${
          isOn ? "border-foreground bg-foreground text-background" : "border-border"
        }`}
      >
        {isOn && <Check className="h-3 w-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{c.title}</span>
        <span className="block truncate font-mono text-3xs uppercase tracking-wider text-muted-foreground">
          {c.filingRef || `CASE-${c.id}`}
          {c.clientName ? ` · ${c.clientName}` : ""}
        </span>
      </span>
    </button>
  );

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => {
            const c = cases.find((x: Case) => x.id === id);
            return (
              <Badge
                key={id}
                variant="outline"
                className="rounded-[var(--radius)] font-mono text-3xs uppercase tracking-wider"
              >
                {c?.filingRef || `CASE-${id}`}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(id)}
                  aria-label={`Remove ${c?.title ?? `case ${id}`}`}
                  className="ml-1.5 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={disabled}
          placeholder="Search matters by name, ref or client…"
          className="rounded-lg pl-9 text-sm"
          aria-label="Search matters"
        />
      </div>

      <div className="max-h-56 overflow-y-auto overscroll-y-contain rounded-[var(--radius)] border border-border p-1">
        {isLoading ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">Loading matters…</p>
        ) : cases.length === 0 ? (
          <p className="px-2 py-3 text-sm leading-relaxed text-muted-foreground">
            This chamber has no matters yet. Open one first — a client can only be admitted to a
            matter that exists.
          </p>
        ) : (
          <>
            {pinned.map((c: Case) => row(c, true))}
            {pinned.length > 0 && rest.length > 0 && (
              <div className="my-1 border-t border-border" />
            )}
            {rest.map((c: Case) => row(c, false))}
            {rest.length === 0 && pinned.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground">No matter matches that.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
