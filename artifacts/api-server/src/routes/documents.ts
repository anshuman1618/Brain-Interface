import { Router, raw, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  documentsTable,
  documentRequestsTable,
  casesTable,
  notificationsTable,
} from "@workspace/db";
import {
  ListDocumentsParams,
  ListDocumentsResponse,
  ListWorkspaceDocumentsResponse,
  UploadDocumentParams,
  UploadDocumentBody,
  UploadDocumentResponse,
  DeleteDocumentParams,
  UpdateDocumentStageParams,
  UpdateDocumentStageBody,
  UpdateDocumentStageResponse,
} from "@workspace/api-zod";
import {
  requireWorkspace,
  requireCapability,
  ctx,
  type AuthRequest,
  type WorkspaceContext,
} from "../middlewares/requireAuth";
import { addTimelineEvent } from "../lib/timeline";
import { forumGroupFor, isKnownStage } from "../lib/case-stages";
import { getVisibleCase, visibleCaseIds } from "../lib/scope";
import { displayRole } from "../lib/permissions";
import { recordAudit } from "../lib/audit";
import * as blobs from "../lib/blob-store";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * The document vault is bi-directional: the same table holds files the chamber
 * shares with a client and files the client sends back.
 *
 * Two separate boundaries apply, and both are enforced here rather than in the
 * browser:
 *
 *  1. Matter scope — you only see documents on matters you can already see.
 *  2. Visibility — `firm` documents are internal working material. A client is
 *     filtered out of them entirely, so a client cannot enumerate the chamber's
 *     drafts even on their own matter.
 */
function clientSideOnly(c: WorkspaceContext): boolean {
  // Anyone who cannot raise a document request is on the receiving side of one.
  return !c.capabilities.includes("document_requests.create");
}

async function view(doc: typeof documentsTable.$inferSelect) {
  const [c] = await db.select().from(casesTable).where(eq(casesTable.id, doc.caseId));
  return { ...doc, caseTitle: c?.title ?? null };
}

/**
 * A stage a caller asked for, checked against the list the matter actually has.
 *
 * Free text is refused rather than stored. A document filed under a stage
 * nothing else can ever be filed under is a heading of one, and a typo becomes
 * a permanent extra section of the vault that no dropdown will ever offer
 * again. Adding a genuinely new stage is `POST /cases/:caseId/stages`, which is
 * gated on `cases.write` — so a client uploading a file cannot invent one.
 *
 * Absent (undefined) and null both mean unfiled, which is where every document
 * from before this feature sits.
 */
async function resolveStage(
  c: WorkspaceContext,
  matter: typeof casesTable.$inferSelect,
  requested: string | null | undefined,
): Promise<{ ok: true; value: string | null } | { ok: false; message: string }> {
  if (requested == null || requested === "") return { ok: true, value: null };

  const group = forumGroupFor(matter);
  if (await isKnownStage(c.workspaceId, group, requested)) {
    return { ok: true, value: requested };
  }
  return {
    ok: false,
    message: `"${requested}" is not a stage on this matter's list.`,
  };
}

/** Every document the caller may see, across all their matters. */
router.get(
  "/documents",
  requireWorkspace,
  requireCapability("documents.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const caseIds = await visibleCaseIds(c);
    if (caseIds.length === 0) {
      res.json([]);
      return;
    }

    const conditions = [inArray(documentsTable.caseId, caseIds)];
    if (clientSideOnly(c)) conditions.push(eq(documentsTable.visibility, "shared"));

    const docs = await db
      .select()
      .from(documentsTable)
      .where(and(...conditions));
    res.json(ListWorkspaceDocumentsResponse.parse(await Promise.all(docs.map(view))));
  },
);

router.get(
  "/cases/:caseId/documents",
  requireWorkspace,
  requireCapability("documents.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const params = ListDocumentsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    if (!(await getVisibleCase(c, params.data.caseId))) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const conditions = [eq(documentsTable.caseId, params.data.caseId)];
    if (clientSideOnly(c)) conditions.push(eq(documentsTable.visibility, "shared"));

    const docs = await db
      .select()
      .from(documentsTable)
      .where(and(...conditions));
    res.json(ListDocumentsResponse.parse(docs));
  },
);

router.post(
  "/cases/:caseId/documents",
  requireWorkspace,
  requireCapability("documents.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const pathParams = UploadDocumentParams.safeParse(req.params);
    if (!pathParams.success) {
      res.status(400).json({ error: pathParams.error.message });
      return;
    }

    const matter = await getVisibleCase(c, pathParams.data.caseId);
    if (!matter) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const body = UploadDocumentBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const stage = await resolveStage(c, matter, body.data.stage);
    if (!stage.ok) {
      res.status(400).json({ error: "unknown_stage", message: stage.message });
      return;
    }

    const fromClient = clientSideOnly(c);
    // A client cannot create firm-internal material, whatever the request says.
    const visibility = fromClient
      ? "shared"
      : body.data.visibility === "shared"
        ? "shared"
        : "firm";

    // If this upload answers a request, the request must be in this workspace and
    // addressed to this caller — otherwise anyone could close somebody else's.
    let request: typeof documentRequestsTable.$inferSelect | undefined;
    if (body.data.documentRequestId != null) {
      [request] = await db
        .select()
        .from(documentRequestsTable)
        .where(
          and(
            eq(documentRequestsTable.id, body.data.documentRequestId),
            eq(documentRequestsTable.workspaceId, c.workspaceId),
          ),
        );
      if (!request) {
        res.status(404).json({ error: "Document request not found" });
        return;
      }
      if (fromClient && request.clientClerkId !== c.user.clerkId) {
        res.status(403).json({ error: "That request is not addressed to you." });
        return;
      }
    }

    const [doc] = await db
      .insert(documentsTable)
      .values({
        caseId: pathParams.data.caseId,
        name: body.data.name,
        fileType: body.data.fileType ?? null,
        fileSize: body.data.fileSize ?? null,
        url: body.data.url ?? null,
        storagePath: body.data.storagePath ?? null,
        note: body.data.note ?? null,
        stage: stage.value,
        visibility,
        uploadedBy: c.user.displayName,
        uploadedByClerkId: c.user.clerkId,
        uploadedByRole: c.role,
        documentRequestId: request?.id ?? null,
        encrypted: true,
      })
      .returning();

    // Close the loop: a fulfilling upload marks the request done and tells the
    // person who raised it, rather than leaving them to notice.
    if (request && request.status === "pending") {
      await db
        .update(documentRequestsTable)
        .set({ status: "fulfilled", fulfilledDocumentId: doc.id, fulfilledAt: new Date() })
        .where(eq(documentRequestsTable.id, request.id));

      if (request.requestedByClerkId) {
        await db.insert(notificationsTable).values({
          userId: request.requestedByClerkId,
          type: "document_request",
          message: `${c.user.displayName} uploaded "${doc.name}" for "${request.documentName}".`,
          link: "/documents",
        });
      }
    }

    await addTimelineEvent(
      pathParams.data.caseId,
      "document_added",
      `Document "${doc.name}" added by ${c.user.displayName} (${displayRole(c.role)})`,
      c.user.displayName,
    );

    res.status(201).json(UploadDocumentResponse.parse(doc));
  },
);

/* ── Real bytes ───────────────────────────────────────────────────────────
   Binary upload and download.

   Deliberately raw-body rather than multipart: a single file per request needs
   no multipart parser, and not adding one keeps a well-known class of parser
   bug out of the dependency tree entirely. Metadata rides in headers.

   The JSON POST above still exists for records that point at something else
   (an external URL) or that are placeholders. This endpoint is the one that
   puts a file in the vault. ───────────────────────────────────────────────── */

router.post(
  "/cases/:caseId/documents/content",
  requireWorkspace,
  requireCapability("documents.write"),
  // Cap enforced by the body parser, so oversized uploads are refused before
  // the bytes are ever buffered in full.
  raw({ type: () => true, limit: blobs.maxUploadBytes() }),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const caseId = Number(req.params["caseId"]);
    const matter = Number.isFinite(caseId) ? await getVisibleCase(c, caseId) : undefined;
    if (!matter) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      res.status(400).json({ error: "empty_upload", message: "No file content was received." });
      return;
    }

    const mime = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (!blobs.isAllowedMime(mime)) {
      res.status(415).json({
        error: "unsupported_type",
        message: `${mime || "That file type"} is not accepted. Allowed: PDF, images, plain text, CSV and Office documents.`,
      });
      return;
    }

    // The header above is the caller's claim; this is the file itself. Checked
    // separately so the message can say which of the two was wrong — "not
    // accepted" and "not what you said it was" send someone to different fixes.
    if (!blobs.contentMatchesMime(buf, mime)) {
      res.status(415).json({
        error: "content_type_mismatch",
        message: `This file does not look like ${mime}. Upload it with its real type, or re-save it in that format.`,
      });
      return;
    }

    const rawName = req.headers["x-document-name"];
    const name = blobs.sanitiseFileName(
      decodeURIComponent(Array.isArray(rawName) ? rawName[0]! : (rawName ?? "file")),
    );

    const fromClient = clientSideOnly(c);
    const wantShared = String(req.headers["x-document-visibility"] ?? "") === "shared";
    const visibility = fromClient ? "shared" : wantShared ? "shared" : "firm";

    // Same rule as the JSON path, read off a header because this request is
    // raw bytes and has no body to put it in.
    const stageHeader = req.headers["x-document-stage"];
    const stage = await resolveStage(
      c,
      matter,
      Array.isArray(stageHeader) ? stageHeader[0] : stageHeader,
    );
    if (!stage.ok) {
      res.status(400).json({ error: "unknown_stage", message: stage.message });
      return;
    }

    // Same request-ownership rule as the JSON path: you can only close a
    // request that is in this workspace and, for a client, addressed to you.
    let request: typeof documentRequestsTable.$inferSelect | undefined;
    const reqIdRaw = req.headers["x-document-request-id"];
    const reqId = Number(Array.isArray(reqIdRaw) ? reqIdRaw[0] : reqIdRaw);
    if (Number.isFinite(reqId) && reqId > 0) {
      [request] = await db
        .select()
        .from(documentRequestsTable)
        .where(
          and(
            eq(documentRequestsTable.id, reqId),
            eq(documentRequestsTable.workspaceId, c.workspaceId),
          ),
        );
      if (!request) {
        res.status(404).json({ error: "Document request not found" });
        return;
      }
      if (fromClient && request.clientClerkId !== c.user.clerkId) {
        res.status(403).json({ error: "That request is not addressed to you." });
        return;
      }
    }

    let stored: blobs.StoredBlob;
    try {
      stored = await blobs.put(buf);
    } catch {
      res.status(413).json({ error: "too_large", message: "That file is too large." });
      return;
    }

    const [doc] = await db
      .insert(documentsTable)
      .values({
        caseId,
        name,
        fileType: mime,
        fileSize: stored.bytes,
        storagePath: stored.key,
        checksum: stored.checksum,
        stage: stage.value,
        visibility,
        uploadedBy: c.user.displayName,
        uploadedByClerkId: c.user.clerkId,
        uploadedByRole: c.role,
        documentRequestId: request?.id ?? null,
        encrypted: true,
      })
      .returning();

    if (request && request.status === "pending") {
      await db
        .update(documentRequestsTable)
        .set({ status: "fulfilled", fulfilledDocumentId: doc!.id, fulfilledAt: new Date() })
        .where(eq(documentRequestsTable.id, request.id));
      if (request.requestedByClerkId) {
        await db.insert(notificationsTable).values({
          userId: request.requestedByClerkId,
          type: "document_request",
          message: `${c.user.displayName} uploaded "${doc!.name}" for "${request.documentName}".`,
          link: "/documents",
        });
      }
    }

    await addTimelineEvent(
      caseId,
      "document_added",
      `Document "${doc!.name}" uploaded by ${c.user.displayName} (${displayRole(c.role)})`,
      c.user.displayName,
    );
    await recordAudit(req, c, {
      action: "document.uploaded",
      entityType: "document",
      entityId: doc!.id,
      summary: `Uploaded "${doc!.name}" (${Math.ceil(stored.bytes / 1024)} KB, ${visibility})`,
    });

    res.status(201).json(UploadDocumentResponse.parse(doc));
  },
);

/**
 * Re-file a document under a different stage.
 *
 * Stages are chosen at upload, and this is the correction. It exists because
 * the alternative to correcting a mislabelled paper is deleting and re-uploading
 * it, which loses the upload record, the checksum and whichever document
 * request it closed.
 *
 * Every boundary the list applies is re-applied: matter scope through
 * `visibleCaseIds`, and visibility, so a client cannot discover a firm-internal
 * document by patching ids and reading which ones come back 400 rather than
 * 404. Both failures are a flat 404.
 */
router.patch(
  "/documents/:id/stage",
  requireWorkspace,
  requireCapability("documents.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const params = UpdateDocumentStageParams.safeParse(req.params);
    if (!params.success) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const body = UpdateDocumentStageBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid_request", message: body.error.message });
      return;
    }

    const [doc] = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.id, params.data.id));
    if (!doc) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const matter = await getVisibleCase(c, doc.caseId);
    if (!matter) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (clientSideOnly(c) && doc.visibility !== "shared") {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const stage = await resolveStage(c, matter, body.data.stage);
    if (!stage.ok) {
      res.status(400).json({ error: "unknown_stage", message: stage.message });
      return;
    }

    const [updated] = await db
      .update(documentsTable)
      .set({ stage: stage.value })
      .where(eq(documentsTable.id, doc.id))
      .returning();

    res.json(UpdateDocumentStageResponse.parse(await view(updated!)));
  },
);

/**
 * Download.
 *
 * Every boundary the list endpoint applies is re-applied here — matter scope
 * and visibility — because a direct link to /documents/42/content must not be
 * a way around a filter that only ran on the list.
 */
router.get(
  "/documents/:id/content",
  requireWorkspace,
  requireCapability("documents.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);
    const id = Number(req.params["id"]);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
    if (!doc) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const allowedCases = await visibleCaseIds(c);
    if (!allowedCases.includes(doc.caseId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (clientSideOnly(c) && doc.visibility !== "shared") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!doc.storagePath || !(await blobs.exists(doc.storagePath))) {
      res.status(404).json({
        error: "no_content",
        message: "This record has no file attached.",
      });
      return;
    }

    await recordAudit(req, c, {
      action: "document.downloaded",
      entityType: "document",
      entityId: doc.id,
      summary: `Downloaded "${doc.name}"`,
    });

    // Always an attachment, never inline: nothing a user uploaded should be
    // rendered by the browser in this origin.
    res.setHeader("Content-Type", blobs.safeContentType(doc.fileType));
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${blobs.sanitiseFileName(doc.name)}"`,
    );
    res.setHeader("X-Content-Type-Options", "nosniff");

    // Decrypted whole before a byte is sent: the GCM tag only verifies at the
    // end, so streaming would mean shipping unauthenticated bytes and then
    // discovering the file had been tampered with, with nothing left to do
    // about it. A failure here is a 500 with no partial body.
    let plain: Buffer;
    try {
      plain = await blobs.read(doc.storagePath);
    } catch (err) {
      logger.error({ err, documentId: doc.id }, "Failed to read document bytes");
      res.status(500).json({ error: "Unreadable", message: "The stored file could not be read." });
      return;
    }
    res.setHeader("Content-Length", String(plain.length));
    res.end(plain);
  },
);

// Clients may upload but never remove firm records — deletion is gated on
// cases.write, which no client holds.
router.delete(
  "/cases/:caseId/documents/:docId",
  requireWorkspace,
  requireCapability("cases.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const params = DeleteDocumentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    if (!(await getVisibleCase(c, params.data.caseId))) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const [doc] = await db
      .delete(documentsTable)
      .where(
        and(
          eq(documentsTable.id, params.data.docId),
          eq(documentsTable.caseId, params.data.caseId),
        ),
      )
      .returning();

    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    res.sendStatus(204);
  },
);

export default router;
