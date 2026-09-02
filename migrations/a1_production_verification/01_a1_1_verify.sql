-- A1.1 production postcondition verifier (SELECT-only, read-only).
-- Derived solely from migrations/kai_sprint2_a1_1_impact_outcome_context.sql
-- as it exists at the current repository HEAD. Proves the full structural
-- shape of kai.impact_outcome_contexts (table, columns, constraints,
-- indexes, function, trigger) -- not mere object existence.
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
)
SELECT
  CASE WHEN bool_and(ok) THEN 'A1_1_VERIFIED' ELSE 'INCOMPLETE' END AS package_status,
  count(*) FILTER (WHERE NOT ok) AS failed_check_count,
  COALESCE(string_agg(check_id, ', ' ORDER BY check_id) FILTER (WHERE NOT ok), '') AS failed_checks
FROM checks;
