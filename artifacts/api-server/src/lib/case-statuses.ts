import { and, asc, eq } from "drizzle-orm";
import { db, workspaceStatusLabelsTable } from "@workspace/db";

/**
 * The workflow statuses a matter can be in, and how a chamber extends them.
 *
 * Mirrors `case-stages.ts` deliberately — same split between a standard list
 * in code and chamber additions in a table, same key derivation, same refusal
 * to delete. Read that file's reasoning; it applies here unchanged except that
 * status has no forum group, because whether anyone is working on a matter
 * does not depend on which court it is in.
 *
 * ── Why these four are code and not rows ──────────────────────────────────
 *
 * They are the same in every chamber and they are what `cases.status` has
 * defaulted to since the first migration. Seeding them per workspace would
 * mean four rows to migrate every time one is reworded, and — more to the
 * point — every matter already in production carries one of these four
 * strings. They have to keep resolving whether or not a chamber has ever
 * opened the status screen.
 */
export type StandardStatus = { key: string; label: string };

const STANDARD: StandardStatus[] = [
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In progress" },
  { key: "review", label: "Review" },
  { key: "closed", label: "Closed" },
];

/** What a matter gets when nobody says otherwise. Matches the column default. */
export const DEFAULT_STATUS = "open";

/**
 * A label turned into a status key.
 *
 * Identical rules to `stageKey()`, and for the identical reason: "On Hold",
 * "on-hold" and "On  Hold" must be one status, or the unique constraint lets a
 * chamber create three chips that read alike and filter apart.
 */
export function statusKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export type StatusOption = {
  key: string;
  label: string;
  /** "standard" comes from the list above; "chamber" from the table. */
  source: "standard" | "chamber";
  position: number;
};

/**
 * The full status vocabulary for one workspace: the four standard statuses in
 * their fixed order, then the chamber's own.
 *
 * A chamber addition whose key collides with a standard status does not appear
 * twice — the standard one wins and keeps its position. The unique constraint
 * cannot prevent that collision, because the standard keys are not rows for it
 * to conflict with.
 */
export async function statusOptions(workspaceId: number): Promise<StatusOption[]> {
  const options: StatusOption[] = STANDARD.map((s, i) => ({
    key: s.key,
    label: s.label,
    source: "standard",
    position: i,
  }));

  const rows = await db
    .select()
    .from(workspaceStatusLabelsTable)
    .where(eq(workspaceStatusLabelsTable.workspaceId, workspaceId))
    .orderBy(asc(workspaceStatusLabelsTable.position), asc(workspaceStatusLabelsTable.id));

  const taken = new Set(options.map((s) => s.key));
  for (const r of rows) {
    if (taken.has(r.key)) continue;
    taken.add(r.key);
    options.push({ key: r.key, label: r.label, source: "chamber", position: r.position });
  }

  return options;
}

/** Whether a status key is one this chamber's list actually offers. */
export async function isKnownStatus(workspaceId: number, key: string): Promise<boolean> {
  return (await statusOptions(workspaceId)).some((s) => s.key === key);
}

/**
 * One status key resolved to its label, for display.
 *
 * Memory first, like `stageLabelFor`: a register of forty matters would
 * otherwise be forty queries for a single word each, and all four standard
 * keys answer without touching the database.
 */
export async function statusLabelFor(workspaceId: number, key: string): Promise<string> {
  const standard = STANDARD.find((s) => s.key === key);
  if (standard) return standard.label;

  const [row] = await db
    .select()
    .from(workspaceStatusLabelsTable)
    .where(
      and(
        eq(workspaceStatusLabelsTable.workspaceId, workspaceId),
        eq(workspaceStatusLabelsTable.key, key),
      ),
    );
  // A key whose label was never recorded still has to render as something, and
  // the key is closer to the truth than a blank.
  return row?.label ?? key;
}

/**
 * Add a status to a chamber's list, or return the list unchanged if it already
 * has one with that key.
 *
 * Idempotent on purpose — the same call `stageOptions`' add makes. Two people
 * adding "On hold" a second apart should both succeed, and the second should
 * not see an error about a thing that is now true.
 */
export async function addStatus(
  workspaceId: number,
  label: string,
  createdBy: string,
): Promise<{ ok: true; options: StatusOption[] } | { ok: false; message: string }> {
  const trimmed = label.trim();
  if (trimmed.length < 2) return { ok: false, message: "A status needs at least two characters." };
  if (trimmed.length > 40) return { ok: false, message: "A status is at most 40 characters." };

  const key = statusKey(trimmed);
  if (!key) return { ok: false, message: "That label has no letters or digits in it." };

  const existing = await statusOptions(workspaceId);
  if (existing.some((s) => s.key === key)) return { ok: true, options: existing };

  await db
    .insert(workspaceStatusLabelsTable)
    .values({ workspaceId, key, label: trimmed, createdBy })
    .onConflictDoNothing();

  return { ok: true, options: await statusOptions(workspaceId) };
}
