import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * An append-only record of every privileged action.
 *
 * The capability matrix stops the wrong people doing things. This table is how
 * a chamber later demonstrates that it did — which is a different requirement,
 * and the one an audit or a client complaint actually asks about.
 *
 * Nothing in the API updates or deletes a row here. Erasure requests
 * (see deletion_requests) redact the actor's name, never the fact that the
 * action happened: a log you can edit is not evidence of anything.
 *
 * `summary` is written for a person to read, not for a machine to parse. It is
 * rendered straight into the Activity screen, so it says "Granted Firm Admin to
 * priya@…" rather than a bag of ids the reader has to resolve themselves.
 */
export const AUDIT_ACTIONS = [
  "workspace.created",
  "access.granted",
  "access.revoked",
  "access.requested",
  "member.role_changed",
  "member.removed",
  "invite.created",
  "case.created",
  "case.updated",
  "case.deleted",
  "case.conflict_acknowledged",
  "document.uploaded",
  "document.downloaded",
  "document.deleted",
  "document_request.created",
  "subscription.changed",
  "billing.checkout_started",
  "billing.paid",
  "data.exported",
  "erasure.requested",
  "erasure.completed",
  "erasure.rejected",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const auditEventsTable = pgTable(
  "audit_events",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull(),
    actorClerkId: text("actor_clerk_id").notNull().default(""),
    /** Denormalised on purpose: the log must still read correctly after the
     *  actor's account is erased or their display name changes. */
    actorName: text("actor_name").notNull().default(""),
    actorRole: text("actor_role").notNull().default(""),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull().default(""),
    entityId: text("entity_id"),
    summary: text("summary").notNull().default(""),
    /** Truncated to the network, not the host: enough to spot an anomaly,
     *  not enough to be a tracking record in its own right. */
    ip: text("ip"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_events_workspace_at_idx").on(t.workspaceId, t.at)],
);

export type AuditEvent = typeof auditEventsTable.$inferSelect;
