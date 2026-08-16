/**
 * File-backed Postgres for preview mode.
 *
 * When DATABASE_URL is absent the app boots against PGlite — a real Postgres
 * compiled to WASM running in-process — rather than failing at import time.
 * Every query in the codebase therefore runs unchanged (same SQL dialect, same
 * Drizzle driver surface); nothing is stubbed at the query-builder level.
 *
 * PERSISTENCE: PGlite is pointed at a data directory (PREVIEW_DATA_DIR, default
 * `.preview-data`), so everything entered survives a restart. It is only
 * discarded if that directory is deleted.
 *
 * Why PGlite-on-disk rather than SQLite or lowdb: those are different storage
 * engines with a different SQL dialect (or none at all). Every query in this
 * codebase is Drizzle-for-Postgres — `serial`, `timestamptz`, `ilike`,
 * `ON CONFLICT`, `returning()` — so swapping the engine would mean rewriting the
 * data layer twice over and leaving preview running different SQL from
 * production. Pointing PGlite at a directory gets the same durability with zero
 * dialect drift: preview and production run identical Postgres.
 */

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/** Mirrors lib/db/src/schema. Kept here rather than generated so preview mode has no build step. */
const DDL = `
CREATE TABLE IF NOT EXISTS workspaces (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'chamber',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_memberships (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  clerk_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client',
  is_owner BOOLEAN NOT NULL DEFAULT false,
  requested_role TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  request_note TEXT,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workspace_memberships_workspace_user_key UNIQUE (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS calendar_entries (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  kind TEXT NOT NULL DEFAULT 'note',
  entry_date TEXT NOT NULL,
  entry_time TEXT,
  case_id INTEGER,
  audience TEXT NOT NULL DEFAULT 'all',
  created_by TEXT NOT NULL DEFAULT '',
  created_by_role TEXT NOT NULL DEFAULT '',
  created_by_clerk_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_access_list (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'email',
  value TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client',
  note TEXT,
  added_by TEXT NOT NULL DEFAULT '',
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workspace_access_list_ws_kind_value_key UNIQUE (workspace_id, kind, value)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL,
  plan TEXT NOT NULL DEFAULT 'trial',
  billing_period TEXT NOT NULL DEFAULT 'one_time',
  status TEXT NOT NULL DEFAULT 'trialing',
  paid_months INTEGER NOT NULL DEFAULT 1,
  free_months INTEGER NOT NULL DEFAULT 0,
  amount_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  -- Null until the plan is in force. A custom-plan enquiry has no start.
  started_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_workspace_key UNIQUE (workspace_id)
);

CREATE TABLE IF NOT EXISTS payment_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  workspace_id INTEGER,
  order_id TEXT,
  payment_id TEXT,
  amount_minor INTEGER,
  outcome TEXT NOT NULL DEFAULT 'applied',
  detail TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_events_event_key UNIQUE (event_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL,
  actor_clerk_id TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  actor_role TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT,
  summary TEXT NOT NULL DEFAULT '',
  ip TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_workspace_at_idx ON audit_events (workspace_id, at);

CREATE TABLE IF NOT EXISTS deletion_requests (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  clerk_id TEXT NOT NULL,
  requested_email TEXT NOT NULL DEFAULT '',
  requested_name TEXT NOT NULL DEFAULT '',
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'notice',
  status TEXT NOT NULL DEFAULT 'queued',
  transport TEXT NOT NULL DEFAULT '',
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  clerk_id TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'client',
  role_selected BOOLEAN NOT NULL DEFAULT false,
  display_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  auth_provider TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cases (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  client_id INTEGER,
  filing_ref TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS time_entries (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL,
  case_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  clerk_id TEXT NOT NULL,
  user_name TEXT NOT NULL DEFAULT '',
  work_date DATE NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  billable BOOLEAN NOT NULL DEFAULT true,
  started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS time_entries_workspace_date_idx ON time_entries (workspace_id, work_date);
CREATE INDEX IF NOT EXISTS time_entries_case_idx ON time_entries (case_id);
CREATE INDEX IF NOT EXISTS time_entries_user_date_idx ON time_entries (user_id, work_date);

CREATE TABLE IF NOT EXISTS invoice_series (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL,
  financial_year TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invoice_series_workspace_year_key UNIQUE (workspace_id, financial_year)
);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL,
  invoice_number INTEGER,
  financial_year TEXT,
  invoice_ref TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT NOT NULL DEFAULT '',
  created_by_clerk_id TEXT NOT NULL DEFAULT '',
  issued_by TEXT,
  issued_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  voided_by TEXT,
  voided_at TIMESTAMPTZ,
  void_reason TEXT,
  supersedes_invoice_id INTEGER,
  issue_date DATE,
  due_date DATE,
  client_id INTEGER,
  client_name TEXT NOT NULL DEFAULT '',
  client_address TEXT NOT NULL DEFAULT '',
  client_email TEXT NOT NULL DEFAULT '',
  client_gstin TEXT,
  firm_name TEXT NOT NULL DEFAULT '',
  firm_address TEXT NOT NULL DEFAULT '',
  firm_gstin TEXT,
  tax_treatment TEXT NOT NULL DEFAULT 'unspecified',
  place_of_supply TEXT,
  sac_code TEXT,
  cgst_rate_bp INTEGER NOT NULL DEFAULT 0,
  sgst_rate_bp INTEGER NOT NULL DEFAULT 0,
  igst_rate_bp INTEGER NOT NULL DEFAULT 0,
  subtotal_minor INTEGER NOT NULL DEFAULT 0,
  cgst_minor INTEGER NOT NULL DEFAULT 0,
  sgst_minor INTEGER NOT NULL DEFAULT 0,
  igst_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  notes TEXT,
  payment_terms TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invoices_workspace_year_number_key UNIQUE (workspace_id, financial_year, invoice_number)
);
CREATE INDEX IF NOT EXISTS invoices_workspace_status_idx ON invoices (workspace_id, status);
CREATE INDEX IF NOT EXISTS invoices_client_idx ON invoices (client_id);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL DEFAULT 1000,
  unit TEXT NOT NULL DEFAULT 'hour',
  unit_rate_minor INTEGER NOT NULL DEFAULT 0,
  amount_minor INTEGER NOT NULL DEFAULT 0,
  sac_code TEXT,
  time_entry_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invoice_line_items_time_entry_key UNIQUE (time_entry_id)
);
CREATE INDEX IF NOT EXISTS invoice_line_items_invoice_idx ON invoice_line_items (invoice_id);

CREATE TABLE IF NOT EXISTS beta_feedback (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  clerk_id TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  workspace_id INTEGER,
  message TEXT NOT NULL,
  page_path TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'medium',
  assignee_id TEXT,
  deadline DATE NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delay_logs (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT,
  proof_file_name TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consultations (
  id SERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  consent_given BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'scheduled',
  category TEXT NOT NULL DEFAULT 'legal_solution',
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  url TEXT,
  encrypted BOOLEAN NOT NULL DEFAULT true,
  storage_path TEXT,
  visibility TEXT NOT NULL DEFAULT 'firm',
  uploaded_by TEXT NOT NULL DEFAULT '',
  uploaded_by_clerk_id TEXT NOT NULL DEFAULT '',
  uploaded_by_role TEXT NOT NULL DEFAULT '',
  document_request_id INTEGER,
  note TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_requests (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  client_clerk_id TEXT NOT NULL,
  requested_from_name TEXT NOT NULL DEFAULT '',
  requested_by TEXT NOT NULL,
  requested_by_clerk_id TEXT NOT NULL DEFAULT '',
  requested_by_role TEXT NOT NULL DEFAULT '',
  document_name TEXT NOT NULL,
  note TEXT,
  due_date TEXT,
  case_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  fulfilled_document_id INTEGER,
  fulfilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invites (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'client',
  case_id INTEGER,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL,
  case_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  client_clerk_id TEXT NOT NULL,
  client_name TEXT NOT NULL DEFAULT '',
  rating INTEGER NOT NULL,
  comment TEXT,
  response TEXT,
  responded_by TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS timeline_events (
  id SERIAL PRIMARY KEY,
  case_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  actor_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

/**
 * No seed data.
 *
 * The platform starts completely empty: no chambers, no users, no matters, no
 * tasks. The first person to sign in creates their chamber and becomes its
 * owner, then invites everyone else and enters their own work. Every counter
 * reads zero until they do.
 *
 * This is deliberate. Sample matters made the portal look populated, which is
 * actively misleading in a product whose whole subject is who may see which
 * client's file — and made it impossible to tell your own data apart from the
 * fixtures.
 */

/**
 * Idempotent column additions.
 *
 * `CREATE TABLE IF NOT EXISTS` above creates missing tables but will not add a
 * column to a table that already exists — so on a persisted database an upgrade
 * would silently leave new columns off and every insert would fail. These run on
 * every boot and are no-ops once applied, which is what lets the data directory
 * survive a schema change instead of having to be thrown away.
 */
const MIGRATIONS = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT '';
-- subscriptions.started_at became nullable when the quote-only Custom plan
-- arrived: an enquiry is recorded, but nothing has started. DROP NOT NULL is a
-- no-op once applied, so this is safe to run on every boot like the rest.
ALTER TABLE subscriptions ALTER COLUMN started_at DROP NOT NULL;
ALTER TABLE mail_outbox ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;
ALTER TABLE mail_outbox ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_order_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_payment_id TEXT;
ALTER TABLE workspace_memberships ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS checksum TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS opposing_party TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS conflict_acknowledged_by TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS conflict_note TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'firm';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS uploaded_by TEXT NOT NULL DEFAULT '';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS uploaded_by_clerk_id TEXT NOT NULL DEFAULT '';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS uploaded_by_role TEXT NOT NULL DEFAULT '';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS document_request_id INTEGER;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS fulfilled_document_id INTEGER;
ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;
`;

/** Where the preview database lives on disk. */
export function previewDataDir(): string {
  return process.env.PREVIEW_DATA_DIR?.trim() || ".preview-data";
}

/**
 * Boots PGlite against a data directory and applies the schema. Seeds nothing —
 * the platform starts empty and stays however the user left it.
 */
export async function createPreviewDatabase(): Promise<NodePgDatabase<typeof schema>> {
  // Imported dynamically: PGlite is a dev-only dependency and must never be
  // required on a production boot, where DATABASE_URL is always set.
  const [{ PGlite }, { drizzle }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
  ]);

  const client = new PGlite(previewDataDir());
  await client.waitReady;
  await client.exec(DDL);
  await client.exec(MIGRATIONS);

  return drizzle(client, { schema }) as unknown as NodePgDatabase<typeof schema>;
}
