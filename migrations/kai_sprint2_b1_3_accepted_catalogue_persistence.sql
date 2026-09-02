BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.requirement_sources') IS NULL THEN
    RAISE EXCEPTION 'kai.requirement_sources is required before the B1.3 accepted-catalogue-persistence migration';
  END IF;
  IF to_regclass('kai.requirement_framework_versions') IS NULL THEN
    RAISE EXCEPTION 'kai.requirement_framework_versions is required before the B1.3 accepted-catalogue-persistence migration';
  END IF;
  IF to_regclass('kai.requirement_sets') IS NULL THEN
    RAISE EXCEPTION 'kai.requirement_sets is required before the B1.3 accepted-catalogue-persistence migration';
  END IF;
  IF to_regclass('kai.requirements') IS NULL THEN
    RAISE EXCEPTION 'kai.requirements is required before the B1.3 accepted-catalogue-persistence migration';
  END IF;
END $$;

-- B1.3 owner decision (Persist Owner-Accepted Baseline Catalogue): this
-- package persists the owner-accepted
-- docs/kai/catalogues/KAI_B1_2_BASELINE_IMPACT_REQUIREMENTS_CATALOGUE_V1_ACCEPTED.md
-- catalogue into the existing B1.1 generic requirements model. It creates no
-- new relation and no new column - it is a data-only migration against
-- kai.requirement_sources, kai.requirement_framework_versions,
-- kai.requirement_sets, and kai.requirements. It never touches
-- kai.engagement_requirement_sets (0 rows added by this package), and it
-- never sets framework_status to anything other than 'draft' - activation is
-- a separate, later, owner-authorized action.
--
-- Rerun safety: every INSERT is guarded by a WHERE NOT EXISTS check against
-- the same natural-key columns the existing B1.1 UNIQUE constraints already
-- enforce (source_type/source_code; requirement_source_id/framework_code/
-- version_label; requirement_framework_version_id/set_key;
-- requirement_set_id/requirement_key). A rerun of this migration is a no-op
-- against an already-persisted catalogue; a failure partway through rolls
-- back atomically with the rest of the transaction, so no partial catalogue
-- is ever left behind.
--
-- display_order is a single sequence (0-20) spanning the whole framework
-- version, assigned in canonical domain order and then canonical
-- requirement order within each domain. kai.requirement_sets has no
-- display_order column of its own (existing B1.1 schema, unchanged here), so
-- each set's position in the canonical order is recoverable as the minimum
-- display_order among its own requirements.
--
-- requirement_label and requirement_description are copied verbatim, byte
-- for byte, from the canonical artefact - never rewritten, shortened, or
-- normalized.
DO $$
DECLARE
  v_source_id uuid;
  v_framework_version_id uuid;
  v_set_id uuid;
BEGIN
  INSERT INTO kai.requirement_sources (source_type, source_code, source_name)
  SELECT 'kai_standard', 'kai_baseline_impact_requirements', 'KAI Baseline Impact Requirements'
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirement_sources
    WHERE source_type = 'kai_standard' AND source_code = 'kai_baseline_impact_requirements'
  );

  SELECT requirement_source_id INTO v_source_id
  FROM kai.requirement_sources
  WHERE source_type = 'kai_standard' AND source_code = 'kai_baseline_impact_requirements';

  INSERT INTO kai.requirement_framework_versions (requirement_source_id, framework_code, framework_name, version_label, framework_status)
  SELECT v_source_id, 'kai_baseline_impact_v1', 'KAI Baseline Impact Requirements', 'v1', 'draft'
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirement_framework_versions
    WHERE requirement_source_id = v_source_id AND framework_code = 'kai_baseline_impact_v1' AND version_label = 'v1'
  );

  SELECT requirement_framework_version_id INTO v_framework_version_id
  FROM kai.requirement_framework_versions
  WHERE requirement_source_id = v_source_id AND framework_code = 'kai_baseline_impact_v1' AND version_label = 'v1';

  -- purpose_intended_change
  INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
  SELECT v_framework_version_id, 'purpose_intended_change', 'Purpose & Intended Change'
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirement_sets
    WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'purpose_intended_change'
  );

  SELECT requirement_set_id INTO v_set_id FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'purpose_intended_change';

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_pur_001', 'Intended outcome is explicitly defined', 'For each impact claim scope, the organization has articulated, in an explicit statement, the specific change it intends to create — distinct from the activities or outputs it delivers.', 0
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_pur_001'
  );

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_pur_002', 'Rationale connecting activities to the intended outcome is known', 'The organization can state, at least narratively, why it believes its program activities lead to the stated outcome.', 1
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_pur_002'
  );

  -- program_delivery
  INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
  SELECT v_framework_version_id, 'program_delivery', 'Program & Delivery'
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirement_sets
    WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'program_delivery'
  );

  SELECT requirement_set_id INTO v_set_id FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'program_delivery';

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_prog_001', 'The program/activity intended to produce the outcome is identified', 'The specific program, service, or activity delivered toward the stated outcome is named and distinguishable from other things the organization does.', 2
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_prog_001'
  );

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_prog_002', 'The population targeted for delivery is known', 'The organization can identify the population it intends to reach through the named program, as distinct from the population that experiences the outcome.', 3
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_prog_002'
  );

  -- stakeholders
  INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
  SELECT v_framework_version_id, 'stakeholders', 'Stakeholders'
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirement_sets
    WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'stakeholders'
  );

  SELECT requirement_set_id INTO v_set_id FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'stakeholders';

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_stk_001', 'The stakeholder experiencing the intended outcome is identified', 'For each intended outcome, the specific stakeholder group expected to experience it (as opposed to merely receiving a service) is named.', 4
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_stk_001'
  );

  -- outcomes
  INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
  SELECT v_framework_version_id, 'outcomes', 'Outcomes'
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirement_sets
    WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'outcomes'
  );

  SELECT requirement_set_id INTO v_set_id FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'outcomes';

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_out_001', 'The stated outcome is distinguished from the output(s) that precede it', 'The outcome statement identifies a change in condition, behavior, knowledge, or status — not merely a count of people served or activities completed.', 5
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_out_001'
  );

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_out_002', 'The applicable measurement period is known', 'The organization knows the period over which the outcome is expected to emerge and be measured (e.g., during the program, at exit, at a defined follow-up interval).', 6
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_out_002'
  );

  -- indicators
  INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
  SELECT v_framework_version_id, 'indicators', 'Indicators'
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirement_sets
    WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'indicators'
  );

  SELECT requirement_set_id INTO v_set_id FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'indicators';

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_ind_001', 'At least one indicator is associated with the intended outcome', 'The organization has identified at least one specific, observable measure used to track progress toward the stated outcome.', 7
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_ind_001'
  );

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_ind_002', 'The indicator''s unit and direction of desired change are known', 'For each indicator, what is being measured (unit) and which direction represents progress are known.', 8
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_ind_002'
  );

  -- data_evidence
  INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
  SELECT v_framework_version_id, 'data_evidence', 'Data & Evidence'
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirement_sets
    WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'data_evidence'
  );

  SELECT requirement_set_id INTO v_set_id FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'data_evidence';

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_data_001', 'The source and provenance of data used as evidence is known and governed', 'Each piece of data supporting a claim can be traced to a specific, classified source with a known review/promotion status.', 9
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_data_001'
  );

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_data_002', 'Known limitations or quality issues in the underlying data are documented', 'Data-quality concerns relevant to interpreting a claim (missingness, unclear definitions/time period/entity level, small-sample risk) are captured rather than left implicit.', 10
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_data_002'
  );

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_data_003', 'A reported outcome-performance statement has traceable supporting evidence', 'Any statement about outcome performance is backed by an identifiable, linked piece of evidence rather than an unsupported assertion.', 11
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_data_003'
  );

  -- performance_impact
  INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
  SELECT v_framework_version_id, 'performance_impact', 'Performance & Impact'
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirement_sets
    WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'performance_impact'
  );

  SELECT requirement_set_id INTO v_set_id FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'performance_impact';

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_perf_001', 'The organization can distinguish output/reach performance from outcome/change performance', 'When a performance result is reported, it is knowable whether it demonstrates reach/delivery or an actual change experienced by the stakeholder — the two are not treated as equivalent.', 12
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_perf_001'
  );

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_perf_002', 'Performance is reported against the stated intended outcome, not a substitute measure', 'A reported performance result can be traced back to the specific outcome/indicator it''s meant to represent, rather than a looser, more available substitute.', 13
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_perf_002'
  );

  -- contribution_limitations_risk
  INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
  SELECT v_framework_version_id, 'contribution_limitations_risk', 'Contribution, Limitations & Risk'
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirement_sets
    WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'contribution_limitations_risk'
  );

  SELECT requirement_set_id INTO v_set_id FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'contribution_limitations_risk';

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_contrib_001', 'The organization''s contribution to the observed outcome, versus other factors, is addressed', 'Where an outcome is reported, the organization has stated what role its own program played relative to other plausible causes — even if only qualitatively.', 14
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_contrib_001'
  );

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_contrib_002', 'Known limitations affecting confidence in a reported result are documented', 'Where a result carries a limitation affecting confidence (small sample, conflicting sources, unassessed evidence strength), that limitation is recorded rather than omitted.', 15
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_contrib_002'
  );

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_contrib_003', 'Unresolved conflicts or gaps affecting a claim are tracked to a decision before use', 'Where claims conflict or a data-quality gap remains, that conflict/gap is tracked to a resolution status (resolved, risk-flagged, or knowingly left open) rather than disappearing silently.', 16
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_contrib_003'
  );

  -- learning_improvement
  INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
  SELECT v_framework_version_id, 'learning_improvement', 'Learning & Improvement'
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirement_sets
    WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'learning_improvement'
  );

  SELECT requirement_set_id INTO v_set_id FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'learning_improvement';

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_learn_001', 'Findings inform a subsequent decision about the program or its measurement approach', 'When a finding is produced, there is a record of what decision it informed (a program adjustment, a change to what''s measured, or a deliberate decision to continue unchanged).', 17
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_learn_001'
  );

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_learn_002', 'Review of a claim, evidence item, or evaluation result by a qualified reviewer is known', 'Review of a claim, evidence item, or evaluation result by a qualified reviewer is known.', 18
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_learn_002'
  );

  -- communication_accountability
  INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
  SELECT v_framework_version_id, 'communication_accountability', 'Communication & Accountability'
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirement_sets
    WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'communication_accountability'
  );

  SELECT requirement_set_id INTO v_set_id FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'communication_accountability';

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_comm_001', 'Who a result is permitted to be shared with is known before it is communicated', 'For any claim/evidence/result, the organization knows the audience(s) it is currently approved for, distinct from audiences not yet approved.', 19
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_comm_001'
  );

  INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
  SELECT v_set_id, 'ir_comm_002', 'A reported result can be traced back to who is accountable for its accuracy', 'A reported result can be traced back to who is accountable for its accuracy.', 20
  WHERE NOT EXISTS (
    SELECT 1 FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_comm_002'
  );
END $$;

COMMIT;
