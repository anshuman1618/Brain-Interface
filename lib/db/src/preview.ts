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
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  clerk_id TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'client',
  role_selected BOOLEAN NOT NULL DEFAULT false,
  display_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cases (
  id SERIAL PRIMARY KEY,
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
  client_id INTEGER NOT NULL,
  client_clerk_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  document_name TEXT NOT NULL,
  note TEXT,
  case_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invites (
  id SERIAL PRIMARY KEY,
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

/** Stable Clerk-style ids so the preview auth middleware can map a role to a seeded user. */
export const PREVIEW_USER_IDS = {
  admin: "preview_user_admin",
  senior_advocate: "preview_user_senior",
  junior_advocate: "preview_user_junior",
  clerk_intern: "preview_user_clerk",
  client: "preview_user_client",
} as const;

export type PreviewRole = keyof typeof PREVIEW_USER_IDS;

function offsetDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Sample chamber data. Deliberately includes an already-overdue task so the SLA
 * delay-logging flow (reason + proof required) is reachable the moment preview
 * mode starts, and a scheduled consultation for the consent/recorder flow.
 */
async function seed(db: NodePgDatabase<typeof schema>): Promise<void> {
  const existing = await db.select().from(schema.usersTable);
  if (existing.length > 0) return;

  const users = await db
    .insert(schema.usersTable)
    .values([
      { clerkId: PREVIEW_USER_IDS.admin, role: "admin", roleSelected: true, displayName: "Priya Raghavan", email: "admin@chambers.preview" },
      { clerkId: PREVIEW_USER_IDS.senior_advocate, role: "senior_advocate", roleSelected: true, displayName: "R. Krishnan", email: "krishnan@chambers.preview" },
      { clerkId: PREVIEW_USER_IDS.junior_advocate, role: "junior_advocate", roleSelected: true, displayName: "S. Iyer", email: "iyer@chambers.preview" },
      { clerkId: PREVIEW_USER_IDS.clerk_intern, role: "clerk_intern", roleSelected: true, displayName: "P. Nair", email: "nair@chambers.preview" },
      { clerkId: PREVIEW_USER_IDS.client, role: "client", roleSelected: true, displayName: "A. Kapoor", email: "kapoor@client.preview" },
    ])
    .returning();

  const clientUser = users.find((u) => u.role === "client")!;
  const senior = users.find((u) => u.role === "senior_advocate")!;
  const clerk = users.find((u) => u.role === "clerk_intern")!;

  const cases = await db
    .insert(schema.casesTable)
    .values([
      { title: "Mehra & Sons v. Union of India", description: "Writ petition challenging the impugned customs notification.", status: "in_progress", clientId: clientUser.id, filingRef: "W.P.(C) 8842/2026", priority: "high" },
      { title: "Kapoor estate — succession certificate", description: "Petition for succession certificate over movable assets.", status: "open", clientId: clientUser.id, filingRef: "CS(OS) 331/2026", priority: "urgent" },
      { title: "Vardhman Textiles — GST appeal", description: "Appeal against order-in-original raising a demand for FY 2024-25.", status: "review", clientId: clientUser.id, filingRef: "AP/GST/441/2026", priority: "medium" },
    ])
    .returning();

  await db.insert(schema.tasksTable).values([
    // Deliberately overdue: exercises the mandatory delay-reason + proof flow.
    { caseId: cases[0].id, title: "File rejoinder to counter-affidavit", description: "Respond to the counter filed by the respondent.", status: "in_progress", priority: "urgent", assigneeId: PREVIEW_USER_IDS.clerk_intern, deadline: offsetDate(-2) },
    { caseId: cases[2].id, title: "Draft written submissions", description: "Summarise grounds of appeal for the bench.", status: "pending", priority: "high", assigneeId: PREVIEW_USER_IDS.senior_advocate, deadline: offsetDate(0) },
    { caseId: cases[1].id, title: "Collect notarised affidavit from client", status: "pending", priority: "medium", assigneeId: PREVIEW_USER_IDS.clerk_intern, deadline: offsetDate(4) },
    { caseId: cases[0].id, title: "Prepare index and paperbook", status: "completed", priority: "low", assigneeId: PREVIEW_USER_IDS.junior_advocate, deadline: offsetDate(-6), completedAt: new Date() },
  ]);

  await db.insert(schema.consultationsTable).values([
    { caseId: cases[1].id, title: "Succession strategy — first consultation", notes: "Walk the client through the documentary requirements.", consentGiven: false, status: "scheduled", category: "legal_solution", scheduledAt: new Date(Date.now() + 36e5) },
    { caseId: cases[2].id, title: "GST exposure review", notes: "Assess penalty exposure before the appeal hearing.", consentGiven: false, status: "scheduled", category: "regulatory_solution", scheduledAt: new Date(Date.now() + 3 * 864e5) },
  ]);

  await db.insert(schema.documentsTable).values([
    { caseId: cases[0].id, name: "Counter-affidavit (respondent).pdf", fileType: "application/pdf", fileSize: 481_204, storagePath: "preview/counter-affidavit.pdf" },
    { caseId: cases[1].id, name: "Death certificate (certified copy).pdf", fileType: "application/pdf", fileSize: 118_003, storagePath: "preview/death-certificate.pdf" },
  ]);

  await db.insert(schema.documentRequestsTable).values([
    { clientId: clientUser.id, clientClerkId: clientUser.clerkId, requestedBy: senior.displayName, documentName: "Notarised affidavit of succession", note: "Required before the next listing.", caseId: cases[1].id, status: "pending" },
    { clientId: clientUser.id, clientClerkId: clientUser.clerkId, requestedBy: clerk.displayName, documentName: "Bank statements — Apr to Jun 2026", caseId: cases[1].id, status: "fulfilled" },
  ]);

  await db.insert(schema.timelineEventsTable).values([
    { caseId: cases[0].id, eventType: "case_created", description: 'Case "Mehra & Sons v. Union of India" created', actorName: "Priya Raghavan" },
    { caseId: cases[0].id, eventType: "document_added", description: 'Document "Counter-affidavit (respondent).pdf" added', actorName: "R. Krishnan" },
    { caseId: cases[1].id, eventType: "case_created", description: 'Case "Kapoor estate — succession certificate" created', actorName: "Priya Raghavan" },
  ]);

  await db.insert(schema.notificationsTable).values([
    { userId: clientUser.clerkId, type: "document_request", message: 'Action required: "Notarised affidavit of succession" has been requested by R. Krishnan.', link: "/dashboard" },
  ]);
}

/** Boots PGlite, applies the schema and seeds sample data. */
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

  const db = drizzle(client, { schema }) as unknown as NodePgDatabase<typeof schema>;
  await seed(db);
  return db;
}
