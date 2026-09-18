-- KAI P13-EXT-5 grant_response_paragraph content-type evolution smoke seed.
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
-- grant_response_paragraph (requested_audience 'internal', proving this
-- content type reuses the shared, unrestricted {internal, funder, public}
-- audience shape exactly like annual_report_section - unlike
-- funder_outcome_table's own funder-only audience gate), plus the
-- limitation_snapshots row and export_candidates row required to exercise
-- grant_response_paragraph through the P3-16 export-candidate foundation,
-- mirroring
-- scripts/kai-sprint2-p13-ext4-funder-outcome-table-content-type-evolution-smoke-seed.sql's
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
  '13ef0000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000001',
  'p13-ext5-smoke-grant-response-paragraph',
  repeat('7', 64),
  'grant_response_paragraph',
  'internal',
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
  '13ef0000-0000-4000-8000-000000000203',
  '13ef0000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000001',
  'grant_response_paragraph',
  'internal',
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
  '13ef0000-0000-4000-8000-000000000303',
  '00000000-0000-4000-8000-000000000001',
  '13ef0000-0000-4000-8000-000000000203',
  '90000000-0000-4000-8000-000000000001',
  'gk_admin',
  repeat('c', 64),
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
  '13ef0000-0000-4000-8000-000000000403',
  '00000000-0000-4000-8000-000000000001',
  '13ef0000-0000-4000-8000-000000000203',
  'grant_response_paragraph',
  'internal',
  '13ef0000-0000-4000-8000-000000000303',
  'kai-sprint2-p3-16-export-candidate-fingerprint-v1',
  repeat('d', 64),
  '90000000-0000-4000-8000-000000000001',
  'human'
);

COMMIT;
