import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, feedbackTable, casesTable } from "@workspace/db";
import {
  ListFeedbackResponse,
  CreateFeedbackBody,
  CreateFeedbackResponse,
  RespondToFeedbackBody,
  RespondToFeedbackResponse,
} from "@workspace/api-zod";
import {
  requireWorkspace,
  requireCapability,
  ctx,
  type AuthRequest,
} from "../middlewares/requireAuth";
import { getVisibleCase, visibleCaseIds } from "../lib/scope";

const router: IRouter = Router();

async function view(row: typeof feedbackTable.$inferSelect) {
  const [c] = await db.select().from(casesTable).where(eq(casesTable.id, row.caseId));
  return {
    ...row,
    caseTitle: c?.title ?? null,
    respondedAt: row.respondedAt?.toISOString() ?? null,
  };
}

/**
 * Staff read every rating in the workspace; a client reads only their own.
 *
 * The scope comes from `visibleCaseIds`, which is already workspace- and
 * row-scoped, so a client cannot read another client's review of the same firm.
 */
router.get(
  "/feedback",
  requireWorkspace,
  requireCapability("feedback.read"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const caseIds = await visibleCaseIds(c);
    if (caseIds.length === 0) {
      res.json([]);
      return;
    }

    const conditions = [
      eq(feedbackTable.workspaceId, c.workspaceId),
      inArray(feedbackTable.caseId, caseIds),
    ];
    // A client's own feedback only — belt and braces on top of the case scope.
    if (!c.capabilities.includes("feedback.respond") && c.role === "client") {
      conditions.push(eq(feedbackTable.clientClerkId, c.user.clerkId));
    }

    const rows = await db
      .select()
      .from(feedbackTable)
      .where(and(...conditions));
    res.json(ListFeedbackResponse.parse(await Promise.all(rows.map(view))));
  },
);

/**
 * Only a client leaves feedback, and only on a matter that is theirs.
 *
 * A chamber cannot rate itself: `feedback.write` is held by the client role
 * alone, and the matter must resolve through the client's own row scope.
 */
router.post(
  "/feedback",
  requireWorkspace,
  requireCapability("feedback.write"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const parsed = CreateFeedbackBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const rating = Number(parsed.data.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      res.status(400).json({ error: "Rating must be a whole number from 1 to 5." });
      return;
    }

    const matter = await getVisibleCase(c, parsed.data.caseId);
    if (!matter) {
      res.status(404).json({ error: "Matter not found" });
      return;
    }

    const [existing] = await db
      .select()
      .from(feedbackTable)
      .where(
        and(eq(feedbackTable.caseId, matter.id), eq(feedbackTable.clientClerkId, c.user.clerkId)),
      );
    if (existing) {
      res.status(409).json({ error: "You have already rated this matter." });
      return;
    }

    const [created] = await db
      .insert(feedbackTable)
      .values({
        workspaceId: c.workspaceId,
        caseId: matter.id,
        clientId: c.user.id,
        clientClerkId: c.user.clerkId,
        clientName: c.user.displayName,
        rating,
        comment: parsed.data.comment?.trim() || null,
      })
      .returning();

    res.status(201).json(CreateFeedbackResponse.parse(await view(created)));
  },
);

/**
 * The chamber's reply. Deliberately a separate field rather than an edit: staff
 * can answer a review but never rewrite what the client wrote.
 */
router.post(
  "/feedback/:id/response",
  requireWorkspace,
  requireCapability("feedback.respond"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const parsed = RespondToFeedbackBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [existing] = await db
      .select()
      .from(feedbackTable)
      .where(and(eq(feedbackTable.id, id), eq(feedbackTable.workspaceId, c.workspaceId)));
    if (!existing) {
      res.status(404).json({ error: "Feedback not found" });
      return;
    }

    const [updated] = await db
      .update(feedbackTable)
      .set({
        response: parsed.data.response.trim(),
        respondedBy: c.user.displayName,
        respondedAt: new Date(),
      })
      .where(eq(feedbackTable.id, id))
      .returning();

    res.json(RespondToFeedbackResponse.parse(await view(updated)));
  },
);

export default router;
