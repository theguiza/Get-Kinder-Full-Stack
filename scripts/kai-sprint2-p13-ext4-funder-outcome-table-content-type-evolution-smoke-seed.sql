-- KAI P13-EXT-4 funder_outcome_table content-type evolution smoke seed.
--
-- NOT YET RUN. Synthetic data only - authored to prove the seed shape is
-- correct, following the "authored but not executed" convention used for
-- this package's local-postgres verification pass (see runbook.md). This
-- file must only ever be run against an ephemeral/synthetic verification
-- database, never against a real client database, and it was not run in
-- this pass per the constraint against connecting to a live PostgreSQL
-- instance.
--
-- Seeds one synthetic generation_runs/generated_content_drafts pair for
-- funder_outcome_table (requested_audience 'funder', proving this content
-- type's funder-only audience gate, unlike annual_report_section's broader
-- internal/funder/public gate), plus the limitation_snapshots row and
-- export_candidates row required to exercise funder_outcome_table through
-- the P3-16 export-candidate foundation, mirroring
-- scripts/kai-sprint2-p13-ext3-annual-report-section-content-type-evolution-smoke-seed.sql's
-- shape and kai.export_candidates' real column set
-- (migrations/kai_sprint2_p3_16_export_candidate_foundation.sql).

BEGIN;

INSERT INTO kai.generation_runs (
  generation_run_id,
  organization_id,
  idempotency_key,
  request_fingerprint,
  content_type,
  requested_audience,
  created_by_type
)
VALUES (
  '13ef0000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000001',
  'p13-ext4-smoke-funder-outcome-table',
  repeat('6', 64),
  'funder_outcome_table',
  'funder',
  'system'
);

INSERT INTO kai.generated_content_drafts (
  generated_content_draft_id,
  generation_run_id,
  organization_id,
  content_type,
  requested_audience,
  draft_status,
  review_status,
  validator_results,
  created_by_type
)
VALUES (
  '13ef0000-0000-4000-8000-000000000202',
  '13ef0000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000001',
  'funder_outcome_table',
  'funder',
  'draft',
  'needs_gk_review',
  '[]'::jsonb,
  'system'
);

INSERT INTO kai.limitation_snapshots (
  limitation_snapshot_id,
  organization_id,
  generated_content_draft_id,
  confirmed_by,
  confirmed_by_role,
  entries_fingerprint,
  created_by_type
)
VALUES (
  '13ef0000-0000-4000-8000-000000000302',
  '00000000-0000-4000-8000-000000000001',
  '13ef0000-0000-4000-8000-000000000202',
  '90000000-0000-4000-8000-000000000001',
  'gk_admin',
  repeat('a', 64),
  'human'
);

INSERT INTO kai.export_candidates (
  export_candidate_id,
  organization_id,
  generated_content_draft_id,
  content_type,
  requested_audience,
  limitation_snapshot_id,
  fingerprint_contract_version,
  canonical_fingerprint,
  created_by,
  created_by_type
)
VALUES (
  '13ef0000-0000-4000-8000-000000000402',
  '00000000-0000-4000-8000-000000000001',
  '13ef0000-0000-4000-8000-000000000202',
  'funder_outcome_table',
  'funder',
  '13ef0000-0000-4000-8000-000000000302',
  'kai-sprint2-p3-16-export-candidate-fingerprint-v1',
  repeat('b', 64),
  '90000000-0000-4000-8000-000000000001',
  'human'
);

COMMIT;
