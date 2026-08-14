import { Router, type IRouter } from "express";
import { db, betaFeedbackTable } from "@workspace/db";
import { SendBetaFeedbackBody } from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { getOrCreateUser } from "../lib/jit";
import { listActiveMemberships } from "../middlewares/requireAuth";
import { zodMessage } from "../lib/validation";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Product feedback from the beta widget.
 *
 * Behind `requireAuth`, NOT `requireWorkspace`. That is the whole point: a user
 * who is stuck on the access-denied screen, or waiting for an admin to approve
 * them, has no workspace and would be refused by the usual guard — and they are
 * precisely the people whose feedback the beta needs. The workspace is recorded
 * when there is one and left null when there is not.
 *
 * Nothing here is trusted from the body except the message and the path the user
 * was on. Identity comes from the verified session.
 */
router.post("/beta-feedback", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = SendBetaFeedbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", message: zodMessage(parsed.error) });
    return;
  }

  const message = parsed.data.message.trim();
  if (!message) {
    res.status(400).json({ error: "invalid_request", message: "Write something first." });
    return;
  }

  // Best-effort context. A user with several chambers gets the first; this is a
  // triage hint, not an authorization decision, so it does not need to be exact.
  const memberships = await listActiveMemberships(user.id);

  const [row] = await db
    .insert(betaFeedbackTable)
    .values({
      userId: user.id,
      clerkId: user.clerkId,
      email: user.email,
      displayName: user.displayName,
      workspaceId: memberships[0]?.workspace.id ?? null,
      message,
      pagePath: parsed.data.pagePath.slice(0, 512),
      // Truncated: this is a diagnostic breadcrumb, and some browsers send
      // several hundred characters of it.
      userAgent: (req.headers["user-agent"] ?? "").slice(0, 512),
    })
    .returning();

  // Logged as well as stored: during a beta the useful thing is often seeing it
  // arrive, not querying for it later.
  logger.info(
    { betaFeedbackId: row.id, userId: user.id, pagePath: row.pagePath },
    "Beta feedback received",
  );

  res.status(201).json({ id: row.id, createdAt: row.createdAt.toISOString() });
});

export default router;
