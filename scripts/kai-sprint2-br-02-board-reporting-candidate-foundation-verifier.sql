DROP TABLE IF EXISTS br_02_results;
CREATE TEMP TABLE br_02_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO br_02_results
SELECT 'board_reporting_candidates_table_present',
       CASE WHEN to_regclass('kai.board_reporting_candidates') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
       'kai.board_reporting_candidates exists';

INSERT INTO br_02_results
SELECT 'board_reporting_candidate_members_table_present',
       CASE WHEN to_regclass('kai.board_reporting_candidate_members') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
       'kai.board_reporting_candidate_members exists';

INSERT INTO br_02_results
SELECT 'candidate_id_org_unique_present',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conname = 'board_reporting_candidates_br_02_id_org_unique'
            AND conrelid = 'kai.board_reporting_candidates'::regclass
            AND contype = 'u'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'UNIQUE (board_reporting_candidate_id, organization_id) is present';

INSERT INTO br_02_results
SELECT 'candidate_engagement_fk_is_tenant_safe',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint c
          WHERE c.conname = 'board_reporting_candidates_br_02_engagement_fk'
            AND c.conrelid = 'kai.board_reporting_candidates'::regclass
            AND c.contype = 'f'
            AND c.confrelid = 'kai.engagements'::regclass
            AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (engagement_id, organization_id)%'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'candidate FK into engagements is scoped by organization_id';

INSERT INTO br_02_results
SELECT 'candidate_internal_audience_check_present',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conname = 'board_reporting_candidates_br_02_audience_chk'
            AND conrelid = 'kai.board_reporting_candidates'::regclass
            AND contype = 'c'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'packet_audience is pinned to internal';

INSERT INTO br_02_results
SELECT 'candidate_idempotency_unique_present',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint c
          WHERE c.conname = 'board_reporting_candidates_br_02_idempotency_unq'
            AND c.conrelid = 'kai.board_reporting_candidates'::regclass
            AND c.contype = 'u'
            AND pg_get_constraintdef(c.oid) = 'UNIQUE (organization_id, engagement_id, idempotency_key)'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'idempotent replay is scoped to organization, engagement, idempotency_key';

INSERT INTO br_02_results
SELECT 'candidate_fingerprint_contract_check_present',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conname = 'board_reporting_candidates_br_02_fp_contract_chk'
            AND conrelid = 'kai.board_reporting_candidates'::regclass
            AND contype = 'c'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'fingerprint contract version is pinned';

INSERT INTO br_02_results
SELECT 'candidate_fingerprint_format_check_present',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conname = 'board_reporting_candidates_br_02_fp_chk'
            AND conrelid = 'kai.board_reporting_candidates'::regclass
            AND contype = 'c'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'canonical_fingerprint is lower-case sha256 hex';

INSERT INTO br_02_results
SELECT 'candidate_append_only_trigger_present',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_trigger
          WHERE tgname = 'trg_br_02_board_reporting_candidates_append_only'
            AND tgrelid = 'kai.board_reporting_candidates'::regclass
       ) THEN 'PASS' ELSE 'FAIL' END,
       'candidate UPDATE/DELETE trigger is present';

INSERT INTO br_02_results
SELECT 'member_candidate_fk_is_tenant_safe',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint c
          WHERE c.conname = 'board_reporting_candidate_members_br_02_candidate_fk'
            AND c.conrelid = 'kai.board_reporting_candidate_members'::regclass
            AND c.contype = 'f'
            AND c.confrelid = 'kai.board_reporting_candidates'::regclass
            AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (board_reporting_candidate_id, organization_id)%'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'member FK into candidate is tenant-safe';

INSERT INTO br_02_results
SELECT 'member_draft_fk_is_tenant_safe',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint c
          WHERE c.conname = 'board_reporting_candidate_members_br_02_draft_fk'
            AND c.conrelid = 'kai.board_reporting_candidate_members'::regclass
            AND c.contype = 'f'
            AND c.confrelid = 'kai.generated_content_drafts'::regclass
            AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (generated_content_draft_id, organization_id)%'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'member FK into generated_content_drafts is tenant-safe';

INSERT INTO br_02_results
SELECT 'member_draft_unique_present',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint c
          WHERE c.conname = 'board_reporting_candidate_members_br_02_draft_unique'
            AND c.conrelid = 'kai.board_reporting_candidate_members'::regclass
            AND c.contype = 'u'
            AND pg_get_constraintdef(c.oid) = 'UNIQUE (board_reporting_candidate_id, generated_content_draft_id)'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'a draft appears at most once in a candidate snapshot';

INSERT INTO br_02_results
SELECT 'member_ordinal_unique_present',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint c
          WHERE c.conname = 'board_reporting_candidate_members_br_02_ordinal_unique'
            AND c.conrelid = 'kai.board_reporting_candidate_members'::regclass
            AND c.contype = 'u'
            AND pg_get_constraintdef(c.oid) = 'UNIQUE (board_reporting_candidate_id, ordinal)'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'ordinal is unique within a candidate snapshot';

INSERT INTO br_02_results
SELECT 'member_append_only_trigger_present',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_trigger
          WHERE tgname = 'trg_br_02_board_reporting_candidate_members_append_only'
            AND tgrelid = 'kai.board_reporting_candidate_members'::regclass
       ) THEN 'PASS' ELSE 'FAIL' END,
       'member UPDATE/DELETE trigger is present';

INSERT INTO br_02_results
SELECT 'supporting_indexes_present',
       CASE WHEN (
         SELECT count(*) FROM pg_indexes
          WHERE schemaname = 'kai'
            AND indexname IN (
              'ix_board_reporting_candidates_br_02_engagement_created',
              'ix_board_reporting_candidates_br_02_fingerprint',
              'ix_board_reporting_candidate_members_br_02_candidate_order',
              'ix_board_reporting_candidate_members_br_02_draft'
            )
       ) = 4 THEN 'PASS' ELSE 'FAIL' END,
       'candidate/member supporting indexes are present';

SELECT * FROM br_02_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM br_02_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'BR-02 board-reporting-candidate-foundation verifier failed';
  END IF;
END $$;
