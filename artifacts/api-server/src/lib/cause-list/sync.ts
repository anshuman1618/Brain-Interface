import { and, eq } from "drizzle-orm";
import {
  db,
  courtsTable,
  causeListEntriesTable,
  causeListSyncRunsTable,
  normaliseCaseType,
  type Court,
} from "@workspace/db";
import { logger } from "../logger";
import { adapterFor } from "./registry";
import { proposeMatches } from "./matcher";
import type { CauseListRow } from "./types";

/**
 * Fetch one court's list for one day, store it, and propose matches.
 *
 * Every run writes a `cause_list_sync_runs` row whatever happens — success,
 * failure, or no adapter. A scraper's characteristic failure is going quiet
 * after a site redesign, returning zero rows while everything downstream
 * keeps working on an empty set, so "it succeeded and found nothing" and "it
 * broke" have to be distinguishable in the data rather than in a log nobody
 * reads.
 */

/** How long one court gets before it is abandoned, so one slow site cannot stall the rest. */
const FETCH_TIMEOUT_MS = 30_000;

export type SyncResult = {
  courtId: number;
  status: "ok" | "failed" | "skipped";
  fetched: number;
  upserted: number;
  proposed: number;
  error?: string;
};

export async function syncCourt(court: Court, listDate: string): Promise<SyncResult> {
  const startedAt = Date.now();
  const adapter = adapterFor(court.adapter);

  // No adapter registered for this court. Not an error: a court can be listed
  // — and selected on a matter — long before anything can read its list.
  if (!adapter) {
    await db.insert(causeListSyncRunsTable).values({
      courtId: court.id,
      adapter: court.adapter,
      listDate,
      status: "skipped",
      durationMs: Date.now() - startedAt,
    });
    return { courtId: court.id, status: "skipped", fetched: 0, upserted: 0, proposed: 0 };
  }

  let rows: CauseListRow[];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      rows = await adapter.fetchCauseList({ listDate, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.insert(causeListSyncRunsTable).values({
      courtId: court.id,
      adapter: court.adapter,
      listDate,
      status: "failed",
      error: message.slice(0, 1000),
      durationMs: Date.now() - startedAt,
    });
    logger.error(
      { courtId: court.id, adapter: court.adapter, listDate, err },
      "Cause list sync failed",
    );
    return {
      courtId: court.id,
      status: "failed",
      fetched: 0,
      upserted: 0,
      proposed: 0,
      error: message,
    };
  }

  // The run row is written first so entries can point at it, then updated with
  // the counts once the work is done.
  const [run] = await db
    .insert(causeListSyncRunsTable)
    .values({
      courtId: court.id,
      adapter: court.adapter,
      listDate,
      status: "ok",
      fetched: rows.length,
    })
    .returning();

  let upserted = 0;
  for (const row of rows) {
    const values = {
      courtId: court.id,
      listDate,
      caseType: row.caseType,
      // Normalised here, once, by the same function the matter used — this is
      // what makes matching a plain equality rather than a fuzzy compare.
      caseTypeNorm: normaliseCaseType(row.caseType),
      caseNumber: row.caseNumber,
      caseYear: row.caseYear,
      parties: row.parties,
      courtNo: row.courtNo,
      itemNo: row.itemNo,
      coram: row.coram,
      purpose: row.purpose,
      rawText: row.rawText,
      sourceKey: row.sourceKey,
      syncRunId: run.id,
      fetchedAt: new Date(),
    };

    // Update in place on a re-fetch. Courts republish a list through the day as
    // items move between benches or are struck off, and the advocate wants the
    // current state of their listing, not six historical copies of it.
    await db
      .insert(causeListEntriesTable)
      .values(values)
      .onConflictDoUpdate({
        target: [
          causeListEntriesTable.courtId,
          causeListEntriesTable.listDate,
          causeListEntriesTable.sourceKey,
        ],
        set: values,
      });
    upserted += 1;
  }

  const proposed = await proposeMatches(court.id, listDate);

  await db
    .update(causeListSyncRunsTable)
    .set({ upserted, proposed, durationMs: Date.now() - startedAt })
    .where(eq(causeListSyncRunsTable.id, run.id));

  logger.info(
    {
      courtId: court.id,
      adapter: court.adapter,
      listDate,
      fetched: rows.length,
      upserted,
      proposed,
    },
    "Cause list synced",
  );
  return { courtId: court.id, status: "ok", fetched: rows.length, upserted, proposed };
}

/**
 * Sync every active court for a date.
 *
 * One court's failure never stops another's — `syncCourt` catches its own
 * errors and reports them as a result, so a High Court that redesigned its
 * page overnight does not take the rest of the country's listings down with
 * it. That is the whole reason this loop does not use `Promise.all` with a
 * rejection path.
 */
export async function syncAllCourts(listDate: string): Promise<SyncResult[]> {
  const courts = await db.select().from(courtsTable).where(eq(courtsTable.active, true));
  const results: SyncResult[] = [];
  // In series, not in parallel: these are requests to other people's servers,
  // several of them government ones, and a burst of simultaneous fetches is
  // exactly the behaviour that gets an IP blocked.
  for (const court of courts) {
    results.push(await syncCourt(court, listDate));
  }
  return results;
}

/** The court a code names, or null. Used by the manual-trigger route. */
export async function courtByCode(code: string): Promise<Court | null> {
  const [row] = await db.select().from(courtsTable).where(eq(courtsTable.code, code));
  return row ?? null;
}

/** Today and the next `days` days, as YYYY-MM-DD. */
export function upcomingDates(days: number, from = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i <= days; i += 1) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Whether a court already has a successful run for a date — used to avoid re-fetching. */
export async function hasSyncedToday(courtId: number, listDate: string): Promise<boolean> {
  const [row] = await db
    .select({ id: causeListSyncRunsTable.id })
    .from(causeListSyncRunsTable)
    .where(
      and(
        eq(causeListSyncRunsTable.courtId, courtId),
        eq(causeListSyncRunsTable.listDate, listDate),
        eq(causeListSyncRunsTable.status, "ok"),
      ),
    )
    .limit(1);
  return Boolean(row);
}
