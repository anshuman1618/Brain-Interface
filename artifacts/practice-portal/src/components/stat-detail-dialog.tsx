import type { ReactNode } from "react";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";

/**
 * What a number on the dashboard is actually made of.
 *
 * The stat cards report counts, and a count on its own is a dead end: "3
 * overdue" prompts "which three?" and the only answer used to be to leave the
 * dashboard and go looking. This turns each figure into the list behind it.
 *
 * Deliberately not a new endpoint. Every row shown here comes from a query the
 * dashboard has already made for its other sections, so opening one of these
 * costs nothing and can never disagree with the number on the card — the count
 * and the list are the same data.
 *
 * Every row leads somewhere. A dialog that shows a list and strands you there
 * has only moved the dead end one click further in.
 */

export type StatRow = {
  id: number | string;
  /** The line a person scans for. */
  title: string;
  /** Context under it — a date, a status, a matter name. */
  subtitle?: string;
  /** Right-aligned marker: a due date, a priority. */
  trailing?: ReactNode;
  /** Where clicking the row goes. Omit to make the row inert. */
  href?: string;
};

export function StatDetailDialog({
  open,
  onOpenChange,
  title,
  description,
  rows,
  emptyMessage,
  seeAllHref,
  seeAllLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  rows: StatRow[];
  /** Shown instead of the list when there is nothing. Say what it means. */
  emptyMessage: string;
  seeAllHref?: string;
  seeAllLabel?: string;
}) {
  const [, setLocation] = useLocation();

  const go = (href: string) => {
    onOpenChange(false);
    setLocation(href);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <div className="-mx-2 flex-1 overflow-y-auto">
            {rows.map((row) => {
              const content = (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{row.title}</div>
                    {row.subtitle && (
                      <div className="truncate text-xs text-muted-foreground">{row.subtitle}</div>
                    )}
                  </div>
                  {row.trailing && (
                    <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {row.trailing}
                    </div>
                  )}
                  {row.href && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                </>
              );

              // A row that goes nowhere is not a button. Rendering it as one
              // would promise a click that does nothing.
              return row.href ? (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => go(row.href!)}
                  className="flex w-full items-center gap-3 rounded-[var(--radius)] px-2 py-2.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {content}
                </button>
              ) : (
                <div key={row.id} className="flex w-full items-center gap-3 px-2 py-2.5">
                  {content}
                </div>
              );
            })}
          </div>
        )}

        {seeAllHref && (
          <Button variant="outline" className="w-full" onClick={() => go(seeAllHref)}>
            {seeAllLabel ?? "See all"}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A stat card that is only pressable when there is something behind it.
 *
 * Two cards carry their own controls or their own empty state at zero — Active
 * Cases offers "File your first case", Next Hearing says "None scheduled". A
 * button inside a button is invalid markup, and opening an empty list teaches
 * nobody anything, so at zero these render as plain cards.
 */
export function MaybeStatButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  if (!active) return <>{children}</>;
  return (
    <StatCardButton onClick={onClick} label={label}>
      {children}
    </StatCardButton>
  );
}

/**
 * The card wrapper that makes a stat clickable.
 *
 * A plain `<div onClick>` would be invisible to a keyboard and to a screen
 * reader, so this is a real button with the card's own relief: it lifts on
 * hover and sinks on press, matching every other pressable surface in the app.
 */
export function StatCardButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  /** Announced to assistive tech — the visible number alone means nothing. */
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="w-full text-left rounded-[var(--radius)] transition-shadow hover:shadow-[var(--raise-lg)] active:shadow-[var(--press)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {children}
    </button>
  );
}
