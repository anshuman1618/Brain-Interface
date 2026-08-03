import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, documentsTable, documentRequestsTable, casesTable, notificationsTable } from "@workspace/db";
import {
  ListDocumentsParams,
  ListDocumentsResponse,
  ListWorkspaceDocumentsResponse,
  UploadDocumentParams,
  UploadDocumentBody,
  UploadDocumentResponse,
  DeleteDocumentParams,
} from "@workspace/api-zod";
import {
  requireWorkspace,
  requireCapability,
  ctx,
  type AuthRequest,
  type WorkspaceContext,
} from "../middlewares/requireAuth";
import { addTimelineEvent } from "../lib/timeline";
import { getVisibleCase, visibleCaseIds } from "../lib/scope";
import { displayRole } from "../lib/permissions";

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

/** Every document the caller may see, across all their matters. */
router.get("/documents", requireWorkspace, requireCapability("documents.read"), async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);

  const caseIds = await visibleCaseIds(c);
  if (caseIds.length === 0) { res.json([]); return; }

  const conditions = [inArray(documentsTable.caseId, caseIds)];
  if (clientSideOnly(c)) conditions.push(eq(documentsTable.visibility, "shared"));

  const docs = await db.select().from(documentsTable).where(and(...conditions));
  res.json(ListWorkspaceDocumentsResponse.parse(await Promise.all(docs.map(view))));
});

router.get("/cases/:caseId/documents", requireWorkspace, requireCapability("documents.read"), async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);

  const params = ListDocumentsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  if (!(await getVisibleCase(c, params.data.caseId))) {
    res.status(404).json({ error: "Case not found" });
    return;
  }

  const conditions = [eq(documentsTable.caseId, params.data.caseId)];
  if (clientSideOnly(c)) conditions.push(eq(documentsTable.visibility, "shared"));

  const docs = await db.select().from(documentsTable).where(and(...conditions));
  res.json(ListDocumentsResponse.parse(docs));
});

router.post("/cases/:caseId/documents", requireWorkspace, requireCapability("documents.write"), async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);

  const pathParams = UploadDocumentParams.safeParse(req.params);
  if (!pathParams.success) { res.status(400).json({ error: pathParams.error.message }); return; }

  if (!(await getVisibleCase(c, pathParams.data.caseId))) {
    res.status(404).json({ error: "Case not found" });
    return;
  }

  const body = UploadDocumentBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const fromClient = clientSideOnly(c);
  // A client cannot create firm-internal material, whatever the request says.
  const visibility = fromClient ? "shared" : (body.data.visibility === "shared" ? "shared" : "firm");

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
    if (!request) { res.status(404).json({ error: "Document request not found" }); return; }
    if (fromClient && request.clientClerkId !== c.user.clerkId) {
      res.status(403).json({ error: "That request is not addressed to you." });
      return;
    }
  }

  const [doc] = await db.insert(documentsTable).values({
    caseId: pathParams.data.caseId,
    name: body.data.name,
    fileType: body.data.fileType ?? null,
    fileSize: body.data.fileSize ?? null,
    url: body.data.url ?? null,
    storagePath: body.data.storagePath ?? null,
    note: body.data.note ?? null,
    visibility,
    uploadedBy: c.user.displayName,
    uploadedByClerkId: c.user.clerkId,
    uploadedByRole: c.role,
    documentRequestId: request?.id ?? null,
    encrypted: true,
  }).returning();

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
});

// Clients may upload but never remove firm records — deletion is gated on
// cases.write, which no client holds.
router.delete("/cases/:caseId/documents/:docId", requireWorkspace, requireCapability("cases.write"), async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);

  const params = DeleteDocumentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  if (!(await getVisibleCase(c, params.data.caseId))) {
    res.status(404).json({ error: "Case not found" });
    return;
  }

  const [doc] = await db.delete(documentsTable)
    .where(and(eq(documentsTable.id, params.data.docId), eq(documentsTable.caseId, params.data.caseId)))
    .returning();

  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  res.sendStatus(204);
});

export default router;
