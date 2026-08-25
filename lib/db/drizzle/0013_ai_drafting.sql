-- AI drafting: the chamber's own knowledge, its own voice, and what it spends.
--
-- Additive and guarded throughout, like every migration before it. Nothing is
-- dropped, nothing is retyped, and every statement is safe to re-run — which is
-- what lets this survive a database that `drizzle-kit push` touched first.
--
-- Five tables and one column, in the order they depend on each other.

-- ── The opt-in ──────────────────────────────────────────────────────────────
--
-- Off by default, and that default is the whole point. Drafting sends matter
-- facts and selected documents to a third party; a chamber has to say yes,
-- knowing what leaves. The two companion columns record who said it and when,
-- because "the chamber consented" is worth nothing without evidence of it.
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "drafting_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "drafting_enabled_by" text;
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "drafting_enabled_at" timestamptz;

-- ── Insights ────────────────────────────────────────────────────────────────
--
-- What an advocate concluded, as opposed to what happened. Workspace-scoped:
-- an insight written in one chamber is retrieved only for that chamber.
CREATE TABLE IF NOT EXISTS "chamber_insights" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL DEFAULT '',
  "tags" text NOT NULL DEFAULT '',
  "court_id" integer,
  "case_type_norm" text,
  "author_clerk_id" text NOT NULL DEFAULT '',
  "author_name" text NOT NULL DEFAULT '',
  "author_role" text NOT NULL DEFAULT '',
  "shared_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "chamber_insights_workspace_idx"
  ON "chamber_insights" ("workspace_id");

-- Retrieval is full text, not vectors.
--
-- `pg_trgm` and `pgvector` are NOT available in PGlite, which is what preview
-- mode and every CI suite run on — verified, not assumed. An embedding-based
-- retriever would be a production-only path no test could ever execute. That is
-- the same trade the cause-list search made, for the same reason, and at the
-- volume one chamber writes it is not a compromise: full text finds the right
-- insight and costs nothing per query.
--
-- 'simple' rather than 'english': these are Indian court names, case types and
-- proper nouns, and English stemming loses more than it finds.
CREATE INDEX IF NOT EXISTS "chamber_insights_fts_idx"
  ON "chamber_insights"
  USING GIN (
    to_tsvector(
      'simple',
      coalesce("title", '') || ' ' || coalesce("body", '') || ' ' || coalesce("tags", '')
    )
  );

-- ── Style exemplars ─────────────────────────────────────────────────────────
--
-- `source_text` is what was extracted; `body` is the redacted copy. Only `body`
-- is ever sent to a model, and only once `reviewed_at` is set — an automatic
-- redaction nobody read is not a redaction you can rely on.
CREATE TABLE IF NOT EXISTS "style_exemplars" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL,
  "kind" text NOT NULL DEFAULT 'petition',
  "title" text NOT NULL,
  "source_document_id" integer,
  "source_text" text NOT NULL DEFAULT '',
  "body" text NOT NULL DEFAULT '',
  "anonymised_at" timestamptz,
  "reviewed_at" timestamptz,
  "reviewed_by" text,
  "active" boolean NOT NULL DEFAULT true,
  "added_by_clerk_id" text NOT NULL DEFAULT '',
  "added_by_name" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "style_exemplars_workspace_kind_idx"
  ON "style_exemplars" ("workspace_id", "kind");

-- ── Drafts and reviews ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "drafts" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL,
  "case_id" integer NOT NULL,
  "kind" text NOT NULL DEFAULT 'petition',
  "title" text NOT NULL DEFAULT '',
  "instruction" text NOT NULL DEFAULT '',
  "body" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'generating',
  "error" text,
  "model" text NOT NULL DEFAULT '',
  "parent_draft_id" integer,
  "created_by_clerk_id" text NOT NULL DEFAULT '',
  "created_by_name" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "drafts_workspace_case_idx"
  ON "drafts" ("workspace_id", "case_id");

-- What was actually sent, per draft.
--
-- The record that makes "the advocate chose what left the server" checkable
-- rather than merely asserted. When a client asks what of theirs was sent, this
-- is the answer.
CREATE TABLE IF NOT EXISTS "draft_sources" (
  "id" serial PRIMARY KEY,
  "draft_id" integer NOT NULL,
  "workspace_id" integer NOT NULL,
  "kind" text NOT NULL,
  "source_id" integer,
  "label" text NOT NULL DEFAULT '',
  "tokens" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "draft_sources_draft_idx" ON "draft_sources" ("draft_id");

-- ── Spend ───────────────────────────────────────────────────────────────────
--
-- Separate from `drafts` because a chamber may delete a draft and the tokens
-- were still spent. The remaining budget is a SUM over this table, not a
-- counter column — a counter drifts, a sum cannot.
--
-- `dedupe_key` is unique so a retried stream or a handler that runs twice
-- cannot bill one call twice.
CREATE TABLE IF NOT EXISTS "ai_usage_events" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL,
  "draft_id" integer,
  "purpose" text NOT NULL DEFAULT 'draft',
  "model" text NOT NULL DEFAULT '',
  "input_tokens" integer NOT NULL DEFAULT 0,
  "output_tokens" integer NOT NULL DEFAULT 0,
  "cache_read_tokens" integer NOT NULL DEFAULT 0,
  "cache_write_tokens" integer NOT NULL DEFAULT 0,
  "web_searches" integer NOT NULL DEFAULT 0,
  "cost_minor" integer NOT NULL DEFAULT 0,
  "dedupe_key" text NOT NULL,
  "actor_clerk_id" text NOT NULL DEFAULT '',
  "at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ai_usage_events_dedupe_key" UNIQUE ("dedupe_key")
);
CREATE INDEX IF NOT EXISTS "ai_usage_events_workspace_at_idx"
  ON "ai_usage_events" ("workspace_id", "at");

-- Budget bought on top of the plan allowance. Written only from the Razorpay
-- webhook, never from the browser reporting success.
CREATE TABLE IF NOT EXISTS "ai_topups" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL,
  "pack" text NOT NULL,
  "price_minor" integer NOT NULL DEFAULT 0,
  "grant_minor" integer NOT NULL DEFAULT 0,
  "order_id" text,
  "payment_id" text,
  "expires_at" timestamptz,
  "bought_by_clerk_id" text NOT NULL DEFAULT '',
  "bought_by_name" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "ai_topups_workspace_idx" ON "ai_topups" ("workspace_id");
