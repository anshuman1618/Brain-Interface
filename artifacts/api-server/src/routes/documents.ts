import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, documentsTable } from "@workspace/db";
import {
  ListDocumentsParams,
  ListDocumentsResponse,
  UploadDocumentParams,
  UploadDocumentBody,
  UploadDocumentResponse,
  DeleteDocumentParams,
} from "@workspace/api-zod";
import { requireWorkspace, requireCapability, ctx, type AuthRequest } from "../middlewares/requireAuth";
import { addTimelineEvent } from "../lib/timeline";
import { getVisibleCase } from "../lib/scope";

const router: IRouter = Router();

// Every document route hangs off a case, so case visibility — which is already
// workspace-scoped and row-scoped — is the only check that matters here.
router.get("/cases/:caseId/documents", requireWorkspace, requireCapability("documents.read"), async (req: AuthRequest, res): Promise<void> => {
  const c = ctx(req);

  const params = ListDocumentsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  if (!(await getVisibleCase(c, params.data.caseId))) {
    res.status(404).json({ error: "Case not found" });
    return;
  }

  const docs = await db.select().from(documentsTable).where(eq(documentsTable.caseId, params.data.caseId));
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

  const [doc] = await db.insert(documentsTable).values({
    caseId: pathParams.data.caseId,
    name: body.data.name,
    fileType: body.data.fileType ?? null,
    fileSize: body.data.fileSize ?? null,
    storagePath: body.data.storagePath ?? null,
    encrypted: true,
  }).returning();

  await addTimelineEvent(pathParams.data.caseId, "document_added", `Document "${doc.name}" added`, c.user.displayName);

  res.status(201).json(UploadDocumentResponse.parse(doc));
});

// Clients may upload but never remove firm records — documents.write grants the
// upload, deletion is gated separately on cases.write (staff only).
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
