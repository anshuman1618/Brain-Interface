import * as React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * One table definition, two layouts: a real table from `md` up, stacked cards
 * below it.
 *
 * ── Why this supersedes column dropping ─────────────────────────────────────
 *
 * The rule until now (DECISIONS.md, "Wide tables lose columns on phones rather
 * than becoming cards") was `hidden sm:table-cell` on secondary columns, with
 * the horizontal scroller as the fallback. That was the right call for a design
 * pass and it is the wrong one for an app somebody works from on a phone,
 * because the two failure modes are not equivalent:
 *
 *   - A dropped column is *gone*. On `/invoices`, seven columns at 360px leaves
 *     about two — and "which invoices are unpaid" is answered by the columns
 *     that get dropped, not by the ones that survive.
 *   - A card is *tall*. Nothing is hidden, the reader scrolls, and scrolling is
 *     the one gesture a phone is unambiguously good at.
 *
 * ── Why one definition rather than two blocks of JSX ────────────────────────
 *
 * The obvious implementation is a `hidden md:block` table beside a `md:hidden`
 * list, each written out. That is two renderings of the same row, and they
 * drift: a column added to one is forgotten in the other, and nobody notices
 * because nobody has both open at the same width.
 *
 * Here `cell` is called by BOTH layouts. There is one place a column's contents
 * can come from, so a new column appears in the card the moment it appears in
 * the table, and it cannot be styled differently by accident.
 *
 * ── The `card` role ─────────────────────────────────────────────────────────
 *
 * What a column becomes below `md`:
 *
 *   "title"     the card's heading — one per table
 *   "subtitle"  a quieter line under the heading (a reference, a date)
 *   "field"     a labelled row in the card's body, label taken from `header`
 *   "action"    pinned to the card's footer, label suppressed (buttons, menus)
 *   "hidden"    rendered in the table only — for a column that is pure
 *               decoration, or whose information is already in the title
 *
 * Omitted defaults to "field", which is the safe direction: a column nobody
 * classified still shows up on a phone rather than silently vanishing, which is
 * the exact failure this component exists to stop.
 */

export type AdaptiveColumn<T> = {
  /** Stable key. Also the React key for the cell. */
  key: string;
  /** Column heading, and the label for a `field` in card layout. */
  header: React.ReactNode;
  /** Renders the value. Called by BOTH layouts — see the note above. */
  cell: (row: T) => React.ReactNode;
  /** What this column becomes below `md`. Defaults to `"field"`. */
  card?: "title" | "subtitle" | "field" | "action" | "hidden";
  /** Extra classes for the `<th>`/`<td>` in table layout only. */
  className?: string;
  /**
   * Hide the column in TABLE layout at narrow widths, e.g. `"hidden lg:table-cell"`.
   * Card layout ignores this — the whole point is that the card keeps it.
   */
  tableClassName?: string;
};

export type AdaptiveTableProps<T> = {
  columns: AdaptiveColumn<T>[];
  rows: T[];
  /** Stable identity per row, for React keys. */
  rowKey: (row: T) => string | number;
  /** Shown in place of both layouts when there are no rows. */
  empty?: React.ReactNode;
  /** Optional click target for a whole row / whole card. */
  onRowClick?: (row: T) => void;
  /**
   * Per-row styling, applied to the `<tr>` AND the card `<li>`.
   *
   * For state that the row itself carries rather than any one column — an
   * overdue task tinting its whole row. Taking it here rather than letting a
   * column render it is what keeps the two layouts saying the same thing: a
   * tint that existed only on the table would quietly not exist on a phone.
   */
  rowClassName?: (row: T) => string | undefined;
  className?: string;
  /** Accessible name for the table. */
  label?: string;
};

export function AdaptiveTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  onRowClick,
  rowClassName,
  className,
  label,
}: AdaptiveTableProps<T>) {
  if (rows.length === 0 && empty) {
    return <>{empty}</>;
  }

  const roleOf = (c: AdaptiveColumn<T>) => c.card ?? "field";
  const title = columns.find((c) => roleOf(c) === "title");
  const subtitles = columns.filter((c) => roleOf(c) === "subtitle");
  const fields = columns.filter((c) => roleOf(c) === "field");
  const actions = columns.filter((c) => roleOf(c) === "action");

  return (
    <div className={className}>
      {/* ── Table, md and up ─────────────────────────────────────────────── */}
      <div className="hidden md:block">
        <Table aria-label={label}>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key} className={cn(c.className, c.tableClassName)}>
                  {c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(onRowClick && "cursor-pointer", rowClassName?.(row))}
              >
                {columns.map((c) => (
                  <TableCell key={c.key} className={cn(c.className, c.tableClassName)}>
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ── Cards, below md ──────────────────────────────────────────────── */}
      <ul className="md:hidden flex flex-col gap-2" aria-label={label}>
        {rows.map((row) => {
          const body = (
            <>
              {title ? (
                <div className="text-sm font-medium leading-snug min-w-0 break-words">
                  {title.cell(row)}
                </div>
              ) : null}

              {subtitles.length > 0 ? (
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground min-w-0">
                  {subtitles.map((c) => (
                    <span key={c.key} className="min-w-0 break-words">
                      {c.cell(row)}
                    </span>
                  ))}
                </div>
              ) : null}

              {fields.length > 0 ? (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  {fields.map((c) => (
                    <React.Fragment key={c.key}>
                      <dt className="font-mono text-3xs uppercase tracking-wider text-muted-foreground self-center">
                        {c.header}
                      </dt>
                      {/* `min-w-0` on the value, or a long unbroken reference
                          pushes the grid wider than the card and the page
                          scrolls sideways — which is the whole failure this
                          component exists to prevent. */}
                      <dd className="text-xs min-w-0 break-words">{c.cell(row)}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              ) : null}

              {actions.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
                  {actions.map((c) => (
                    <React.Fragment key={c.key}>{c.cell(row)}</React.Fragment>
                  ))}
                </div>
              ) : null}
            </>
          );

          return (
            <li
              key={rowKey(row)}
              className={cn("rounded-[var(--radius)] bg-card p-3 shadow-sm", rowClassName?.(row))}
            >
              {onRowClick ? (
                /*
                 * A button rather than a click handler on the <li>: a card that
                 * navigates has to be reachable by keyboard and announce itself
                 * as activatable, and a div with onClick does neither.
                 *
                 * `text-left` because a button centres its content by default,
                 * which would centre every field in the card.
                 */
                <button
                  type="button"
                  onClick={() => onRowClick(row)}
                  className="w-full text-left min-w-0"
                >
                  {body}
                </button>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
