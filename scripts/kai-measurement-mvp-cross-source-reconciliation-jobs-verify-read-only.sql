-- Cross-source reconciliation jobs migration verification. READ ONLY: one SELECT.
-- Run independently in pgAdmin (F5); the final OVERALL row must be PASS.
-- Definitions are pinned to the existing migration's PostgreSQL catalog form.
-- Semantically equivalent rewrites or future additive changes may require a
-- reviewed verifier update; this intentionally fails closed on schema drift.
WITH expected_columns(name, type_name, required, default_expr) AS (
  VALUES
    ('reconciliation_job_id', 'uuid', true, 'gen_random_uuid()'),
    ('organization_id', 'uuid', true, NULL),
    ('primary_source_version_id', 'uuid', true, NULL),
    ('reference_source_version_id', 'uuid', true, NULL),
    ('primary_profile_canonical_sha256', 'text', true, NULL),
    ('reference_profile_canonical_sha256', 'text', true, NULL),
    ('request_fingerprint', 'text', true, NULL),
    ('mapping', 'jsonb', true, NULL),
    ('job_state', 'text', true, NULL),
    ('attempt_count', 'integer', true, '0'),
    ('claim_token', 'uuid', false, NULL),
    ('claim_expires_at', 'timestamp with time zone', false, NULL),
    ('last_attempt_at', 'timestamp with time zone', false, NULL),
    ('next_eligible_at', 'timestamp with time zone', false, NULL),
    ('last_error_code', 'text', false, NULL),
    ('measurement_ids', 'uuid[]', false, NULL),
    ('requested_by', 'uuid', true, NULL),
    ('created_at', 'timestamp with time zone', true, 'now()'),
    ('updated_at', 'timestamp with time zone', true, 'now()'),
    ('completed_at', 'timestamp with time zone', false, NULL)
), expected_constraints(name, kind, definition) AS (
  VALUES
    ('cross_source_reconciliation_jobs_attempt_count_check', 'c', 'CHECK (attempt_count >= 0 AND attempt_count <= 3)'),
    ('cross_source_reconciliation_jobs_distinct_versions_check', 'c', 'CHECK (primary_source_version_id <> reference_source_version_id)'),
    ('cross_source_reconciliation_jobs_error_code_check', 'c', 'CHECK (last_error_code IS NULL OR last_error_code ~ ''^[a-z0-9_]{1,64}$''::text)'),
    ('cross_source_reconciliation_jobs_fingerprint_check', 'c', 'CHECK (request_fingerprint ~ ''^[a-f0-9]{64}$''::text)'),
    ('cross_source_reconciliation_jobs_id_org_unique', 'u', 'UNIQUE (reconciliation_job_id, organization_id)'),
    ('cross_source_reconciliation_jobs_mapping_check', 'c', 'CHECK (jsonb_typeof(mapping) = ''object''::text AND gate_a_p0_jsonb_metadata_only(mapping))'),
    ('cross_source_reconciliation_jobs_measurement_ids_check', 'c', 'CHECK (measurement_ids IS NULL OR cardinality(measurement_ids) >= 1 AND cardinality(measurement_ids) <= 64)'),
    ('cross_source_reconciliation_jobs_pkey', 'p', 'PRIMARY KEY (reconciliation_job_id)'),
    ('cross_source_reconciliation_jobs_primary_version_fk', 'f', 'FOREIGN KEY (primary_source_version_id, organization_id) REFERENCES source_versions(source_version_id, organization_id) ON DELETE RESTRICT'),
    ('cross_source_reconciliation_jobs_profile_sha_check', 'c', 'CHECK (primary_profile_canonical_sha256 ~ ''^[a-f0-9]{64}$''::text AND reference_profile_canonical_sha256 ~ ''^[a-f0-9]{64}$''::text)'),
    ('cross_source_reconciliation_jobs_reference_version_fk', 'f', 'FOREIGN KEY (reference_source_version_id, organization_id) REFERENCES source_versions(source_version_id, organization_id) ON DELETE RESTRICT'),
    ('cross_source_reconciliation_jobs_request_unique', 'u', 'UNIQUE (organization_id, request_fingerprint)'),
    ('cross_source_reconciliation_jobs_state_check', 'c', 'CHECK (job_state = ANY (ARRAY[''queued''::text, ''in_progress''::text, ''retry_scheduled''::text, ''succeeded''::text, ''failed''::text, ''exhausted''::text]))'),
    ('cross_source_reconciliation_jobs_state_fact_consistency_check', 'c', 'CHECK (job_state = ''queued''::text AND claim_token IS NULL AND claim_expires_at IS NULL AND next_eligible_at IS NULL AND last_error_code IS NULL AND measurement_ids IS NULL AND completed_at IS NULL AND attempt_count = 0 OR job_state = ''in_progress''::text AND claim_token IS NOT NULL AND claim_expires_at IS NOT NULL AND last_attempt_at IS NOT NULL AND next_eligible_at IS NULL AND measurement_ids IS NULL AND completed_at IS NULL AND attempt_count >= 1 AND attempt_count <= 3 OR job_state = ''retry_scheduled''::text AND claim_token IS NULL AND claim_expires_at IS NULL AND last_attempt_at IS NOT NULL AND next_eligible_at IS NOT NULL AND last_error_code IS NOT NULL AND measurement_ids IS NULL AND completed_at IS NULL AND attempt_count >= 1 AND attempt_count <= 2 OR job_state = ''succeeded''::text AND claim_token IS NULL AND claim_expires_at IS NULL AND next_eligible_at IS NULL AND last_error_code IS NULL AND measurement_ids IS NOT NULL AND completed_at IS NOT NULL AND attempt_count >= 1 AND attempt_count <= 3 OR (job_state = ANY (ARRAY[''failed''::text, ''exhausted''::text])) AND claim_token IS NULL AND claim_expires_at IS NULL AND next_eligible_at IS NULL AND last_error_code IS NOT NULL AND measurement_ids IS NULL AND completed_at IS NOT NULL AND attempt_count >= 1 AND attempt_count <= 3 AND (job_state = ''failed''::text OR attempt_count = 3))')
), actual_columns AS (
  SELECT a.attname::text AS name, format_type(a.atttypid, a.atttypmod) AS type_name,
         a.attnotnull AS required, pg_get_expr(d.adbin, d.adrelid) AS default_expr
  FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = to_regclass('kai.cross_source_reconciliation_jobs') AND a.attnum > 0 AND NOT a.attisdropped
), actual_constraints AS (
  SELECT c.conname::text AS name, c.contype::text AS kind,
         regexp_replace(pg_get_constraintdef(c.oid, true), '\mkai\.', '', 'g') AS definition,
         c.convalidated, c.condeferrable,
         CASE WHEN c.contype = 'f' THEN c.confrelid = to_regclass('kai.source_versions') ELSE true END AS target_valid,
         CASE WHEN c.conname = 'cross_source_reconciliation_jobs_mapping_check' THEN EXISTS (
           SELECT 1 FROM pg_depend dep WHERE dep.classid = 'pg_constraint'::regclass AND dep.objid = c.oid
             AND dep.refclassid = 'pg_proc'::regclass AND dep.refobjid = to_regprocedure('kai.gate_a_p0_jsonb_metadata_only(jsonb)')
         ) ELSE true END AS function_valid,
         CASE WHEN c.contype IN ('p', 'u') THEN coalesce(i.indisvalid AND i.indisready AND i.indislive, false) ELSE true END AS index_valid
  FROM pg_constraint c LEFT JOIN pg_index i ON i.indexrelid = c.conindid
  WHERE c.conrelid = to_regclass('kai.cross_source_reconciliation_jobs')
), checks AS (
  SELECT 1 AS ord, 'J1.table' AS check_id,
    EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('kai.cross_source_reconciliation_jobs') AND relkind = 'r') AS ok,
    'ordinary reconciliation job table exists' AS detail
  UNION ALL
  SELECT 2, 'J2.columns', NOT EXISTS (
    SELECT 1 FROM expected_columns e LEFT JOIN actual_columns a USING (name)
    WHERE a.name IS NULL OR a.type_name <> e.type_name OR a.required <> e.required OR a.default_expr IS DISTINCT FROM e.default_expr
  ), 'required columns, types, nullability and defaults'
  UNION ALL
  SELECT 3, 'J3.constraint:' || e.name,
    coalesce(a.kind = e.kind AND a.definition = e.definition AND a.convalidated AND NOT a.condeferrable AND a.index_valid AND a.target_valid AND a.function_valid, false),
    'validated, nondeferrable migration constraint with its full definition'
  FROM expected_constraints e LEFT JOIN actual_constraints a USING (name)
  UNION ALL
  SELECT 4, 'J4.indexes',
    NOT EXISTS (SELECT 1 FROM (VALUES
      ('ix_cross_source_reconciliation_jobs_due', 'CREATE INDEX ix_cross_source_reconciliation_jobs_due ON cross_source_reconciliation_jobs USING btree (job_state, next_eligible_at, claim_expires_at)'),
      ('ix_cross_source_reconciliation_jobs_tenant_created', 'CREATE INDEX ix_cross_source_reconciliation_jobs_tenant_created ON cross_source_reconciliation_jobs USING btree (organization_id, created_at DESC)')
    ) e(name, definition) WHERE NOT EXISTS (
      SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
      WHERE i.indrelid = to_regclass('kai.cross_source_reconciliation_jobs') AND idx.relname = e.name
        AND i.indisvalid AND i.indisready AND i.indislive
        AND regexp_replace(pg_get_indexdef(idx.oid), '\mkai\.', '', 'g') = e.definition
    )), 'sweep and organization listing indexes'
), results AS (
  SELECT ord, check_id, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS status, detail FROM checks
)
SELECT ord, check_id, status, detail FROM results
UNION ALL
SELECT 99, 'OVERALL', CASE WHEN bool_and(status = 'PASS') AND count(*) = 17 THEN 'PASS' ELSE 'FAIL' END,
       'all job migration checks must pass' FROM results
ORDER BY 1, 2;
