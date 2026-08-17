-- Test-only fixture: recreates the exact legacy production shape proven by the
-- real, read-only production catalog dump supplied by the repository owner on
-- 2026-08-17 (kai.intake_source_candidates, kai.intake_file_profiles,
-- kai.data_dictionaries, kai.intake_sensitivity_profiles,
-- kai.intake_promotion_decisions, kai.sources, kai.source_versions,
-- kai.review_queue_items), for the sole purpose of proving the real-PostgreSQL
-- collision-and-cutover regression. Never applied to production - production
-- already has these tables; this file exists only to stand up the same shape
-- inside an ephemeral, ownerless PostgreSQL instance the local-postgres runner
-- creates and destroys itself.
--
-- Column sets are trimmed to what is structurally necessary to (a) reproduce
-- the 42703 undefined_column failure on file_profile_id via the real,
-- unmodified getScopedSourceCandidateByIdentity query, and (b) exercise the
-- cutover migration's shape-classification markers - not a byte-for-byte
-- reproduction of every column in the 60+ column production kai.sources table.

BEGIN;

-- kai.audit_events is a base table this repository's migrations never create
-- (like kai.intake_files, it predates tracked migrations); the real P1 required-
-- audit machinery (createProductionMetadataOnlyAudit ->
-- insertRequiredSuccessfulAuditEvent) writes to it. Synthetic mirror only,
-- identical to the one already used by
-- scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql.
CREATE TYPE kai.object_type_enum AS ENUM ('other');

CREATE TABLE kai.audit_events (
  audit_event_id    bigserial PRIMARY KEY,
  organization_id   uuid,
  actor_user_id     uuid,
  actor_type        text NOT NULL,
  action            text NOT NULL,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  object_type       kai.object_type_enum NOT NULL,
  reason_code       text,
  reason_text       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kai.intake_file_profiles (
  intake_file_profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_file_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  detected_columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  processing_status text NOT NULL DEFAULT 'parsed',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kai.data_dictionaries (
  data_dictionary_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  intake_file_id uuid,
  dictionary_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  processing_status text NOT NULL DEFAULT 'needs_gk_review',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kai.intake_sensitivity_profiles (
  intake_sensitivity_profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_file_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  consent_scope text[] NOT NULL DEFAULT ARRAY['none'],
  review_status text NOT NULL DEFAULT 'needs_gk_review',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kai.intake_source_candidates (
  intake_source_candidate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_file_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  proposed_source_code text,
  proposed_display_name text,
  proposed_source_type text,
  processing_status text NOT NULL DEFAULT 'needs_gk_review',
  review_status text NOT NULL DEFAULT 'needs_gk_review',
  created_source_id uuid,
  created_source_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'human'
);

CREATE TABLE kai.sources (
  source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  engagement_id uuid,
  display_name text NOT NULL,
  source_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kai.source_versions (
  source_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL,
  version_number integer NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kai.intake_promotion_decisions (
  intake_promotion_decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_source_candidate_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  decision_status text NOT NULL,
  decision_by uuid,
  created_source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Shared/live table: production shape (unnamed default constraints, already
-- permits every literal the canonical P1-06/07/08 code writes) - proven never
-- to be relocated by the cutover migration.
CREATE TABLE kai.review_queue_items (
  review_queue_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  engagement_id uuid,
  queue_type text NOT NULL CHECK (queue_type = ANY (ARRAY[
    'intake_file_review', 'source_candidate_review', 'sensitivity_review',
    'data_dictionary_review', 'evidence_review', 'claim_review', 'client_followup',
    'conflict_resolution', 'generated_content_review', 'export_review'
  ])),
  target_object_type text NOT NULL,
  target_object_id uuid NOT NULL,
  priority text NOT NULL DEFAULT 'medium',
  queue_status text NOT NULL DEFAULT 'open' CHECK (queue_status = ANY (ARRAY[
    'open', 'in_progress', 'blocked', 'waiting_on_client', 'waiting_on_gk', 'resolved', 'cancelled'
  ])),
  review_status text NOT NULL DEFAULT 'needs_gk_review',
  assigned_to uuid,
  due_at timestamptz,
  last_action_at timestamptz,
  blocked_reason text,
  summary text NOT NULL CHECK (summary <> ''),
  required_action text,
  queue_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'system',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

-- One synthetic legacy candidate row, simulating an existing production row
-- created by the pre-Sprint2 legacy generation. A clearly-synthetic identity -
-- no repository or production evidence ties any specific real UUID to this
-- fixture, so none is claimed here.
INSERT INTO kai.intake_source_candidates (
  intake_source_candidate_id, intake_file_id, organization_id,
  proposed_display_name, proposed_source_type, processing_status, review_status,
  created_by, created_by_type, created_at
) VALUES (
  '9f1e0000-0000-4000-8000-00000000c0c0',
  '20000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'Legacy synthetic candidate (pre-Sprint2 generation)',
  'legacy_unspecified',
  'needs_gk_review',
  'needs_gk_review',
  NULL,
  'system',
  '2026-01-15T00:00:00Z'
);

COMMIT;
