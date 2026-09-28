import { pgTable, serial, integer, unique, index } from "drizzle-orm/pg-core";

/**
 * Which matters a pinned access-list entry, and the membership it creates, are
 * narrowed to.
 *
 * ── Why two tables and not one ────────────────────────────────────────────
 *
 * Because there are two objects with two lifetimes. `workspace_access_list` is
 * the standing grant an admin wrote in advance; `workspace_memberships` is the
 * real membership created the first time that person signs in. The set has to
 * be copied from one to the other at reconcile, exactly as the single
 * `case_id` column already was — the membership is what `lib/scope.ts`
 * enforces from, and an access-list row is not consulted again after
 * admission.
 *
 * ── The legacy column is still written, on purpose ────────────────────────
 *
 * `workspace_access_list.case_id` and `workspace_memberships.case_id` stay,
 * and keep receiving the FIRST matter of the set. They are not the source of
 * truth any more, and nothing should read them where these tables are
 * available — but if some path is missed, restricting to one matter of the
 * three intended is narrower than intended rather than wider. A missed read
 * that fails open is a data leak; one that fails closed is a support ticket.
 * That asymmetry is the whole reason the column is not dropped.
 *
 * It also means every membership that existed before this migration keeps
 * working with no backfill: no rows here, one `case_id`, and the resolver
 * falls back to it.
 */

export const accessListCasesTable = pgTable(
  "access_list_cases",
  {
    id: serial("id").primaryKey(),
    /** The `workspace_access_list` row this set belongs to. */
    entryId: integer("entry_id").notNull(),
    caseId: integer("case_id").notNull(),
  },
  (t) => [
    unique("access_list_cases_entry_case_key").on(t.entryId, t.caseId),
    index("access_list_cases_entry_idx").on(t.entryId),
  ],
);

export const membershipCasesTable = pgTable(
  "membership_cases",
  {
    id: serial("id").primaryKey(),
    /** The `workspace_memberships` row this set belongs to. */
    membershipId: integer("membership_id").notNull(),
    caseId: integer("case_id").notNull(),
  },
  (t) => [
    unique("membership_cases_membership_case_key").on(t.membershipId, t.caseId),
    // Read on every request that resolves a restricted caller's scope.
    index("membership_cases_membership_idx").on(t.membershipId),
  ],
);

export type AccessListCase = typeof accessListCasesTable.$inferSelect;
export type MembershipCase = typeof membershipCasesTable.$inferSelect;
