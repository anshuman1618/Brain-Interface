import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  auditEventsTable,
  deletionRequestsTable,
  usersTable,
  workspacesTable,
  workspaceMembershipsTable,
  workspaceAccessListTable,
  casesTable,
  documentsTable,
  documentRequestsTable,
  feedbackTable,
  consultationsTable,
} from "@workspace/db";
import { DecideErasureBody, RequestErasureBody } from "@workspace/api-zod";
import {
  requireWorkspace,
  requireCapability,
  ctx,
  type AuthRequest,
} from "../middlewares/requireAuth";
import { recordAudit } from "../lib/audit";
import { usageFor } from "../lib/quota";
import { sendMail } from "../lib/mailer";
import { visibleCaseIds } from "../lib/scope";

const router: IRouter = Router();

/* ── Audit log ───────────────────────────────────────────────────────────── */

router.get(
  "/workspace/audit",
  requireWorkspace,
  requireCapability("audit.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const raw = Number(req.query["limit"]);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 200) : 100;

    const rows = await db
      .select()
      .from(auditEventsTable)
      .where(eq(auditEventsTable.workspaceId, c.workspaceId))
      .orderBy(desc(auditEventsTable.at))
      .limit(limit);

    res.json(
      rows.map((r) => ({
        id: r.id,
        actorName: r.actorName,
        actorRole: r.actorRole,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        summary: r.summary,
        ip: r.ip,
        at: r.at.toISOString(),
      })),
    );
  },
);

/* ── Plan usage ──────────────────────────────────────────────────────────── */

router.get("/workspace/usage", requireWorkspace, async (req: AuthRequest, res): Promise<void> => {
  res.json(await usageFor(ctx(req).workspaceId));
});

/* ── Data export (DPDP) ──────────────────────────────────────────────────── */

/**
 * Everything this workspace holds about the caller, as JSON they can keep.
 *
 * Scoped to the caller and to one workspace: a chamber's other clients are not
 * the requester's data, and a matter they are not party to is not either. The
 * row scope that governs the rest of the app governs this too — `visibleCaseIds`
 * is the same function the case list uses.
 */
router.get("/privacy/export", requireWorkspace, async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);
  const caseIds = await visibleCaseIds(c);

  const [workspace] = await db
    .select()
    .from(workspacesTable)
    .where(eq(workspacesTable.id, c.workspaceId));
  const [membership] = await db
    .select()
    .from(workspaceMembershipsTable)
    .where(
      and(
        eq(workspaceMembershipsTable.workspaceId, c.workspaceId),
        eq(workspaceMembershipsTable.userId, c.user.id),
      ),
    );

  const cases = caseIds.length
    ? await db.select().from(casesTable).where(inArray(casesTable.id, caseIds))
    : [];
  const documents = caseIds.length
    ? await db.select().from(documentsTable).where(inArray(documentsTable.caseId, caseIds))
    : [];
  const requests = await db
    .select()
    .from(documentRequestsTable)
    .where(
      and(
        eq(documentRequestsTable.workspaceId, c.workspaceId),
        eq(documentRequestsTable.clientId, c.user.id),
      ),
    );
  const feedback = await db
    .select()
    .from(feedbackTable)
    .where(
      and(eq(feedbackTable.workspaceId, c.workspaceId), eq(feedbackTable.clientId, c.user.id)),
    );
  const consultations = caseIds.length
    ? await db.select().from(consultationsTable).where(inArray(consultationsTable.caseId, caseIds))
    : [];

  await recordAudit(req, c, {
    action: "data.exported",
    entityType: "user",
    entityId: c.user.id,
    summary: `${c.user.displayName || c.user.email} exported their own data`,
  });

  res.setHeader("Content-Disposition", 'attachment; filename="lex-practice-export.json"');
  res.json({
    generatedAt: new Date().toISOString(),
    subject: {
      name: c.user.displayName,
      email: c.user.email,
      role: c.role,
      joinedAt: membership?.createdAt?.toISOString() ?? null,
    },
    workspace: { name: workspace?.name ?? "" },
    // Only what is genuinely about the requester; the bytes of files are not
    // inlined - they are downloadable individually from the Documents screen.
    cases,
    documents: documents.map(({ storagePath: _p, ...d }) => d),
    documentRequests: requests,
    feedback,
    consultations,
  });
});

/* ── Erasure requests (DPDP) ─────────────────────────────────────────────── */

function viewErasure(r: typeof deletionRequestsTable.$inferSelect) {
  return {
    id: r.id,
    requestedName: r.requestedName,
    requestedEmail: r.requestedEmail,
    reason: r.reason,
    status: r.status,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/privacy/erasure", requireWorkspace, async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);
  const canManage = c.capabilities.includes("privacy.manage");
  const rows = await db
    .select()
    .from(deletionRequestsTable)
    .where(
      canManage
        ? eq(deletionRequestsTable.workspaceId, c.workspaceId)
        : and(
            eq(deletionRequestsTable.workspaceId, c.workspaceId),
            eq(deletionRequestsTable.userId, c.user.id),
          ),
    )
    .orderBy(desc(deletionRequestsTable.createdAt));
  res.json(rows.map(viewErasure));
});

router.post("/privacy/erasure", requireWorkspace, async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);
  const body = RequestErasureBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "invalid_request", details: body.error.issues });
    return;
  }

  const existing = await db
    .select()
    .from(deletionRequestsTable)
    .where(
      and(
        eq(deletionRequestsTable.workspaceId, c.workspaceId),
        eq(deletionRequestsTable.userId, c.user.id),
        eq(deletionRequestsTable.status, "pending"),
      ),
    );
  if (existing.length) {
    res.status(409).json({
      error: "already_pending",
      message: "You already have an erasure request awaiting a decision.",
    });
    return;
  }

  const [row] = await db
    .insert(deletionRequestsTable)
    .values({
      workspaceId: c.workspaceId,
      userId: c.user.id,
      clerkId: c.user.clerkId,
      requestedEmail: c.user.email,
      requestedName: c.user.displayName,
      reason: body.data.reason ?? null,
    })
    .returning();

  await recordAudit(req, c, {
    action: "erasure.requested",
    entityType: "user",
    entityId: c.user.id,
    summary: `${c.user.displayName || c.user.email} requested erasure of their data`,
  });

  res.status(201).json(viewErasure(row!));
});

/**
 * Completing an erasure anonymises; it does not delete matters.
 *
 * A chamber has retention obligations over the files of cases it fought, and a
 * former client cannot unilaterally remove them. What is removed is the link
 * between those records and an identifiable person: name and email are
 * replaced, and the membership is revoked so the account reaches nothing.
 *
 * The audit log keeps the fact that this happened, with the actor redacted the
 * same way. A log that could be edited would not be evidence of anything.
 */
router.patch(
  "/privacy/erasure/:id",
  requireWorkspace,
  requireCapability("privacy.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const id = Number(req.params["id"]);
    const body = DecideErasureBody.safeParse(req.body);
    if (!Number.isFinite(id) || !body.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    const [row] = await db
      .select()
      .from(deletionRequestsTable)
      .where(
        and(eq(deletionRequestsTable.id, id), eq(deletionRequestsTable.workspaceId, c.workspaceId)),
      );
    if (!row || row.status !== "pending") {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const complete = body.data.decision === "complete";

    if (complete) {
      const anonName = `Erased user #${row.userId}`;
      await db
        .update(usersTable)
        .set({ displayName: anonName, email: "" })
        .where(eq(usersTable.id, row.userId));
      await db
        .update(workspaceMembershipsTable)
        .set({ status: "revoked" })
        .where(
          and(
            eq(workspaceMembershipsTable.workspaceId, c.workspaceId),
            eq(workspaceMembershipsTable.userId, row.userId),
          ),
        );
      // Also stop the address being re-admitted by a standing access-list rule.
      if (row.requestedEmail) {
        await db
          .update(workspaceAccessListTable)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(workspaceAccessListTable.workspaceId, c.workspaceId),
              eq(workspaceAccessListTable.value, row.requestedEmail),
            ),
          );
      }
      await db
        .update(auditEventsTable)
        .set({ actorName: anonName })
        .where(
          and(
            eq(auditEventsTable.workspaceId, c.workspaceId),
            eq(auditEventsTable.actorClerkId, row.clerkId),
          ),
        );
    }

    const [updated] = await db
      .update(deletionRequestsTable)
      .set({
        status: complete ? "completed" : "rejected",
        decidedBy: c.user.clerkId,
        decidedAt: new Date(),
        decisionNote: body.data.note ?? null,
      })
      .where(eq(deletionRequestsTable.id, id))
      .returning();

    await recordAudit(req, c, {
      action: complete ? "erasure.completed" : "erasure.rejected",
      entityType: "user",
      entityId: row.userId,
      summary: complete
        ? `Erased the personal data of ${row.requestedEmail || row.requestedName}`
        : `Rejected the erasure request from ${row.requestedEmail || row.requestedName}`,
    });

    if (row.requestedEmail) {
      await sendMail({
        to: row.requestedEmail,
        workspaceId: c.workspaceId,
        kind: "erasure",
        subject: complete ? "Your data has been erased" : "Your erasure request was declined",
        body: complete
          ? `Your personal details have been removed from this chamber's records. Case files the chamber is required to retain remain, but are no longer linked to you.\n\n${body.data.note ?? ""}`
          : `Your erasure request was declined.\n\n${body.data.note ?? "No reason was given."}`,
      });
    }

    res.json(viewErasure(updated!));
  },
);

export default router;
