DROP TABLE IF EXISTS p3_19_results;
DROP TABLE IF EXISTS p3_19_expected_checks;

CREATE TEMP TABLE p3_19_expected_checks (
  check_name text PRIMARY KEY
);

INSERT INTO p3_19_expected_checks (check_name)
VALUES
  ('export_manifests_table_present'),
  ('candidate_fk_present'),
  ('authority_decision_fk_present'),
  ('decision_type_check_present'),
  ('fingerprint_contract_version_check_present'),
  ('canonical_fingerprint_check_present'),
  ('created_by_type_check_present'),
  ('replay_convergence_unique_present'),
  ('append_only_trigger_present'),
  ('no_requested_audience_or_draft_id_column'),
  ('no_artifact_or_storage_columns'),
  ('generated_content_draft_status_locked_column_unchanged'),
  ('upload_lifecycle_audit_operation_allowlist_unchanged');

CREATE TEMP TABLE p3_19_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p3_19_results
SELECT 'export_manifests_table_present',
       CASE WHEN to_regclass('kai.export_manifests') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
       'kai.export_manifests exists - this supersedes P3-16''s/P3-17''s own verifier assertions that no such table existed yet (this package''s verifier is run instead of theirs by the P3-19 runner, exactly as prior superseded verifiers are excluded)';

INSERT INTO p3_19_results
SELECT 'candidate_fk_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conname = 'export_manifests_p3_19_candidate_fk'
                 AND pg_get_constraintdef(c.oid) LIKE '%export_candidates%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'every manifest binds to exactly one existing (organization, export_candidate) row';

INSERT INTO p3_19_results
SELECT 'authority_decision_fk_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conname = 'export_manifests_p3_19_authority_decision_fk'
                 AND pg_get_constraintdef(c.oid) LIKE '%human_authority_decisions%'
                 AND pg_get_constraintdef(c.oid) LIKE '%export_candidate_id%'
                 AND pg_get_constraintdef(c.oid) LIKE '%effective_authority_decision_type%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'every manifest binds to exactly one existing (organization, export_candidate, decision_type) human-authority-decision row - lineage cannot cross tenant, candidate, or decision type';

INSERT INTO p3_19_results
SELECT 'decision_type_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conname = 'export_manifests_p3_19_decision_type_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%export_authority_granted%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'effective_authority_decision_type is constrained to exactly export_authority_granted';

INSERT INTO p3_19_results
SELECT 'fingerprint_contract_version_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conname = 'export_manifests_p3_19_fingerprint_contract_version_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%kai-sprint2-p3-19-export-manifest-fingerprint-v1%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'fingerprint_contract_version is pinned to the P3-19 contract literal';

INSERT INTO p3_19_results
SELECT 'canonical_fingerprint_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint WHERE conname = 'export_manifests_p3_19_canonical_fingerprint_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'canonical_fingerprint is constrained to a lowercase 64-hex sha256 digest';

INSERT INTO p3_19_results
SELECT 'created_by_type_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conname = 'export_manifests_p3_19_created_by_type_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%human%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'created_by_type is constrained to exactly human';

INSERT INTO p3_19_results
SELECT 'replay_convergence_unique_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conname = 'export_manifests_p3_19_replay_convergence_unique'
                 AND pg_get_constraintdef(c.oid) LIKE '%organization_id%'
                 AND pg_get_constraintdef(c.oid) LIKE '%export_candidate_id%'
                 AND pg_get_constraintdef(c.oid) LIKE '%canonical_fingerprint%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'replay of the same effective-authority state for the same candidate converges to exactly one manifest row';

INSERT INTO p3_19_results
SELECT 'append_only_trigger_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_trigger
               WHERE tgname = 'trg_p3_19_export_manifests_append_only'
                 AND tgrelid = 'kai.export_manifests'::regclass
                 AND NOT tgisinternal
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'ordinary UPDATE/DELETE of kai.export_manifests is rejected at the database boundary';

INSERT INTO p3_19_results
SELECT 'no_requested_audience_or_draft_id_column',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND table_name = 'export_manifests'
                 AND column_name IN ('requested_audience', 'generated_content_draft_id')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'audience and draft identity are derived via export_candidate_id, never duplicated on the manifest row';

INSERT INTO p3_19_results
SELECT 'no_artifact_or_storage_columns',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND table_name = 'export_manifests'
                 AND column_name IN ('manifest_bytes', 'storage_path', 'signed_url', 'download_url', 'rendered_at', 'artifact_id')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'no artifact/render/storage/download column exists on kai.export_manifests';

INSERT INTO p3_19_results
SELECT 'generated_content_draft_status_locked_column_unchanged',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint c
               JOIN pg_class r ON r.oid = c.conrelid
               JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'generated_content_drafts'
                 AND pg_get_constraintdef(c.oid) LIKE '%draft_status%draft%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.generated_content_drafts.draft_status remains schema-locked to ''draft'' - unchanged by this package';

INSERT INTO p3_19_results
SELECT 'upload_lifecycle_audit_operation_allowlist_unchanged',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM pg_constraint c
               JOIN pg_class r ON r.oid = c.conrelid
               JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%export_manifest_created%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P3-19 does not widen kai.upload_lifecycle_audit''s operation allowlist - export_manifest_created is an kai.audit_events action, never an upload_lifecycle_audit operation';

DO $$
DECLARE
  expected_count integer := 13;
BEGIN
  IF (SELECT COUNT(*) FROM p3_19_expected_checks) <> expected_count
     OR (SELECT COUNT(*) FROM p3_19_results) <> expected_count
     OR EXISTS (
          SELECT 1
            FROM p3_19_results r
           GROUP BY r.check_name
          HAVING COUNT(*) <> 1
        )
     OR EXISTS (
          SELECT 1
            FROM p3_19_expected_checks e
            LEFT JOIN p3_19_results r ON r.check_name = e.check_name
           WHERE r.check_name IS NULL
        )
     OR EXISTS (
          SELECT 1
            FROM p3_19_results r
            LEFT JOIN p3_19_expected_checks e ON e.check_name = r.check_name
           WHERE e.check_name IS NULL
        ) THEN
    RAISE EXCEPTION 'P3-19 export-manifest-foundation verifier result construction failed';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p3_19_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P3-19 export-manifest-foundation verifier failed';
  END IF;
END $$;

SELECT
  check_name,
  status,
  detail
FROM p3_19_results
ORDER BY check_name;
