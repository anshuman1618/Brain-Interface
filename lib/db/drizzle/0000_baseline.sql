-- Baseline schema.
--
-- Written with IF NOT EXISTS on purpose. This repository ran `drizzle-kit push`
-- against production for its whole life, so the deployed database already has
-- every table below and a plain CREATE would abort the migration on the first
-- one. Guarded, the same file initialises a brand-new database and is a no-op
-- against the existing one — no manual baselining step, nothing to remember.
--
-- Because of that, this file cannot ALTER anything on a database that already
-- exists. Changes to tables that predate migrations go in their own numbered
-- file; 0001 is the first of those.

CREATE TABLE IF NOT EXISTS "workspaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'chamber' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"clerk_id" text NOT NULL,
	"role" text DEFAULT 'client' NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"requested_role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"request_note" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_memberships_workspace_user_key" UNIQUE("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_access_list" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"kind" text DEFAULT 'email' NOT NULL,
	"value" text NOT NULL,
	"role" text DEFAULT 'client' NOT NULL,
	"note" text,
	"added_by" text DEFAULT '' NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_access_list_ws_kind_value_key" UNIQUE("workspace_id","kind","value")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"plan" text DEFAULT 'trial' NOT NULL,
	"billing_period" text DEFAULT 'one_time' NOT NULL,
	"status" text DEFAULT 'trialing' NOT NULL,
	"paid_months" integer DEFAULT 1 NOT NULL,
	"free_months" integer DEFAULT 0 NOT NULL,
	"amount_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"started_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"provider_order_id" text,
	"provider_payment_id" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_workspace_key" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"actor_clerk_id" text DEFAULT '' NOT NULL,
	"actor_name" text DEFAULT '' NOT NULL,
	"actor_role" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text DEFAULT '' NOT NULL,
	"entity_id" text,
	"summary" text DEFAULT '' NOT NULL,
	"ip" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deletion_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"clerk_id" text NOT NULL,
	"requested_email" text DEFAULT '' NOT NULL,
	"requested_name" text DEFAULT '' NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"workspace_id" integer,
	"order_id" text,
	"payment_id" text,
	"amount_minor" integer,
	"outcome" text DEFAULT 'applied' NOT NULL,
	"detail" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_events_event_key" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mail_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"kind" text DEFAULT 'notice' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"transport" text DEFAULT '' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calendar_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"kind" text DEFAULT 'note' NOT NULL,
	"entry_date" text NOT NULL,
	"entry_time" text,
	"case_id" integer,
	"audience" text DEFAULT 'all' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_by_role" text DEFAULT '' NOT NULL,
	"created_by_clerk_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"case_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"client_clerk_id" text NOT NULL,
	"client_name" text DEFAULT '' NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"response" text,
	"responded_by" text,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_id" text NOT NULL,
	"role" text DEFAULT 'client' NOT NULL,
	"role_selected" boolean DEFAULT false NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"auth_provider" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"client_id" integer,
	"opposing_party" text,
	"conflict_acknowledged_by" text,
	"conflict_note" text,
	"filing_ref" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"file_type" text,
	"file_size" integer,
	"encrypted" boolean DEFAULT true NOT NULL,
	"storage_path" text,
	"checksum" text,
	"visibility" text DEFAULT 'firm' NOT NULL,
	"uploaded_by" text DEFAULT '' NOT NULL,
	"uploaded_by_clerk_id" text DEFAULT '' NOT NULL,
	"uploaded_by_role" text DEFAULT '' NOT NULL,
	"document_request_id" integer,
	"note" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"assignee_id" text,
	"deadline" date NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delay_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"proof_file_name" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consultations" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"consent_given" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"category" text,
	"scheduled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "timeline_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"description" text NOT NULL,
	"actor_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"email" text NOT NULL,
	"token" text NOT NULL,
	"role" text DEFAULT 'client' NOT NULL,
	"case_id" integer,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"client_clerk_id" text NOT NULL,
	"requested_from_name" text DEFAULT '' NOT NULL,
	"requested_by" text NOT NULL,
	"requested_by_clerk_id" text DEFAULT '' NOT NULL,
	"requested_by_role" text DEFAULT '' NOT NULL,
	"document_name" text NOT NULL,
	"note" text,
	"due_date" text,
	"case_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"fulfilled_document_id" integer,
	"fulfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_workspace_at_idx" ON "audit_events" USING btree ("workspace_id","at");