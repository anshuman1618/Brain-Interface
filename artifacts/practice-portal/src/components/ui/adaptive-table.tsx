import * as React from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * One dataset, two layouts.
 *
 * The chamber's widest screens are tables — invoices carries seven columns,
 * tasks and consultations six. Dropping secondary columns with
 * `hidden sm:table-cell` (see DECISIONS.md) narrowed them but never made them
 * fit: /team still measured 499px at a 375px viewport, and a table that has to
 * be scrolled sideways to read a due date is not a table anybody uses on a
 * phone.
 *
 * So below `md` the same rows render as cards, where a row is read top to
 * bottom and nothing is off-screen. Above it, the real `<table>` comes back,
 * because on a laptop a table genuinely is the better instrument: it aligns
 * figures in a column and lets the eye run down one field across many rows.
 *
 * The point of doing it here rather than per page is that a column is then
 * described ONCE. `cell` renders in both layouts, so the two can never drift
 * into showing different data — which is exactly what happened the first time
 * this was solved page by page.
 */

/** Where a column goes when the row becomes a card. */
export type CardRole =
  /** The headline. Rendered large; the first `title` column wins. */
  | "title"
  /** Sits directly under the title, muted — status, reference, category. */
  | "subtitle"
  /** A labelled field in the card's detail grid. This is the default. */
  | "field"
  /** Pinned to the card's footer — buttons, menus. Label is never shown. */
  | "action"
  /** Table only. Use for anything that is pure decoration in a narrow layout. */
  | "hidden";

export type AdaptiveColumn<T> = {
  /** Stable key. Also the React key for the cell. */
  key: string;
  /** Column heading. Also the field label in card layout unless `cardLabel` overrides it. */
  header: React.ReactNode;
  /** Renders the value. Used by BOTH layouts, so they cannot disagree. */
  cell: (row: T) => React.ReactNode;
  /** Overrides `header` as the card field label — useful when the heading is an icon or blank. */
  cardLabel?: React.ReactNode;
  /** Where this column lands in card layout. Defaults to `"field"`. */
  card?: CardRole;
  /** Extra classes on the `<th>`. Put table-only column dropping here, e.g. `hidden lg:table-cell`. */
  headClassName?: string;
  /** Extra classes on the `<td>`. Must match any `hidden …:table-cell` used above. */
  cellClassName?: string;
  /** Width of the skeleton bar shown for this column while loading. */
  skeletonClassName?: string;
};

type AdaptiveTableProps<T> = {
  columns: AdaptiveColumn<T>[];
  rows: T[];
  rowKey: (row: T) => React.Key;
  /** Applied to the `<tr>` and to the card — row-level emphasis such as an overdue tint. */
  rowClassName?: (row: T) => string | undefined;
  isLoading?: boolean;
  /** How many placeholder rows to draw while loading. */
  skeletonRows?: number;
  /** Shown instead of rows when there are none. Spans the full width in both layouts. */
  empty?: React.ReactNode;
  /** Accessible name for the table. */
  label?: string;
  className?: string;
};

export function AdaptiveTable<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  isLoading = false,
  skeletonRows = 5,
  empty,
  label,
  className,
}: AdaptiveTableProps<T>) {
  const roleOf = (c: AdaptiveColumn<T>): CardRole => c.card ?? "field";

  // Resolved once per render rather than inside the row loop: the split is a
  // property of the column spec, not of any row.
  const titleColumn = columns.find((c) => roleOf(c) === "title");
  const subtitleColumns = columns.filter((c) => roleOf(c) === "subtitle");
  const fieldColumns = columns.filter((c) => roleOf(c) === "field");
  const actionColumns = columns.filter((c) => roleOf(c) === "action");

  const showEmpty = !isLoading && rows.length === 0 && empty !== undefined;

  return (
    <div className={className}>
      {/* ── Table: md and up ─────────────────────────────────────────────── */}
      <div className="hidden md:block">
        <Table aria-label={label}>
          <TableHeader>
            <TableRow className="hover:bg-transparent bg-muted/30">
              {columns.map((c) => (
                <TableHead key={c.key} className={c.headClassName}>
                  {c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: skeletonRows }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  {columns.map((c) => (
                    <TableCell key={c.key} className={c.cellClassName}>
                      <Skeleton className={cn("h-4 w-24", c.skeletonClassName)} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : showEmpty ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="h-32 text-center">
                  {empty}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={rowKey(row)} className={rowClassName?.(row)}>
                  {columns.map((c) => (
                    <TableCell key={c.key} className={c.cellClassName}>
                      {c.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Cards: below md ──────────────────────────────────────────────── */}
      <div className="md:hidden">
        {isLoading ? (
          <ul className="divide-y divide-border">
            {Array.from({ length: skeletonRows }).map((_, i) => (
              <li key={`skeleton-card-${i}`} className="p-4 space-y-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-20" />
                </div>
              </li>
            ))}
          </ul>
        ) : showEmpty ? (
          <div className="p-6 text-center">{empty}</div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={rowKey(row)} className={cn("p-4 space-y-3", rowClassName?.(row))}>
                {(titleColumn || subtitleColumns.length > 0) && (
                  <div className="space-y-1">
                    {titleColumn && (
                      <div className="text-sm font-medium leading-snug">
                        {titleColumn.cell(row)}
                      </div>
                    )}
                    {subtitleColumns.length > 0 && (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                        {subtitleColumns.map((c) => (
                          <React.Fragment key={c.key}>{c.cell(row)}</React.Fragment>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {fieldColumns.length > 0 && (
                  /* Two columns at 360px is the widest that keeps a label and
                     its value on one line without the label wrapping. */
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {fieldColumns.map((c) => (
                      <div key={c.key} className="min-w-0">
                        <dt className="font-mono text-3xs uppercase tracking-wider text-muted-foreground">
                          {c.cardLabel ?? c.header}
                        </dt>
                        <dd className="text-sm mt-0.5 break-words">{c.cell(row)}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {actionColumns.length > 0 && (
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                    {actionColumns.map((c) => (
                      <React.Fragment key={c.key}>{c.cell(row)}</React.Fragment>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
