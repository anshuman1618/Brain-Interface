import { pgTable, text, serial, integer, timestamp, boolean, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * The single source of truth for "may this user reach this workspace, and as
 * what?".
 *
 * Nothing else grants access. A Clerk sign-up creates a user row and — at most —
 * a `pending` membership recording what they *asked* for; it never creates an
 * `active` one. Only an admin acting inside the workspace can move a row to
 * `active`, and the role they set is the role the admin chose, not the role the
 * applicant requested.
 *
 * status:
 *   pending  — an access request. Grants nothing.
 *   active   — the only status that grants access.
 *   revoked  — previously granted, now withdrawn. Grants nothing.
 */
export const MEMBERSHIP_STATUSES = ["pending", "active", "revoked"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const workspaceMembershipsTable = pgTable(
  "workspace_memberships",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull(),
    userId: integer("user_id").notNull(),
    /** Denormalised from users.clerk_id so the hot-path membership lookup is a single query. */
    clerkId: text("clerk_id").notNull(),
    /** The granted role. Meaningless unless status is 'active'. */
    role: text("role").notNull().default("client"),
    /**
     * True for whoever created the chamber.
     *
     * A founder needs to be able to invite their own team whatever practice
     * title they hold, so ownership adds the management capabilities on top of
     * the role. It is scoped to the workspace they created and confers nothing
     * anywhere else — and it cannot be self-assigned, because it is only ever
     * set by the create-workspace endpoint for the caller creating it.
     */
    isOwner: boolean("is_owner").notNull().default(false),
    /** What the applicant asked for at sign-up. Recorded as intent only — never granted. */
    requestedRole: text("requested_role"),
    status: text("status").notNull().default("pending"),
    /** Free-text justification supplied with an access request. */
    requestNote: text("request_note"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("workspace_memberships_workspace_user_key").on(table.workspaceId, table.userId),
  ],
);

export const insertWorkspaceMembershipSchema = createInsertSchema(workspaceMembershipsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWorkspaceMembership = z.infer<typeof insertWorkspaceMembershipSchema>;
export type WorkspaceMembership = typeof workspaceMembershipsTable.$inferSelect;
