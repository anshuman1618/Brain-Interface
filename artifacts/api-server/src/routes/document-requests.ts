import { guardIdParams, parseId } from "../lib/validation";
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, documentRequestsTable, usersTable, casesTable } from "@workspace/db";
import { CreateDocumentRequestBody, UpdateDocumentRequestBody } from "@workspace/api-zod";
import {
  requireWorkspace,
  requireCapability,
  findActiveMembership,
  ctx,
  type AuthRequest,
} from "../middlewares/requireAuth";
import { caseInWorkspace } from "../lib/scope";
import { displayRole } from "../lib/permissions";
import { notify } from "../lib/notify";

const router: IRouter = Router();

// Every :id on this router must be a real int4 before it reaches a query.
guardIdParams(router, "id");

/**
 * Both sides of a request are surfaced: who it is addressed to and who raised
 * it. The list view used to show only the document name, which left the reader
 * guessing whose desk it was on.
 */
async function enrich(dr: typeof documentRequestsTable.$inferSelect) {
  const [recipient] = await db.select().from(usersTable).where(eq(usersTable.id, dr.clientId));
  let caseTitle: string | null = null;
  if (dr.caseId) {
    const [c] = await db.select().from(casesTable).where(eq(casesTable.id, dr.caseId));
    caseTitle = c?.title ?? null;
  }
  return {
    ...dr,
    clientName: recipient?.displayName ?? null,
    requestedFromName: dr.requestedFromName || recipient?.displayName || null,
    requestedFromEmail: recipient?.email ?? null,
    requestedByRole: dr.requestedByRole ? displayRole(dr.requestedByRole) : null,
    caseTitle,
  };
}

router.get(
  "/document-requests",
  requireWorkspace,
  requireCapability("document_requests.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    // A recipient sees only requests addressed to them; staff see the workspace's.
    const conditions = [eq(documentRequestsTable.workspaceId, c.workspaceId)];
    if (!c.capabilities.includes("document_requests.create")) {
      conditions.push(eq(documentRequestsTable.clientClerkId, c.user.clerkId));
    }

    const rows = await db
      .select()
      .from(documentRequestsTable)
      .where(and(...conditions));
    const enriched = await Promise.all(rows.map(enrich));
    res.json(enriched);
  },
);

router.post(
  "/document-requests",
  requireWorkspace,
  requireCapability("document_requests.create"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const parsed = CreateDocumentRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [recipient] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, parsed.data.clientId));
    if (!recipient) {
      res.status(404).json({ error: "Recipient not found" });
      return;
    }

    // The recipient must be an active member of this workspace. Without this an
    // advocate could address a request to a client of a different chamber.
    const membership = await findActiveMembership(recipient.id, c.workspaceId);
    if (!membership || membership.role !== "client") {
      res.status(404).json({ error: "Recipient is not a client of this workspace" });
      return;
    }

    if (parsed.data.caseId != null && !(await caseInWorkspace(c, parsed.data.caseId))) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    const [created] = await db
      .insert(documentRequestsTable)
      .values({
        workspaceId: c.workspaceId,
        clientId: recipient.id,
        clientClerkId: recipient.clerkId,
        requestedFromName: recipient.displayName,
        requestedBy: c.user.displayName,
        requestedByClerkId: c.user.clerkId,
        requestedByRole: c.role,
        documentName: parsed.data.documentName,
        note: parsed.data.note ?? null,
        dueDate: parsed.data.dueDate ?? null,
        caseId: parsed.data.caseId ?? null,
        status: "pending",
      })
      .returning();

    // The client this is addressed to may well have signed up by mobile number
    // and have no email at all, so the bell row alone would be the only trace —
    // and a bell is only seen by somebody already looking at the app. notify()
    // adds the push, which is the channel that actually reaches them.
    await notify({
      clerkId: recipient.clerkId,
      workspaceId: c.workspaceId,
      type: "document_request",
      title: "A document has been requested",
      message: `Action required: "${parsed.data.documentName}" has been requested by ${c.user.displayName} (${displayRole(c.role)}).`,
      link: "/dashboard",
      dedupe: false,
    });

    res.status(201).json(await enrich(created));
  },
);

router.patch(
  "/document-requests/:id",
  requireWorkspace,
  requireCapability("document_requests.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const id = parseId(req.params["id"]);
    if (id === null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const parsed = UpdateDocumentRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [existing] = await db
      .select()
      .from(documentRequestsTable)
      .where(
        and(eq(documentRequestsTable.id, id), eq(documentRequestsTable.workspaceId, c.workspaceId)),
      );
    if (!existing) {
      res.status(404).json({ error: "Document request not found" });
      return;
    }

    // A recipient may only act on their own request.
    const isStaff = c.capabilities.includes("document_requests.create");
    if (!isStaff && existing.clientClerkId !== c.user.clerkId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const [updated] = await db
      .update(documentRequestsTable)
      .set({ status: parsed.data.status })
      .where(eq(documentRequestsTable.id, id))
      .returning();

    if (parsed.data.status !== existing.status && existing.requestedByClerkId) {
      await notify({
        clerkId: existing.requestedByClerkId,
        workspaceId: c.workspaceId,
        type: "document_request",
        title: "A document request was updated",
        message: `${existing.requestedFromName || "The client"} marked "${existing.documentName}" as ${parsed.data.status}.`,
        link: "/dashboard",
        dedupe: false,
      });
    }

    res.json(await enrich(updated));
  },
);

export default router;
