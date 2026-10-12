DROP TABLE IF EXISTS kai_client_admin_sensitivity_review_results;
CREATE TEMP TABLE kai_client_admin_sensitivity_review_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO kai_client_admin_sensitivity_review_results
SELECT 'sensitivity_decision_table_exists',
       CASE WHEN to_regclass('kai.intake_sensitivity_review_decisions') IS NOT NULL
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.intake_sensitivity_review_decisions exists';

INSERT INTO kai_client_admin_sensitivity_review_results
SELECT 'sensitivity_decision_role_check_exists_and_validated',
       CASE WHEN EXISTS (
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
            THEN 'PASS' ELSE 'FAIL' END,
       'the named sensitivity decision role CHECK exists and is validated';

INSERT INTO kai_client_admin_sensitivity_review_results
SELECT 'sensitivity_decision_role_check_exact_role_set',
       CASE WHEN EXISTS (
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
            THEN 'PASS' ELSE 'FAIL' END,
       'the validated sensitivity decision role CHECK admits exactly gk_admin, gk_operator, gk_reviewer, and client_admin';

SELECT check_name, status, detail
  FROM kai_client_admin_sensitivity_review_results
 ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM kai_client_admin_sensitivity_review_results
     WHERE status <> 'PASS'
  ) THEN
    RAISE EXCEPTION 'client-admin sensitivity review migration verifier failed';
  END IF;
END $$;
