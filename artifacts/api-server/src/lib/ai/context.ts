import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  casesTable,
  courtsTable,
  documentsTable,
  timelineEventsTable,
  calendarEntriesTable,
  chamberInsightsTable,
  styleExemplarsTable,
  courtLabel,
  type DraftKind,
} from "@workspace/db";
import * as blobStore from "../blob-store";
import { extractText } from "./extract";
import { estimateTokens } from "./client";

/**
 * Assembling what the model is told, out of what the chamber already holds.
 *
 * This is the feature. A general model given the same instruction writes a
 * generic petition; this one is given the matter's own facts, the chamber's own
 * voice, and the things these advocates have learned appearing before this
 * court. Everything else in `lib/ai` is plumbing around this file.
 *
 * ── The rule that governs all of it ─────────────────────────────────────
 *
 * **Only what the advocate ticked leaves the server.** Documents are included
 * by explicit id, and every id is re-checked here against the caller's
 * workspace AND the matter it claims to belong to. An id in a request body
 * proves nothing — the same reasoning as `billableClient()` in
 * `routes/invoices.ts`, and the reason this feature is defensible at all.
 *
 * The matter's own fields, the timeline and the chamber's insights are not
 * ticked individually. They are the chamber's own record of its own work,
 * which is what the advocate asked to draft from.
 */

/** Everything the prompt is built from, and what each part cost in tokens. */
export type AssembledContext = {
  /** The stable, cacheable prefix: drafting rules and the chamber's voice. */
  system: string;
  /** The volatile part: this matter, these documents, this instruction. */
  user: string;
  /** One row per thing that went in, for `draft_sources`. */
  sources: {
    kind: "document" | "insight" | "exemplar" | "matter";
    sourceId: number | null;
    label: string;
    tokens: number;
  }[];
  /** Documents the advocate ticked that yielded nothing readable. */
  unreadable: { id: number; name: string; note: string }[];
  estimatedInputTokens: number;
};

/** Ceiling on everything the documents contribute, in characters. */
const DOCUMENT_BUDGET_CHARS = 240_000;
/** How many insights to retrieve. Beyond this they stop being specific. */
const MAX_INSIGHTS = 8;
/** How many exemplars ride in the prefix. Two is a voice; six is a corpus. */
const MAX_EXEMPLARS = 2;

/* ── The matter ─────────────────────────────────────────────────────────── */

async function matterBrief(
  workspaceId: number,
  caseId: number,
): Promise<{ text: string; title: string } | null> {
  const [row] = await db
    .select({ matter: casesTable, court: courtsTable })
    .from(casesTable)
    .leftJoin(courtsTable, eq(courtsTable.id, casesTable.courtId))
    .where(and(eq(casesTable.id, caseId), eq(casesTable.workspaceId, workspaceId)));
  if (!row) return null;

  const m = row.matter;
  const courtRef =
    m.caseNumber !== null && m.caseYear !== null
      ? `${m.caseType ?? ""} ${m.caseNumber}/${m.caseYear}`.trim()
      : null;

  const lines = [
    `Title: ${m.title}`,
    `Filing reference: ${m.filingRef}`,
    row.court ? `Court: ${courtLabel(row.court)}` : null,
    courtRef ? `Case number as filed: ${courtRef}` : null,
    m.opposingParty ? `Opposing party: ${m.opposingParty}` : null,
    `Status: ${m.status}`,
    m.description ? `\nBackground as recorded by the chamber:\n${m.description}` : null,
  ].filter(Boolean);

  // The history, oldest first — a chronology is what a petition's "facts" section
  // is, and giving it in reverse would have to be undone by the model.
  const events = await db
    .select()
    .from(timelineEventsTable)
    .where(eq(timelineEventsTable.caseId, caseId))
    .orderBy(desc(timelineEventsTable.createdAt))
    .limit(40);
  if (events.length > 0) {
    lines.push("\nChronology (from the chamber's records):");
    for (const e of [...events].reverse()) {
      lines.push(`- ${e.createdAt.toISOString().slice(0, 10)} — ${e.description}`);
    }
  }

  const hearings = await db
    .select()
    .from(calendarEntriesTable)
    .where(
      and(
        eq(calendarEntriesTable.workspaceId, workspaceId),
        eq(calendarEntriesTable.caseId, caseId),
      ),
    )
    .orderBy(desc(calendarEntriesTable.entryDate))
    .limit(10);
  if (hearings.length > 0) {
    lines.push("\nListed dates:");
    for (const h of [...hearings].reverse()) {
      lines.push(`- ${h.entryDate} — ${h.title}`);
    }
  }

  return { text: lines.join("\n"), title: m.title };
}

/* ── The documents the advocate ticked ──────────────────────────────────── */

async function tickedDocuments(
  workspaceId: number,
  caseId: number,
  documentIds: number[],
): Promise<{
  text: string;
  sources: AssembledContext["sources"];
  unreadable: AssembledContext["unreadable"];
}> {
  if (documentIds.length === 0) return { text: "", sources: [], unreadable: [] };

  // Re-checked against the matter AND the workspace. A document id that belongs
  // to another chamber, or to another matter in this one, simply is not
  // returned — the request is not refused, because the honest answer is that
  // the advocate has no such document, not that they were caught at something.
  const rows = await db
    .select({ doc: documentsTable })
    .from(documentsTable)
    .innerJoin(casesTable, eq(casesTable.id, documentsTable.caseId))
    .where(
      and(
        inArray(documentsTable.id, documentIds),
        eq(documentsTable.caseId, caseId),
        eq(casesTable.workspaceId, workspaceId),
      ),
    );

  const parts: string[] = [];
  const sources: AssembledContext["sources"] = [];
  const unreadable: AssembledContext["unreadable"] = [];
  let used = 0;

  for (const { doc } of rows) {
    if (!doc.storagePath) {
      unreadable.push({
        id: doc.id,
        name: doc.name,
        note: "No file is stored against this entry.",
      });
      continue;
    }

    let extracted;
    try {
      const bytes = await blobStore.read(doc.storagePath);
      extracted = await extractText(bytes, doc.fileType ?? "application/octet-stream");
    } catch (err) {
      unreadable.push({
        id: doc.id,
        name: doc.name,
        note: `Could not be opened (${err instanceof Error ? err.message : String(err)}).`,
      });
      continue;
    }

    if (extracted.empty) {
      unreadable.push({
        id: doc.id,
        name: doc.name,
        note: extracted.note ?? "No readable text.",
      });
      continue;
    }

    // The shared ceiling. Stopping is better than silently dropping the middle
    // of a document, which would leave a plausible-looking half-order in the
    // prompt with no sign that anything was missing.
    const remaining = DOCUMENT_BUDGET_CHARS - used;
    if (remaining <= 0) {
      unreadable.push({
        id: doc.id,
        name: doc.name,
        note: "Left out — the documents already selected filled the context.",
      });
      continue;
    }
    const body = extracted.text.slice(0, remaining);
    used += body.length;

    parts.push(`--- Document: ${doc.name} ---\n${body}`);
    sources.push({
      kind: "document",
      sourceId: doc.id,
      label: doc.name,
      tokens: estimateTokens(body),
    });
  }

  return {
    text:
      parts.length > 0 ? `\n\nDOCUMENTS SELECTED BY THE ADVOCATE:\n\n${parts.join("\n\n")}` : "",
    sources,
    unreadable,
  };
}

/* ── The chamber's own knowledge ────────────────────────────────────────── */

/**
 * The insights most likely to matter here.
 *
 * Full-text ranked against the matter and the instruction, scoped to this
 * workspace, with a nudge toward insights recorded about the same court or the
 * same kind of case. `pg_trgm` and `pgvector` are unavailable in PGlite, so
 * this is `plainto_tsquery` — and at the volume one chamber writes, it finds
 * the right note. See DECISIONS.md.
 */
async function relevantInsights(
  workspaceId: number,
  query: string,
  courtId: number | null,
  caseTypeNorm: string | null,
): Promise<{ text: string; sources: AssembledContext["sources"] }> {
  const cleaned = query.replace(/\s+/g, " ").trim().slice(0, 500);
  const vector = sql`to_tsvector('simple', coalesce(${chamberInsightsTable.title}, '') || ' ' || coalesce(${chamberInsightsTable.body}, '') || ' ' || coalesce(${chamberInsightsTable.tags}, ''))`;

  // The text rank is computed as a SELECTED COLUMN and the forum preference is
  // applied in JavaScript afterwards — rather than the more obvious single
  // ORDER BY with the bonuses added into it.
  //
  // That is not a style choice. Bound parameters inside an ORDER BY expression
  // came back from PGlite as `invalid byte sequence for encoding "UTF8": 0x00`,
  // which is a parameter-binding fault a long way from anything this code says.
  // Keeping the ordering expression parameter-free removes the whole class of
  // problem, and the preference is clearer written out than buried in a CASE.
  const candidates = await db
    .select({
      insight: chamberInsightsTable,
      rank: sql<number>`ts_rank(${vector}, plainto_tsquery('simple', ${cleaned}))`,
    })
    .from(chamberInsightsTable)
    .where(eq(chamberInsightsTable.workspaceId, workspaceId))
    .orderBy(desc(chamberInsightsTable.updatedAt))
    .limit(60);

  if (candidates.length === 0) return { text: "", sources: [] };

  // An insight recorded about THIS court beats a better-worded one about a
  // different one: the whole value of a local observation is that it is local.
  const scored = candidates
    .map(({ insight, rank }) => ({
      insight,
      score:
        Number(rank ?? 0) +
        (courtId !== null && insight.courtId === courtId ? 0.3 : 0) +
        (caseTypeNorm !== null && insight.caseTypeNorm === caseTypeNorm ? 0.2 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_INSIGHTS)
    // Nothing matched the words and nothing matched the forum: including a
    // chamber's most recent notes regardless would be padding the prompt with
    // irrelevance and charging them for it.
    .filter((row) => row.score > 0);

  if (scored.length === 0) return { text: "", sources: [] };

  const parts = scored.map(({ insight }) => `- ${insight.title}\n  ${insight.body}`);
  return {
    text:
      `\n\nTHIS CHAMBER'S OWN OBSERVATIONS, recorded by its advocates from their own ` +
      `appearances. These are practical, local and not found in any judgment — prefer ` +
      `them over general assumptions where they conflict:\n\n${parts.join("\n")}`,
    sources: scored.map(({ insight }) => ({
      kind: "insight" as const,
      sourceId: insight.id,
      label: insight.title,
      tokens: estimateTokens(insight.title + insight.body),
    })),
  };
}

/**
 * How this chamber writes, from its own past filings.
 *
 * Only the redacted copy (`body`), and only once a person has reviewed it —
 * `reviewedAt` is the gate, enforced here rather than merely encouraged in the
 * schema comment. An exemplar sits in the cached prefix of every draft of its
 * kind, so an unreviewed one would put another client's facts in front of every
 * future draft.
 */
async function exemplars(
  workspaceId: number,
  kind: DraftKind,
): Promise<{ text: string; sources: AssembledContext["sources"] }> {
  const rows = await db
    .select()
    .from(styleExemplarsTable)
    .where(
      and(
        eq(styleExemplarsTable.workspaceId, workspaceId),
        eq(styleExemplarsTable.kind, kind),
        eq(styleExemplarsTable.active, true),
        sql`${styleExemplarsTable.reviewedAt} is not null`,
      ),
    )
    .orderBy(desc(styleExemplarsTable.updatedAt))
    .limit(MAX_EXEMPLARS);

  if (rows.length === 0) return { text: "", sources: [] };

  const parts = rows.map((e, i) => `--- Example ${i + 1}: ${e.title} ---\n${e.body}`);
  return {
    text:
      `\n\nHOW THIS CHAMBER WRITES. Past filings of this kind, with names and ` +
      `identifying facts removed. Follow their STRUCTURE, headings, register and ` +
      `standard formulae. Do not reuse their facts — they belong to other matters:` +
      `\n\n${parts.join("\n\n")}`,
    sources: rows.map((e) => ({
      kind: "exemplar" as const,
      sourceId: e.id,
      label: e.title,
      tokens: estimateTokens(e.body),
    })),
  };
}

/* ── Putting it together ────────────────────────────────────────────────── */

export type AssembleInput = {
  workspaceId: number;
  caseId: number;
  kind: DraftKind;
  instruction: string;
  documentIds: number[];
  /** The base rules for this kind of output. See `prompts.ts`. */
  rules: string;
};

export async function assemble(input: AssembleInput): Promise<AssembledContext | null> {
  const brief = await matterBrief(input.workspaceId, input.caseId);
  if (!brief) return null;

  const [matterRow] = await db
    .select({ courtId: casesTable.courtId, caseTypeNorm: casesTable.caseTypeNorm })
    .from(casesTable)
    .where(eq(casesTable.id, input.caseId));

  const [docs, insights, styles] = await Promise.all([
    tickedDocuments(input.workspaceId, input.caseId, input.documentIds),
    relevantInsights(
      input.workspaceId,
      `${brief.title} ${input.instruction}`,
      matterRow?.courtId ?? null,
      matterRow?.caseTypeNorm ?? null,
    ),
    exemplars(input.workspaceId, input.kind),
  ]);

  // The stable prefix, in cache order: rules first (identical for every draft
  // of this kind), then the chamber's voice, then its standing knowledge.
  // Nothing here varies per matter, which is what lets it be cached — a byte
  // that changed per request would invalidate the whole prefix every time.
  const system = `${input.rules}${styles.text}${insights.text}`;

  const user =
    `THE MATTER:\n\n${brief.text}${docs.text}\n\n` + `WHAT IS ASKED FOR:\n\n${input.instruction}`;

  return {
    system,
    user,
    sources: [
      {
        kind: "matter",
        sourceId: input.caseId,
        label: brief.title,
        tokens: estimateTokens(brief.text),
      },
      ...docs.sources,
      ...insights.sources,
      ...styles.sources,
    ],
    unreadable: docs.unreadable,
    estimatedInputTokens: estimateTokens(system) + estimateTokens(user),
  };
}
