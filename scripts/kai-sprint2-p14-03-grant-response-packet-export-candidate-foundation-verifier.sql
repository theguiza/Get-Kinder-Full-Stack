DROP TABLE IF EXISTS p14_03_results;
CREATE TEMP TABLE p14_03_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p14_03_results
SELECT 'grant_response_packet_export_candidates_table_present',
       CASE WHEN to_regclass('kai.grant_response_packet_export_candidates') IS NOT NULL
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.grant_response_packet_export_candidates exists';

INSERT INTO p14_03_results
SELECT 'grant_response_packet_export_candidate_members_table_present',
       CASE WHEN to_regclass('kai.grant_response_packet_export_candidate_members') IS NOT NULL
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.grant_response_packet_export_candidate_members exists';

INSERT INTO p14_03_results
SELECT 'candidate_id_org_unique_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grant_response_packet_export_candidates_p14_03_id_org_unique'
                 AND conrelid = 'kai.grant_response_packet_export_candidates'::regclass
                 AND contype = 'u'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'UNIQUE (grant_response_packet_export_candidate_id, organization_id) is present';

INSERT INTO p14_03_results
SELECT 'candidate_identity_fk_is_tenant_safe_composite',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'grant_response_packet_export_candidates_p14_03_identity_fk'
                 AND c.conrelid = 'kai.grant_response_packet_export_candidates'::regclass
                 AND c.contype = 'f'
                 AND c.confrelid = 'kai.grant_response_packet_export_identities'::regclass
                 AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (grant_response_packet_export_identity_id, organization_id)%'
                 AND pg_get_constraintdef(c.oid) LIKE '%REFERENCES kai.grant_response_packet_export_identities(grant_response_packet_export_identity_id, organization_id)%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the candidate FK is a composite (grant_response_packet_export_identity_id, organization_id) FK into the existing P14-02 identity table - packet structural identity is reused, never re-minted';

INSERT INTO p14_03_results
SELECT 'candidate_fingerprint_contract_version_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grant_response_packet_export_candidates_p14_03_fp_contract_chk'
                 AND conrelid = 'kai.grant_response_packet_export_candidates'::regclass
                 AND contype = 'c'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'fingerprint_contract_version is pinned to the single P14-03 fingerprint contract';

INSERT INTO p14_03_results
SELECT 'candidate_fingerprint_format_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grant_response_packet_export_candidates_p14_03_fp_check'
                 AND conrelid = 'kai.grant_response_packet_export_candidates'::regclass
                 AND contype = 'c'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'canonical_fingerprint is checked to a lower-case SHA-256 hex string';

INSERT INTO p14_03_results
SELECT 'candidate_convergence_unique_present',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'grant_response_packet_export_candidates_p14_03_converge_unq'
                 AND c.conrelid = 'kai.grant_response_packet_export_candidates'::regclass
                 AND c.contype = 'u'
                 AND pg_get_constraintdef(c.oid) = 'UNIQUE (organization_id, grant_response_packet_export_identity_id, canonical_fingerprint)'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'UNIQUE (organization_id, grant_response_packet_export_identity_id, canonical_fingerprint) is the replay-convergence key - identical semantic state always converges to one row';

INSERT INTO p14_03_results
SELECT 'candidate_append_only_trigger_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_trigger
               WHERE tgname = 'trg_p14_03_grant_response_packet_export_candidates_append_only'
                 AND tgrelid = 'kai.grant_response_packet_export_candidates'::regclass
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the append-only BEFORE UPDATE OR DELETE trigger is present on the candidate table';

INSERT INTO p14_03_results
SELECT 'member_id_org_unique_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grppec_members_p14_03_id_org_unique'
                 AND conrelid = 'kai.grant_response_packet_export_candidate_members'::regclass
                 AND contype = 'u'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'UNIQUE (grant_response_packet_export_candidate_member_id, organization_id) is present';

INSERT INTO p14_03_results
SELECT 'member_candidate_fk_is_tenant_safe_composite',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'grppec_members_p14_03_candidate_fk'
                 AND c.conrelid = 'kai.grant_response_packet_export_candidate_members'::regclass
                 AND c.contype = 'f'
                 AND c.confrelid = 'kai.grant_response_packet_export_candidates'::regclass
                 AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (grant_response_packet_export_candidate_id, organization_id)%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the member FK into the candidate table is a tenant-safe composite FK';

INSERT INTO p14_03_results
SELECT 'member_draft_fk_is_tenant_safe_composite',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'grppec_members_p14_03_draft_fk'
                 AND c.conrelid = 'kai.grant_response_packet_export_candidate_members'::regclass
                 AND c.contype = 'f'
                 AND c.confrelid = 'kai.generated_content_drafts'::regclass
                 AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (generated_content_draft_id, organization_id)%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the member FK into kai.generated_content_drafts is a tenant-safe composite FK - membership can never cross tenant';

INSERT INTO p14_03_results
SELECT 'member_draft_unique_present',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'grppec_members_p14_03_draft_unique'
                 AND c.conrelid = 'kai.grant_response_packet_export_candidate_members'::regclass
                 AND c.contype = 'u'
                 AND pg_get_constraintdef(c.oid) = 'UNIQUE (grant_response_packet_export_candidate_id, generated_content_draft_id)'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'a draft is a member of a given candidate at most once';

INSERT INTO p14_03_results
SELECT 'member_ordinal_unique_present',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'grppec_members_p14_03_ordinal_unique'
                 AND c.conrelid = 'kai.grant_response_packet_export_candidate_members'::regclass
                 AND c.contype = 'u'
                 AND pg_get_constraintdef(c.oid) = 'UNIQUE (grant_response_packet_export_candidate_id, ordinal)'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'ordinal position within a candidate is unique - the render model order is preserved exactly';

INSERT INTO p14_03_results
SELECT 'member_append_only_trigger_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_trigger
               WHERE tgname = 'trg_p14_03_grppec_members_append_only'
                 AND tgrelid = 'kai.grant_response_packet_export_candidate_members'::regclass
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the append-only BEFORE UPDATE OR DELETE trigger is present on the member table';

INSERT INTO p14_03_results
SELECT 'no_export_manifest_or_export_candidate_column_on_member_table',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai' AND table_name = 'grant_response_packet_export_candidate_members'
                 AND column_name IN ('export_candidate_id', 'export_manifest_id')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'no member exportCandidateId/exportManifestId column exists on the member snapshot table';

INSERT INTO p14_03_results
SELECT 'export_candidates_and_manifests_not_altered',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conrelid IN (
                       SELECT oid FROM (
                         SELECT to_regclass('kai.export_candidates') AS oid
                         UNION ALL SELECT to_regclass('kai.export_manifests')
                       ) present WHERE oid IS NOT NULL
                     )
                 AND c.conname LIKE 'p14_03%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.export_candidates and kai.export_manifests (where present) carry no P14-03-owned constraint';

SELECT * FROM p14_03_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_03_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-03 grant-response-packet-export-candidate-foundation verifier failed';
  END IF;
END $$;
