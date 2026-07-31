import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, documentsTable, casesTable } from "@workspace/db";
import {
  ListDocumentsParams,
  ListDocumentsResponse,
  UploadDocumentParams,
  UploadDocumentBody,
  UploadDocumentResponse,
  DeleteDocumentParams,
} from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { getOrCreateUser } from "../lib/jit";
import { addTimelineEvent } from "../lib/timeline";
import { isClientRole } from "../lib/roles";

const router: IRouter = Router();

// Clients may only see/act on documents for their own cases.
async function ownsCase(userId: number, caseId: number): Promise<boolean> {
  const [c] = await db.select().from(casesTable).where(eq(casesTable.id, caseId));
  return !!c && c.clientId === userId;
}

router.get("/cases/:caseId/documents", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const params = ListDocumentsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  if (isClientRole(user.role) && !(await ownsCase(user.id, params.data.caseId))) {
    res.status(404).json({ error: "Case not found" });
    return;
  }

  const docs = await db.select().from(documentsTable).where(eq(documentsTable.caseId, params.data.caseId));
  res.json(ListDocumentsResponse.parse(docs));
});

router.post("/cases/:caseId/documents", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const pathParams = UploadDocumentParams.safeParse(req.params);
  if (!pathParams.success) { res.status(400).json({ error: pathParams.error.message }); return; }

  // Clients have a Doc Upload Hub, but only for their own cases.
  if (isClientRole(user.role) && !(await ownsCase(user.id, pathParams.data.caseId))) {
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

  await addTimelineEvent(pathParams.data.caseId, "document_added", `Document "${doc.name}" added`, user.displayName);

  res.status(201).json(UploadDocumentResponse.parse(doc));
});

// Deleting documents is a staff action — clients can upload but not remove firm records.
router.delete("/cases/:caseId/documents/:docId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (isClientRole(user.role)) { res.status(403).json({ error: "Forbidden" }); return; }

  const params = DeleteDocumentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [doc] = await db.delete(documentsTable)
    .where(and(eq(documentsTable.id, params.data.docId), eq(documentsTable.caseId, params.data.caseId)))
    .returning();

  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  res.sendStatus(204);
});

export default router;
