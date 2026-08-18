-- Cause-list ingestion: courts, scraped listings, and per-chamber proposals.
--
-- courts / cause_list_entries / cause_list_sync_runs are GLOBAL, not
-- workspace-scoped. A published cause list is one public document that every
-- chamber appearing in it reads identically; fetching it per tenant would mean
-- N requests to one government server for one file. cause_list_matches IS
-- workspace-scoped, and is where public data becomes something a particular
-- chamber is told about. See DECISIONS.md.
--
-- Additive and guarded throughout. The four columns on `cases` are nullable:
-- every matter predating this feature has none, and a matter not before a
-- court never will — neither is broken, they simply never match a listing.

CREATE TABLE IF NOT EXISTS "courts" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"bench" text DEFAULT '' NOT NULL,
	"jurisdiction" text DEFAULT '' NOT NULL,
	"adapter" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courts_code_key" UNIQUE ("code")
);

CREATE TABLE IF NOT EXISTS "cause_list_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"court_id" integer NOT NULL,
	"list_date" text NOT NULL,
	"case_type" text DEFAULT '' NOT NULL,
	"case_type_norm" text DEFAULT '' NOT NULL,
	"case_number" integer,
	"case_year" integer,
	"parties" text DEFAULT '' NOT NULL,
	"court_no" text DEFAULT '' NOT NULL,
	"item_no" text DEFAULT '' NOT NULL,
	"coram" text DEFAULT '' NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"raw_text" text DEFAULT '' NOT NULL,
	"source_key" text NOT NULL,
	"sync_run_id" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cause_list_entries_court_date_key" UNIQUE ("court_id", "list_date", "source_key")
);

CREATE INDEX IF NOT EXISTS "cause_list_entries_court_date_idx"
	ON "cause_list_entries" ("court_id", "list_date");

CREATE TABLE IF NOT EXISTS "cause_list_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"cause_list_entry_id" integer NOT NULL,
	"case_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"confidence" text DEFAULT 'exact' NOT NULL,
	"calendar_entry_id" integer,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cause_list_matches_ws_entry_case_key"
		UNIQUE ("workspace_id", "cause_list_entry_id", "case_id")
);

CREATE INDEX IF NOT EXISTS "cause_list_matches_ws_status_idx"
	ON "cause_list_matches" ("workspace_id", "status");

CREATE TABLE IF NOT EXISTS "cause_list_sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"court_id" integer NOT NULL,
	"adapter" text DEFAULT '' NOT NULL,
	"list_date" text NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"upserted" integer DEFAULT 0 NOT NULL,
	"proposed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "cause_list_sync_runs_court_started_idx"
	ON "cause_list_sync_runs" ("court_id", "started_at");

ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "court_id" integer;
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "case_type" text;
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "case_type_norm" text;
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "case_number" integer;
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "case_year" integer;

-- The matcher's other hot path: every matter at a court with a given number.
CREATE INDEX IF NOT EXISTS "cases_court_number_idx"
	ON "cases" ("court_id", "case_number", "case_year");

ALTER TABLE "calendar_entries" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'manual' NOT NULL;
ALTER TABLE "calendar_entries" ADD COLUMN IF NOT EXISTS "cause_list_entry_id" integer;
