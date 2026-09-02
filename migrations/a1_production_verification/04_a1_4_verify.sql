-- A1.4 production postcondition verifier (SELECT-only, read-only).
-- Derived solely from
-- migrations/kai_sprint2_a1_4_impact_evaluation_result_provenance_links.sql
-- as it exists at the current repository HEAD. Proves the full structural
-- shape of kai.impact_evaluation_result_evidence_links,
-- kai.impact_evaluation_result_claim_links, and the A1.4 ALTER-added
-- compatibility constraint on kai.impact_evaluation_results -- not mere
-- object existence.
--
-- Does not mutate any state. Safe to run against production read-only.

WITH checks(check_id, ok) AS (
  VALUES
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
  CASE WHEN bool_and(ok) THEN 'A1_4_VERIFIED' ELSE 'INCOMPLETE' END AS package_status,
  count(*) FILTER (WHERE NOT ok) AS failed_check_count,
  COALESCE(string_agg(check_id, ', ' ORDER BY check_id) FILTER (WHERE NOT ok), '') AS failed_checks
FROM checks;
