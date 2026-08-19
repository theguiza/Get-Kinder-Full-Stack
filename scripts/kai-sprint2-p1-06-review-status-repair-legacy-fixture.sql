-- Test-only synthetic fixture: reproduces, for kai.review_queue_items alone,
-- the exact incompatible starting contract the owner's pgAdmin inspection
-- diagnosed on 2026-08-17 - review_status is kai.review_status_enum-backed,
-- NOT NULL, default 'needs_gk_review'::kai.review_status_enum, and the shared
-- enum lacks a 'resolved' label. The enum vocabulary and the review_status-
-- inclusive composite index mirror the production capture already recorded
-- in scripts/kai-sprint2-legacy-cutover-legacy-shape-seed.sql (its
-- kai.review_status_enum definition and its idx_review_queue_items_org_status
-- index). kai.priority_enum is included, unmodified by the repair, as the
-- fixture's representative unrelated enum-backed column.
--
-- Never applied to any real database - loopback-only, ephemeral, self-
-- destroying PostgreSQL instances only (see
-- kai-sprint2-p1-06-review-status-repair-local-postgres.js).

CREATE SCHEMA kai;

CREATE TYPE kai.review_status_enum AS ENUM (
  'proposed', 'needs_gk_review', 'approved_internal', 'approved_funder',
  'approved_public', 'export_ready', 'exported', 'rejected'
);

CREATE TYPE kai.priority_enum AS ENUM (
  'mandatory', 'immediate_fix', 'high', 'medium', 'low', 'backlog', 'not_applicable', 'unknown'
);

CREATE TABLE kai.review_queue_items (
  review_queue_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  engagement_id uuid,
  queue_type text NOT NULL,
  target_object_type text NOT NULL,
  target_object_id uuid NOT NULL,
  priority kai.priority_enum NOT NULL DEFAULT 'medium',
  queue_status text NOT NULL DEFAULT 'open',
  review_status kai.review_status_enum NOT NULL DEFAULT 'needs_gk_review',
  blocked_reason text,
  assigned_to uuid,
  due_at timestamptz,
  summary text NOT NULL,
  required_action text,
  queue_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT review_queue_items_p1_06_queue_type_check
    CHECK (queue_type IN (
      'intake_file_review', 'source_candidate_review', 'sensitivity_review',
      'data_dictionary_review', 'evidence_review', 'claim_review', 'client_followup',
      'conflict_resolution', 'generated_content_review', 'export_review'
    )),
  CONSTRAINT review_queue_items_p1_06_queue_status_check
    CHECK (queue_status IN (
      'open', 'in_progress', 'blocked', 'waiting_on_client', 'waiting_on_gk', 'resolved', 'cancelled'
    ))
);

CREATE UNIQUE INDEX ux_review_queue_items_p1_06_sensitivity_review_identity
  ON kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id)
  WHERE queue_type = 'sensitivity_review';

CREATE INDEX ix_review_queue_items_p1_06_tenant_queue
  ON kai.review_queue_items (organization_id, queue_type, queue_status);

-- Representative index dependency involving review_status, mirroring the
-- production-captured idx_review_queue_items_org_status.
CREATE INDEX idx_review_queue_items_org_status
  ON kai.review_queue_items (organization_id, queue_status, priority, review_status);

-- Unrelated consumer of the shared kai.review_status_enum, separate from
-- kai.review_queue_items.review_status: this repair must not disturb
-- another table's use of the same enum type. kai.priority_enum (below, via
-- review_queue_items.priority) is a different type and does not substitute
-- for this proof.
CREATE TABLE kai.unrelated_review_status_enum_consumer (
  unrelated_review_status_enum_consumer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_status kai.review_status_enum NOT NULL DEFAULT 'needs_gk_review'
);

-- Representative pre-existing needs_gk_review row, queued for the P1-08
-- source-promotion resolve path (queue_status = 'waiting_on_client').
INSERT INTO kai.review_queue_items (
  review_queue_item_id, organization_id, queue_type, target_object_type, target_object_id,
  queue_status, review_status, summary
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  'source_candidate_review',
  'intake_source_candidate',
  '33333333-3333-3333-3333-333333333333',
  'waiting_on_client',
  'needs_gk_review',
  'synthetic legacy fixture row for the P1-06 review_status repair proof'
);
