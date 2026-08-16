-- Invoicing: the data model and the gapless number series.
--
-- Money is integer paise throughout; every amount column ends _minor. Quantities
-- are thousandths, so 1.5 hours is 1500. Neither ever touches a float.
--
-- invoice_series is the gapless counter, one row per chamber per financial
-- year. A Postgres sequence would be simpler and wrong: sequences are documented
-- as non-gapless, because a rolled-back transaction consumes its value and does
-- not return it. Here the counter is an ordinary row, locked FOR UPDATE inside
-- the same transaction that writes the invoice, so a failure rolls the number
-- back with it.
--
-- Drafts carry a NULL invoice_number. The unique constraint on
-- (workspace, financial_year, invoice_number) therefore constrains only issued
-- invoices — Postgres does not treat NULLs as equal — which is what lets any
-- number of drafts coexist while two issued invoices can never share a number.

CREATE TABLE IF NOT EXISTS "invoice_line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"description" text NOT NULL,
	"quantity_milli" integer DEFAULT 1000 NOT NULL,
	"unit" text DEFAULT 'hour' NOT NULL,
	"unit_rate_minor" integer DEFAULT 0 NOT NULL,
	"amount_minor" integer DEFAULT 0 NOT NULL,
	"sac_code" text,
	"time_entry_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_line_items_time_entry_key" UNIQUE("time_entry_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_series" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"financial_year" text NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_series_workspace_year_key" UNIQUE("workspace_id","financial_year")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"invoice_number" integer,
	"financial_year" text,
	"invoice_ref" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_by_clerk_id" text DEFAULT '' NOT NULL,
	"issued_by" text,
	"issued_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_by" text,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"supersedes_invoice_id" integer,
	"issue_date" date,
	"due_date" date,
	"client_id" integer,
	"client_name" text DEFAULT '' NOT NULL,
	"client_address" text DEFAULT '' NOT NULL,
	"client_email" text DEFAULT '' NOT NULL,
	"client_gstin" text,
	"firm_name" text DEFAULT '' NOT NULL,
	"firm_address" text DEFAULT '' NOT NULL,
	"firm_gstin" text,
	"tax_treatment" text DEFAULT 'unspecified' NOT NULL,
	"place_of_supply" text,
	"sac_code" text,
	"cgst_rate_bp" integer DEFAULT 0 NOT NULL,
	"sgst_rate_bp" integer DEFAULT 0 NOT NULL,
	"igst_rate_bp" integer DEFAULT 0 NOT NULL,
	"subtotal_minor" integer DEFAULT 0 NOT NULL,
	"cgst_minor" integer DEFAULT 0 NOT NULL,
	"sgst_minor" integer DEFAULT 0 NOT NULL,
	"igst_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"notes" text,
	"payment_terms" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_workspace_year_number_key" UNIQUE("workspace_id","financial_year","invoice_number")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_line_items_invoice_idx" ON "invoice_line_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_workspace_status_idx" ON "invoices" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_client_idx" ON "invoices" USING btree ("client_id");