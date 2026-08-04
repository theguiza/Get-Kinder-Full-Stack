BEGIN;

WITH constants AS (
  SELECT '00000000-0000-4000-8000-000000000001'::uuid AS org1,
         '20000000-0000-4000-8000-000000000001'::uuid AS file1,
         '40000000-0000-4000-8000-000000000001'::uuid AS parser_run1,
         '50000000-0000-4000-8000-000000000001'::uuid AS profile1_id,
         repeat('1', 64) AS checksum1,
         '{
            "status":"profiled",
            "format":"csv",
            "counts":{"row_count":10,"column_count":2,"field_count":2,"formula_count":1,"duplicate_row_count":2},
            "duplicate_row_hints":{"has_duplicate_rows":true,"duplicate_row_count":2},
            "fields":[
              {"field_key":"field_1","meaning":"unknown","sensitivity":"unknown","review":"required","allowed_use":"internal only","missing_count":3,"present_count":7,"primitive_type_hints":{"blank":0,"boolean":0,"number":7,"date_like":0,"text_like":0}},
              {"field_key":"field_2","meaning":"unknown","sensitivity":"unknown","review":"required","allowed_use":"internal only","missing_count":0,"present_count":10,"primitive_type_hints":{"blank":0,"boolean":0,"number":5,"date_like":0,"text_like":5}}
            ]
          }'::jsonb AS profile1
),
parser_run_insert AS (
  INSERT INTO kai.intake_parser_runs (
    parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum,
    parser_status, started_at
  )
  SELECT parser_run1, org1, file1, 'kai_local_profiling_kernel', '1.0.0', checksum1,
         'running', '2026-08-02T13:00:00Z'
    FROM constants
  RETURNING organization_id, intake_file_id
)
INSERT INTO kai.intake_file_profiles (
  file_profile_id, organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum,
  profile, profile_canonical_sha256, created_at
)
SELECT profile1_id, org1, file1, parser_run1,
       'kai_local_profiling_kernel', '1.0.0', checksum1,
       profile1, encode(digest(profile1::text, 'sha256'), 'hex'),
       '2026-08-02T13:00:06Z'
  FROM constants
  WHERE EXISTS (SELECT 1 FROM parser_run_insert);

-- Separate statement: the row inserted above is not visible to an UPDATE on the same table
-- within that same statement's CTE snapshot, so the transition to 'completed' must run as its
-- own statement (same convention as the P1-02 smoke seed).
UPDATE kai.intake_parser_runs
   SET parser_status = 'completed',
       completed_at = '2026-08-02T13:00:07Z',
       output_profile_id = '50000000-0000-4000-8000-000000000001'
 WHERE parser_run_id = '40000000-0000-4000-8000-000000000001'
   AND EXISTS (
     SELECT 1 FROM kai.intake_file_profiles
      WHERE file_profile_id = '50000000-0000-4000-8000-000000000001'
   );

-- Second completed profile under the same tenant/file with no bound dictionary bundle yet,
-- used by the smoke verifier's targeted CHECK/FK negative tests so they are not shadowed by
-- the one-bundle-per-organization_id + file_profile_id uniqueness rule on profile1's bundle.
INSERT INTO kai.intake_parser_runs (
  parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at
) VALUES (
  '40000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'kai_local_profiling_kernel', '2.0.0', repeat('2', 64), 'running', '2026-08-02T13:00:00Z'
);

INSERT INTO kai.intake_file_profiles (
  file_profile_id, organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum,
  profile, profile_canonical_sha256, created_at
) VALUES (
  '50000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002', 'kai_local_profiling_kernel', '2.0.0', repeat('2', 64),
  '{"status":"profiled","format":"csv","counts":{"row_count":1,"column_count":0,"field_count":0,"formula_count":0,"duplicate_row_count":0},"fields":[]}'::jsonb,
  encode(digest('{"status":"profiled","format":"csv","counts":{"row_count":1,"column_count":0,"field_count":0,"formula_count":0,"duplicate_row_count":0},"fields":[]}'::jsonb::text, 'sha256'), 'hex'),
  '2026-08-02T13:00:09Z'
);

UPDATE kai.intake_parser_runs
   SET parser_status = 'completed', completed_at = '2026-08-02T13:00:10Z',
       output_profile_id = '50000000-0000-4000-8000-000000000002'
 WHERE parser_run_id = '40000000-0000-4000-8000-000000000002';

-- Separate statement, run only after both profiles above are committed within this transaction:
-- the draft dictionary bundle, its fields, mappings, and findings for profile1 only.
WITH constants AS (
  SELECT '00000000-0000-4000-8000-000000000001'::uuid AS org1,
         '20000000-0000-4000-8000-000000000001'::uuid AS file1,
         '50000000-0000-4000-8000-000000000001'::uuid AS profile1_id,
         '60000000-0000-4000-8000-000000000001'::uuid AS dictionary1_id,
         '70000000-0000-4000-8000-000000000001'::uuid AS field1_id,
         '70000000-0000-4000-8000-000000000002'::uuid AS field2_id
),
dictionary_insert AS (
  INSERT INTO kai.data_dictionaries (
    data_dictionary_id, organization_id, intake_file_id, file_profile_id, profile_canonical_sha256, created_at
  )
  SELECT dictionary1_id, org1, file1, profile1_id, profile_canonical_sha256, '2026-08-02T13:00:08Z'
    FROM constants
    JOIN kai.intake_file_profiles ON intake_file_profiles.file_profile_id = constants.profile1_id
  RETURNING data_dictionary_id
),
field1_insert AS (
  INSERT INTO kai.data_dictionary_fields (
    data_dictionary_field_id, data_dictionary_id, organization_id, file_profile_id,
    profile_field_key, field_label_safe, data_type, created_at
  )
  SELECT field1_id, dictionary1_id, org1, profile1_id, 'field_1', 'field_1', 'number', '2026-08-02T13:00:08Z'
    FROM constants
    WHERE EXISTS (SELECT 1 FROM dictionary_insert)
  RETURNING data_dictionary_field_id
),
field2_insert AS (
  INSERT INTO kai.data_dictionary_fields (
    data_dictionary_field_id, data_dictionary_id, organization_id, file_profile_id,
    profile_field_key, field_label_safe, data_type, created_at
  )
  SELECT field2_id, dictionary1_id, org1, profile1_id, 'field_2', 'field_2', 'mixed', '2026-08-02T13:00:08Z'
    FROM constants
    WHERE EXISTS (SELECT 1 FROM field1_insert)
  RETURNING data_dictionary_field_id
),
mapping1_insert AS (
  INSERT INTO kai.data_dictionary_mappings (
    data_dictionary_field_id, data_dictionary_id, organization_id, file_profile_id, profile_field_key, created_at
  )
  SELECT field1_id, dictionary1_id, org1, profile1_id, 'field_1', '2026-08-02T13:00:08Z'
    FROM constants
    WHERE EXISTS (SELECT 1 FROM field2_insert)
  RETURNING data_dictionary_field_id
),
mapping2_insert AS (
  INSERT INTO kai.data_dictionary_mappings (
    data_dictionary_field_id, data_dictionary_id, organization_id, file_profile_id, profile_field_key, created_at
  )
  SELECT field2_id, dictionary1_id, org1, profile1_id, 'field_2', '2026-08-02T13:00:08Z'
    FROM constants
    WHERE EXISTS (SELECT 1 FROM mapping1_insert)
  RETURNING data_dictionary_field_id
),
finding1_insert AS (
  INSERT INTO kai.data_quality_findings (
    data_dictionary_id, organization_id, file_profile_id, profile_field_key, finding_type, finding_detail_safe, created_at
  )
  SELECT dictionary1_id, org1, profile1_id, 'field_1', 'missingness', 'field_1 has 3 missing values out of 10', '2026-08-02T13:00:08Z'
    FROM constants
    WHERE EXISTS (SELECT 1 FROM mapping2_insert)
  RETURNING data_dictionary_id
),
finding2_insert AS (
  INSERT INTO kai.data_quality_findings (
    data_dictionary_id, organization_id, file_profile_id, profile_field_key, finding_type, finding_detail_safe, created_at
  )
  SELECT dictionary1_id, org1, profile1_id, 'field_2', 'type_inconsistency', 'field_2 has mixed primitive type hints', '2026-08-02T13:00:08Z'
    FROM constants
    WHERE EXISTS (SELECT 1 FROM finding1_insert)
  RETURNING data_dictionary_id
),
finding3_insert AS (
  INSERT INTO kai.data_quality_findings (
    data_dictionary_id, organization_id, file_profile_id, finding_type, finding_detail_safe, created_at
  )
  SELECT dictionary1_id, org1, profile1_id, 'duplicate_rows', '2 duplicate rows detected', '2026-08-02T13:00:08Z'
    FROM constants
    WHERE EXISTS (SELECT 1 FROM finding2_insert)
  RETURNING data_dictionary_id
),
finding4_insert AS (
  INSERT INTO kai.data_quality_findings (
    data_dictionary_id, organization_id, file_profile_id, finding_type, finding_detail_safe, created_at
  )
  SELECT dictionary1_id, org1, profile1_id, 'formula_like_content', '1 formula-like value detected', '2026-08-02T13:00:08Z'
    FROM constants
    WHERE EXISTS (SELECT 1 FROM finding3_insert)
  RETURNING data_dictionary_id
)
INSERT INTO kai.upload_lifecycle_audit (
  organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
)
SELECT org1, file1, 'data_dictionary_draft_persisted', 'reserved', 'reserved', 'success',
       jsonb_build_object(
         'metadata_only', true,
         'contract', 'p1_draft_data_dictionary_and_quality_v1',
         'file_profile_id', profile1_id::text,
         'profile_canonical_sha256', (SELECT profile_canonical_sha256 FROM kai.intake_file_profiles WHERE file_profile_id = profile1_id),
         'dictionary_status', 'draft',
         'field_count', 2,
         'mapping_count', 2,
         'finding_count', 4,
         'validator_key', 'VAL-KAI-P1-04-001'
       ),
       '2026-08-02T13:00:08Z'
  FROM constants
  WHERE EXISTS (SELECT 1 FROM finding4_insert);

COMMIT;
