DROP TABLE IF EXISTS p14_08a_results;
CREATE TEMP TABLE p14_08a_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p14_08a_results
SELECT 'grant_response_packet_export_manifests_table_present',
       CASE WHEN to_regclass('kai.grant_response_packet_export_manifests') IS NOT NULL
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.grant_response_packet_export_manifests exists';

INSERT INTO p14_08a_results
SELECT 'id_org_unique_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grppem_p14_08a_id_org_unique'
                 AND conrelid = 'kai.grant_response_packet_export_manifests'::regclass
                 AND contype = 'u'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'UNIQUE (grant_response_packet_export_manifest_id, organization_id) is present';

INSERT INTO p14_08a_results
SELECT 'replay_convergence_unique_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grppem_p14_08a_replay_convergence_unique'
                 AND conrelid = 'kai.grant_response_packet_export_manifests'::regclass
                 AND contype = 'u'
                 AND pg_get_constraintdef(oid) LIKE '%UNIQUE (organization_id, grant_response_packet_export_candidate_id, canonical_fingerprint)%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the same effective-authority state submitted twice for the same packet candidate converges to exactly one manifest row';

INSERT INTO p14_08a_results
SELECT 'candidate_fk_is_tenant_safe_composite_into_p14_03_table',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'grppem_p14_08a_candidate_fk'
                 AND c.conrelid = 'kai.grant_response_packet_export_manifests'::regclass
                 AND c.contype = 'f'
                 AND c.confrelid = 'kai.grant_response_packet_export_candidates'::regclass
                 AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (grant_response_packet_export_candidate_id, organization_id)%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the candidate FK is a tenant-safe composite FK into kai.grant_response_packet_export_candidates (P14-03), never kai.export_candidates';

INSERT INTO p14_08a_results
SELECT 'authority_decision_fk_is_tenant_and_candidate_safe_into_p14_07b1_table',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'grppem_p14_08a_authority_decision_fk'
                 AND c.conrelid = 'kai.grant_response_packet_export_manifests'::regclass
                 AND c.contype = 'f'
                 AND c.confrelid = 'kai.grant_response_packet_human_authority_decisions'::regclass
                 AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (effective_authority_decision_id, organization_id, grant_response_packet_export_candidate_id, effective_authority_decision_type)%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the authority-decision FK is a tenant/candidate-safe composite FK into kai.grant_response_packet_human_authority_decisions (P14-07B1), never kai.human_authority_decisions';

INSERT INTO p14_08a_results
SELECT 'decision_type_pinned_to_export_authority_granted',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grppem_p14_08a_decision_type_check'
                 AND conrelid = 'kai.grant_response_packet_export_manifests'::regclass
                 AND contype = 'c'
                 AND pg_get_constraintdef(oid) = 'CHECK ((effective_authority_decision_type = ''export_authority_granted''::text))'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'no packet_approved/packet_funder_ready/packet_finalized vocabulary - only export_authority_granted exists';

INSERT INTO p14_08a_results
SELECT 'fingerprint_contract_version_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grppem_p14_08a_fingerprint_contract_version_check'
                 AND conrelid = 'kai.grant_response_packet_export_manifests'::regclass
                 AND contype = 'c'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'fingerprint_contract_version is pinned to the exact P14-08A version string';

INSERT INTO p14_08a_results
SELECT 'canonical_fingerprint_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grppem_p14_08a_canonical_fingerprint_check'
                 AND conrelid = 'kai.grant_response_packet_export_manifests'::regclass
                 AND contype = 'c'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'canonical_fingerprint is checked as a 64-hex-char sha256 digest';

INSERT INTO p14_08a_results
SELECT 'created_by_type_pinned_to_human',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grppem_p14_08a_created_by_type_check'
                 AND conrelid = 'kai.grant_response_packet_export_manifests'::regclass
                 AND contype = 'c'
                 AND pg_get_constraintdef(oid) = 'CHECK ((created_by_type = ''human''::text))'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'no assistant/system actor can ever create a manifest row here';

INSERT INTO p14_08a_results
SELECT 'append_only_trigger_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_trigger
               WHERE tgname = 'trg_p14_08a_grppem_append_only'
                 AND tgrelid = 'kai.grant_response_packet_export_manifests'::regclass
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the append-only BEFORE UPDATE OR DELETE trigger is present';

INSERT INTO p14_08a_results
SELECT 'no_requested_audience_column',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai' AND table_name = 'grant_response_packet_export_manifests'
                 AND column_name = 'requested_audience'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'no requested_audience column - a Grant Response Packet audience is always exactly funder';

INSERT INTO p14_08a_results
SELECT 'no_export_review_queue_item_column',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai' AND table_name = 'grant_response_packet_export_manifests'
                 AND column_name = 'export_review_queue_item_id'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'no export_review_queue_item_id column - no packet-level review-queue-item binding concept exists here';

INSERT INTO p14_08a_results
SELECT 'export_manifests_p3_19_unaltered',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'export_manifests_p3_19_candidate_fk'
                 AND conrelid = 'kai.export_manifests'::regclass
                 AND confrelid = 'kai.export_candidates'::regclass
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the existing P3-19 kai.export_manifests -> kai.export_candidates FK is completely unchanged';

SELECT * FROM p14_08a_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_08a_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-08A grant-response-packet-export-manifest-foundation verifier failed';
  END IF;
END $$;
