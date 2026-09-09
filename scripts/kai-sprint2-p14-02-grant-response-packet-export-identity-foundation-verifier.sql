DROP TABLE IF EXISTS p14_02_results;
CREATE TEMP TABLE p14_02_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p14_02_results
SELECT 'grant_response_packet_export_identities_table_present',
       CASE WHEN to_regclass('kai.grant_response_packet_export_identities') IS NOT NULL
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.grant_response_packet_export_identities exists';

INSERT INTO p14_02_results
SELECT 'id_org_unique_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grant_response_packet_export_identities_p14_02_id_org_unique'
                 AND conrelid = 'kai.grant_response_packet_export_identities'::regclass
                 AND contype = 'u'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'UNIQUE (grant_response_packet_export_identity_id, organization_id) is present, following the repository tenant-safe-FK-target convention';

INSERT INTO p14_02_results
SELECT 'engagement_fk_is_tenant_safe_composite',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'grant_response_packet_export_identities_p14_02_engagement_fk'
                 AND c.conrelid = 'kai.grant_response_packet_export_identities'::regclass
                 AND c.contype = 'f'
                 AND c.confrelid = 'kai.engagements'::regclass
                 AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (engagement_id, organization_id)%'
                 AND pg_get_constraintdef(c.oid) LIKE '%REFERENCES kai.engagements(engagement_id, organization_id)%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the engagement FK is a composite (engagement_id, organization_id) FK into kai.engagements, preventing cross-tenant attachment';

INSERT INTO p14_02_results
SELECT 'audience_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grant_response_packet_export_identities_p14_02_audience_check'
                 AND conrelid = 'kai.grant_response_packet_export_identities'::regclass
                 AND contype = 'c'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'packet_audience is checked to the single existing supported value (funder)';

INSERT INTO p14_02_results
SELECT 'created_by_type_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grant_response_packet_export_identities_p14_02_created_by_chk'
                 AND conrelid = 'kai.grant_response_packet_export_identities'::regclass
                 AND contype = 'c'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'created_by_type is checked to human/system';

INSERT INTO p14_02_results
SELECT 'identity_replay_convergence_unique_present',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'grant_response_packet_export_identities_p14_02_identity_unique'
                 AND c.conrelid = 'kai.grant_response_packet_export_identities'::regclass
                 AND c.contype = 'u'
                 AND pg_get_constraintdef(c.oid) = 'UNIQUE (organization_id, engagement_id, packet_audience)'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'UNIQUE (organization_id, engagement_id, packet_audience) is the durable composite identity key - the same triple always converges to one row';

INSERT INTO p14_02_results
SELECT 'append_only_trigger_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_trigger
               WHERE tgname = 'trg_p14_02_grant_response_packet_export_identities_append_only'
                 AND tgrelid = 'kai.grant_response_packet_export_identities'::regclass
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the append-only BEFORE UPDATE OR DELETE trigger is present, mirroring the P3-19 export-manifest immutability convention';

INSERT INTO p14_02_results
SELECT 'no_export_candidate_or_manifest_column',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai' AND table_name = 'grant_response_packet_export_identities'
                 AND column_name IN ('export_candidate_id', 'export_manifest_id')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'no member exportCandidateId/exportManifestId column exists on this table - packet identity is independent of per-member export identity';

INSERT INTO p14_02_results
SELECT 'export_candidates_and_manifests_not_altered',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conrelid IN (
                       SELECT oid FROM (
                         SELECT to_regclass('kai.export_candidates') AS oid
                         UNION ALL SELECT to_regclass('kai.export_manifests')
                       ) present WHERE oid IS NOT NULL
                     )
                 AND c.conname LIKE 'p14_02%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.export_candidates and kai.export_manifests (where present) carry no P14-02-owned constraint (neither table is altered by this migration)';

SELECT * FROM p14_02_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_02_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-02 grant-response-packet-export-identity-foundation verifier failed';
  END IF;
END $$;
