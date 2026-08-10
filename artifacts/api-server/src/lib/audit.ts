import type { Request } from "express";
import { db, auditEventsTable, type AuditAction } from "@workspace/db";
import { logger } from "./logger";
import type { WorkspaceContext } from "../middlewares/requireAuth";

/**
 * Write one line into the workspace's audit log.
 *
 * Deliberately fire-and-forget with its own try/catch: an audit write that
 * fails must not turn a successful action into a 500 the user cannot get past.
 * A missing log line is a problem to alert on, not a reason to block a chamber
 * from filing. The failure is logged at error level so it is still visible.
 */

/**
 * Keep the network, drop the host.
 *
 * Enough to notice "these twelve grants came from one place at 3am", not
 * enough to be a location record for every action a person takes. IPv4 keeps
 * three octets, IPv6 keeps the /48 a site is typically allocated.
 */
export function truncateIp(raw: string | undefined): string | null {
  if (!raw) return null;
  const ip = raw.split(",")[0]!.trim();
  if (!ip) return null;
  if (ip.includes(".")) {
    const parts = ip.split(".");
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.x` : null;
  }
  if (ip.includes(":")) {
    const parts = ip.split(":").filter(Boolean);
    return parts.length >= 3 ? `${parts.slice(0, 3).join(":")}::/48` : null;
  }
  return null;
}

export type AuditInput = {
  action: AuditAction;
  entityType?: string;
  entityId?: string | number | null;
  /** Written for a human to read on the Activity screen. */
  summary: string;
};

export async function recordAudit(
  req: Request,
  ctx: Pick<WorkspaceContext, "workspaceId" | "role" | "user">,
  input: AuditInput,
): Promise<void> {
  try {
    await db.insert(auditEventsTable).values({
      workspaceId: ctx.workspaceId,
      actorClerkId: ctx.user.clerkId,
      actorName: ctx.user.displayName || ctx.user.email || ctx.user.clerkId,
      actorRole: ctx.role,
      action: input.action,
      entityType: input.entityType ?? "",
      entityId: input.entityId == null ? null : String(input.entityId),
      summary: input.summary,
      ip: truncateIp(
        (req.headers["x-forwarded-for"] as string | undefined) ?? req.socket?.remoteAddress,
      ),
    });
  } catch (err) {
    logger.error({ err, action: input.action }, "Failed to write audit event");
  }
}
