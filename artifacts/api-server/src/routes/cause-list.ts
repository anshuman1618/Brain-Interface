import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  courtsTable,
  casesTable,
  causeListEntriesTable,
  causeListMatchesTable,
  causeListSyncRunsTable,
  courtLabel,
} from "@workspace/db";
import {
  ListCourtsResponse,
  ListCauseListProposalsQueryParams,
  ListCauseListProposalsResponse,
  DecideCauseListProposalBody,
  ListCauseListRunsResponse,
  TriggerCauseListSyncBody,
} from "@workspace/api-zod";
import {
  requireWorkspace,
  requireCapability,
  ctx,
  type AuthRequest,
} from "../middlewares/requireAuth";
import { zodMessage } from "../lib/validation";
import { adapterFor } from "../lib/cause-list/registry";
import { acceptMatch, dismissMatch } from "../lib/cause-list/decide";
import { courtByCode, syncCourt } from "../lib/cause-list/sync";

const router: IRouter = Router();

/**
 * Courts, for the picker on a matter.
 *
 * Global reference data — every chamber sees the same list, because a court
 * is a fact about the world rather than about a tenant. Behind
 * `requireWorkspace` all the same: there is no reason to serve it to someone
 * who is not signed in, and it costs nothing to keep the whole API behind one
 * consistent rule.
 *
 * `syncable` is computed rather than stored: whether an adapter exists is a
 * property of the BUILD, not of the row, and a court whose adapter is
 * unwritten should say so honestly instead of looking ready.
 */
router.get(
  "/courts",
  requireWorkspace,
  requireCapability("cases.read"),
  async (_req: AuthRequest, res): Promise<void> => {
    const rows = await db
      .select()
      .from(courtsTable)
      .where(eq(courtsTable.active, true))
      .orderBy(courtsTable.name, courtsTable.bench);

    res.json(
      ListCourtsResponse.parse(
        rows.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          bench: c.bench,
          jurisdiction: c.jurisdiction,
          active: c.active,
          syncable: adapterFor(c.adapter) !== null,
        })),
      ),
    );
  },
);

/**
 * Listings matched to this chamber's matters.
 *
 * `calendar.read` rather than `cases.read`: this is about who has to be in a
 * courtroom, which is the same question the calendar answers, and it means a
 * clerk — who holds calendar.read and does the diary — sees them, while a
 * client (who holds neither) never does.
 *
 * Scoped to the caller's workspace on the WHERE clause. The join reaches
 * `cause_list_entries`, which is global, but only through match rows that
 * already belong to this workspace — so the global table cannot leak a
 * listing for somebody else's matter.
 */
router.get(
  "/cause-list/proposals",
  requireWorkspace,
  requireCapability("calendar.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const params = ListCauseListProposalsQueryParams.safeParse(req.query);
    if (!params.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(params.error) });
      return;
    }
    const status = params.data.status ?? "pending";

    const rows = await db
      .select({
        match: causeListMatchesTable,
        entry: causeListEntriesTable,
        matter: casesTable,
        court: courtsTable,
      })
      .from(causeListMatchesTable)
      .innerJoin(
        causeListEntriesTable,
        eq(causeListEntriesTable.id, causeListMatchesTable.causeListEntryId),
      )
      .innerJoin(casesTable, eq(casesTable.id, causeListMatchesTable.caseId))
      .innerJoin(courtsTable, eq(courtsTable.id, causeListEntriesTable.courtId))
      .where(
        and(
          eq(causeListMatchesTable.workspaceId, c.workspaceId),
          eq(causeListMatchesTable.status, status),
        ),
      )
      .orderBy(causeListEntriesTable.listDate);

    res.json(
      ListCauseListProposalsResponse.parse(
        rows.map(({ match, entry, matter, court }) => ({
          id: match.id,
          status: match.status,
          confidence: match.confidence,
          caseId: matter.id,
          caseTitle: matter.title,
          listDate: entry.listDate,
          courtName: courtLabel(court),
          caseRef:
            entry.caseNumber !== null && entry.caseYear !== null
              ? `${entry.caseType} ${entry.caseNumber}/${entry.caseYear}`
              : entry.caseType,
          parties: entry.parties,
          courtNo: entry.courtNo,
          itemNo: entry.itemNo,
          coram: entry.coram,
          purpose: entry.purpose,
          rawText: entry.rawText,
          calendarEntryId: match.calendarEntryId,
          decidedBy: match.decidedBy,
          decidedAt: match.decidedAt?.toISOString() ?? null,
          createdAt: match.createdAt.toISOString(),
        })),
      ),
    );
  },
);

/**
 * Accept a listing onto the calendar, or dismiss it.
 *
 * `calendar.write` — the same boundary as posting any other calendar entry,
 * held by Admin and Senior Advocate. Accepting IS writing to the calendar;
 * gating it any lower would mean the one control that turns scraped text into
 * a date an advocate plans around is weaker than typing that date by hand.
 *
 * It also inherits the lapsed-plan rule for free: `calendar.write` is not on
 * `CAPABILITIES_WHEN_LAPSED`, so a chamber whose plan expired can still SEE
 * its proposals and cannot act on them.
 */
router.post(
  "/cause-list/proposals/:id/decision",
  requireWorkspace,
  requireCapability("calendar.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const body = DecideCauseListProposalBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(body.error) });
      return;
    }

    const decide = body.data.decision === "accept" ? acceptMatch : dismissMatch;
    const result = await decide(c.workspaceId, id, c.user.displayName);

    if (!result.ok) {
      // 404 for another chamber's id as well as a missing one — an outsider
      // must not be able to use the response to confirm that an id exists.
      if (result.reason === "not_found") {
        res.status(404).json({ error: "No such proposal" });
        return;
      }
      res.status(409).json({
        error: "already_decided",
        message: "That listing has already been accepted or dismissed.",
      });
      return;
    }

    // Re-read through the same shape the list endpoint serves, so a client can
    // swap the row it holds without a second request.
    const [row] = await db
      .select({
        match: causeListMatchesTable,
        entry: causeListEntriesTable,
        matter: casesTable,
        court: courtsTable,
      })
      .from(causeListMatchesTable)
      .innerJoin(
        causeListEntriesTable,
        eq(causeListEntriesTable.id, causeListMatchesTable.causeListEntryId),
      )
      .innerJoin(casesTable, eq(casesTable.id, causeListMatchesTable.caseId))
      .innerJoin(courtsTable, eq(courtsTable.id, causeListEntriesTable.courtId))
      .where(eq(causeListMatchesTable.id, result.match.id));

    res.json({
      id: row.match.id,
      status: row.match.status,
      confidence: row.match.confidence,
      caseId: row.matter.id,
      caseTitle: row.matter.title,
      listDate: row.entry.listDate,
      courtName: courtLabel(row.court),
      caseRef:
        row.entry.caseNumber !== null && row.entry.caseYear !== null
          ? `${row.entry.caseType} ${row.entry.caseNumber}/${row.entry.caseYear}`
          : row.entry.caseType,
      parties: row.entry.parties,
      courtNo: row.entry.courtNo,
      itemNo: row.entry.itemNo,
      coram: row.entry.coram,
      purpose: row.entry.purpose,
      rawText: row.entry.rawText,
      calendarEntryId: row.match.calendarEntryId,
      decidedBy: row.match.decidedBy,
      decidedAt: row.match.decidedAt?.toISOString() ?? null,
      createdAt: row.match.createdAt.toISOString(),
    });
  },
);

/**
 * Sync health.
 *
 * `audit.read` — admin only. This is an operational view of what the server
 * did on its own, which is the same category as the audit log, and it is
 * where a court that silently stopped returning rows becomes visible.
 */
router.get(
  "/cause-list/runs",
  requireWorkspace,
  requireCapability("audit.read"),
  async (_req: AuthRequest, res): Promise<void> => {
    const rows = await db
      .select({ run: causeListSyncRunsTable, court: courtsTable })
      .from(causeListSyncRunsTable)
      .innerJoin(courtsTable, eq(courtsTable.id, causeListSyncRunsTable.courtId))
      .orderBy(desc(causeListSyncRunsTable.startedAt))
      .limit(100);

    res.json(
      ListCauseListRunsResponse.parse(
        rows.map(({ run, court }) => ({
          id: run.id,
          courtId: run.courtId,
          courtName: courtLabel(court),
          adapter: run.adapter,
          listDate: run.listDate,
          status: run.status,
          fetched: run.fetched,
          upserted: run.upserted,
          proposed: run.proposed,
          error: run.error,
          durationMs: run.durationMs,
          startedAt: run.startedAt.toISOString(),
        })),
      ),
    );
  },
);

/**
 * Fetch one court's list now.
 *
 * Held to `audit.read` (admin) rather than something more practice-shaped,
 * because this reaches out to a third-party — usually government — server on
 * demand. It is rate-limited in app.ts on top of that. The scheduled sync is
 * the normal path; this exists for "the list was republished, I want it now".
 */
router.post(
  "/cause-list/sync",
  requireWorkspace,
  requireCapability("audit.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const body = TriggerCauseListSyncBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(body.error) });
      return;
    }

    const court = await courtByCode(body.data.courtCode);
    if (!court) {
      res.status(404).json({ error: "No such court" });
      return;
    }

    const result = await syncCourt(court, body.data.listDate);
    res.json(result);
  },
);

export default router;
