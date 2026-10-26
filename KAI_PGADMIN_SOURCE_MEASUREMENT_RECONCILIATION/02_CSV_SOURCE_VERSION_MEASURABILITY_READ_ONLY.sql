-- KAI: can the organization's CSV source version be counted under P2-01M now,
-- and would its measured claim be ordinary internal information?
-- ONE SELECT statement; writes nothing. Paste the whole file and press F5.
-- Mirrors loadMeasurableSourceVersion / deriveRecordCountMeasurement and the
-- ordinary internal authority (classifySourceDecision). Always returns rows.
-- Returns ids, types, states and counts only.
WITH p AS (
  SELECT 'ed32e526-3d47-41e9-8ddf-f1163a36db4f'::uuid AS org_id,
         '8c9cae80-7e3b-43df-9e8d-fc629c1ed0f1'::uuid AS project_id,
         'eeddc0c7-abb5-4d02-a726-152a3477d9e7'::uuid AS version_id
),
v AS (SELECT sv.* FROM p JOIN kai.source_versions sv ON sv.source_version_id = p.version_id),
c AS (SELECT cand.* FROM v JOIN kai.intake_source_candidates cand ON cand.intake_source_candidate_id = v.intake_source_candidate_id),
f AS (SELECT to_jsonb(fi) AS j FROM c JOIN kai.intake_files fi ON fi.intake_file_id = c.intake_file_id),
fp AS (SELECT x.* FROM c JOIN kai.intake_file_profiles x ON x.file_profile_id = c.file_profile_id),
pd AS (SELECT d.* FROM v JOIN kai.intake_promotion_decisions d ON d.source_version_id = v.source_version_id),
d AS (SELECT s.* FROM v JOIN kai.intake_sensitivity_review_decisions s
        ON s.intake_sensitivity_profile_id = v.intake_sensitivity_profile_id
       WHERE NOT EXISTS (SELECT 1 FROM kai.intake_sensitivity_review_decisions s2
                          WHERE s2.supersedes_decision_id = s.decision_id))
SELECT n, check_name, result FROM (
  SELECT 1 AS n, 'version found / org / current / source_id' AS check_name,
         coalesce((SELECT string_agg(concat_ws(' / ', organization_id, is_current, source_id), ' | ') FROM v), 'none') AS result
  UNION ALL
  SELECT 2, 'candidate (id : status : intake_file_id : file_profile_id)',
         coalesce((SELECT string_agg(concat_ws(' : ', intake_source_candidate_id, candidate_status, intake_file_id, file_profile_id), ' | ') FROM c), 'none')
  UNION ALL
  SELECT 3, 'file in project',
         coalesce((SELECT string_agg(coalesce((j->>'engagement_id' = (SELECT project_id::text FROM p))::text, 'n/a'), ' | ') FROM f), 'none')
  UNION ALL
  SELECT 4, 'promotion decision (id : status)',
         coalesce((SELECT string_agg(concat_ws(' : ', intake_promotion_decision_id, decision_status), ' | ') FROM pd), 'none')
  UNION ALL
  SELECT 5, 'profile (status : format : header_row_assumed : row_count type : blank_record_count type : duplicate_row_count type)',
         coalesce((SELECT string_agg(concat_ws(' : ', profile->>'status', profile->>'format',
           coalesce(profile->'structural_metadata'->>'header_row_assumed', 'no_header_flag'),
           coalesce(jsonb_typeof(profile->'counts'->'row_count'), 'missing'),
           coalesce(jsonb_typeof(profile->'counts'->'blank_record_count'), 'missing'),
           coalesce(jsonb_typeof(profile->'counts'->'duplicate_row_count'), 'missing')), ' | ') FROM fp), 'none')
  UNION ALL
  SELECT 6, 'profile hash matches version (else conflict_current_state_changed)',
         coalesce((SELECT string_agg((fp.profile_canonical_sha256 = v.profile_canonical_sha256)::text, ' | ') FROM fp, v), 'none')
  UNION ALL
  SELECT 7, 'current sensitivity decisions (count; must be exactly 1)',
         (SELECT count(*)::text FROM d)
  UNION ALL
  SELECT 8, 'decision (outcome : allowed_use : llm : personal : minor : hhji : indigenous : story : small_cell)',
         coalesce((SELECT string_agg(concat_ws(' : ', decision_outcome, reviewed_allowed_use_status, reviewed_llm_processing_allowed,
           reviewed_personal_data_status, reviewed_minor_data_status, reviewed_health_housing_justice_immigration_status,
           reviewed_indigenous_governance_status, reviewed_story_testimonial_status, reviewed_small_cell_risk_status), ' | ') FROM d), 'none')
  UNION ALL
  SELECT 9, 'evidence on version: field facts / measurements',
         concat_ws(' / ',
           (SELECT count(*) FROM kai.evidence_items e WHERE e.source_version_id = (SELECT version_id FROM p) AND e.evidence_type = 'dictionary_field_presence_fact'),
           (SELECT count(*) FROM kai.evidence_items e WHERE e.source_version_id = (SELECT version_id FROM p) AND e.evidence_type = 'source_record_count_measurement'))
  UNION ALL
  SELECT 10, 'claims on version (any type)',
         (SELECT count(*)::text FROM kai.claims cl JOIN kai.evidence_items e ON e.evidence_item_id = cl.evidence_item_id
           WHERE e.source_version_id = (SELECT version_id FROM p))
) checks
ORDER BY n;
