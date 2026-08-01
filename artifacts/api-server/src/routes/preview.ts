import { Router, type IRouter } from "express";
import { isPreviewDatabase } from "@workspace/db";
import { isPreviewAuth } from "../lib/preview-mode";

const router: IRouter = Router();

/**
 * Lets the SPA discover, at runtime, that it is talking to a preview backend so
 * it can mock auth to match and show a preview banner. Unauthenticated by
 * design — it reveals only whether external services are configured, never any
 * key material or data.
 */
router.get("/preview-status", (_req, res): void => {
  res.json({
    previewAuth: isPreviewAuth(),
    previewDatabase: isPreviewDatabase(),
  });
});

export default router;
