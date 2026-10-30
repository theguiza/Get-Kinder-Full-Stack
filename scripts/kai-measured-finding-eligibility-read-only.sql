-- KAI measured-finding eligibility: the ordinary internal record-count rule's
-- inputs for one promoted source version, and one reviewer's KAI roles.
-- READ-ONLY. One SELECT statement; it changes nothing and inserts nothing.
-- Metadata only: no cell values, file names, definition text or claim text.
-- Run it in the pgAdmin Query Tool (Execute script, F5) and read the Data
-- Output grid. Edit the two literals in `params` only.
--
-- The rule (Backend/kai/dictionary/postgresOrdinaryInternalFactAuthority.js,
-- applied by P2-06 to the internal audience only) needs every one of:
--   R1 evidence_type = source_record_count_measurement
--   R2 a human_confirmed record-count definition of the same source version
--      (the application also re-checks the measurement against its basis)
--   R3 claim_type = finding restating that measurement (the application
--      compares the exact composed statement; not evaluated here)
--   R4 the source version is current
--   R5 its current sensitivity decision is complete ('reviewed')
--   R6 allowed use = 'allowed' and AI processing permitted
--   R7 each of the six section 7.2 categories recorded 'absent'
--      ('unknown' and 'present' both fail; the value says which)
-- The capability canRecordEvidenceReviewDecision needs a gk_reviewer or
-- gk_admin role (global or membership) plus an ACTIVE membership in the
-- organization (A1..A3), or platform superuser authority (not in kai.*).
WITH
params(source_version_id, actor_email) AS (
  VALUES ('485b90cd-cdf3-470e-a308-fe75d5d4b5fe'::uuid, ''::text)
),
sv AS (
  SELECT v.source_version_id, v.organization_id, v.is_current, v.intake_sensitivity_profile_id
    FROM kai.source_versions v JOIN params p ON p.source_version_id = v.source_version_id
),
decision_heads AS (
  SELECT d.*
    FROM kai.intake_sensitivity_review_decisions d JOIN sv ON sv.organization_id = d.organization_id
                                                    AND sv.intake_sensitivity_profile_id = d.intake_sensitivity_profile_id
   WHERE NOT EXISTS (SELECT 1 FROM kai.intake_sensitivity_review_decisions s WHERE s.supersedes_decision_id = d.decision_id)
),
head AS (SELECT * FROM decision_heads WHERE (SELECT count(*) FROM decision_heads) = 1),
m AS (
  SELECT m.evidence_item_id, m.calculation_method, m.measured_value, m.total_record_count, m.blank_record_count, m.duplicate_record_count,
         e.evidence_type, e.support_strength, e.evidence_review_status, sl.coordinates->>'sheet_key' AS sheet_key,
         def.definition_status, def.source_version_id = m.source_version_id AS definition_same_version
    FROM kai.evidence_measurements m
    JOIN sv ON sv.organization_id = m.organization_id AND sv.source_version_id = m.source_version_id
    JOIN kai.evidence_items e ON e.organization_id = m.organization_id AND e.evidence_item_id = m.evidence_item_id
    JOIN kai.source_locators sl ON sl.organization_id = e.organization_id AND sl.source_locator_id = e.source_locator_id
    JOIN kai.source_measurement_definitions def ON def.organization_id = m.organization_id
                                               AND def.source_measurement_definition_id = m.source_measurement_definition_id
),
c AS (
  SELECT c.claim_id, c.evidence_item_id, c.claim_type, c.claim_review_status, c.claim_strength
    FROM kai.claims c JOIN m ON m.evidence_item_id = c.evidence_item_id JOIN sv ON sv.organization_id = c.organization_id
),
queues AS (
  SELECT q.queue_type, q.target_object_id, q.queue_status, q.review_status
    FROM kai.review_queue_items q JOIN sv ON sv.organization_id = q.organization_id
   WHERE (q.queue_type = 'evidence_review' AND q.target_object_id IN (SELECT evidence_item_id FROM m))
      OR (q.queue_type = 'claim_review' AND q.target_object_id IN (SELECT claim_id FROM c))
),
evidence_heads AS (
  SELECT d.evidence_item_id, d.decision_outcome, d.decided_by_role
    FROM kai.evidence_review_decisions d JOIN m ON m.evidence_item_id = d.evidence_item_id
   WHERE NOT EXISTS (SELECT 1 FROM kai.evidence_review_decisions s WHERE s.supersedes_decision_id = d.decision_id)
),
claim_heads AS (
  SELECT d.claim_id, d.decision_outcome, d.decided_by_role, d.approved_audiences
    FROM kai.claim_review_decisions d JOIN c ON c.claim_id = d.claim_id
   WHERE NOT EXISTS (SELECT 1 FROM kai.claim_review_decisions s WHERE s.supersedes_decision_id = d.decision_id)
),
actor AS (
  SELECT u.user_id FROM kai.users u JOIN params p ON p.actor_email <> '' AND lower(u.email) = lower(p.actor_email)
),
rows(seq, item, value) AS (
  SELECT 10, 'source_version.found', (SELECT count(*) FROM sv)::text
  UNION ALL SELECT 11, 'source_version.organization_id', (SELECT organization_id::text FROM sv)
  UNION ALL SELECT 12, 'R4 source_version.is_current', (SELECT is_current::text FROM sv)
  UNION ALL SELECT 20, 'sensitivity_decision.current_heads', (SELECT count(*) FROM decision_heads)::text
  UNION ALL SELECT 21, 'R5 sensitivity_decision.decision_outcome', (SELECT decision_outcome FROM head)
  UNION ALL SELECT 22, 'R6 reviewed_allowed_use_status', (SELECT reviewed_allowed_use_status FROM head)
  UNION ALL SELECT 23, 'R6 reviewed_llm_processing_allowed', (SELECT reviewed_llm_processing_allowed::text FROM head)
  UNION ALL SELECT 24, 'R7 reviewed_personal_data_status', (SELECT reviewed_personal_data_status FROM head)
  UNION ALL SELECT 25, 'R7 reviewed_minor_data_status', (SELECT reviewed_minor_data_status FROM head)
  UNION ALL SELECT 26, 'R7 reviewed_health_housing_justice_immigration_status', (SELECT reviewed_health_housing_justice_immigration_status FROM head)
  UNION ALL SELECT 27, 'R7 reviewed_indigenous_governance_status', (SELECT reviewed_indigenous_governance_status FROM head)
  UNION ALL SELECT 28, 'R7 reviewed_story_testimonial_status', (SELECT reviewed_story_testimonial_status FROM head)
  UNION ALL SELECT 29, 'R7 reviewed_small_cell_risk_status', (SELECT reviewed_small_cell_risk_status FROM head)
  UNION ALL SELECT 30, 'sensitivity_decision.decided_by_role', (SELECT decided_by_role FROM head)
  UNION ALL SELECT 40, 'measurement.count', (SELECT count(*) FROM m)::text
  UNION ALL SELECT 41 + row_number() OVER (ORDER BY evidence_item_id), 'measurement ' || evidence_item_id::text,
         'R1 evidence_type=' || evidence_type || '; R2 definition_status=' || definition_status || ', same_version=' || definition_same_version::text
         || '; method=' || calculation_method || '; sheet_key=' || coalesce(sheet_key, '(none)') || '; measured=' || measured_value::text
         || ' (data ' || total_record_count::text || ', blank ' || blank_record_count::text || ', duplicates ' || duplicate_record_count::text || ')'
         || '; support_strength=' || support_strength || '; evidence_review_status=' || coalesce(evidence_review_status, '(null)')
    FROM m
  UNION ALL SELECT 60 + row_number() OVER (ORDER BY claim_id), 'claim ' || claim_id::text,
         'R3 claim_type=' || claim_type || '; claim_review_status=' || coalesce(claim_review_status, '(null)') || '; claim_strength=' || coalesce(claim_strength, '(null)')
    FROM c
  UNION ALL SELECT 80 + row_number() OVER (ORDER BY queue_type, target_object_id), 'queue ' || queue_type || ' ' || target_object_id::text,
         queue_status || ' / ' || review_status
    FROM queues
  UNION ALL SELECT 100, 'evidence_review_decision.heads', coalesce((SELECT string_agg(decision_outcome || ' by ' || decided_by_role, '; ') FROM evidence_heads), 'none')
  UNION ALL SELECT 101, 'claim_review_decision.heads', coalesce((SELECT string_agg(decision_outcome || ' by ' || decided_by_role || ' for ' || array_to_string(approved_audiences, ','), '; ') FROM claim_heads), 'none')
  UNION ALL SELECT 102, 'coverage_review_decisions.count',
         (SELECT count(*) FROM kai.coverage_review_decisions d JOIN sv ON sv.organization_id = d.organization_id WHERE d.claim_id IN (SELECT claim_id FROM c))::text
  UNION ALL SELECT 120, 'A0 actor.found (params.actor_email)', (SELECT count(*) FROM actor)::text
  UNION ALL SELECT 121, 'A1 actor.global_kai_roles',
         coalesce((SELECT string_agg(r.role_name, ', ' ORDER BY r.role_name) FROM kai.user_roles ur JOIN kai.roles r ON r.role_id = ur.role_id WHERE ur.user_id IN (SELECT user_id FROM actor)), 'none')
  UNION ALL SELECT 122, 'A2 actor.memberships_in_this_organization',
         coalesce((SELECT string_agg(om.role_name || ' (' || om.membership_status || ')', ', ' ORDER BY om.role_name)
                     FROM kai.organization_memberships om JOIN sv ON sv.organization_id = om.organization_id WHERE om.user_id IN (SELECT user_id FROM actor)), 'none')
  UNION ALL SELECT 123, 'A3 actor.may_record_gk_evidence_review (excluding platform superuser)',
         (EXISTS (SELECT 1 FROM kai.organization_memberships om JOIN sv ON sv.organization_id = om.organization_id
                   WHERE om.user_id IN (SELECT user_id FROM actor) AND om.membership_status = 'active')
          AND (EXISTS (SELECT 1 FROM kai.organization_memberships om JOIN sv ON sv.organization_id = om.organization_id
                        WHERE om.user_id IN (SELECT user_id FROM actor) AND om.membership_status = 'active' AND om.role_name IN ('gk_reviewer', 'gk_admin'))
               OR EXISTS (SELECT 1 FROM kai.user_roles ur JOIN kai.roles r ON r.role_id = ur.role_id
                           WHERE ur.user_id IN (SELECT user_id FROM actor) AND r.role_name IN ('gk_reviewer', 'gk_admin'))))::text
)
SELECT seq, item, value FROM rows ORDER BY seq, item;
