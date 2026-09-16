-- Step C: read-only Package 2A post-forward verification.
-- Expected result: all rows return status PASS, then PACKAGE_2A_FORWARD_VERIFIED.
-- Stop conditions: any FAIL row or raised exception. Do not continue to Gate-A forward SQL.

WITH column_checks AS (
  SELECT expected.column_name,
         EXISTS (
           SELECT 1
             FROM information_schema.columns c
            WHERE c.table_schema = 'kai'
              AND c.table_name = 'engagement_requirement_sets'
              AND c.column_name = expected.column_name
              AND c.data_type = expected.data_type
              AND c.udt_name = expected.udt_name
              AND (expected.is_nullable IS NULL OR c.is_nullable = expected.is_nullable)
         ) AS ok
    FROM (VALUES
      ('reviewed_by', 'uuid', 'uuid', 'YES'),
      ('reviewed_by_role', 'text', 'text', 'YES'),
      ('reviewed_at', 'timestamp with time zone', 'timestamptz', 'YES'),
      ('applicability_effective_state', 'text', 'text', 'NO'),
      ('supersedes_engagement_requirement_set_id', 'uuid', 'uuid', 'YES'),
      ('target_context_identity', 'jsonb', 'jsonb', 'YES')
    ) AS expected(column_name, data_type, udt_name, is_nullable)
),
constraint_specs AS (
  SELECT *
    FROM (VALUES
      (
        'unique identity constraint',
        'engagement_requirement_sets_package_2a_id_org_engagement_set_un',
        NULL::text,
        'u',
        'UNIQUE (engagement_requirement_set_id, organization_id, engagement_id, requirement_set_id)'
      ),
      (
        'supersedes FK',
        NULL::text,
        'engagement_requirement_sets_package_2a_supersedes_fk',
        'f',
        'FOREIGN KEY (supersedes_engagement_requirement_set_id, organization_id, engagement_id, requirement_set_id) REFERENCES kai.engagement_requirement_sets(engagement_requirement_set_id, organization_id, engagement_id, requirement_set_id) ON DELETE RESTRICT'
      ),
      (
        'not-self-superseding check',
        NULL::text,
        'engagement_requirement_sets_package_2a_not_self_superseding',
        'c',
        'CHECK ((supersedes_engagement_requirement_set_id IS DISTINCT FROM engagement_requirement_set_id))'
      ),
      (
        'reviewed authority check',
        NULL::text,
        'engagement_requirement_sets_package_2a_reviewed_authority_check',
        'c',
        'CHECK ((((reviewed_by IS NULL) AND (reviewed_by_role IS NULL) AND (reviewed_at IS NULL)) OR ((reviewed_by IS NOT NULL) AND (reviewed_by_role = ANY (ARRAY[''gk_admin''::text, ''gk_operator''::text, ''gk_reviewer''::text, ''client_admin''::text])) AND (reviewed_at IS NOT NULL))))'
      ),
      (
        'effective state check',
        NULL::text,
        'engagement_requirement_sets_package_2a_effective_state_check',
        'c',
        'CHECK ((applicability_effective_state = ANY (ARRAY[''pending_review''::text, ''applicable''::text, ''not_applicable''::text, ''retired''::text])))'
      ),
      (
        'reviewed/effective consistency check',
        'engagement_requirement_sets_package_2a_reviewed_effective_consi',
        NULL::text,
        'c',
        'CHECK (((applicability_effective_state = ''pending_review''::text) OR ((applicability_status = ''confirmed''::text) AND (reviewed_by IS NOT NULL) AND (reviewed_by_role IS NOT NULL) AND (reviewed_at IS NOT NULL) AND (target_context_identity IS NOT NULL))))'
      ),
      (
        'approved target check',
        NULL::text,
        'engagement_requirement_sets_package_2a_approved_target_check',
        'c',
        'CHECK (((target_context_identity IS NULL) OR ((jsonb_typeof(target_context_identity) = ''object''::text) AND (target_context_identity ? ''target_funder_id''::text) AND (target_context_identity ? ''target_framework''::text))))'
      )
    ) AS spec(label, identifier_prefix, identifier, contype, definition)
),
constraint_matches AS (
  SELECT spec.label,
         count(c.*) AS match_count,
         bool_and(c.contype = spec.contype AND c.convalidated AND pg_get_constraintdef(c.oid) = spec.definition) AS exact_match
    FROM constraint_specs spec
    LEFT JOIN pg_constraint c
      ON (
           (spec.identifier IS NOT NULL AND c.conname = spec.identifier)
           OR (spec.identifier_prefix IS NOT NULL AND c.conname LIKE spec.identifier_prefix || '%')
         )
    LEFT JOIN pg_class r ON r.oid = c.conrelid
    LEFT JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE c.oid IS NULL
      OR (n.nspname = 'kai' AND r.relname = 'engagement_requirement_sets')
   GROUP BY spec.label
),
index_specs AS (
  SELECT *
    FROM (VALUES
      (
        'ux_engagement_requirement_sets_package_2a_current_identity',
        'CREATE UNIQUE INDEX ux_engagement_requirement_sets_package_2a_current_identity ON kai.engagement_requirement_sets USING btree (organization_id, engagement_id, requirement_set_id) WHERE (supersedes_engagement_requirement_set_id IS NULL)'
      ),
      (
        'ux_engagement_requirement_sets_package_2a_single_successor',
        'CREATE UNIQUE INDEX ux_engagement_requirement_sets_package_2a_single_successor ON kai.engagement_requirement_sets USING btree (supersedes_engagement_requirement_set_id) WHERE (supersedes_engagement_requirement_set_id IS NOT NULL)'
      ),
      (
        'ix_engagement_requirement_sets_package_2a_current_lookup',
        'CREATE INDEX ix_engagement_requirement_sets_package_2a_current_lookup ON kai.engagement_requirement_sets USING btree (organization_id, engagement_id, applicability_effective_state) WHERE (supersedes_engagement_requirement_set_id IS NULL)'
      )
    ) AS spec(index_name, indexdef)
),
index_matches AS (
  SELECT spec.index_name,
         actual.indexdef = spec.indexdef AS ok
    FROM index_specs spec
    LEFT JOIN pg_indexes actual
      ON actual.schemaname = 'kai'
     AND actual.tablename = 'engagement_requirement_sets'
     AND actual.indexname = spec.index_name
),
checks AS (
  SELECT 'columns_' || column_name AS check_name,
         CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS status,
         'Package 2A column exists with expected type/nullability' AS detail
    FROM column_checks
  UNION ALL
  SELECT 'constraint_' || label,
         CASE WHEN match_count = 1 AND exact_match THEN 'PASS' ELSE 'FAIL' END,
         'Package 2A constraint matches catalog definition; long identifiers are matched by proven 63-byte-safe prefix where required'
    FROM constraint_matches
  UNION ALL
  SELECT 'index_' || index_name,
         CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END,
         'Package 2A index definition matches expected catalog definition'
    FROM index_matches
  UNION ALL
  SELECT 'append_only_function_present',
         CASE WHEN to_regprocedure('kai.package_2a_reject_engagement_requirement_set_mutation()') IS NOT NULL
              THEN 'PASS' ELSE 'FAIL' END,
         'Package 2A append-only trigger function exists'
  UNION ALL
  SELECT 'append_only_trigger_present',
         CASE WHEN EXISTS (
                SELECT 1
                  FROM pg_trigger t
                  JOIN pg_class r ON r.oid = t.tgrelid
                  JOIN pg_namespace n ON n.oid = r.relnamespace
                 WHERE n.nspname = 'kai'
                   AND r.relname = 'engagement_requirement_sets'
                   AND t.tgname = 'trg_package_2a_engagement_requirement_sets_append_only'
                   AND NOT t.tgisinternal
              )
              THEN 'PASS' ELSE 'FAIL' END,
         'Package 2A append-only trigger exists'
)
SELECT 'C_PACKAGE_2A_POST_FORWARD_VERIFICATION' AS result_type, check_name, status, detail
FROM checks
ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (
    WITH column_checks AS (
      SELECT expected.column_name,
             EXISTS (
               SELECT 1
                 FROM information_schema.columns c
                WHERE c.table_schema = 'kai'
                  AND c.table_name = 'engagement_requirement_sets'
                  AND c.column_name = expected.column_name
                  AND c.data_type = expected.data_type
                  AND c.udt_name = expected.udt_name
                  AND (expected.is_nullable IS NULL OR c.is_nullable = expected.is_nullable)
             ) AS ok
        FROM (VALUES
          ('reviewed_by', 'uuid', 'uuid', 'YES'),
          ('reviewed_by_role', 'text', 'text', 'YES'),
          ('reviewed_at', 'timestamp with time zone', 'timestamptz', 'YES'),
          ('applicability_effective_state', 'text', 'text', 'NO'),
          ('supersedes_engagement_requirement_set_id', 'uuid', 'uuid', 'YES'),
          ('target_context_identity', 'jsonb', 'jsonb', 'YES')
        ) AS expected(column_name, data_type, udt_name, is_nullable)
    ),
    constraint_specs AS (
      SELECT *
        FROM (VALUES
          ('unique identity constraint', 'engagement_requirement_sets_package_2a_id_org_engagement_set_un', NULL::text, 'u', 'UNIQUE (engagement_requirement_set_id, organization_id, engagement_id, requirement_set_id)'),
          ('supersedes FK', NULL::text, 'engagement_requirement_sets_package_2a_supersedes_fk', 'f', 'FOREIGN KEY (supersedes_engagement_requirement_set_id, organization_id, engagement_id, requirement_set_id) REFERENCES kai.engagement_requirement_sets(engagement_requirement_set_id, organization_id, engagement_id, requirement_set_id) ON DELETE RESTRICT'),
          ('not-self-superseding check', NULL::text, 'engagement_requirement_sets_package_2a_not_self_superseding', 'c', 'CHECK ((supersedes_engagement_requirement_set_id IS DISTINCT FROM engagement_requirement_set_id))'),
          ('reviewed authority check', NULL::text, 'engagement_requirement_sets_package_2a_reviewed_authority_check', 'c', 'CHECK ((((reviewed_by IS NULL) AND (reviewed_by_role IS NULL) AND (reviewed_at IS NULL)) OR ((reviewed_by IS NOT NULL) AND (reviewed_by_role = ANY (ARRAY[''gk_admin''::text, ''gk_operator''::text, ''gk_reviewer''::text, ''client_admin''::text])) AND (reviewed_at IS NOT NULL))))'),
          ('effective state check', NULL::text, 'engagement_requirement_sets_package_2a_effective_state_check', 'c', 'CHECK ((applicability_effective_state = ANY (ARRAY[''pending_review''::text, ''applicable''::text, ''not_applicable''::text, ''retired''::text])))'),
          ('reviewed/effective consistency check', 'engagement_requirement_sets_package_2a_reviewed_effective_consi', NULL::text, 'c', 'CHECK (((applicability_effective_state = ''pending_review''::text) OR ((applicability_status = ''confirmed''::text) AND (reviewed_by IS NOT NULL) AND (reviewed_by_role IS NOT NULL) AND (reviewed_at IS NOT NULL) AND (target_context_identity IS NOT NULL))))'),
          ('approved target check', NULL::text, 'engagement_requirement_sets_package_2a_approved_target_check', 'c', 'CHECK (((target_context_identity IS NULL) OR ((jsonb_typeof(target_context_identity) = ''object''::text) AND (target_context_identity ? ''target_funder_id''::text) AND (target_context_identity ? ''target_framework''::text))))')
        ) AS spec(label, identifier_prefix, identifier, contype, definition)
    ),
    constraint_matches AS (
      SELECT spec.label,
             count(c.*) AS match_count,
             bool_and(c.contype = spec.contype AND c.convalidated AND pg_get_constraintdef(c.oid) = spec.definition) AS exact_match
        FROM constraint_specs spec
        LEFT JOIN pg_constraint c
          ON (
               (spec.identifier IS NOT NULL AND c.conname = spec.identifier)
               OR (spec.identifier_prefix IS NOT NULL AND c.conname LIKE spec.identifier_prefix || '%')
             )
        LEFT JOIN pg_class r ON r.oid = c.conrelid
        LEFT JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE c.oid IS NULL
          OR (n.nspname = 'kai' AND r.relname = 'engagement_requirement_sets')
       GROUP BY spec.label
    ),
    index_specs AS (
      SELECT *
        FROM (VALUES
          ('ux_engagement_requirement_sets_package_2a_current_identity', 'CREATE UNIQUE INDEX ux_engagement_requirement_sets_package_2a_current_identity ON kai.engagement_requirement_sets USING btree (organization_id, engagement_id, requirement_set_id) WHERE (supersedes_engagement_requirement_set_id IS NULL)'),
          ('ux_engagement_requirement_sets_package_2a_single_successor', 'CREATE UNIQUE INDEX ux_engagement_requirement_sets_package_2a_single_successor ON kai.engagement_requirement_sets USING btree (supersedes_engagement_requirement_set_id) WHERE (supersedes_engagement_requirement_set_id IS NOT NULL)'),
          ('ix_engagement_requirement_sets_package_2a_current_lookup', 'CREATE INDEX ix_engagement_requirement_sets_package_2a_current_lookup ON kai.engagement_requirement_sets USING btree (organization_id, engagement_id, applicability_effective_state) WHERE (supersedes_engagement_requirement_set_id IS NULL)')
        ) AS spec(index_name, indexdef)
    ),
    index_matches AS (
      SELECT spec.index_name,
             actual.indexdef = spec.indexdef AS ok
        FROM index_specs spec
        LEFT JOIN pg_indexes actual
          ON actual.schemaname = 'kai'
         AND actual.tablename = 'engagement_requirement_sets'
         AND actual.indexname = spec.index_name
    ),
    checks AS (
      SELECT ok FROM column_checks
      UNION ALL
      SELECT match_count = 1 AND exact_match FROM constraint_matches
      UNION ALL
      SELECT ok FROM index_matches
      UNION ALL
      SELECT to_regprocedure('kai.package_2a_reject_engagement_requirement_set_mutation()') IS NOT NULL
      UNION ALL
      SELECT EXISTS (
        SELECT 1
          FROM pg_trigger t
          JOIN pg_class r ON r.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = r.relnamespace
         WHERE n.nspname = 'kai'
           AND r.relname = 'engagement_requirement_sets'
           AND t.tgname = 'trg_package_2a_engagement_requirement_sets_append_only'
           AND NOT t.tgisinternal
      )
    )
    SELECT 1 FROM checks WHERE NOT ok
  ) THEN
    RAISE EXCEPTION 'C_PACKAGE_2A_POST_FORWARD_VERIFICATION failed: stop before Gate-A repair';
  END IF;
  RAISE NOTICE 'PACKAGE_2A_FORWARD_VERIFIED';
END $$;
