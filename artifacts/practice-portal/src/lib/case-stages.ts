import type { Document, StageOption } from "@workspace/api-client-react";

/**
 * The key the unfiled group uses in React lists.
 *
 * Not a stage: it is the absence of one. Kept as a constant so the empty-string
 * key and the null value cannot drift apart between the picker and the vault.
 */
export const UNFILED = "__unfiled__";

export type StageGroup = {
  key: string;
  label: string;
  /** False for the trailing unfiled bucket, which is not a stage of anything. */
  isStage: boolean;
  documents: Document[];
};

/**
 * Documents under stage headings, in the order the papers actually come.
 *
 * Two rules, and both are about not hiding anything from the reader:
 *
 *  - **Empty stages are dropped.** A writ list is eight headings long and a
 *    matter at the counter-affidavit stage has papers under two of them; six
 *    empty headings is a screen that reads as broken. The picker still offers
 *    every stage, so nothing is unreachable.
 *  - **Unfiled papers come last, never nowhere.** Every document uploaded
 *    before stages existed has a null stage, and so does anything a client
 *    sends in without one. They group under a trailing heading — dropping them
 *    would be a vault that silently shows fewer files than it holds.
 *
 * A document carrying a stage the list no longer offers (the matter was
 * re-grouped, so its old keys are not on the new list) gets its own heading
 * from the key rather than being folded into unfiled — losing the label is not
 * a reason to lose the filing.
 */
export function groupByStage(documents: Document[], options: StageOption[]): StageGroup[] {
  const byKey = new Map<string, Document[]>();
  for (const d of documents) {
    const key = d.stage ?? UNFILED;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(d);
    else byKey.set(key, [d]);
  }

  const groups: StageGroup[] = [];
  const placed = new Set<string>();

  for (const option of options) {
    const docs = byKey.get(option.key);
    if (!docs?.length) continue;
    placed.add(option.key);
    groups.push({ key: option.key, label: option.label, isStage: true, documents: docs });
  }

  // Stages this matter's list no longer offers, in whatever order they arrived.
  for (const [key, docs] of byKey) {
    if (key === UNFILED || placed.has(key)) continue;
    groups.push({ key, label: key, isStage: true, documents: docs });
  }

  const unfiled = byKey.get(UNFILED);
  if (unfiled?.length) {
    groups.push({
      key: UNFILED,
      label: "Unfiled papers",
      isStage: false,
      documents: unfiled,
    });
  }

  return groups;
}
