WITH expected AS (
  SELECT
    'NCWS-P0-PASS2-METADATA-001'::text AS batch_code,
    'kai-p0-pass2-ncws-batch-001'::text AS batch_idempotency_key,
    'kai-p0-pass2-ncws-file-reservation-001'::text AS file_idempotency_key,
    'pass2_admin_metadata_intake_verification'::text AS p0_pass,
    'a5d17c5a-c55f-43af-9b21-fe63aafe733f'::uuid AS organization_id,
    '2e426ea1-2be3-4e48-b80f-9783ddbacda0'::uuid AS engagement_id
),
pass2_batches AS (
  SELECT b.*
  FROM kai.intake_batches b
  JOIN expected e ON b.batch_code = e.batch_code
    OR b.idempotency_key = e.batch_idempotency_key
    OR b.batch_metadata->>'p0_pass' = e.p0_pass
),
pass2_files AS (
  SELECT f.*
  FROM kai.intake_files f
  JOIN expected e ON f.file_metadata->>'p0_pass' = e.p0_pass
    OR f.file_metadata->>'idempotency_key' = e.file_idempotency_key
),
pass2_audit AS (
  SELECT a.*
  FROM kai.audit_events a
  JOIN expected e ON a.metadata->>'p0_pass' = e.p0_pass
)
SELECT 'CHECK' AS result_type,
       'PASS2_BATCH_EXISTS_ONCE' AS check_name,
       'kai.intake_batches' AS object_name,
       CASE WHEN (SELECT count(*) FROM pass2_batches) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
       'Pass 2 batch rows matched by batch_code, idempotency_key, or batch_metadata.p0_pass: ' || (SELECT count(*) FROM pass2_batches) AS detail
UNION ALL
SELECT 'CHECK',
       'PASS2_BATCH_ORG_ENGAGEMENT_MATCH',
       'kai.intake_batches',
       CASE WHEN EXISTS (
         SELECT 1 FROM pass2_batches b JOIN expected e ON b.organization_id = e.organization_id AND b.engagement_id = e.engagement_id
       ) THEN 'PASS' ELSE 'FAIL' END,
       'Batch organization_id and engagement_id match expected NCWS target.'
UNION ALL
SELECT 'CHECK',
       'PASS2_BATCH_METADATA_ONLY_FLAGS_CLOSED',
       'kai.intake_batches',
       CASE WHEN EXISTS (
         SELECT 1 FROM pass2_batches
         WHERE batch_metadata->>'p0_pass' = (SELECT p0_pass FROM expected)
           AND batch_metadata->>'synthetic_only' = 'true'
           AND batch_metadata->>'raw_upload_enabled' = 'false'
           AND batch_metadata->>'signed_url_enabled' = 'false'
           AND batch_metadata->>'parser_worker_enabled' = 'false'
           AND batch_metadata->>'source_promotion_enabled' = 'false'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'Batch metadata contains stable Pass 2 markers and closed raw/parser/source flags.'
UNION ALL
SELECT 'CHECK',
       'PASS2_FILE_RESERVATION_EXISTS_ONCE',
       'kai.intake_files',
       CASE WHEN (SELECT count(*) FROM pass2_files) = 1 THEN 'PASS' ELSE 'FAIL' END,
       'Pass 2 file reservation rows matched by file_metadata.p0_pass or reservation idempotency marker: ' || (SELECT count(*) FROM pass2_files)
UNION ALL
SELECT 'CHECK',
       'PASS2_FILE_RESERVATION_ORG_ENGAGEMENT_BATCH_MATCH',
       'kai.intake_files',
       CASE WHEN EXISTS (
         SELECT 1
         FROM pass2_files f
         JOIN pass2_batches b ON b.intake_batch_id = f.intake_batch_id
         JOIN expected e ON f.organization_id = e.organization_id AND f.engagement_id = e.engagement_id
       ) THEN 'PASS' ELSE 'FAIL' END,
       'File reservation belongs to expected organization, engagement, and Pass 2 batch.'
UNION ALL
SELECT 'CHECK',
       'PASS2_FILE_RESERVATION_RAW_FILE_RETAINED_FALSE',
       'kai.intake_files',
       CASE WHEN EXISTS (SELECT 1 FROM pass2_files WHERE raw_file_retained IS FALSE) THEN 'PASS' ELSE 'FAIL' END,
       'File reservation did not retain a raw file.'
UNION ALL
SELECT 'CHECK',
       'PASS2_FILE_RESERVATION_POLICY_STATUS_SKIPPED',
       'kai.intake_files',
       CASE WHEN EXISTS (SELECT 1 FROM pass2_files WHERE file_policy_status = 'skipped') THEN 'PASS' ELSE 'FAIL' END,
       'Synthetic/dev no-raw reservation uses file_policy_status=skipped.'
UNION ALL
SELECT 'CHECK',
       'PASS2_FILE_RESERVATION_MALWARE_STATUS_SKIPPED',
       'kai.intake_files',
       CASE WHEN EXISTS (SELECT 1 FROM pass2_files WHERE malware_scan_status = 'skipped') THEN 'PASS' ELSE 'FAIL' END,
       'Synthetic/dev no-raw reservation uses malware_scan_status=skipped.'
UNION ALL
SELECT 'CHECK',
       'PASS2_FILE_RESERVATION_NO_SIGNED_URL_METADATA',
       'kai.intake_files',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pass2_files
         WHERE file_metadata ? 'signed_upload_url'
            OR file_metadata ? 'signed_read_url'
            OR file_metadata::text ILIKE '%X-Goog-Signature%'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'File metadata contains no signed upload/read URL.'
UNION ALL
SELECT 'CHECK',
       'PASS2_FILE_RESERVATION_CHECKSUM_SCOPE_METADATA_ONLY',
       'kai.intake_files',
       CASE WHEN EXISTS (
         SELECT 1 FROM pass2_files WHERE file_metadata->>'checksum_scope' = 'metadata_reservation_no_raw_file'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'Checksum scope is metadata_reservation_no_raw_file.'
UNION ALL
SELECT 'CHECK',
       'PASS2_NO_PARSER_RUN_CREATED',
       'kai.intake_parser_runs',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM kai.intake_parser_runs r JOIN pass2_files f ON f.intake_file_id = r.intake_file_id
       ) THEN 'PASS' ELSE 'FAIL' END,
       'No parser run exists for Pass 2 file reservation.'
UNION ALL
SELECT 'CHECK',
       'PASS2_NO_FILE_PROFILE_CREATED',
       'kai.intake_file_profiles',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM kai.intake_file_profiles p JOIN pass2_files f ON f.intake_file_id = p.intake_file_id
       ) THEN 'PASS' ELSE 'FAIL' END,
       'No file profile exists for Pass 2 file reservation.'
UNION ALL
SELECT 'CHECK',
       'PASS2_NO_SENSITIVITY_PROFILE_CREATED',
       'kai.intake_sensitivity_profiles',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM kai.intake_sensitivity_profiles p JOIN pass2_files f ON f.intake_file_id = p.intake_file_id
       ) THEN 'PASS' ELSE 'FAIL' END,
       'No sensitivity profile exists for Pass 2 file reservation.'
UNION ALL
SELECT 'CHECK',
       'PASS2_NO_SOURCE_CANDIDATE_CREATED',
       'kai.intake_source_candidates',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM kai.intake_source_candidates c JOIN pass2_files f ON f.intake_file_id = c.intake_file_id
       ) THEN 'PASS' ELSE 'FAIL' END,
       'No source candidate exists for Pass 2 file reservation.'
UNION ALL
SELECT 'CHECK',
       'PASS2_NO_PROMOTION_DECISION_CREATED',
       'kai.intake_promotion_decisions',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM kai.intake_promotion_decisions d JOIN pass2_files f ON f.intake_file_id = d.intake_file_id
       ) THEN 'PASS' ELSE 'FAIL' END,
       'No promotion decision exists for Pass 2 file reservation.'
UNION ALL
SELECT 'CHECK',
       'PASS2_AUDIT_OBJECT_TYPE_OTHER_FOR_INTAKE_BATCH_BLOCKER',
       'kai.audit_events',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pass2_audit WHERE metadata->>'target_object_type' = 'intake_batch' AND object_type <> 'other'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'Intake batch blocked-attempt audit rows use object_type=other.'
UNION ALL
SELECT 'CHECK',
       'PASS2_AUDIT_OBJECT_TYPE_OTHER_FOR_INTAKE_FILE_BLOCKER',
       'kai.audit_events',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pass2_audit WHERE metadata->>'target_object_type' = 'intake_file' AND object_type <> 'other'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'Intake file blocked-attempt audit rows use object_type=other.'
UNION ALL
SELECT 'CHECK',
       'PASS2_AUDIT_METADATA_TARGET_OBJECT_TYPE_PRESENT',
       'kai.audit_events',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pass2_audit WHERE metadata->>'target_object_type' IS NULL
       ) THEN 'PASS' ELSE 'FAIL' END,
       'Pass 2 audit rows preserve real target type in metadata.target_object_type.'
UNION ALL
SELECT 'CHECK',
       'PASS2_AUDIT_METADATA_NO_RAW_OR_PROMPT_KEYS',
       'kai.audit_events',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pass2_audit
         WHERE metadata ? 'raw_file_content'
            OR metadata ? 'raw_parsed_rows'
            OR metadata ? 'prompt_text'
            OR metadata ? 'signed_upload_url'
            OR metadata ? 'signed_read_url'
            OR metadata ? 'storage_credentials'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'Pass 2 audit metadata contains no raw, prompt, signed URL, or credential keys.'
UNION ALL
SELECT 'CHECK',
       'PASS2_FORBIDDEN_CORE_TABLE_TOUCH_MARKERS_ZERO',
       'kai.core_forbidden_objects',
       CASE WHEN
         NOT EXISTS (SELECT 1 FROM kai.sources s WHERE to_jsonb(s)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.source_versions sv WHERE to_jsonb(sv)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.source_locators sl WHERE to_jsonb(sl)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.evidence_items ei WHERE to_jsonb(ei)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.claims c WHERE to_jsonb(c)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.claim_evidence_links cel WHERE to_jsonb(cel)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.claim_requirement_links crl WHERE to_jsonb(crl)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.reports r WHERE to_jsonb(r)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.report_sections rs WHERE to_jsonb(rs)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.report_section_claims rsc WHERE to_jsonb(rsc)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.exports ex WHERE to_jsonb(ex)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.export_items xi WHERE to_jsonb(xi)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.graph_relationships gr WHERE to_jsonb(gr)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.prompt_runs pr WHERE to_jsonb(pr)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%')
         AND NOT EXISTS (SELECT 1 FROM kai.model_outputs mo WHERE to_jsonb(mo)::text LIKE '%' || (SELECT p0_pass FROM expected) || '%')
       THEN 'PASS' ELSE 'FAIL' END,
       'No Pass 2 marker appears in forbidden source/evidence/claim/report/export/graph/prompt/model tables.'
UNION ALL
SELECT 'CHECK',
       'PASS2_RESULTS_SINGLE_RESULT_SET_SHAPE',
       'verifier',
       'PASS',
       'Verifier returns one result set with result_type, check_name, object_name, status, detail.';
