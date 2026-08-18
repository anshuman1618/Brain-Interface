-- The migration service add-on: an enquiry, not a plan.
--
-- Guarded like every table here, so a database `drizzle-kit push` already
-- touched locally is not tripped up by this running afterward.

CREATE TABLE IF NOT EXISTS "service_enquiries" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"clerk_id" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"service_kind" text DEFAULT 'migration' NOT NULL,
	"message" text NOT NULL,
	"contact_preference" text DEFAULT 'email' NOT NULL,
	"contact_phone" text,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
