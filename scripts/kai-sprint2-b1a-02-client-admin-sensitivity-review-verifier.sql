DO $$
DECLARE
  decision_table_exists boolean;
  role_check_validated boolean;
  role_check_exact boolean;
BEGIN
  decision_table_exists := to_regclass('kai.intake_sensitivity_review_decisions') IS NOT NULL;

  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'intake_sensitivity_review_decisions'
       AND c.conname = 'intake_sensitivity_review_decisions_b1a_02_role_check'
       AND c.contype = 'c'
       AND c.convalidated
  )
  INTO role_check_validated;

  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'intake_sensitivity_review_decisions'
       AND c.conname = 'intake_sensitivity_review_decisions_b1a_02_role_check'
       AND c.contype = 'c'
       AND c.convalidated
       AND ARRAY(
         SELECT role_literal[1]
           FROM regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g') AS role_literals(role_literal)
          ORDER BY role_literal[1]
       ) = ARRAY['client_admin', 'gk_admin', 'gk_operator', 'gk_reviewer']::text[]
  )
  INTO role_check_exact;

  IF NOT decision_table_exists OR NOT role_check_validated OR NOT role_check_exact THEN
    RAISE EXCEPTION
      'client-admin sensitivity review verifier failed (decision_table_exists=%, role_check_validated=%, role_check_exact=%)',
      decision_table_exists,
      role_check_validated,
      role_check_exact;
  END IF;
END
$$;

WITH role_check AS (
  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'intake_sensitivity_review_decisions'
       AND c.conname = 'intake_sensitivity_review_decisions_b1a_02_role_check'
       AND c.contype = 'c'
       AND c.convalidated
  ) AS validated,
  EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'intake_sensitivity_review_decisions'
       AND c.conname = 'intake_sensitivity_review_decisions_b1a_02_role_check'
       AND c.contype = 'c'
       AND c.convalidated
       AND ARRAY(
         SELECT role_literal[1]
           FROM regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g') AS role_literals(role_literal)
          ORDER BY role_literal[1]
       ) = ARRAY['client_admin', 'gk_admin', 'gk_operator', 'gk_reviewer']::text[]
  ) AS exact_role_set
)
SELECT check_name,
       CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS status,
       detail
  FROM (
    SELECT 'sensitivity_decision_table_exists'::text AS check_name,
           to_regclass('kai.intake_sensitivity_review_decisions') IS NOT NULL AS passed,
           'kai.intake_sensitivity_review_decisions exists'::text AS detail
    UNION ALL
    SELECT 'sensitivity_decision_role_check_exists_and_validated',
           role_check.validated,
           'the named sensitivity decision role CHECK exists and is validated'
      FROM role_check
    UNION ALL
    SELECT 'sensitivity_decision_role_check_exact_role_set',
           role_check.exact_role_set,
           'the validated sensitivity decision role CHECK admits exactly gk_admin, gk_operator, gk_reviewer, and client_admin'
      FROM role_check
  ) checks
 ORDER BY check_name;
