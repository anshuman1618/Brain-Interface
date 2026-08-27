import { pgTable, serial, integer, text, timestamp, unique, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * A matter an admin has explicitly opened to one member.
 *
 * The chamber's answer to "the junior should see the Mehta file, and nothing
 * else". Row scope alone could not express it: `all` shows everything and
 * `assigned` shows only what somebody holds a task on, so granting sight of a
 * matter meant inventing a task for it.
 *
 * ── How it combines with row scope ──────────────────────────────────────
 *
 * A grant is ADDITIVE and only meaningful for a membership marked
 * `caseAccessRestricted`. Such a member sees:
 *
 *     matters they are assigned  ∪  matters granted here
 *
 * Nothing else. An unrestricted membership ignores this table entirely, which
 * is why switching it on is an admin's deliberate act and why deploying this
 * takes no access away from anybody.
 *
 * It cannot WIDEN a scope beyond the workspace: every read still starts from
 * `cases.workspace_id`, and a grant naming a matter in another chamber
 * resolves to nothing because the join finds no such case here.
 */
export const caseAccessGrantsTable = pgTable(
  "case_access_grants",
  {
    id: serial("id").primaryKey(),
    /** Tenant boundary, denormalised so a grant can be checked without a join. */
    workspaceId: integer("workspace_id").notNull(),
    /** The membership this opens a matter to — not the user, who may be in several chambers. */
    membershipId: integer("membership_id").notNull(),
    caseId: integer("case_id").notNull(),

    grantedBy: text("granted_by").notNull().default(""),
    grantedByClerkId: text("granted_by_clerk_id").notNull().default(""),
    /** Why, in the admin's words. Read when somebody asks how this person saw the file. */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Granting the same matter twice is a no-op, not a second row.
    unique("case_access_grants_membership_case_key").on(t.membershipId, t.caseId),
    index("case_access_grants_membership_idx").on(t.membershipId),
    index("case_access_grants_workspace_idx").on(t.workspaceId),
  ],
);

export const insertCaseAccessGrantSchema = createInsertSchema(caseAccessGrantsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCaseAccessGrant = z.infer<typeof insertCaseAccessGrantSchema>;
export type CaseAccessGrant = typeof caseAccessGrantsTable.$inferSelect;
