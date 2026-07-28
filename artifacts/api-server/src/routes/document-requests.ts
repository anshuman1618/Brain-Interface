import { Router, type IRouter } from "express";
import { eq, or } from "drizzle-orm";
import { db, documentRequestsTable, usersTable, notificationsTable } from "@workspace/db";
import {
  CreateDocumentRequestBody,
  UpdateDocumentRequestBody,
} from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { getOrCreateUser } from "../lib/jit";

const router: IRouter = Router();

async function enrich(dr: typeof documentRequestsTable.$inferSelect) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, dr.clientId));
  return { ...dr, clientName: u?.displayName ?? null };
}

router.get("/document-requests", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const staffRoles = ["admin", "senior_advocate", "junior_advocate", "clerk_intern", "clerk"];
  const rows = staffRoles.includes(user.role)
    ? await db.select().from(documentRequestsTable)
    : await db.select().from(documentRequestsTable).where(eq(documentRequestsTable.clientClerkId, req.userId!));

  const enriched = await Promise.all(rows.map(enrich));
  res.json(enriched);
});

const STAFF_ROLES = ["admin", "senior_advocate", "junior_advocate", "clerk_intern", "clerk"];

router.post("/document-requests", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (!STAFF_ROLES.includes(user.role)) {
    res.status(403).json({ error: "Only staff can create document requests" });
    return;
  }

  const parsed = CreateDocumentRequestBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [client] = await db.select().from(usersTable).where(eq(usersTable.id, parsed.data.clientId));
  if (!client || client.role !== "client") { res.status(404).json({ error: "Client not found" }); return; }

  const [created] = await db.insert(documentRequestsTable).values({
    clientId: client.id,
    clientClerkId: client.clerkId,
    requestedBy: user.displayName,
    documentName: parsed.data.documentName,
    note: parsed.data.note ?? null,
    caseId: parsed.data.caseId ?? null,
    status: "pending",
  }).returning();

  await db.insert(notificationsTable).values({
    userId: client.clerkId,
    type: "document_request",
    message: `Action required: "${parsed.data.documentName}" has been requested by ${user.displayName}.`,
    link: "/dashboard",
  });

  res.status(201).json(await enrich(created));
});

router.patch("/document-requests/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateDocumentRequestBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const user = await getOrCreateUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [existing] = await db.select().from(documentRequestsTable).where(eq(documentRequestsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Document request not found" }); return; }

  // Clients may only update their own requests
  if (user.role === "client" && existing.clientClerkId !== req.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [updated] = await db.update(documentRequestsTable)
    .set({ status: parsed.data.status })
    .where(eq(documentRequestsTable.id, id))
    .returning();

  res.json(await enrich(updated));
});

export default router;
