/**
 * In-memory Postgres for preview mode.
 *
 * When DATABASE_URL is absent the app boots against PGlite — a real Postgres
 * compiled to WASM running in-process — rather than failing at import time.
 * Every query in the codebase therefore runs unchanged (same SQL dialect, same
 * Drizzle driver surface); nothing is stubbed at the query-builder level.
 *
 * The database is ephemeral: it lives for the life of the process and is
 * recreated, schema and seed data included, on every start.
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
  filing_ref TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  audio_url TEXT,
  transcript_placeholder TEXT,
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
  encrypted BOOLEAN NOT NULL DEFAULT true,
  storage_path TEXT,
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

/** Boots PGlite and applies the schema. Seeds nothing. */
export async function createPreviewDatabase(): Promise<NodePgDatabase<typeof schema>> {
  // Imported dynamically: PGlite is a dev-only dependency and must never be
  // required on a production boot, where DATABASE_URL is always set.
  const [{ PGlite }, { drizzle }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
  ]);

  const client = new PGlite();
  await client.waitReady;
  await client.exec(DDL);

  return drizzle(client, { schema }) as unknown as NodePgDatabase<typeof schema>;
}
