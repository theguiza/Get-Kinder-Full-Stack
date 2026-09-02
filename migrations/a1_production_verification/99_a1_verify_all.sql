-- Combined A1.1-A1.4 production postcondition verifier (SELECT-only,
-- read-only). Derived solely from the four A1 forward migration source
-- files as they exist at the current repository HEAD:
--   migrations/kai_sprint2_a1_1_impact_outcome_context.sql
--   migrations/kai_sprint2_a1_2_impact_evaluation_framework_and_criteria.sql
--   migrations/kai_sprint2_a1_3_impact_evaluations_and_results.sql
--   migrations/kai_sprint2_a1_4_impact_evaluation_result_provenance_links.sql
--
-- This is the union of every check in 01_a1_1_verify.sql,
-- 02_a1_2_verify.sql, 03_a1_3_verify.sql, and 04_a1_4_verify.sql. It proves
-- the complete structural shape of every A1.1-A1.4 object in one pass --
-- not mere object existence.
--
-- Does not mutate any state. Safe to run against production read-only.

WITH checks(check_id, ok) AS (
  VALUES
  -- Table existence
  ('table:kai.impact_outcome_contexts:exists',
    to_regclass('kai.impact_outcome_contexts') IS NOT NULL),

  -- Exact column count (catches unexpected added/removed columns)
  ('table:kai.impact_outcome_contexts:column_count_11',
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'kai' AND table_name = 'impact_outcome_contexts') = 11),

  -- Columns: name, type, nullability, default
  ('col:impact_outcome_context_id:uuid_notnull_default_gen_random_uuid',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_outcome_contexts'
        AND column_name='impact_outcome_context_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default ILIKE '%gen_random_uuid%')),
  ('col:organization_id:uuid_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_outcome_contexts'
        AND column_name='organization_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:engagement_id:uuid_nullable_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_outcome_contexts'
        AND column_name='engagement_id' AND data_type='uuid'
        AND is_nullable='YES' AND column_default IS NULL)),
  ('col:outcome_key:text_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_outcome_contexts'
        AND column_name='outcome_key' AND data_type='text'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:outcome_statement:text_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_outcome_contexts'
        AND column_name='outcome_statement' AND data_type='text'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:stakeholder_key:text_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_outcome_contexts'
        AND column_name='stakeholder_key' AND data_type='text'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:stakeholder_label:text_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_outcome_contexts'
        AND column_name='stakeholder_label' AND data_type='text'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:created_by:uuid_nullable_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_outcome_contexts'
        AND column_name='created_by' AND data_type='uuid'
        AND is_nullable='YES' AND column_default IS NULL)),
  ('col:created_by_type:text_notnull_default_human',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_outcome_contexts'
        AND column_name='created_by_type' AND data_type='text'
        AND is_nullable='NO' AND column_default ILIKE '%human%')),
  ('col:created_at:timestamptz_notnull_default_now',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_outcome_contexts'
        AND column_name='created_at' AND data_type='timestamp with time zone'
        AND is_nullable='NO' AND column_default ILIKE '%now()%')),
  ('col:updated_at:timestamptz_notnull_default_now',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_outcome_contexts'
        AND column_name='updated_at' AND data_type='timestamp with time zone'
        AND is_nullable='NO' AND column_default ILIKE '%now()%')),

  -- Primary key
  ('pk:impact_outcome_contexts:impact_outcome_context_id',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_outcome_contexts' AND c.contype='p'
        AND pg_get_constraintdef(c.oid) = 'PRIMARY KEY (impact_outcome_context_id)')),

  -- UNIQUE (impact_outcome_context_id, organization_id)
  ('unique:impact_outcome_contexts_a1_1_id_org_unique',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_outcome_contexts'
        AND c.conname='impact_outcome_contexts_a1_1_id_org_unique' AND c.contype='u'
        AND pg_get_constraintdef(c.oid) = 'UNIQUE (impact_outcome_context_id, organization_id)')),

  -- UNIQUE (organization_id, engagement_id, outcome_key, stakeholder_key)
  ('unique:impact_outcome_contexts_a1_1_identity_unique',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_outcome_contexts'
        AND c.conname='impact_outcome_contexts_a1_1_identity_unique' AND c.contype='u'
        AND pg_get_constraintdef(c.oid) = 'UNIQUE (organization_id, engagement_id, outcome_key, stakeholder_key)')),

  -- FK organization_id -> kai.organizations(organization_id) ON DELETE RESTRICT
  ('fk:impact_outcome_contexts_a1_1_organization_fk',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_outcome_contexts'
        AND c.conname='impact_outcome_contexts_a1_1_organization_fk' AND c.contype='f'
        AND pg_get_constraintdef(c.oid) = 'FOREIGN KEY (organization_id) REFERENCES kai.organizations(organization_id) ON DELETE RESTRICT')),

  -- FK (engagement_id, organization_id) -> kai.engagements(engagement_id, organization_id) ON DELETE RESTRICT
  ('fk:impact_outcome_contexts_a1_1_engagement_fk',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_outcome_contexts'
        AND c.conname='impact_outcome_contexts_a1_1_engagement_fk' AND c.contype='f'
        AND pg_get_constraintdef(c.oid) = 'FOREIGN KEY (engagement_id, organization_id) REFERENCES kai.engagements(engagement_id, organization_id) ON DELETE RESTRICT')),

  -- Exact count of CHECK constraints (5) on the table
  ('check:impact_outcome_contexts:check_count_5',
    (SELECT count(*) FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_outcome_contexts' AND c.contype='c') = 5),

  -- CHECK: outcome_key ~ '^[a-z][a-z0-9_]{0,95}$'
  ('check:impact_outcome_contexts_a1_1_outcome_key_check',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_outcome_contexts'
        AND c.conname='impact_outcome_contexts_a1_1_outcome_key_check' AND c.contype='c'
        AND strpos(pg_get_constraintdef(c.oid), 'outcome_key') > 0
        AND strpos(pg_get_constraintdef(c.oid), '^[a-z][a-z0-9_]{0,95}$') > 0)),

  -- CHECK: btrim(outcome_statement) <> '' AND char_length(outcome_statement) <= 2000
  ('check:impact_outcome_contexts_a1_1_outcome_statement_check',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_outcome_contexts'
        AND c.conname='impact_outcome_contexts_a1_1_outcome_statement_check' AND c.contype='c'
        AND strpos(pg_get_constraintdef(c.oid), 'outcome_statement') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'btrim') > 0
        AND strpos(pg_get_constraintdef(c.oid), '2000') > 0)),

  -- CHECK: stakeholder_key ~ '^[a-z][a-z0-9_]{0,95}$'
  ('check:impact_outcome_contexts_a1_1_stakeholder_key_check',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_outcome_contexts'
        AND c.conname='impact_outcome_contexts_a1_1_stakeholder_key_check' AND c.contype='c'
        AND strpos(pg_get_constraintdef(c.oid), 'stakeholder_key') > 0
        AND strpos(pg_get_constraintdef(c.oid), '^[a-z][a-z0-9_]{0,95}$') > 0)),

  -- CHECK: btrim(stakeholder_label) <> '' AND char_length(stakeholder_label) <= 200
  ('check:impact_outcome_contexts_a1_1_stakeholder_label_check',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_outcome_contexts'
        AND c.conname='impact_outcome_contexts_a1_1_stakeholder_label_check' AND c.contype='c'
        AND strpos(pg_get_constraintdef(c.oid), 'stakeholder_label') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'btrim') > 0
        AND strpos(pg_get_constraintdef(c.oid), '200') > 0)),

  -- CHECK: created_by_type IN ('human', 'system')
  ('check:impact_outcome_contexts_a1_1_created_by_type_check',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_outcome_contexts'
        AND c.conname='impact_outcome_contexts_a1_1_created_by_type_check' AND c.contype='c'
        AND strpos(pg_get_constraintdef(c.oid), 'created_by_type') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'human') > 0
        AND strpos(pg_get_constraintdef(c.oid), 'system') > 0)),

  -- Partial UNIQUE INDEX for org-level identity (engagement_id IS NULL)
  ('index:ux_impact_outcome_contexts_a1_1_org_level_identity',
    EXISTS (SELECT 1 FROM pg_class i
      JOIN pg_index ix ON ix.indexrelid = i.oid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname='kai' AND t.relname='impact_outcome_contexts'
        AND i.relname='ux_impact_outcome_contexts_a1_1_org_level_identity'
        AND ix.indisunique
        AND pg_get_indexdef(i.oid) = 'CREATE UNIQUE INDEX ux_impact_outcome_contexts_a1_1_org_level_identity ON kai.impact_outcome_contexts USING btree (organization_id, outcome_key, stakeholder_key) WHERE (engagement_id IS NULL)')),

  -- Non-unique tenant/engagement index
  ('index:ix_impact_outcome_contexts_a1_1_tenant_engagement',
    EXISTS (SELECT 1 FROM pg_class i
      JOIN pg_index ix ON ix.indexrelid = i.oid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname='kai' AND t.relname='impact_outcome_contexts'
        AND i.relname='ix_impact_outcome_contexts_a1_1_tenant_engagement'
        AND NOT ix.indisunique
        AND pg_get_indexdef(i.oid) = 'CREATE INDEX ix_impact_outcome_contexts_a1_1_tenant_engagement ON kai.impact_outcome_contexts USING btree (organization_id, engagement_id)')),

  -- Function kai.touch_impact_outcome_contexts_updated_at() RETURNS trigger, plpgsql
  ('function:kai.touch_impact_outcome_contexts_updated_at',
    EXISTS (SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname='kai' AND p.proname='touch_impact_outcome_contexts_updated_at'
        AND p.pronargs = 0
        AND p.prorettype = 'trigger'::regtype
        AND l.lanname='plpgsql')),

  -- Trigger trg_impact_outcome_contexts_touch_updated_at BEFORE UPDATE ... FOR EACH ROW
  ('trigger:trg_impact_outcome_contexts_touch_updated_at',
    EXISTS (SELECT 1 FROM pg_trigger tg
      JOIN pg_class r ON r.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      JOIN pg_proc p ON p.oid = tg.tgfoid
      WHERE n.nspname='kai' AND r.relname='impact_outcome_contexts'
        AND tg.tgname='trg_impact_outcome_contexts_touch_updated_at'
        AND NOT tg.tgisinternal
        AND p.proname='touch_impact_outcome_contexts_updated_at'
        AND (tg.tgtype & 2) = 2   -- BEFORE
        AND (tg.tgtype & 16) = 16 -- UPDATE
        AND (tg.tgtype & 1) = 1)) -- FOR EACH ROW
,
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
,
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
,
  -- ALTER-added A1.4 compatibility constraint on kai.impact_evaluation_results
  ('unique:impact_evaluation_results_a1_4_id_org_unique',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_results'
        AND c.conname='impact_evaluation_results_a1_4_id_org_unique' AND c.contype='u'
        AND pg_get_constraintdef(c.oid) = 'UNIQUE (impact_evaluation_result_id, organization_id)')),

  -- ---- kai.impact_evaluation_result_evidence_links ----
  ('table:kai.impact_evaluation_result_evidence_links:exists',
    to_regclass('kai.impact_evaluation_result_evidence_links') IS NOT NULL),

  ('table:kai.impact_evaluation_result_evidence_links:column_count_5',
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_result_evidence_links') = 5),

  ('col:impact_evaluation_result_evidence_link_id:uuid_notnull_default_gen_random_uuid',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_result_evidence_links'
        AND column_name='impact_evaluation_result_evidence_link_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default ILIKE '%gen_random_uuid%')),
  ('col:evidence_links.organization_id:uuid_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_result_evidence_links'
        AND column_name='organization_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:evidence_links.impact_evaluation_result_id:uuid_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_result_evidence_links'
        AND column_name='impact_evaluation_result_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:evidence_item_id:uuid_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_result_evidence_links'
        AND column_name='evidence_item_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:evidence_links.created_at:timestamptz_notnull_default_now',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_result_evidence_links'
        AND column_name='created_at' AND data_type='timestamp with time zone'
        AND is_nullable='NO' AND column_default ILIKE '%now()%')),

  ('pk:impact_evaluation_result_evidence_links:impact_evaluation_result_evidence_link_id',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_result_evidence_links' AND c.contype='p'
        AND pg_get_constraintdef(c.oid) = 'PRIMARY KEY (impact_evaluation_result_evidence_link_id)')),

  ('unique:impact_evaluation_result_evidence_links_a1_4_identity_unique',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_result_evidence_links'
        AND c.conname='impact_evaluation_result_evidence_links_a1_4_identity_unique' AND c.contype='u'
        AND pg_get_constraintdef(c.oid) = 'UNIQUE (impact_evaluation_result_id, evidence_item_id)')),

  ('fk:impact_evaluation_result_evidence_links_a1_4_result_fk',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_result_evidence_links'
        AND c.conname='impact_evaluation_result_evidence_links_a1_4_result_fk' AND c.contype='f'
        AND pg_get_constraintdef(c.oid) = 'FOREIGN KEY (impact_evaluation_result_id, organization_id) REFERENCES kai.impact_evaluation_results(impact_evaluation_result_id, organization_id) ON DELETE RESTRICT')),

  ('fk:impact_evaluation_result_evidence_links_a1_4_evidence_fk',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_result_evidence_links'
        AND c.conname='impact_evaluation_result_evidence_links_a1_4_evidence_fk' AND c.contype='f'
        AND pg_get_constraintdef(c.oid) = 'FOREIGN KEY (evidence_item_id, organization_id) REFERENCES kai.evidence_items(evidence_item_id, organization_id) ON DELETE RESTRICT')),

  ('index:ix_impact_evaluation_result_evidence_links_a1_4_result',
    EXISTS (SELECT 1 FROM pg_class i
      JOIN pg_index ix ON ix.indexrelid = i.oid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname='kai' AND t.relname='impact_evaluation_result_evidence_links'
        AND i.relname='ix_impact_evaluation_result_evidence_links_a1_4_result'
        AND NOT ix.indisunique
        AND pg_get_indexdef(i.oid) = 'CREATE INDEX ix_impact_evaluation_result_evidence_links_a1_4_result ON kai.impact_evaluation_result_evidence_links USING btree (impact_evaluation_result_id)')),

  ('index:ix_impact_evaluation_result_evidence_links_a1_4_evidence',
    EXISTS (SELECT 1 FROM pg_class i
      JOIN pg_index ix ON ix.indexrelid = i.oid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname='kai' AND t.relname='impact_evaluation_result_evidence_links'
        AND i.relname='ix_impact_evaluation_result_evidence_links_a1_4_evidence'
        AND NOT ix.indisunique
        AND pg_get_indexdef(i.oid) = 'CREATE INDEX ix_impact_evaluation_result_evidence_links_a1_4_evidence ON kai.impact_evaluation_result_evidence_links USING btree (organization_id, evidence_item_id)')),

  -- ---- kai.impact_evaluation_result_claim_links ----
  ('table:kai.impact_evaluation_result_claim_links:exists',
    to_regclass('kai.impact_evaluation_result_claim_links') IS NOT NULL),

  ('table:kai.impact_evaluation_result_claim_links:column_count_5',
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_result_claim_links') = 5),

  ('col:impact_evaluation_result_claim_link_id:uuid_notnull_default_gen_random_uuid',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_result_claim_links'
        AND column_name='impact_evaluation_result_claim_link_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default ILIKE '%gen_random_uuid%')),
  ('col:claim_links.organization_id:uuid_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_result_claim_links'
        AND column_name='organization_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:claim_links.impact_evaluation_result_id:uuid_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_result_claim_links'
        AND column_name='impact_evaluation_result_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:claim_id:uuid_notnull_nodefault',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_result_claim_links'
        AND column_name='claim_id' AND data_type='uuid'
        AND is_nullable='NO' AND column_default IS NULL)),
  ('col:claim_links.created_at:timestamptz_notnull_default_now',
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='kai' AND table_name='impact_evaluation_result_claim_links'
        AND column_name='created_at' AND data_type='timestamp with time zone'
        AND is_nullable='NO' AND column_default ILIKE '%now()%')),

  ('pk:impact_evaluation_result_claim_links:impact_evaluation_result_claim_link_id',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_result_claim_links' AND c.contype='p'
        AND pg_get_constraintdef(c.oid) = 'PRIMARY KEY (impact_evaluation_result_claim_link_id)')),

  ('unique:impact_evaluation_result_claim_links_a1_4_identity_unique',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_result_claim_links'
        AND c.conname='impact_evaluation_result_claim_links_a1_4_identity_unique' AND c.contype='u'
        AND pg_get_constraintdef(c.oid) = 'UNIQUE (impact_evaluation_result_id, claim_id)')),

  ('fk:impact_evaluation_result_claim_links_a1_4_result_fk',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_result_claim_links'
        AND c.conname='impact_evaluation_result_claim_links_a1_4_result_fk' AND c.contype='f'
        AND pg_get_constraintdef(c.oid) = 'FOREIGN KEY (impact_evaluation_result_id, organization_id) REFERENCES kai.impact_evaluation_results(impact_evaluation_result_id, organization_id) ON DELETE RESTRICT')),

  ('fk:impact_evaluation_result_claim_links_a1_4_claim_fk',
    EXISTS (SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='kai' AND r.relname='impact_evaluation_result_claim_links'
        AND c.conname='impact_evaluation_result_claim_links_a1_4_claim_fk' AND c.contype='f'
        AND pg_get_constraintdef(c.oid) = 'FOREIGN KEY (claim_id, organization_id) REFERENCES kai.claims(claim_id, organization_id) ON DELETE RESTRICT')),

  ('index:ix_impact_evaluation_result_claim_links_a1_4_result',
    EXISTS (SELECT 1 FROM pg_class i
      JOIN pg_index ix ON ix.indexrelid = i.oid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname='kai' AND t.relname='impact_evaluation_result_claim_links'
        AND i.relname='ix_impact_evaluation_result_claim_links_a1_4_result'
        AND NOT ix.indisunique
        AND pg_get_indexdef(i.oid) = 'CREATE INDEX ix_impact_evaluation_result_claim_links_a1_4_result ON kai.impact_evaluation_result_claim_links USING btree (impact_evaluation_result_id)')),

  ('index:ix_impact_evaluation_result_claim_links_a1_4_claim',
    EXISTS (SELECT 1 FROM pg_class i
      JOIN pg_index ix ON ix.indexrelid = i.oid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname='kai' AND t.relname='impact_evaluation_result_claim_links'
        AND i.relname='ix_impact_evaluation_result_claim_links_a1_4_claim'
        AND NOT ix.indisunique
        AND pg_get_indexdef(i.oid) = 'CREATE INDEX ix_impact_evaluation_result_claim_links_a1_4_claim ON kai.impact_evaluation_result_claim_links USING btree (organization_id, claim_id)'))
)
SELECT
  CASE WHEN bool_and(ok) THEN 'A1_VERIFIED' ELSE 'INCOMPLETE' END AS package_status,
  count(*) FILTER (WHERE NOT ok) AS failed_check_count,
  COALESCE(string_agg(check_id, ', ' ORDER BY check_id) FILTER (WHERE NOT ok), '') AS failed_checks
FROM checks;
