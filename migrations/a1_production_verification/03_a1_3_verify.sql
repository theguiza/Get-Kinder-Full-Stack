-- A1.3 production postcondition verifier (SELECT-only, read-only).
-- Derived solely from
-- migrations/kai_sprint2_a1_3_impact_evaluations_and_results.sql as it
-- exists at the current repository HEAD. Proves the full structural shape
-- of kai.impact_evaluations, kai.impact_evaluation_results, and the A1.3
-- ALTER-added compatibility constraint on kai.impact_evaluation_criteria --
-- not mere object existence.
--
-- Does not mutate any state. Safe to run against production read-only.

WITH checks(check_id, ok) AS (
  VALUES
  -- ALTER-added A1.3 compatibility constraint on kai.impact_evaluation_criteria
  ('unique:impact_evaluation_criteria_a1_3_id_framework_version_unique',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_criteria'
        AND c.conname='impact_evaluation_criteria_a1_3_id_framework_version_unique' AND c.contype='u'
        AND pg_get_constraintdef(c.oid) = 'UNIQUE (criterion_id, framework_version_id)')),

  -- ---- kai.impact_evaluations ----
  ('table:kai.impact_evaluations:exists',
    to_regclass('kai.impact_evaluations') IS NOT NULL),

  ('table:kai.impact_evaluations:column_count_7',
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluations') = 7),

  ('col:impact_evaluation_id:uuid_notnull_default_gen_random_uuid',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluations'
        AND column_name='impact_evaluation_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default ILIKE '%gen_random_uuid%')),
  ('col:evaluations.organization_id:uuid_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluations'
        AND column_name='organization_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:impact_outcome_context_id:uuid_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluations'
        AND column_name='impact_outcome_context_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:evaluations.framework_version_id:uuid_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluations'
        AND column_name='framework_version_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:evaluations.created_by:uuid_nullable_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluations'
        AND column_name='created_by' AND data_type='uuid'
        AND is_nullable='YES' AND column_default IS NULL)),
  ('col:evaluations.created_by_type:text_notnull_default_human',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluations'
        AND column_name='created_by_type' AND data_type='text'
        AND is_nullable='NO' AND column_default ILIKE '%human%')),
  ('col:evaluations.created_at:timestamptz_notnull_default_now',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluations'
        AND column_name='created_at' AND data_type='timestamp with time zone'
        AND is_nullable='NO' AND column_default ILIKE '%now()%')),

  ('pk:impact_evaluations:impact_evaluation_id',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluations' AND c.contype='p'
        AND pg_get_constraintdef(c.oid) = 'PRIMARY KEY (impact_evaluation_id)')),

  ('unique:impact_evaluations_a1_3_id_org_framework_unique',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluations'
        AND c.conname='impact_evaluations_a1_3_id_org_framework_unique' AND c.contype='u'
        AND pg_get_constraintdef(c.oid) = 'UNIQUE (impact_evaluation_id, organization_id, framework_version_id)')),

  ('fk:impact_evaluations_a1_3_outcome_context_fk',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluations'
        AND c.conname='impact_evaluations_a1_3_outcome_context_fk' AND c.contype='f'
        AND pg_get_constraintdef(c.oid) = 'FOREIGN KEY (impact_outcome_context_id, organization_id) REFERENCES kai.impact_outcome_contexts(impact_outcome_context_id, organization_id) ON DELETE RESTRICT')),

  ('fk:impact_evaluations_a1_3_framework_version_fk',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluations'
        AND c.conname='impact_evaluations_a1_3_framework_version_fk' AND c.contype='f'
        AND pg_get_constraintdef(c.oid) = 'FOREIGN KEY (framework_version_id) REFERENCES kai.impact_evaluation_framework_versions(framework_version_id) ON DELETE RESTRICT')),

  ('table:impact_evaluations:check_count_1',
    (SELECT count(*) FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluations' AND c.contype='c') = 1),

  ('check:impact_evaluations_a1_3_created_by_type_check',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluations'
        AND c.conname='impact_evaluations_a1_3_created_by_type_check' AND c.contype='c'
        AND strpos(pg_get_constraintdef(c.oid), 'created_by_type') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'human') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'system') > 0)),

  ('index:ix_impact_evaluations_a1_3_tenant_context',
    EXISTS (SELECT 1 FROM pg_class i
      JOIN pg_index ix ON ix.indexrelid = i.oid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname='kai' AND t.relname='impact_evaluations'
        AND i.relname='ix_impact_evaluations_a1_3_tenant_context'
        AND NOT ix.indisunique
        AND pg_get_indexdef(i.oid) = 'CREATE INDEX ix_impact_evaluations_a1_3_tenant_context ON kai.impact_evaluations USING btree (organization_id, impact_outcome_context_id)')),

  -- ---- kai.impact_evaluation_results ----
  ('table:kai.impact_evaluation_results:exists',
    to_regclass('kai.impact_evaluation_results') IS NOT NULL),

  ('table:kai.impact_evaluation_results:column_count_9',
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_results') = 9),

  ('col:impact_evaluation_result_id:uuid_notnull_default_gen_random_uuid',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_results'
        AND column_name='impact_evaluation_result_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default ILIKE '%gen_random_uuid%')),
  ('col:results.organization_id:uuid_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_results'
        AND column_name='organization_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:impact_evaluation_id:uuid_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_results'
        AND column_name='impact_evaluation_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:results.framework_version_id:uuid_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_results'
        AND column_name='framework_version_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:results.criterion_id:uuid_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_results'
        AND column_name='criterion_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:assessment_state:text_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_results'
        AND column_name='assessment_state' AND data_type='text'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:safe_explanation:text_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_results'
        AND column_name='safe_explanation' AND data_type='text'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:limitation_notes:text_nullable_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_results'
        AND column_name='limitation_notes' AND data_type='text'
        AND is_nullable='YES' AND column_default IS NULL)),
  ('col:results.created_at:timestamptz_notnull_default_now',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_results'
        AND column_name='created_at' AND data_type='timestamp with time zone'
        AND is_nullable='NO' AND column_default ILIKE '%now()%')),

  ('pk:impact_evaluation_results:impact_evaluation_result_id',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_results' AND c.contype='p'
        AND pg_get_constraintdef(c.oid) = 'PRIMARY KEY (impact_evaluation_result_id)')),

  ('unique:impact_evaluation_results_a1_3_identity_unique',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_results'
        AND c.conname='impact_evaluation_results_a1_3_identity_unique' AND c.contype='u'
        AND pg_get_constraintdef(c.oid) = 'UNIQUE (impact_evaluation_id, criterion_id)')),

  ('fk:impact_evaluation_results_a1_3_evaluation_fk',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_results'
        AND c.conname='impact_evaluation_results_a1_3_evaluation_fk' AND c.contype='f'
        AND pg_get_constraintdef(c.oid) = 'FOREIGN KEY (impact_evaluation_id, organization_id, framework_version_id) REFERENCES kai.impact_evaluations(impact_evaluation_id, organization_id, framework_version_id) ON DELETE RESTRICT')),

  ('fk:impact_evaluation_results_a1_3_criterion_fk',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_results'
        AND c.conname='impact_evaluation_results_a1_3_criterion_fk' AND c.contype='f'
        AND pg_get_constraintdef(c.oid) = 'FOREIGN KEY (criterion_id, framework_version_id) REFERENCES kai.impact_evaluation_criteria(criterion_id, framework_version_id) ON DELETE RESTRICT')),

  ('table:impact_evaluation_results:check_count_4',
    (SELECT count(*) FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_results' AND c.contype='c') = 4),

  ('check:impact_evaluation_results_a1_3_assessment_state_check',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_results'
        AND c.conname='impact_evaluation_results_a1_3_assessment_state_check' AND c.contype='c'
        AND strpos(pg_get_constraintdef(c.oid), 'assessment_state') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'supported_with_limitation') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'not_supported') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'needs_more_information') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'not_applicable') > 0)),

  ('check:impact_evaluation_results_a1_3_safe_explanation_check',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_results'
        AND c.conname='impact_evaluation_results_a1_3_safe_explanation_check' AND c.contype='c'
        AND strpos(pg_get_constraintdef(c.oid), 'safe_explanation') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'btrim') > 0
        AND strpos(pg_get_constraintdef(c.oid), '2000') > 0)),

  ('check:impact_evaluation_results_a1_3_limitation_notes_length_check',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_results'
        AND c.conname='impact_evaluation_results_a1_3_limitation_notes_length_check' AND c.contype='c'
        AND strpos(pg_get_constraintdef(c.oid), 'limitation_notes') > 0
        AND strpos(pg_get_constraintdef(c.oid), '2000') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'IS NULL') > 0)),

  ('check:impact_evaluation_results_a1_3_limitation_notes_pairing_check',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_results'
        AND c.conname='impact_evaluation_results_a1_3_limitation_notes_pairing_check' AND c.contype='c'
        AND strpos(pg_get_constraintdef(c.oid), 'supported_with_limitation') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'limitation_notes') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'IS NOT NULL') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'IS NULL') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'btrim') > 0)),

  ('index:ix_impact_evaluation_results_a1_3_evaluation',
    EXISTS (SELECT 1 FROM pg_class i
      JOIN pg_index ix ON ix.indexrelid = i.oid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname='kai' AND t.relname='impact_evaluation_results'
        AND i.relname='ix_impact_evaluation_results_a1_3_evaluation'
        AND NOT ix.indisunique
        AND pg_get_indexdef(i.oid) = 'CREATE INDEX ix_impact_evaluation_results_a1_3_evaluation ON kai.impact_evaluation_results USING btree (impact_evaluation_id)'))
)
SELECT
  CASE WHEN bool_and(ok) THEN 'A1_3_VERIFIED' ELSE 'INCOMPLETE' END AS package_status,
  count(*) FILTER (WHERE NOT ok) AS failed_check_count,
  COALESCE(string_agg(check_id, ', ' ORDER BY check_id) FILTER (WHERE NOT ok), '') AS failed_checks
FROM checks;
