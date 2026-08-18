import { Router, type IRouter } from "express";
import {
  db,
  serviceEnquiriesTable,
  isServiceEnquiryKind,
  isContactPreference,
} from "@workspace/db";
import { CreateServiceEnquiryBody } from "@workspace/api-zod";
import {
  requireWorkspace,
  requireCapability,
  ctx,
  type AuthRequest,
} from "../middlewares/requireAuth";
import { zodMessage } from "../lib/validation";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * The migration service add-on: a lead, not a purchase.
 *
 * There is no product behind this yet — it is a card below the pricing tiers
 * that opens a form, and this endpoint is what "Talk to us" actually does.
 * Gated on `billing.manage`, the same boundary as choosing a plan: this is a
 * commercial conversation about the chamber's account, not a support ticket
 * any team member can open on the firm's behalf.
 *
 * No admin screen reads this table yet. It is deliberately readable straight
 * from the database until enough enquiries arrive to justify building one —
 * see DECISIONS.md.
 */
router.post(
  "/service-enquiries",
  requireWorkspace,
  requireCapability("billing.manage"),
  async (req: AuthRequest, res): Promise<void> => {
    const c = ctx(req);

    const parsed = CreateServiceEnquiryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", message: zodMessage(parsed.error) });
      return;
    }

    // Re-checked against the runtime enums, the same reason subscription.ts
    // does: the zod schema is generated from the spec, and a spec that drifts
    // should fail closed here rather than write an unknown value into the row.
    if (!isServiceEnquiryKind(parsed.data.serviceKind)) {
      res.status(400).json({ error: "unknown_service_kind" });
      return;
    }
    if (!isContactPreference(parsed.data.contactPreference)) {
      res.status(400).json({ error: "unknown_contact_preference" });
      return;
    }

    const message = parsed.data.message.trim();
    if (!message) {
      res.status(400).json({ error: "invalid_request", message: "Write something first." });
      return;
    }

    // A phone preference with no phone number is a form that cannot be acted
    // on — reject it here rather than record an enquiry nobody can follow up.
    const contactPhone = parsed.data.contactPhone?.trim() || null;
    if (parsed.data.contactPreference === "phone" && !contactPhone) {
      res.status(400).json({
        error: "invalid_request",
        message: "Add a phone number, or choose email instead.",
      });
      return;
    }

    const [row] = await db
      .insert(serviceEnquiriesTable)
      .values({
        workspaceId: c.workspaceId,
        userId: c.user.id,
        clerkId: c.user.clerkId,
        email: c.user.email,
        displayName: c.user.displayName,
        serviceKind: parsed.data.serviceKind,
        message,
        contactPreference: parsed.data.contactPreference,
        contactPhone,
      })
      .returning();

    logger.info(
      { serviceEnquiryId: row.id, workspaceId: c.workspaceId, serviceKind: row.serviceKind },
      "Service enquiry received",
    );

    res.status(201).json({ id: row.id, createdAt: row.createdAt.toISOString() });
  },
);

export default router;
