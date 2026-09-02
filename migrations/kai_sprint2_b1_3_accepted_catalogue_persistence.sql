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
-- Canonical drift safety (B1.3A): every natural-key identity this package
-- persists (source_type/source_code; requirement_source_id/framework_code/
-- version_label; requirement_framework_version_id/set_key;
-- requirement_set_id/requirement_key) is looked up before insert, not merely
-- guarded with WHERE NOT EXISTS. Three outcomes follow from that lookup:
--   identity absent                              -> insert the canonical row
--   identity exists, B1.3-owned fields match      -> compatible; continue
--   identity exists, any B1.3-owned field differs -> RAISE EXCEPTION
-- A raised exception aborts this DO block, which aborts the surrounding
-- transaction: a conflict at any level leaves no partial B1.3 catalogue
-- change behind. An exact rerun (identity present, all B1.3-owned fields
-- unchanged) remains a no-op against an already-persisted catalogue.
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
  v_existing_text text;
  v_existing_text2 text;
  v_existing_int integer;
BEGIN
  SELECT source_name INTO v_existing_text
  FROM kai.requirement_sources
  WHERE source_type = 'kai_standard' AND source_code = 'kai_baseline_impact_requirements';

  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirement_sources (source_type, source_code, source_name)
    VALUES ('kai_standard', 'kai_baseline_impact_requirements', 'KAI Baseline Impact Requirements');
  ELSIF v_existing_text IS DISTINCT FROM 'KAI Baseline Impact Requirements' THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirement_sources (source_type=kai_standard, source_code=kai_baseline_impact_requirements) already exists with source_name=%, expected source_name=%',
      v_existing_text, 'KAI Baseline Impact Requirements';
  END IF;

  SELECT requirement_source_id INTO v_source_id
  FROM kai.requirement_sources
  WHERE source_type = 'kai_standard' AND source_code = 'kai_baseline_impact_requirements';

  SELECT framework_name, framework_status INTO v_existing_text, v_existing_text2
  FROM kai.requirement_framework_versions
  WHERE requirement_source_id = v_source_id AND framework_code = 'kai_baseline_impact_v1' AND version_label = 'v1';

  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirement_framework_versions (requirement_source_id, framework_code, framework_name, version_label, framework_status)
    VALUES (v_source_id, 'kai_baseline_impact_v1', 'KAI Baseline Impact Requirements', 'v1', 'draft');
  ELSIF v_existing_text IS DISTINCT FROM 'KAI Baseline Impact Requirements' OR v_existing_text2 IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirement_framework_versions (requirement_source_id=%, framework_code=kai_baseline_impact_v1, version_label=v1) already exists with framework_name=%, framework_status=%, expected framework_name=%, framework_status=draft',
      v_source_id, v_existing_text, v_existing_text2, 'KAI Baseline Impact Requirements';
  END IF;

  SELECT requirement_framework_version_id INTO v_framework_version_id
  FROM kai.requirement_framework_versions
  WHERE requirement_source_id = v_source_id AND framework_code = 'kai_baseline_impact_v1' AND version_label = 'v1';

  -- purpose_intended_change
  SELECT set_name INTO v_existing_text FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'purpose_intended_change';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
    VALUES (v_framework_version_id, 'purpose_intended_change', 'Purpose & Intended Change');
  ELSIF v_existing_text IS DISTINCT FROM 'Purpose & Intended Change' THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirement_sets (requirement_framework_version_id=%, set_key=purpose_intended_change) already exists with set_name=%, expected set_name=%',
      v_framework_version_id, v_existing_text, 'Purpose & Intended Change';
  END IF;

  SELECT requirement_set_id INTO v_set_id FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'purpose_intended_change';

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_pur_001';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_pur_001', 'Intended outcome is explicitly defined', 'For each impact claim scope, the organization has articulated, in an explicit statement, the specific change it intends to create — distinct from the activities or outputs it delivers.', 0);
  ELSIF v_existing_text IS DISTINCT FROM 'Intended outcome is explicitly defined'
     OR v_existing_text2 IS DISTINCT FROM 'For each impact claim scope, the organization has articulated, in an explicit statement, the specific change it intends to create — distinct from the activities or outputs it delivers.'
     OR v_existing_int IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_pur_001) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_pur_002';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_pur_002', 'Rationale connecting activities to the intended outcome is known', 'The organization can state, at least narratively, why it believes its program activities lead to the stated outcome.', 1);
  ELSIF v_existing_text IS DISTINCT FROM 'Rationale connecting activities to the intended outcome is known'
     OR v_existing_text2 IS DISTINCT FROM 'The organization can state, at least narratively, why it believes its program activities lead to the stated outcome.'
     OR v_existing_int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_pur_002) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;

  -- program_delivery
  SELECT set_name INTO v_existing_text FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'program_delivery';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
    VALUES (v_framework_version_id, 'program_delivery', 'Program & Delivery');
  ELSIF v_existing_text IS DISTINCT FROM 'Program & Delivery' THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirement_sets (requirement_framework_version_id=%, set_key=program_delivery) already exists with set_name=%, expected set_name=%',
      v_framework_version_id, v_existing_text, 'Program & Delivery';
  END IF;

  SELECT requirement_set_id INTO v_set_id FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'program_delivery';

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_prog_001';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_prog_001', 'The program/activity intended to produce the outcome is identified', 'The specific program, service, or activity delivered toward the stated outcome is named and distinguishable from other things the organization does.', 2);
  ELSIF v_existing_text IS DISTINCT FROM 'The program/activity intended to produce the outcome is identified'
     OR v_existing_text2 IS DISTINCT FROM 'The specific program, service, or activity delivered toward the stated outcome is named and distinguishable from other things the organization does.'
     OR v_existing_int IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_prog_001) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_prog_002';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_prog_002', 'The population targeted for delivery is known', 'The organization can identify the population it intends to reach through the named program, as distinct from the population that experiences the outcome.', 3);
  ELSIF v_existing_text IS DISTINCT FROM 'The population targeted for delivery is known'
     OR v_existing_text2 IS DISTINCT FROM 'The organization can identify the population it intends to reach through the named program, as distinct from the population that experiences the outcome.'
     OR v_existing_int IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_prog_002) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;

  -- stakeholders
  SELECT set_name INTO v_existing_text FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'stakeholders';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
    VALUES (v_framework_version_id, 'stakeholders', 'Stakeholders');
  ELSIF v_existing_text IS DISTINCT FROM 'Stakeholders' THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirement_sets (requirement_framework_version_id=%, set_key=stakeholders) already exists with set_name=%, expected set_name=%',
      v_framework_version_id, v_existing_text, 'Stakeholders';
  END IF;

  SELECT requirement_set_id INTO v_set_id FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'stakeholders';

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_stk_001';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_stk_001', 'The stakeholder experiencing the intended outcome is identified', 'For each intended outcome, the specific stakeholder group expected to experience it (as opposed to merely receiving a service) is named.', 4);
  ELSIF v_existing_text IS DISTINCT FROM 'The stakeholder experiencing the intended outcome is identified'
     OR v_existing_text2 IS DISTINCT FROM 'For each intended outcome, the specific stakeholder group expected to experience it (as opposed to merely receiving a service) is named.'
     OR v_existing_int IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_stk_001) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;

  -- outcomes
  SELECT set_name INTO v_existing_text FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'outcomes';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
    VALUES (v_framework_version_id, 'outcomes', 'Outcomes');
  ELSIF v_existing_text IS DISTINCT FROM 'Outcomes' THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirement_sets (requirement_framework_version_id=%, set_key=outcomes) already exists with set_name=%, expected set_name=%',
      v_framework_version_id, v_existing_text, 'Outcomes';
  END IF;

  SELECT requirement_set_id INTO v_set_id FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'outcomes';

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_out_001';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_out_001', 'The stated outcome is distinguished from the output(s) that precede it', 'The outcome statement identifies a change in condition, behavior, knowledge, or status — not merely a count of people served or activities completed.', 5);
  ELSIF v_existing_text IS DISTINCT FROM 'The stated outcome is distinguished from the output(s) that precede it'
     OR v_existing_text2 IS DISTINCT FROM 'The outcome statement identifies a change in condition, behavior, knowledge, or status — not merely a count of people served or activities completed.'
     OR v_existing_int IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_out_001) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_out_002';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_out_002', 'The applicable measurement period is known', 'The organization knows the period over which the outcome is expected to emerge and be measured (e.g., during the program, at exit, at a defined follow-up interval).', 6);
  ELSIF v_existing_text IS DISTINCT FROM 'The applicable measurement period is known'
     OR v_existing_text2 IS DISTINCT FROM 'The organization knows the period over which the outcome is expected to emerge and be measured (e.g., during the program, at exit, at a defined follow-up interval).'
     OR v_existing_int IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_out_002) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;

  -- indicators
  SELECT set_name INTO v_existing_text FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'indicators';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
    VALUES (v_framework_version_id, 'indicators', 'Indicators');
  ELSIF v_existing_text IS DISTINCT FROM 'Indicators' THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirement_sets (requirement_framework_version_id=%, set_key=indicators) already exists with set_name=%, expected set_name=%',
      v_framework_version_id, v_existing_text, 'Indicators';
  END IF;

  SELECT requirement_set_id INTO v_set_id FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'indicators';

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_ind_001';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_ind_001', 'At least one indicator is associated with the intended outcome', 'The organization has identified at least one specific, observable measure used to track progress toward the stated outcome.', 7);
  ELSIF v_existing_text IS DISTINCT FROM 'At least one indicator is associated with the intended outcome'
     OR v_existing_text2 IS DISTINCT FROM 'The organization has identified at least one specific, observable measure used to track progress toward the stated outcome.'
     OR v_existing_int IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_ind_001) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_ind_002';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_ind_002', 'The indicator''s unit and direction of desired change are known', 'For each indicator, what is being measured (unit) and which direction represents progress are known.', 8);
  ELSIF v_existing_text IS DISTINCT FROM 'The indicator''s unit and direction of desired change are known'
     OR v_existing_text2 IS DISTINCT FROM 'For each indicator, what is being measured (unit) and which direction represents progress are known.'
     OR v_existing_int IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_ind_002) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;

  -- data_evidence
  SELECT set_name INTO v_existing_text FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'data_evidence';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
    VALUES (v_framework_version_id, 'data_evidence', 'Data & Evidence');
  ELSIF v_existing_text IS DISTINCT FROM 'Data & Evidence' THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirement_sets (requirement_framework_version_id=%, set_key=data_evidence) already exists with set_name=%, expected set_name=%',
      v_framework_version_id, v_existing_text, 'Data & Evidence';
  END IF;

  SELECT requirement_set_id INTO v_set_id FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'data_evidence';

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_data_001';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_data_001', 'The source and provenance of data used as evidence is known and governed', 'Each piece of data supporting a claim can be traced to a specific, classified source with a known review/promotion status.', 9);
  ELSIF v_existing_text IS DISTINCT FROM 'The source and provenance of data used as evidence is known and governed'
     OR v_existing_text2 IS DISTINCT FROM 'Each piece of data supporting a claim can be traced to a specific, classified source with a known review/promotion status.'
     OR v_existing_int IS DISTINCT FROM 9 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_data_001) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_data_002';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_data_002', 'Known limitations or quality issues in the underlying data are documented', 'Data-quality concerns relevant to interpreting a claim (missingness, unclear definitions/time period/entity level, small-sample risk) are captured rather than left implicit.', 10);
  ELSIF v_existing_text IS DISTINCT FROM 'Known limitations or quality issues in the underlying data are documented'
     OR v_existing_text2 IS DISTINCT FROM 'Data-quality concerns relevant to interpreting a claim (missingness, unclear definitions/time period/entity level, small-sample risk) are captured rather than left implicit.'
     OR v_existing_int IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_data_002) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_data_003';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_data_003', 'A reported outcome-performance statement has traceable supporting evidence', 'Any statement about outcome performance is backed by an identifiable, linked piece of evidence rather than an unsupported assertion.', 11);
  ELSIF v_existing_text IS DISTINCT FROM 'A reported outcome-performance statement has traceable supporting evidence'
     OR v_existing_text2 IS DISTINCT FROM 'Any statement about outcome performance is backed by an identifiable, linked piece of evidence rather than an unsupported assertion.'
     OR v_existing_int IS DISTINCT FROM 11 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_data_003) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;

  -- performance_impact
  SELECT set_name INTO v_existing_text FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'performance_impact';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
    VALUES (v_framework_version_id, 'performance_impact', 'Performance & Impact');
  ELSIF v_existing_text IS DISTINCT FROM 'Performance & Impact' THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirement_sets (requirement_framework_version_id=%, set_key=performance_impact) already exists with set_name=%, expected set_name=%',
      v_framework_version_id, v_existing_text, 'Performance & Impact';
  END IF;

  SELECT requirement_set_id INTO v_set_id FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'performance_impact';

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_perf_001';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_perf_001', 'The organization can distinguish output/reach performance from outcome/change performance', 'When a performance result is reported, it is knowable whether it demonstrates reach/delivery or an actual change experienced by the stakeholder — the two are not treated as equivalent.', 12);
  ELSIF v_existing_text IS DISTINCT FROM 'The organization can distinguish output/reach performance from outcome/change performance'
     OR v_existing_text2 IS DISTINCT FROM 'When a performance result is reported, it is knowable whether it demonstrates reach/delivery or an actual change experienced by the stakeholder — the two are not treated as equivalent.'
     OR v_existing_int IS DISTINCT FROM 12 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_perf_001) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_perf_002';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_perf_002', 'Performance is reported against the stated intended outcome, not a substitute measure', 'A reported performance result can be traced back to the specific outcome/indicator it''s meant to represent, rather than a looser, more available substitute.', 13);
  ELSIF v_existing_text IS DISTINCT FROM 'Performance is reported against the stated intended outcome, not a substitute measure'
     OR v_existing_text2 IS DISTINCT FROM 'A reported performance result can be traced back to the specific outcome/indicator it''s meant to represent, rather than a looser, more available substitute.'
     OR v_existing_int IS DISTINCT FROM 13 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_perf_002) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;

  -- contribution_limitations_risk
  SELECT set_name INTO v_existing_text FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'contribution_limitations_risk';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
    VALUES (v_framework_version_id, 'contribution_limitations_risk', 'Contribution, Limitations & Risk');
  ELSIF v_existing_text IS DISTINCT FROM 'Contribution, Limitations & Risk' THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirement_sets (requirement_framework_version_id=%, set_key=contribution_limitations_risk) already exists with set_name=%, expected set_name=%',
      v_framework_version_id, v_existing_text, 'Contribution, Limitations & Risk';
  END IF;

  SELECT requirement_set_id INTO v_set_id FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'contribution_limitations_risk';

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_contrib_001';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_contrib_001', 'The organization''s contribution to the observed outcome, versus other factors, is addressed', 'Where an outcome is reported, the organization has stated what role its own program played relative to other plausible causes — even if only qualitatively.', 14);
  ELSIF v_existing_text IS DISTINCT FROM 'The organization''s contribution to the observed outcome, versus other factors, is addressed'
     OR v_existing_text2 IS DISTINCT FROM 'Where an outcome is reported, the organization has stated what role its own program played relative to other plausible causes — even if only qualitatively.'
     OR v_existing_int IS DISTINCT FROM 14 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_contrib_001) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_contrib_002';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_contrib_002', 'Known limitations affecting confidence in a reported result are documented', 'Where a result carries a limitation affecting confidence (small sample, conflicting sources, unassessed evidence strength), that limitation is recorded rather than omitted.', 15);
  ELSIF v_existing_text IS DISTINCT FROM 'Known limitations affecting confidence in a reported result are documented'
     OR v_existing_text2 IS DISTINCT FROM 'Where a result carries a limitation affecting confidence (small sample, conflicting sources, unassessed evidence strength), that limitation is recorded rather than omitted.'
     OR v_existing_int IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_contrib_002) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_contrib_003';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_contrib_003', 'Unresolved conflicts or gaps affecting a claim are tracked to a decision before use', 'Where claims conflict or a data-quality gap remains, that conflict/gap is tracked to a resolution status (resolved, risk-flagged, or knowingly left open) rather than disappearing silently.', 16);
  ELSIF v_existing_text IS DISTINCT FROM 'Unresolved conflicts or gaps affecting a claim are tracked to a decision before use'
     OR v_existing_text2 IS DISTINCT FROM 'Where claims conflict or a data-quality gap remains, that conflict/gap is tracked to a resolution status (resolved, risk-flagged, or knowingly left open) rather than disappearing silently.'
     OR v_existing_int IS DISTINCT FROM 16 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_contrib_003) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;

  -- learning_improvement
  SELECT set_name INTO v_existing_text FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'learning_improvement';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
    VALUES (v_framework_version_id, 'learning_improvement', 'Learning & Improvement');
  ELSIF v_existing_text IS DISTINCT FROM 'Learning & Improvement' THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirement_sets (requirement_framework_version_id=%, set_key=learning_improvement) already exists with set_name=%, expected set_name=%',
      v_framework_version_id, v_existing_text, 'Learning & Improvement';
  END IF;

  SELECT requirement_set_id INTO v_set_id FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'learning_improvement';

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_learn_001';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_learn_001', 'Findings inform a subsequent decision about the program or its measurement approach', 'When a finding is produced, there is a record of what decision it informed (a program adjustment, a change to what''s measured, or a deliberate decision to continue unchanged).', 17);
  ELSIF v_existing_text IS DISTINCT FROM 'Findings inform a subsequent decision about the program or its measurement approach'
     OR v_existing_text2 IS DISTINCT FROM 'When a finding is produced, there is a record of what decision it informed (a program adjustment, a change to what''s measured, or a deliberate decision to continue unchanged).'
     OR v_existing_int IS DISTINCT FROM 17 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_learn_001) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_learn_002';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_learn_002', 'Review of a claim, evidence item, or evaluation result by a qualified reviewer is known', 'Review of a claim, evidence item, or evaluation result by a qualified reviewer is known.', 18);
  ELSIF v_existing_text IS DISTINCT FROM 'Review of a claim, evidence item, or evaluation result by a qualified reviewer is known'
     OR v_existing_text2 IS DISTINCT FROM 'Review of a claim, evidence item, or evaluation result by a qualified reviewer is known.'
     OR v_existing_int IS DISTINCT FROM 18 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_learn_002) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;

  -- communication_accountability
  SELECT set_name INTO v_existing_text FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'communication_accountability';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
    VALUES (v_framework_version_id, 'communication_accountability', 'Communication & Accountability');
  ELSIF v_existing_text IS DISTINCT FROM 'Communication & Accountability' THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirement_sets (requirement_framework_version_id=%, set_key=communication_accountability) already exists with set_name=%, expected set_name=%',
      v_framework_version_id, v_existing_text, 'Communication & Accountability';
  END IF;

  SELECT requirement_set_id INTO v_set_id FROM kai.requirement_sets
  WHERE requirement_framework_version_id = v_framework_version_id AND set_key = 'communication_accountability';

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_comm_001';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_comm_001', 'Who a result is permitted to be shared with is known before it is communicated', 'For any claim/evidence/result, the organization knows the audience(s) it is currently approved for, distinct from audiences not yet approved.', 19);
  ELSIF v_existing_text IS DISTINCT FROM 'Who a result is permitted to be shared with is known before it is communicated'
     OR v_existing_text2 IS DISTINCT FROM 'For any claim/evidence/result, the organization knows the audience(s) it is currently approved for, distinct from audiences not yet approved.'
     OR v_existing_int IS DISTINCT FROM 19 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_comm_001) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;

  SELECT requirement_label, requirement_description, display_order INTO v_existing_text, v_existing_text2, v_existing_int
  FROM kai.requirements WHERE requirement_set_id = v_set_id AND requirement_key = 'ir_comm_002';
  IF v_existing_text IS NULL THEN
    INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
    VALUES (v_set_id, 'ir_comm_002', 'A reported result can be traced back to who is accountable for its accuracy', 'A reported result can be traced back to who is accountable for its accuracy.', 20);
  ELSIF v_existing_text IS DISTINCT FROM 'A reported result can be traced back to who is accountable for its accuracy'
     OR v_existing_text2 IS DISTINCT FROM 'A reported result can be traced back to who is accountable for its accuracy.'
     OR v_existing_int IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION 'B1.3 canonical drift: kai.requirements (requirement_set_id=%, requirement_key=ir_comm_002) already exists with conflicting requirement_label/requirement_description/display_order',
      v_set_id;
  END IF;
END $$;

COMMIT;
