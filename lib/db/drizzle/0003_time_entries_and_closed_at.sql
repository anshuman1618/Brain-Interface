-- Time capture, and a reliable end to the case cycle-time clock.
--
-- time_entries is the first and only place this product records effort. Every
-- hours figure on the KPI page comes from here; before this table there was
-- nothing to compute one from.
--
-- cases.closed_at replaces parsing a free-text timeline sentence to find out
-- when a matter ended. Backfilled below from the status_changed events that
-- were the only previous record — which is exact for rows written by this app,
-- and simply leaves closed_at null where no such event exists.

CREATE TABLE IF NOT EXISTS "time_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"case_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"clerk_id" text NOT NULL,
	"user_name" text DEFAULT '' NOT NULL,
	"work_date" date NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	"description" text,
	"billable" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_workspace_date_idx" ON "time_entries" USING btree ("workspace_id","work_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_case_idx" ON "time_entries" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_user_date_idx" ON "time_entries" USING btree ("user_id","work_date");
--> statement-breakpoint
-- Backfill: the last "closed" status change is the close date. Bounded to rows
-- that are closed now and have no closed_at, so re-running changes nothing.
UPDATE "cases" c
SET "closed_at" = sub.at
FROM (
  SELECT te."case_id" AS case_id, MAX(te."created_at") AS at
  FROM "timeline_events" te
  WHERE te."event_type" = 'status_changed' AND te."description" ILIKE '%closed%'
  GROUP BY te."case_id"
) AS sub
WHERE c."id" = sub.case_id AND c."status" = 'closed' AND c."closed_at" IS NULL;
