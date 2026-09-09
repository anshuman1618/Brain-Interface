import { and, asc, eq } from "drizzle-orm";
import { db, caseStageLabelsTable, type Case } from "@workspace/db";

/**
 * The stages of a matter, and which list applies to which matter.
 *
 * ── Why the standard stages are code and not rows ─────────────────────────
 *
 * A writ petition is answered by a counter affidavit, which is answered by a
 * rejoinder. That is true in every chamber in the country; it is not a fact
 * about any one workspace. Seeding thirty identical rows per chamber would
 * mean a migration across every tenant the first time one label is reworded,
 * and it would let two chambers drift apart on something that is not theirs to
 * differ on. So the standard list lives here, and `case_stage_labels` holds
 * ONLY what a chamber adds on top.
 *
 * ── Why a matter's forum group is inferred rather than backfilled ─────────
 *
 * `cases.forum_group` is null on every matter that predates this feature. A
 * backfill would have had to guess from `case_type_norm` anyway, and a guess
 * written into a column is invisible: nobody re-examines a stored value. A
 * guess made on read is visible in one function, correctable in one place, and
 * overridden the moment somebody sets the column. `forumGroupFor()` is that
 * function.
 */

export const FORUM_GROUPS = ["writ", "civil", "criminal", "tribunal", "general"] as const;
export type ForumGroup = (typeof FORUM_GROUPS)[number];

export function isForumGroup(v: unknown): v is ForumGroup {
  return typeof v === "string" && (FORUM_GROUPS as readonly string[]).includes(v);
}

export const FORUM_GROUP_LABELS: Record<ForumGroup, string> = {
  writ: "Writ and constitutional",
  civil: "Civil suit or appeal",
  criminal: "Criminal",
  tribunal: "Tribunal or commission",
  general: "Advisory or unfiled",
};

export type StandardStage = { key: string; label: string };

/**
 * The standard stages, in the order the papers actually come.
 *
 * Written for Indian practice, and deliberately short. A list long enough to
 * cover every procedural step of every matter is a list nobody reads to the
 * bottom of, and the chamber-defined additions exist precisely so the rare
 * stage does not have to be anticipated here. `order` and `judgment` are kept
 * separate throughout: an interim order is not the disposal, and a chamber
 * filing under one heading does not want the other's papers mixed in.
 */
const STANDARD: Record<ForumGroup, readonly StandardStage[]> = {
  writ: [
    { key: "petition", label: "Petition" },
    { key: "counter_affidavit", label: "Counter affidavit" },
    { key: "rejoinder_affidavit", label: "Rejoinder affidavit" },
    { key: "supplementary_affidavit", label: "Supplementary affidavit" },
    { key: "interlocutory_application", label: "Interlocutory application" },
    { key: "written_submissions", label: "Written submissions" },
    { key: "order", label: "Orders" },
    { key: "judgment", label: "Judgment" },
  ],
  civil: [
    { key: "plaint", label: "Plaint" },
    { key: "written_statement", label: "Written statement" },
    { key: "replication", label: "Replication" },
    { key: "issues", label: "Issues framed" },
    { key: "evidence", label: "Evidence" },
    { key: "written_arguments", label: "Written arguments" },
    { key: "interlocutory_application", label: "Interlocutory application" },
    { key: "order", label: "Orders" },
    { key: "decree", label: "Judgment and decree" },
  ],
  criminal: [
    { key: "fir", label: "FIR" },
    { key: "chargesheet", label: "Chargesheet" },
    { key: "bail_application", label: "Bail application" },
    { key: "reply", label: "Reply by the prosecution" },
    { key: "discharge_application", label: "Discharge application" },
    { key: "charge", label: "Charge framed" },
    { key: "evidence", label: "Evidence" },
    { key: "written_arguments", label: "Written arguments" },
    { key: "order", label: "Orders" },
    { key: "judgment", label: "Judgment" },
  ],
  tribunal: [
    { key: "petition", label: "Petition or appeal" },
    { key: "reply", label: "Reply" },
    { key: "rejoinder", label: "Rejoinder" },
    { key: "additional_affidavit", label: "Additional affidavit" },
    { key: "written_submissions", label: "Written submissions" },
    { key: "interlocutory_application", label: "Interlocutory application" },
    { key: "order", label: "Orders" },
  ],
  general: [
    { key: "instructions", label: "Instructions and brief" },
    { key: "correspondence", label: "Correspondence" },
    { key: "draft", label: "Drafts" },
    { key: "filed", label: "Filed papers" },
    { key: "order", label: "Orders received" },
  ],
};

/**
 * Case-type prefixes that place a matter in a group, longest first.
 *
 * Matched against `case_type_norm`, which `normaliseCaseType` has already
 * stripped to letters and digits and uppercased — so "W.P.(C)" and "WP(C)"
 * both arrive as "WPC" and both hit the "WP" prefix.
 *
 * Order matters and is why this is an array rather than a map: "CRL" must be
 * tested before "CR", or every criminal revision is filed as a civil one. Two
 * known collisions are resolved by hand and neither is safe to widen:
 *
 *  - "CC" is a criminal calendar case in the sessions courts AND a consumer
 *    complaint before a commission. It is read as criminal, which is the far
 *    commoner filing; a consumer matter gets the tribunal list by setting the
 *    column.
 *  - "CP" is a company petition (tribunal) and, in some registries, a civil
 *    petition. It is read as tribunal.
 *
 * This is a default, not a determination. Every matter can override it, and
 * anything unrecognised falls to "general" rather than to a wrong guess.
 */
const TYPE_PREFIXES: readonly (readonly [string, ForumGroup])[] = [
  // Criminal, before the shorter civil prefixes that they start with.
  ["CRLMC", "criminal"],
  ["CRLREV", "criminal"],
  ["CRLA", "criminal"],
  ["CRLMA", "criminal"],
  ["CRLOP", "criminal"],
  ["CRLP", "criminal"],
  ["CRL", "criminal"],
  ["BAIL", "criminal"],
  ["ABA", "criminal"], // anticipatory bail application
  ["FIR", "criminal"],
  ["SC", "criminal"], // sessions case
  ["CC", "criminal"], // calendar case — see the note above
  // Writ and constitutional.
  ["WPCRL", "writ"],
  ["WPC", "writ"],
  ["WP", "writ"],
  ["WRIT", "writ"],
  ["PIL", "writ"],
  ["SLP", "writ"],
  ["CRLWP", "writ"],
  // Tribunals and commissions.
  ["NCLT", "tribunal"],
  ["NCLAT", "tribunal"],
  ["NGT", "tribunal"],
  ["ITAT", "tribunal"],
  ["CAT", "tribunal"],
  ["DRT", "tribunal"],
  ["IBC", "tribunal"],
  ["IB", "tribunal"],
  ["CP", "tribunal"], // company petition — see the note above
  ["OA", "tribunal"], // original application
  ["TA", "tribunal"], // transferred application
  // Civil.
  ["CS", "civil"],
  ["OS", "civil"],
  ["RFA", "civil"],
  ["RSA", "civil"],
  ["FAO", "civil"],
  ["CMA", "civil"],
  ["CMP", "civil"],
  ["CRP", "civil"],
  ["CR", "civil"],
  ["EP", "civil"], // execution petition
  ["MACT", "civil"],
  ["HMA", "civil"], // Hindu Marriage Act
  ["MAT", "civil"],
  ["ARBP", "civil"],
  ["ARB", "civil"],
];

/**
 * The stage list this matter uses. The stored column wins; otherwise the case
 * type decides; otherwise "general".
 */
export function forumGroupFor(c: Pick<Case, "forumGroup" | "caseTypeNorm">): ForumGroup {
  if (isForumGroup(c.forumGroup)) return c.forumGroup;

  const norm = (c.caseTypeNorm ?? "").toUpperCase();
  if (norm) {
    for (const [prefix, group] of TYPE_PREFIXES) {
      if (norm.startsWith(prefix)) return group;
    }
  }
  return "general";
}

/**
 * A label turned into a stage key.
 *
 * Aggressive on purpose, same reasoning as `normaliseCaseType`: "Caveat
 * Petition", "caveat-petition" and "Caveat  Petition" must all be the same
 * stage, or the unique constraint lets a chamber create three headings that
 * read alike and sort apart. Trailing and leading separators are trimmed so a
 * key never begins or ends in an underscore.
 */
export function stageKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export type StageOption = {
  key: string;
  label: string;
  /** "standard" comes from the list above; "chamber" from case_stage_labels. */
  source: "standard" | "chamber";
  position: number;
};

/**
 * The full vocabulary for a forum group in one workspace: the standard stages
 * in their fixed order, then the chamber's own.
 *
 * A chamber addition whose key collides with a standard stage does not appear
 * twice — the standard one wins and keeps its position. The unique constraint
 * cannot prevent that collision, because the standard keys are not rows for it
 * to conflict with, so it is resolved here instead of being shown to a reader
 * as a duplicated heading.
 */
export async function stageOptions(workspaceId: number, group: ForumGroup): Promise<StageOption[]> {
  const standard: StageOption[] = STANDARD[group].map((s, i) => ({
    key: s.key,
    label: s.label,
    source: "standard",
    position: i,
  }));

  const rows = await db
    .select()
    .from(caseStageLabelsTable)
    .where(
      and(
        eq(caseStageLabelsTable.workspaceId, workspaceId),
        eq(caseStageLabelsTable.forumGroup, group),
      ),
    )
    .orderBy(asc(caseStageLabelsTable.position), asc(caseStageLabelsTable.id));

  const taken = new Set(standard.map((s) => s.key));
  for (const r of rows) {
    if (taken.has(r.key)) continue;
    taken.add(r.key);
    standard.push({ key: r.key, label: r.label, source: "chamber", position: r.position });
  }

  return standard;
}

/**
 * One stage key resolved to its heading, for display on a matter.
 *
 * Memory first, and that is the point: a list of forty matters would otherwise
 * be forty queries for a single word each. Only a key the standard list does
 * not have — a chamber-defined one — costs a round trip, and only on the
 * matters that actually carry one.
 */
export async function stageLabelFor(
  workspaceId: number,
  group: ForumGroup,
  key: string | null,
): Promise<string | null> {
  if (!key) return null;

  const standard = STANDARD[group].find((s) => s.key === key);
  if (standard) return standard.label;

  const [row] = await db
    .select()
    .from(caseStageLabelsTable)
    .where(
      and(
        eq(caseStageLabelsTable.workspaceId, workspaceId),
        eq(caseStageLabelsTable.forumGroup, group),
        eq(caseStageLabelsTable.key, key),
      ),
    );
  // A key whose label was never recorded — or was recorded against a different
  // forum group, which happens when a matter is re-grouped — still has to
  // render as something. The key itself is closer to the truth than a blank.
  return row?.label ?? key;
}

/** Whether a stage key is one this matter's list actually offers. */
export async function isKnownStage(
  workspaceId: number,
  group: ForumGroup,
  key: string,
): Promise<boolean> {
  return (await stageOptions(workspaceId, group)).some((s) => s.key === key);
}
