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
  requested_role TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  request_note TEXT,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workspace_memberships_workspace_user_key UNIQUE (workspace_id, user_id)
);

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
 * Stable Clerk-style ids so the preview auth middleware can map a chosen preview
 * identity to a seeded user.
 *
 * Note what this token does and does not do: it selects *who you are*, exactly
 * like a Clerk session would. It grants nothing. What that identity may reach is
 * still resolved from `workspace_memberships` on every request, which is why
 * `unassigned` exists — the same token mechanism, but a user with no active
 * membership, who therefore lands in Pending Approval and can reach no
 * workspace at all.
 */
export const PREVIEW_USER_IDS = {
  admin: "preview_user_admin",
  senior_advocate: "preview_user_senior",
  junior_advocate: "preview_user_junior",
  clerk_intern: "preview_user_clerk",
  client: "preview_user_client",
  unassigned: "preview_user_unassigned",
  rival_admin: "preview_user_rival_admin",
} as const;

export type PreviewRole = keyof typeof PREVIEW_USER_IDS;

/** Slugs of the seeded tenants. Two of them, so cross-tenant denial is demonstrable. */
export const PREVIEW_WORKSPACE_SLUGS = {
  chambers: "raghavan-chambers",
  rival: "mehta-associates",
} as const;

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

  const workspaces = await db
    .insert(schema.workspacesTable)
    .values([
      { slug: PREVIEW_WORKSPACE_SLUGS.chambers, name: "Raghavan Chambers", kind: "chamber" },
      { slug: PREVIEW_WORKSPACE_SLUGS.rival, name: "Mehta & Associates", kind: "chamber" },
    ])
    .returning();

  const chambers = workspaces.find((w) => w.slug === PREVIEW_WORKSPACE_SLUGS.chambers)!;
  const rival = workspaces.find((w) => w.slug === PREVIEW_WORKSPACE_SLUGS.rival)!;

  const users = await db
    .insert(schema.usersTable)
    .values([
      { clerkId: PREVIEW_USER_IDS.admin, role: "admin", roleSelected: true, displayName: "Priya Raghavan", email: "admin@chambers.preview" },
      { clerkId: PREVIEW_USER_IDS.senior_advocate, role: "senior_advocate", roleSelected: true, displayName: "R. Krishnan", email: "krishnan@chambers.preview" },
      { clerkId: PREVIEW_USER_IDS.junior_advocate, role: "junior_advocate", roleSelected: true, displayName: "S. Iyer", email: "iyer@chambers.preview" },
      { clerkId: PREVIEW_USER_IDS.clerk_intern, role: "clerk_intern", roleSelected: true, displayName: "P. Nair", email: "nair@chambers.preview" },
      { clerkId: PREVIEW_USER_IDS.client, role: "client", roleSelected: true, displayName: "A. Kapoor", email: "kapoor@client.preview" },
      // Signed up, asked for Firm Admin, granted nothing. Sits in Pending Approval.
      { clerkId: PREVIEW_USER_IDS.unassigned, role: "client", roleSelected: false, displayName: "T. Deshmukh", email: "deshmukh@applicant.preview" },
      // Admin of the *other* tenant — proof that "admin" is not a global rank.
      { clerkId: PREVIEW_USER_IDS.rival_admin, role: "admin", roleSelected: true, displayName: "V. Mehta", email: "mehta@associates.preview" },
    ])
    .returning();

  const byClerkId = (id: string) => users.find((u) => u.clerkId === id)!;
  const clientUser = byClerkId(PREVIEW_USER_IDS.client);
  const senior = byClerkId(PREVIEW_USER_IDS.senior_advocate);
  const clerk = byClerkId(PREVIEW_USER_IDS.clerk_intern);
  const adminUser = byClerkId(PREVIEW_USER_IDS.admin);
  const applicant = byClerkId(PREVIEW_USER_IDS.unassigned);
  const rivalAdmin = byClerkId(PREVIEW_USER_IDS.rival_admin);

  const active = (workspaceId: number, u: typeof users[number], role: string) => ({
    workspaceId,
    userId: u.id,
    clerkId: u.clerkId,
    role,
    status: "active",
    decidedBy: "seed",
    decidedAt: new Date(),
  });

  await db.insert(schema.workspaceMembershipsTable).values([
    active(chambers.id, adminUser, "admin"),
    active(chambers.id, senior, "senior_advocate"),
    active(chambers.id, byClerkId(PREVIEW_USER_IDS.junior_advocate), "junior_advocate"),
    active(chambers.id, clerk, "clerk_intern"),
    active(chambers.id, clientUser, "client"),
    active(rival.id, rivalAdmin, "admin"),
    // Intent only. `requested_role` records what they asked for; `role` is what an
    // admin would grant, and it stays inert while status is 'pending'.
    {
      workspaceId: chambers.id,
      userId: applicant.id,
      clerkId: applicant.clerkId,
      role: "client",
      requestedRole: "admin",
      status: "pending",
      requestNote: "Joining as practice manager — need firm oversight.",
    },
  ]);

  const cases = await db
    .insert(schema.casesTable)
    .values([
      { workspaceId: chambers.id, title: "Mehra & Sons v. Union of India", description: "Writ petition challenging the impugned customs notification.", status: "in_progress", clientId: clientUser.id, filingRef: "W.P.(C) 8842/2026", priority: "high" },
      { workspaceId: chambers.id, title: "Kapoor estate — succession certificate", description: "Petition for succession certificate over movable assets.", status: "open", clientId: clientUser.id, filingRef: "CS(OS) 331/2026", priority: "urgent" },
      { workspaceId: chambers.id, title: "Vardhman Textiles — GST appeal", description: "Appeal against order-in-original raising a demand for FY 2024-25.", status: "review", clientId: clientUser.id, filingRef: "AP/GST/441/2026", priority: "medium" },
      // Belongs to the other tenant. Must never appear to Raghavan Chambers members.
      { workspaceId: rival.id, title: "Sethi v. Orbit Logistics (confidential)", description: "Mehta & Associates matter — not visible to any other workspace.", status: "open", clientId: null, filingRef: "CS(COMM) 77/2026", priority: "high" },
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
    { workspaceId: chambers.id, clientId: clientUser.id, clientClerkId: clientUser.clerkId, requestedFromName: clientUser.displayName, requestedBy: senior.displayName, requestedByClerkId: senior.clerkId, requestedByRole: "senior_advocate", documentName: "Notarised affidavit of succession", note: "Required before the next listing.", dueDate: offsetDate(5), caseId: cases[1].id, status: "pending" },
    { workspaceId: chambers.id, clientId: clientUser.id, clientClerkId: clientUser.clerkId, requestedFromName: clientUser.displayName, requestedBy: clerk.displayName, requestedByClerkId: clerk.clerkId, requestedByRole: "clerk_intern", documentName: "Bank statements — Apr to Jun 2026", dueDate: offsetDate(-1), caseId: cases[1].id, status: "fulfilled" },
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
