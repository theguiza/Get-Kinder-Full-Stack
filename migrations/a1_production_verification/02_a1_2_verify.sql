-- A1.2 production postcondition verifier (SELECT-only, read-only).
-- Derived solely from
-- migrations/kai_sprint2_a1_2_impact_evaluation_framework_and_criteria.sql
-- as it exists at the current repository HEAD. Proves the full structural
-- shape of kai.impact_evaluation_framework_versions and
-- kai.impact_evaluation_criteria (tables, columns, constraints, indexes) --
-- not mere object existence.
--
-- Does not mutate any state. Safe to run against production read-only.

WITH checks(check_id, ok) AS (
  VALUES
  -- ---- kai.impact_evaluation_framework_versions ----
  ('table:kai.impact_evaluation_framework_versions:exists',
    to_regclass('kai.impact_evaluation_framework_versions') IS NOT NULL),

  ('table:kai.impact_evaluation_framework_versions:column_count_7',
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_framework_versions') = 7),

  ('col:framework_version_id:uuid_notnull_default_gen_random_uuid',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_framework_versions'
        AND column_name='framework_version_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default ILIKE '%gen_random_uuid%')),
  ('col:framework_code:text_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_framework_versions'
        AND column_name='framework_code' AND data_type='text'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:framework_name:text_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_framework_versions'
        AND column_name='framework_name' AND data_type='text'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:version_label:text_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_framework_versions'
        AND column_name='version_label' AND data_type='text'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:framework_status:text_notnull_default_draft',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_framework_versions'
        AND column_name='framework_status' AND data_type='text'
        AND is_nullable='NO' AND column_default ILIKE '%draft%')),
  ('col:framework_versions.created_by_type:text_notnull_default_human',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_framework_versions'
        AND column_name='created_by_type' AND data_type='text'
        AND is_nullable='NO' AND column_default ILIKE '%human%')),
  ('col:framework_versions.created_at:timestamptz_notnull_default_now',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_framework_versions'
        AND column_name='created_at' AND data_type='timestamp with time zone'
        AND is_nullable='NO' AND column_default ILIKE '%now()%')),

  ('pk:impact_evaluation_framework_versions:framework_version_id',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_framework_versions' AND c.contype='p'
        AND pg_get_constraintdef(c.oid) = 'PRIMARY KEY (framework_version_id)')),

  ('unique:impact_evaluation_framework_versions_a1_2_identity_unique',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_framework_versions'
        AND c.conname='impact_evaluation_framework_versions_a1_2_identity_unique' AND c.contype='u'
        AND pg_get_constraintdef(c.oid) = 'UNIQUE (framework_code, version_label)')),

  ('table:impact_evaluation_framework_versions:check_count_5',
    (SELECT count(*) FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_framework_versions' AND c.contype='c') = 5),

  ('check:impact_evaluation_framework_versions_a1_2_framework_code_check',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_framework_versions'
        AND c.conname='impact_evaluation_framework_versions_a1_2_framework_code_check' AND c.contype='c'
        AND strpos(pg_get_constraintdef(c.oid), 'framework_code') > 0
        AND strpos(pg_get_constraintdef(c.oid), '^[a-z][a-z0-9_]{0,95}$') > 0)),

  ('check:impact_evaluation_framework_versions_a1_2_framework_name_check',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_framework_versions'
        AND c.conname='impact_evaluation_framework_versions_a1_2_framework_name_check' AND c.contype='c'
        AND strpos(pg_get_constraintdef(c.oid), 'framework_name') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'btrim') > 0
        AND strpos(pg_get_constraintdef(c.oid), '200') > 0)),

  ('check:impact_evaluation_framework_versions_a1_2_version_label_check',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_framework_versions'
        AND c.conname='impact_evaluation_framework_versions_a1_2_version_label_check' AND c.contype='c'
        AND strpos(pg_get_constraintdef(c.oid), 'version_label') > 0
        AND strpos(pg_get_constraintdef(c.oid), '^[a-z0-9][a-z0-9._-]{0,31}$') > 0)),

  ('check:impact_evaluation_framework_versions_a1_2_framework_status_check',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_framework_versions'
        AND c.conname='impact_evaluation_framework_versions_a1_2_framework_status_check' AND c.contype='c'
        AND strpos(pg_get_constraintdef(c.oid), 'framework_status') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'draft') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'active') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'retired') > 0)),

  ('check:impact_evaluation_framework_versions_a1_2_created_by_type_check',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_framework_versions'
        AND c.conname='impact_evaluation_framework_versions_a1_2_created_by_type_check' AND c.contype='c'
        AND strpos(pg_get_constraintdef(c.oid), 'created_by_type') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'human') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'system') > 0)),

  -- Partial UNIQUE INDEX: at most one active version per framework_code
  ('index:ux_impact_evaluation_framework_versions_a1_2_active_per_code',
    EXISTS (SELECT 1 FROM pg_class i
      JOIN pg_index ix ON ix.indexrelid = i.oid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname='kai' AND t.relname='impact_evaluation_framework_versions'
        AND i.relname='ux_impact_evaluation_framework_versions_a1_2_active_per_code'
        AND ix.indisunique
        AND pg_get_indexdef(i.oid) = 'CREATE UNIQUE INDEX ux_impact_evaluation_framework_versions_a1_2_active_per_code ON kai.impact_evaluation_framework_versions USING btree (framework_code) WHERE (framework_status = ''active''::text)')),

  -- ---- kai.impact_evaluation_criteria ----
  ('table:kai.impact_evaluation_criteria:exists',
    to_regclass('kai.impact_evaluation_criteria') IS NOT NULL),

  ('table:kai.impact_evaluation_criteria:column_count_8',
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_criteria') = 8),

  ('col:criterion_id:uuid_notnull_default_gen_random_uuid',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_criteria'
        AND column_name='criterion_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default ILIKE '%gen_random_uuid%')),
  ('col:criteria.framework_version_id:uuid_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_criteria'
        AND column_name='framework_version_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:criterion_key:text_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_criteria'
        AND column_name='criterion_key' AND data_type='text'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:criterion_label:text_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_criteria'
        AND column_name='criterion_label' AND data_type='text'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:description:text_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_criteria'
        AND column_name='description' AND data_type='text'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:evaluation_guidance:text_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_criteria'
        AND column_name='evaluation_guidance' AND data_type='text'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:display_order:integer_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_criteria'
        AND column_name='display_order' AND data_type='integer'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:criteria.created_at:timestamptz_notnull_default_now',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_criteria'
        AND column_name='created_at' AND data_type='timestamp with time zone'
        AND is_nullable='NO' AND column_default ILIKE '%now()%')),

  ('pk:impact_evaluation_criteria:criterion_id',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_criteria' AND c.contype='p'
        AND pg_get_constraintdef(c.oid) = 'PRIMARY KEY (criterion_id)')),

  ('fk:impact_evaluation_criteria_a1_2_framework_version_fk',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_criteria'
        AND c.conname='impact_evaluation_criteria_a1_2_framework_version_fk' AND c.contype='f'
        AND pg_get_constraintdef(c.oid) = 'FOREIGN KEY (framework_version_id) REFERENCES kai.impact_evaluation_framework_versions(framework_version_id) ON DELETE RESTRICT')),

  ('unique:impact_evaluation_criteria_a1_2_key_unique',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_criteria'
        AND c.conname='impact_evaluation_criteria_a1_2_key_unique' AND c.contype='u'
        AND pg_get_constraintdef(c.oid) = 'UNIQUE (framework_version_id, criterion_key)')),

  ('unique:impact_evaluation_criteria_a1_2_display_order_unique',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_criteria'
        AND c.conname='impact_evaluation_criteria_a1_2_display_order_unique' AND c.contype='u'
        AND pg_get_constraintdef(c.oid) = 'UNIQUE (framework_version_id, display_order)')),

  ('table:impact_evaluation_criteria:check_count_5',
    (SELECT count(*) FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_criteria' AND c.contype='c') = 5),

  ('check:impact_evaluation_criteria_a1_2_criterion_key_check',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_criteria'
        AND c.conname='impact_evaluation_criteria_a1_2_criterion_key_check' AND c.contype='c'
        AND strpos(pg_get_constraintdef(c.oid), 'criterion_key') > 0
        AND strpos(pg_get_constraintdef(c.oid), '^[a-z][a-z0-9_]{0,95}$') > 0)),

  ('check:impact_evaluation_criteria_a1_2_criterion_label_check',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_criteria'
        AND c.conname='impact_evaluation_criteria_a1_2_criterion_label_check' AND c.contype='c'
        AND strpos(pg_get_constraintdef(c.oid), 'criterion_label') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'btrim') > 0
        AND strpos(pg_get_constraintdef(c.oid), '200') > 0)),

  ('check:impact_evaluation_criteria_a1_2_description_check',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_criteria'
        AND c.conname='impact_evaluation_criteria_a1_2_description_check' AND c.contype='c'
        AND strpos(pg_get_constraintdef(c.oid), 'description') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'btrim') > 0
        AND strpos(pg_get_constraintdef(c.oid), '4000') > 0)),

  ('check:impact_evaluation_criteria_a1_2_evaluation_guidance_check',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_criteria'
        AND c.conname='impact_evaluation_criteria_a1_2_evaluation_guidance_check' AND c.contype='c'
        AND strpos(pg_get_constraintdef(c.oid), 'evaluation_guidance') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'btrim') > 0
        AND strpos(pg_get_constraintdef(c.oid), '4000') > 0)),

  ('check:impact_evaluation_criteria_a1_2_display_order_check',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_criteria'
        AND c.conname='impact_evaluation_criteria_a1_2_display_order_check' AND c.contype='c'
        AND strpos(pg_get_constraintdef(c.oid), 'display_order') > 0
        AND strpos(pg_get_constraintdef(c.oid), '>= 0') > 0)),

  ('index:ix_impact_evaluation_criteria_a1_2_framework_version',
    EXISTS (SELECT 1 FROM pg_class i
      JOIN pg_index ix ON ix.indexrelid = i.oid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname='kai' AND t.relname='impact_evaluation_criteria'
        AND i.relname='ix_impact_evaluation_criteria_a1_2_framework_version'
        AND NOT ix.indisunique
        AND pg_get_indexdef(i.oid) = 'CREATE INDEX ix_impact_evaluation_criteria_a1_2_framework_version ON kai.impact_evaluation_criteria USING btree (framework_version_id)'))
)
SELECT
  CASE WHEN bool_and(ok) THEN 'A1_2_VERIFIED' ELSE 'INCOMPLETE' END AS package_status,
  count(*) FILTER (WHERE NOT ok) AS failed_check_count,
  COALESCE(string_agg(check_id, ', ' ORDER BY check_id) FILTER (WHERE NOT ok), '') AS failed_checks
FROM checks;
