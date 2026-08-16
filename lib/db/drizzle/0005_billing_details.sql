-- Billing identity for both sides of an invoice.
--
-- The firm's details live on the workspace, the client's on the user record.
-- Both are CURRENT values; an invoice snapshots them at issue, so editing an
-- address here never rewrites a document already sent.
--
-- Every tax rate defaults to zero and every tax field to empty. Which treatment
-- applies to legal services — including reverse charge in some cases — is the
-- firm's accountant's decision. An unconfigured chamber issues a zero-tax
-- invoice and says so, rather than assuming a rate and being quietly wrong.

ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "firm_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "firm_gstin" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "firm_place_of_supply" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "default_sac_code" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "default_cgst_rate_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "default_sgst_rate_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "default_igst_rate_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "default_hourly_rate_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "default_payment_terms" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "default_payment_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "billing_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "billing_gstin" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "billing_place_of_supply" text;