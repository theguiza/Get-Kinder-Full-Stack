-- KAI source-to-measurement reconciliation. ONE SELECT statement; writes nothing.
-- Paste the whole file into the pgAdmin Query Tool and press F5.
-- Always returns rows: one labelled check per row. A missing link shows as
-- 0 / 'none', never as an empty result. The workbook, draft and claim are looked
-- up by id WITHOUT an organization filter, so an organization mismatch is visible.
-- P2-01M tables are probed with to_regclass, so 'table_missing' means the
-- P2-01M migration is not applied. Returns ids, types, states and counts only.
WITH p AS (
  SELECT 'ed32e526-3d47-41e9-8ddf-f1163a36db4f'::uuid AS org_id,
         '8c9cae80-7e3b-43df-9e8d-fc629c1ed0f1'::uuid AS project_id,
         'd479ccad-f541-47a7-acc9-3e8f65f394bc'::uuid AS draft_id,
         '03fe3285-1c5c-4149-996f-c48bebe83359'::uuid AS claim_id,
         'ea4b455a-9539-4d84-b068-193c7f1502bd'::uuid AS file_id
),
-- Display columns read through to_jsonb so a column absent in one schema shape
-- reads as 'n/a' instead of failing the whole query.
wf AS (SELECT f.organization_id, to_jsonb(f) AS j FROM p JOIN kai.intake_files f ON f.intake_file_id = p.file_id),
wp AS (SELECT fp.* FROM p JOIN kai.intake_file_profiles fp ON fp.intake_file_id = p.file_id),
wc AS (SELECT c.* FROM p JOIN kai.intake_source_candidates c ON c.intake_file_id = p.file_id),
wpd AS (SELECT d.* FROM kai.intake_promotion_decisions d
         WHERE d.intake_source_candidate_id IN (SELECT intake_source_candidate_id FROM wc)),
wv AS (SELECT v.* FROM kai.source_versions v
        WHERE v.intake_source_candidate_id IN (SELECT intake_source_candidate_id FROM wc)),
ws AS (SELECT s.* FROM p JOIN kai.intake_sensitivity_profiles s ON s.intake_file_id = p.file_id),
wd AS (SELECT d.* FROM kai.intake_sensitivity_review_decisions d
        WHERE d.intake_sensitivity_profile_id IN (SELECT intake_sensitivity_profile_id FROM ws)
          AND NOT EXISTS (SELECT 1 FROM kai.intake_sensitivity_review_decisions s2
                           WHERE s2.supersedes_decision_id = d.decision_id)),
dr AS (SELECT d.* FROM p JOIN kai.generated_content_drafts d ON d.generated_content_draft_id = p.draft_id),
dv AS (SELECT DISTINCT e.source_version_id
         FROM p
         JOIN kai.generated_content_blocks b ON b.generated_content_draft_id = p.draft_id
         JOIN kai.generated_content_citations ci ON ci.generated_content_block_id = b.generated_content_block_id
         JOIN kai.evidence_items e ON e.evidence_item_id = ci.evidence_item_id),
cl AS (SELECT c.claim_id, c.organization_id, c.claim_type, e.evidence_type, sl.locator_type, e.source_version_id
         FROM p
         JOIN kai.claims c ON c.claim_id = p.claim_id
         LEFT JOIN kai.evidence_items e ON e.evidence_item_id = c.evidence_item_id
         LEFT JOIN kai.source_locators sl ON sl.source_locator_id = e.source_locator_id),
ov AS (SELECT v.*, fp.profile AS cand_profile
         FROM p
         JOIN kai.source_versions v ON v.organization_id = p.org_id
         LEFT JOIN kai.intake_source_candidates c ON c.intake_source_candidate_id = v.intake_source_candidate_id
         LEFT JOIN kai.intake_file_profiles fp ON fp.file_profile_id = c.file_profile_id)
SELECT n, check_name, result FROM (
  SELECT 1 AS n, 'org: source_versions total / current' AS check_name,
         concat_ws(' / ', count(*), count(*) FILTER (WHERE is_current)) AS result FROM ov
  UNION ALL
  SELECT 2, 'org: every source_version (id : current : profile format)',
         coalesce(string_agg(concat_ws(' : ', source_version_id, is_current, coalesce(cand_profile->>'format', 'no_profile')), ' | ' ORDER BY created_at), 'none') FROM ov
  UNION ALL
  SELECT 3, 'workbook file: found (any org) / organization_id',
         concat_ws(' / ', count(*), coalesce(string_agg(organization_id::text, ','), 'none')) FROM wf
  UNION ALL
  SELECT 4, 'workbook file: in project / processing / parse / review status',
         coalesce(string_agg(concat_ws(' / ',
           coalesce((j->>'engagement_id' = (SELECT project_id::text FROM p))::text, 'n/a'),
           coalesce(j->>'processing_status', 'n/a'), coalesce(j->>'parse_status', 'n/a'), coalesce(j->>'review_status', 'n/a')), ' | '), 'none') FROM wf
  UNION ALL
  SELECT 5, 'workbook profiles (id : status : format : header_row_assumed : blank_count type : sheet_count)',
         coalesce(string_agg(concat_ws(' : ', file_profile_id, profile->>'status', profile->>'format',
           coalesce(profile->'structural_metadata'->>'header_row_assumed', 'no_header_flag'),
           coalesce(jsonb_typeof(profile->'counts'->'blank_record_count'), 'no_blank_count'),
           coalesce(profile->'counts'->>'sheet_count', 'no_sheet_count')), ' | '), 'none') FROM wp
  UNION ALL
  SELECT 6, 'workbook candidates (id : org : status : file_profile_id)',
         coalesce(string_agg(concat_ws(' : ', intake_source_candidate_id, organization_id, candidate_status, file_profile_id), ' | '), 'none') FROM wc
  UNION ALL
  SELECT 7, 'workbook promotion decisions (id : status : source_version_id)',
         coalesce(string_agg(concat_ws(' : ', intake_promotion_decision_id, decision_status, coalesce(source_version_id::text, 'no_version')), ' | '), 'none') FROM wpd
  UNION ALL
  SELECT 8, 'WORKBOOK SOURCE VERSION(S) (id : source_id : current : org)',
         coalesce(string_agg(concat_ws(' : ', source_version_id, source_id, is_current, organization_id), ' | '), 'none') FROM wv
  UNION ALL
  SELECT 9, 'workbook current sensitivity decisions (outcome : allowed_use : llm : personal : minor : hhji : indigenous : story : small_cell)',
         coalesce(string_agg(concat_ws(' : ', decision_outcome, reviewed_allowed_use_status, reviewed_llm_processing_allowed,
           reviewed_personal_data_status, reviewed_minor_data_status, reviewed_health_housing_justice_immigration_status,
           reviewed_indigenous_governance_status, reviewed_story_testimonial_status, reviewed_small_cell_risk_status), ' | '), 'none') FROM wd
  UNION ALL
  SELECT 10, 'draft: found (any org) / org / content_type / audience',
         coalesce(string_agg(concat_ws(' / ', organization_id, content_type, requested_audience), ' | '), 'none') FROM dr
  UNION ALL
  SELECT 11, 'DRAFT CITED SOURCE VERSION(S)',
         coalesce(string_agg(source_version_id::text, ' | '), 'none') FROM dv
  UNION ALL
  SELECT 12, 'cited claim (id : org : claim_type : evidence_type : locator_type : source_version_id)',
         coalesce(string_agg(concat_ws(' : ', claim_id, organization_id, claim_type, evidence_type, locator_type, source_version_id), ' | '), 'none') FROM cl
  UNION ALL
  SELECT 13, 'SAME VERSION? workbook version = cited claim version',
         (EXISTS (SELECT 1 FROM wv JOIN cl ON cl.source_version_id = wv.source_version_id))::text
  UNION ALL
  SELECT 14, 'workbook versions: field-fact evidence / measurement evidence',
         concat_ws(' / ',
           (SELECT count(*) FROM kai.evidence_items e WHERE e.source_version_id IN (SELECT source_version_id FROM wv) AND e.evidence_type = 'dictionary_field_presence_fact'),
           (SELECT count(*) FROM kai.evidence_items e WHERE e.source_version_id IN (SELECT source_version_id FROM wv) AND e.evidence_type = 'source_record_count_measurement'))
  UNION ALL
  SELECT 15, 'workbook versions: structural claims / measured claims',
         concat_ws(' / ',
           (SELECT count(*) FROM kai.claims c JOIN kai.evidence_items e ON e.evidence_item_id = c.evidence_item_id
             WHERE e.source_version_id IN (SELECT source_version_id FROM wv) AND e.evidence_type = 'dictionary_field_presence_fact'),
           (SELECT count(*) FROM kai.claims c JOIN kai.evidence_items e ON e.evidence_item_id = c.evidence_item_id
             WHERE e.source_version_id IN (SELECT source_version_id FROM wv) AND e.evidence_type = 'source_record_count_measurement'))
  UNION ALL
  SELECT 16, 'P2-01M table kai.source_measurement_definitions: org rows',
         CASE WHEN to_regclass('kai.source_measurement_definitions') IS NULL THEN 'table_missing'
              ELSE (xpath('/row/c/text()', query_to_xml(
                'SELECT count(*) AS c FROM kai.source_measurement_definitions WHERE organization_id = ''ed32e526-3d47-41e9-8ddf-f1163a36db4f''::uuid',
                false, true, '')))[1]::text END
  UNION ALL
  SELECT 17, 'P2-01M table kai.evidence_measurements: org rows',
         CASE WHEN to_regclass('kai.evidence_measurements') IS NULL THEN 'table_missing'
              ELSE (xpath('/row/c/text()', query_to_xml(
                'SELECT count(*) AS c FROM kai.evidence_measurements WHERE organization_id = ''ed32e526-3d47-41e9-8ddf-f1163a36db4f''::uuid',
                false, true, '')))[1]::text END
  UNION ALL
  SELECT 18, 'org: evidence_items by type',
         coalesce((SELECT string_agg(concat_ws(' = ', evidence_type, cnt), ' | ')
                     FROM (SELECT evidence_type, count(*) AS cnt FROM kai.evidence_items
                            WHERE organization_id = (SELECT org_id FROM p) GROUP BY evidence_type) t), 'none')
  UNION ALL
  SELECT 19, 'org: claims by type',
         coalesce((SELECT string_agg(concat_ws(' = ', claim_type, cnt), ' | ')
                     FROM (SELECT claim_type, count(*) AS cnt FROM kai.claims
                            WHERE organization_id = (SELECT org_id FROM p) GROUP BY claim_type) t), 'none')
) checks
ORDER BY n;
