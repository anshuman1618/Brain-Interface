-- Beta feedback: the widget's table.
--
-- Guarded like the baseline, because `drizzle-kit push` may still be used
-- locally and could have created this table before the migration ran.

CREATE TABLE IF NOT EXISTS "beta_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"clerk_id" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"workspace_id" integer,
	"message" text NOT NULL,
	"page_path" text NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
