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
 *   phone  — one mobile number, in E.164. For the clerk, intern or client who
 *            has a phone and no work address, which in an Indian chamber is
 *            most of them. Carries a risk email does not: telcos reassign a
 *            disconnected number after about ninety days, so an entry left
 *            standing can one day admit a stranger. Accepted deliberately —
 *            see DECISIONS.md — which is why `lastUsedAt` is surfaced in the
 *            admin UI and why email wins when both match.
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
 * The country code assumed when a number is typed without one.
 *
 * Read from the environment rather than hardcoded to +91. An advocate typing
 * "9876543210" means their own country, and the product should be wrong in one
 * configurable place rather than wrong in a regex somebody has to find.
 */
function defaultCountryCode(): string {
  const raw = process.env["DEFAULT_COUNTRY_CODE"]?.trim() || "+91";
  return raw.startsWith("+") ? raw : `+${raw}`;
}

/**
 * Normalises a mobile number to E.164 for storage and comparison.
 *
 * The phone counterpart of `normaliseEmail`, and it exists for the same reason:
 * matching is a plain equality check, so every path must agree on the stored
 * form. People type "+91 98765 43210", "098765 43210" and "9876543210" for the
 * same number, and all three have to collapse.
 *
 * Returns `""` for anything that is not a usable number — the same "empty means
 * no identifier" convention `identityFromClerk` already uses for an unverified
 * address, so callers have one shape to check rather than two.
 */
export function normalisePhone(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";

  // Anything that is not part of how a number is written is a refusal, not
  // something to strip.
  //
  // Stripping is what a permissive normaliser does, and here it is dangerous in
  // a specific way: "+91 98765 4321O", with a capital O for the final zero,
  // loses one character and becomes +919876543 21 — eleven digits, a perfectly
  // valid-looking E.164 string, and a DIFFERENT number. Admitted to an access
  // list it grants a stranger; typed into OPERATOR_PHONES it silently makes the
  // wrong handset an operator. Neither failure announces itself, because the
  // result is well-formed.
  //
  // Punctuation people actually dial with stays allowed — spaces, +, -, (), .
  // and / all appear in numbers printed on letterheads.
  //
  // Stored values are unaffected. Everything already in the database was
  // normalised on write and is therefore bare E.164, which passes this test
  // unchanged — so tightening the input rule cannot orphan a grant that was
  // matching yesterday.
  if (/[^\d\s+\-()./]/.test(trimmed)) return "";

  // A "+" anywhere ahead of the first digit counts as one — people write
  // "(+91) 98765 43210" and testing only index 0 would miss it, then prepend
  // the country code a second time and store a number that matches nothing.
  const firstDigit = trimmed.search(/\d/);
  const hasPlus = firstDigit > 0 && trimmed.slice(0, firstDigit).includes("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";

  let e164: string;
  if (hasPlus) {
    e164 = `+${digits}`;
  } else if (digits.startsWith("00")) {
    // The other international prefix. "0091..." is the same as "+91...".
    e164 = `+${digits.slice(2)}`;
  } else if (digits.startsWith("0")) {
    // A national trunk prefix: drop it and apply the default country code.
    e164 = `${defaultCountryCode()}${digits.replace(/^0+/, "")}`;
  } else {
    e164 = `${defaultCountryCode()}${digits}`;
  }

  // E.164: a leading digit of 1-9 and eight to fifteen digits in total.
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : "";
}
