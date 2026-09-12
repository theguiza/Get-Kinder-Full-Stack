DROP TABLE IF EXISTS brcem_results;
CREATE TEMP TABLE brcem_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO brcem_results
SELECT 'board_reporting_candidate_export_manifests_table_present',
       CASE WHEN to_regclass('kai.board_reporting_candidate_export_manifests') IS NOT NULL
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.board_reporting_candidate_export_manifests exists';

INSERT INTO brcem_results
SELECT 'id_org_unique_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'brcem_id_org_unique'
                 AND conrelid = 'kai.board_reporting_candidate_export_manifests'::regclass
                 AND contype = 'u'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'UNIQUE (board_reporting_candidate_export_manifest_id, organization_id) is present';

INSERT INTO brcem_results
SELECT 'replay_convergence_unique_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'brcem_replay_convergence_unique'
                 AND conrelid = 'kai.board_reporting_candidate_export_manifests'::regclass
                 AND contype = 'u'
                 AND pg_get_constraintdef(oid) LIKE '%UNIQUE (organization_id, board_reporting_candidate_id, canonical_fingerprint)%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'UNIQUE (organization_id, board_reporting_candidate_id, canonical_fingerprint) replay-convergence key is present';

INSERT INTO brcem_results
SELECT 'candidate_fk_is_tenant_safe_composite_into_br_02_table',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'brcem_candidate_fk'
                 AND c.conrelid = 'kai.board_reporting_candidate_export_manifests'::regclass
                 AND c.contype = 'f'
                 AND c.confrelid = 'kai.board_reporting_candidates'::regclass
                 AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (board_reporting_candidate_id, organization_id)%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the candidate FK is a tenant-safe composite FK into kai.board_reporting_candidates (BR-02), never kai.export_candidates or kai.grant_response_packet_export_candidates';

INSERT INTO brcem_results
SELECT 'authority_decision_fk_pins_org_candidate_and_type_into_br_04_table',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'brcem_authority_decision_fk'
                 AND c.conrelid = 'kai.board_reporting_candidate_export_manifests'::regclass
                 AND c.contype = 'f'
                 AND c.confrelid = 'kai.board_reporting_candidate_human_authority_decisions'::regclass
                 AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (effective_authority_decision_id, organization_id, board_reporting_candidate_id, effective_authority_decision_type)%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the authority decision FK is a tenant-safe composite FK into kai.board_reporting_candidate_human_authority_decisions (BR-04), pinned to organization/candidate/decision-type together';

INSERT INTO brcem_results
SELECT 'decision_type_pinned_to_export_authority_granted',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'brcem_decision_type_check'
                 AND conrelid = 'kai.board_reporting_candidate_export_manifests'::regclass
                 AND contype = 'c'
                 AND pg_get_constraintdef(oid) = 'CHECK ((effective_authority_decision_type = ''export_authority_granted''::text))'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'no board_approved/board_release/board_finalized vocabulary - only export_authority_granted exists';

INSERT INTO brcem_results
SELECT 'fingerprint_contract_version_pinned',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'brcem_fingerprint_contract_version_check'
                 AND conrelid = 'kai.board_reporting_candidate_export_manifests'::regclass
                 AND contype = 'c'
                 AND pg_get_constraintdef(oid) = 'CHECK ((fingerprint_contract_version = ''kai-sprint2-board-reporting-candidate-export-manifest-fingerprint-v1''::text))'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'fingerprint_contract_version is pinned to exactly one contract label';

INSERT INTO brcem_results
SELECT 'canonical_fingerprint_shape_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'brcem_canonical_fingerprint_check'
                 AND conrelid = 'kai.board_reporting_candidate_export_manifests'::regclass
                 AND contype = 'c'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'canonical_fingerprint is checked to be a lowercase 64-hex-char string';

INSERT INTO brcem_results
SELECT 'created_by_type_pinned_to_human',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'brcem_created_by_type_check'
                 AND conrelid = 'kai.board_reporting_candidate_export_manifests'::regclass
                 AND contype = 'c'
                 AND pg_get_constraintdef(oid) = 'CHECK ((created_by_type = ''human''::text))'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'no assistant/system actor can ever create a manifest row here';

INSERT INTO brcem_results
SELECT 'append_only_trigger_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_trigger
               WHERE tgname = 'trg_brcem_append_only'
                 AND tgrelid = 'kai.board_reporting_candidate_export_manifests'::regclass
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the append-only BEFORE UPDATE OR DELETE trigger is present';

INSERT INTO brcem_results
SELECT 'no_review_queue_item_or_audience_or_eligibility_snapshot_column',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai' AND table_name = 'board_reporting_candidate_export_manifests'
                 AND column_name IN (
                   'export_review_queue_item_id', 'board_reporting_candidate_review_queue_item_id',
                   'packet_audience', 'requested_audience',
                   'final_export_eligible', 'final_eligibility_snapshot', 'board_final_eligibility'
                 )
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'no review-queue-item binding, audience, or final-eligibility-snapshot column exists on this foundation-stage table';

INSERT INTO brcem_results
SELECT 'export_manifests_p3_19_unaltered',
       CASE WHEN to_regclass('kai.export_manifests') IS NULL
            THEN 'PASS'
            WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'export_manifests_p3_19_candidate_fk'
                 AND conrelid = to_regclass('kai.export_manifests')
                 AND confrelid = to_regclass('kai.export_candidates')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the existing P3-19 kai.export_manifests -> kai.export_candidates FK is completely unchanged if that package happens to be installed in this target';

INSERT INTO brcem_results
SELECT 'grant_response_packet_export_manifests_p14_08a_unaltered',
       CASE WHEN to_regclass('kai.grant_response_packet_export_manifests') IS NULL
            THEN 'PASS'
            WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grppem_p14_08a_candidate_fk'
                 AND conrelid = to_regclass('kai.grant_response_packet_export_manifests')
                 AND confrelid = to_regclass('kai.grant_response_packet_export_candidates')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the existing P14-08A kai.grant_response_packet_export_manifests -> kai.grant_response_packet_export_candidates FK is completely unchanged if that package happens to be installed in this target';

SELECT * FROM brcem_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM brcem_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'board-reporting-candidate-export-manifest-foundation verifier failed';
  END IF;
END $$;
