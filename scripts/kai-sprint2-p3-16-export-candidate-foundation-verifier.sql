DROP TABLE IF EXISTS p3_16_results;
CREATE TEMP TABLE p3_16_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p3_16_results
SELECT 'limitation_snapshots_table_present',
       CASE WHEN to_regclass('kai.limitation_snapshots') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
       'kai.limitation_snapshots exists';

INSERT INTO p3_16_results
SELECT 'limitation_snapshot_entries_table_present',
       CASE WHEN to_regclass('kai.limitation_snapshot_entries') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
       'kai.limitation_snapshot_entries exists';

INSERT INTO p3_16_results
SELECT 'export_candidates_table_present',
       CASE WHEN to_regclass('kai.export_candidates') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
       'kai.export_candidates exists';

INSERT INTO p3_16_results
SELECT 'current_snapshot_per_draft_unique_index_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_indexes
               WHERE schemaname = 'kai'
                 AND indexname = 'ux_limitation_snapshots_p3_16_current_per_draft'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'at most one non-superseded snapshot per (organization_id, generated_content_draft_id)';

INSERT INTO p3_16_results
SELECT 'limitation_snapshot_entries_identity_unique_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'limitation_snapshot_entries_p3_16_identity_unique'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'exactly one entry per (limitation_snapshot_id, claim_id, evidence_item_id)';

INSERT INTO p3_16_results
SELECT 'limitation_snapshot_entries_codes_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'limitation_snapshot_entries_p3_16_codes_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'limitation_codes are constrained to the accepted syntax and deduplicated';

INSERT INTO p3_16_results
SELECT 'export_candidates_replay_convergence_unique_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'export_candidates_p3_16_replay_convergence_unique'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'identical (organization_id, generated_content_draft_id, requested_audience, canonical_fingerprint) converges to one row';

INSERT INTO p3_16_results
SELECT 'export_candidates_fingerprint_contract_pinned',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conname = 'export_candidates_p3_16_fingerprint_contract_version_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%kai-sprint2-p3-16-export-candidate-fingerprint-v1%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'export candidates are pinned to exactly one fingerprint contract version';

INSERT INTO p3_16_results
SELECT 'export_candidates_does_not_reuse_generation_runs_fingerprint_column',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND table_name = 'export_candidates'
                 AND column_name = 'request_fingerprint'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'export_candidates does not reuse generation_runs.request_fingerprint';

INSERT INTO p3_16_results
SELECT 'audit_operations_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%limitation_snapshot_confirmed%'
                 AND pg_get_constraintdef(c.oid) LIKE '%export_candidate_created%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'metadata-only audit operation vocabulary includes both P3-16 operations';

INSERT INTO p3_16_results
SELECT 'limitation_snapshot_audit_metadata_safe_contract',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'upload_lifecycle_audit_p3_16_limitation_snapshot_metadata_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'limitation_snapshot_confirmed audit metadata is constrained to identifiers, actor/role, counts, and fingerprint';

INSERT INTO p3_16_results
SELECT 'export_candidate_audit_metadata_safe_contract',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'upload_lifecycle_audit_p3_16_export_candidate_metadata_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'export_candidate_created audit metadata is constrained to identifiers, actor, counts, and fingerprint';

INSERT INTO p3_16_results
SELECT 'audit_metadata_forbids_content_and_authority_keys',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conname = 'upload_lifecycle_audit_p3_16_export_candidate_metadata_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%draft_text%'
                 AND pg_get_constraintdef(c.oid) LIKE '%approval%'
                 AND pg_get_constraintdef(c.oid) LIKE '%export_authority%'
                 AND pg_get_constraintdef(c.oid) LIKE '%final_export_gate%'
                 AND pg_get_constraintdef(c.oid) LIKE '%limitation_codes%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P3-16 audit metadata contracts explicitly forbid raw content, limitation codes, and export-authority/final-gate keys';

INSERT INTO p3_16_results
SELECT 'no_export_authority_or_final_gate_state',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND column_name IN ('export_authority', 'final_export_gate', 'approved_at', 'finalized_at', 'exported_at', 'export_eligible', 'affirmative_human_export_authority')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P3-16 introduces no export-authority, final-gate, or finalize/export state anywhere in kai schema';

INSERT INTO p3_16_results
SELECT 'draft_status_review_status_columns_unchanged',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'generated_content_drafts_p3_01_draft_status_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'generated_content_drafts.draft_status remains pinned to draft by its original P3-01 constraint';

INSERT INTO p3_16_results
SELECT 'no_client_reviewed_or_finalize_export_tables',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'kai'
                 AND table_name IN ('client_reviewed', 'funder_ready', 'public_ready', 'export_authority_grants', 'export_manifests', 'export_events')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P3-16 creates no client_reviewed/funder_ready/public_ready/export_authority_granted/manifest/final-export artifact or event tables';

SELECT * FROM p3_16_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p3_16_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P3-16 export-candidate-foundation verifier failed';
  END IF;
END $$;
