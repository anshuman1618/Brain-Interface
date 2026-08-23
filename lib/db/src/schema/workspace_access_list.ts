import { pgTable, text, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * The admin-managed access list: which email addresses may enter a workspace,
 * and as what.
 *
 * This is how "only an admin grants access" survives contact with federated
 * sign-in. Google and Zoho will happily authenticate anybody on earth — they
 * establish *who you are*, not whether you belong here. Signing in proves an
 * email address; this table decides whether that address is admitted.
 *
 * An entry is a standing grant made in advance, which is still an admin
 * decision — it is written only by someone holding `access_control.manage` in
 * the workspace, and it names the role explicitly.
 *
 * kind:
 *   email  — one exact address, e.g. "krishnan@chambers.in"
 *   domain — every address at a domain, e.g. "chambers.in". Convenient for a
 *            firm's own Google Workspace / Zoho Mail tenant, and deliberately
 *            more dangerous: anyone who can get an address at that domain gets
 *            in, so the UI says so.
 *   phone  — one exact mobile number in E.164, e.g. "+919876543210". Admits
 *            somebody who signs in by SMS code and may hold no verified email
 *            at all. There is deliberately NO domain-equivalent for phone:
 *            a numbering range is not an organisation and nobody should be
 *            able to admit one.
 */
export const ACCESS_LIST_KINDS = ["email", "domain", "phone"] as const;
export type AccessListKind = (typeof ACCESS_LIST_KINDS)[number];

export const workspaceAccessListTable = pgTable(
  "workspace_access_list",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id").notNull(),
    kind: text("kind").notNull().default("email"),
    /** Always stored lowercased and trimmed; matching is done on the normalised form. */
    value: text("value").notNull(),
    /** The role granted on first sign-in. Chosen by the admin, never by the applicant. */
    role: text("role").notNull().default("client"),
    /**
     * Pins the membership this entry creates to one matter. Set only for
     * client invites — see `invites.ts`, which is also what makes it
     * mandatory for that role. Copied from `invites.case_id` when the entry
     * is written, then copied again onto the membership at reconcile
     * (`access-list.ts`), because a client's actual visibility is enforced
     * from the membership row, not this one.
     */
    caseId: integer("case_id"),
    note: text("note"),
    addedBy: text("added_by").notNull().default(""),
    /** Set instead of deleting, so a revoked grant stays auditable. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Stamped the first time somebody actually signs in against this entry. */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("workspace_access_list_ws_kind_value_key").on(
      table.workspaceId,
      table.kind,
      table.value,
    ),
  ],
);

export const insertWorkspaceAccessListSchema = createInsertSchema(workspaceAccessListTable).omit({
  id: true,
  createdAt: true,
});
export type InsertWorkspaceAccessListEntry = z.infer<typeof insertWorkspaceAccessListSchema>;
export type WorkspaceAccessListEntry = typeof workspaceAccessListTable.$inferSelect;

/** Normalises an address for storage and comparison. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Normalises a domain, tolerating "@example.com" and "https://example.com". */
export function normaliseDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "");
}

export function domainOf(email: string): string {
  const at = normaliseEmail(email).lastIndexOf("@");
  return at === -1 ? "" : normaliseEmail(email).slice(at + 1);
}

/**
 * Canonicalises a mobile number to E.164, or returns "" if it cannot.
 *
 * This is an authorization primitive, not a formatter, and both directions of
 * failure are security bugs:
 *
 *   - Two spellings of ONE number that normalise differently lock a person out
 *     of a chamber they were admitted to. "+91 98765 43210", "09876543210" and
 *     "919876543210" are the same phone and must produce the same string.
 *   - Two DIFFERENT numbers that normalise to the same string would let one
 *     person sign in against another's grant. That is why every rule below is
 *     exact-length: nothing is padded, truncated, or guessed at.
 *
 * So it is deliberately strict and total. Anything not matching a rule returns
 * "" and is refused at the callers — an access-list row that cannot be written
 * is a visible failure, where a row stored in a form nothing will ever match is
 * a silent one.
 *
 * India (+91) is the default country because that is where the practice is:
 * the rest of the app is in paise, GSTIN and bar-council enrolments. A number
 * given in full international form is honoured whatever its country.
 */
export function normalisePhone(raw: string): string {
  if (!raw) return "";
  // Strip only true formatting characters. Letters are NOT stripped — a
  // vanity string is not a number, and quietly discarding them would let
  // "+91-98765-4321O" (letter O) normalise to a real subscriber's number.
  const trimmed = raw.trim().replace(/[\s()./-]/g, "");
  if (!/^\+?\d+$/.test(trimmed)) return "";

  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1);
    // E.164 caps the whole number at 15 digits; below 8 is no national number
    // anywhere and is far more likely to be a truncated paste.
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : "";
  }

  // Bare national forms, India only. Mobile ranges start 6-9; landlines and
  // service codes are deliberately not accepted, because nothing here can send
  // an SMS to one.
  if (/^[6-9]\d{9}$/.test(trimmed)) return `+91${trimmed}`;
  // Trunk prefix, as dialled domestically.
  if (/^0[6-9]\d{9}$/.test(trimmed)) return `+91${trimmed.slice(1)}`;
  // Country code without the plus.
  if (/^91[6-9]\d{9}$/.test(trimmed)) return `+${trimmed}`;

  return "";
}
