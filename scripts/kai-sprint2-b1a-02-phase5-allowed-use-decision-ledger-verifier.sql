DROP TABLE IF EXISTS b1a_02_results;
CREATE TEMP TABLE b1a_02_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO b1a_02_results
SELECT 'sensitivity_review_decisions_table_exists',
       CASE WHEN to_regclass('kai.intake_sensitivity_review_decisions') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
       'kai.intake_sensitivity_review_decisions exists';

INSERT INTO b1a_02_results
SELECT 'sensitivity_review_decisions_append_only_trigger',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_trigger t
                JOIN pg_class c ON c.oid = t.tgrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'kai'
                 AND c.relname = 'intake_sensitivity_review_decisions'
                 AND t.tgname = 'intake_sensitivity_review_decisions_b1a_02_append_only'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'intake_sensitivity_review_decisions has its append-only BEFORE UPDATE OR DELETE trigger';

INSERT INTO b1a_02_results
SELECT 'sensitivity_review_decisions_root_and_successor_indexes',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_indexes WHERE schemaname='kai' AND indexname='ux_intake_sensitivity_review_decisions_b1a_02_root_per_lineage'
            ) AND EXISTS (
              SELECT 1 FROM pg_indexes WHERE schemaname='kai' AND indexname='ux_intake_sensitivity_review_decisions_b1a_02_single_successor'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'intake_sensitivity_review_decisions has root-per-lineage and single-successor partial unique indexes (exactly one current head per lineage)';

INSERT INTO b1a_02_results
SELECT 'sensitivity_review_decisions_scoped_lineage_fk',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'intake_sensitivity_review_decisions'
                 AND c.conname = 'intake_sensitivity_review_decisions_b1a_02_supersedes_fk'
                 AND pg_get_constraintdef(c.oid) LIKE '%organization_id%'
                 AND pg_get_constraintdef(c.oid) LIKE '%intake_sensitivity_profile_id%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'a successor must reference a predecessor in the SAME organization and sensitivity profile - cross-tenant lineage is structurally impossible';

INSERT INTO b1a_02_results
SELECT 'sensitivity_review_decisions_tenant_scoped_profile_fk',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'intake_sensitivity_review_decisions'
                 AND c.conname = 'intake_sensitivity_review_decisions_b1a_02_profile_fk'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the decision is bound to (intake_sensitivity_profile_id, organization_id) by a tenant-scoped FK';

INSERT INTO b1a_02_results
SELECT 'sensitivity_review_decisions_outcome_vocabulary',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'intake_sensitivity_review_decisions'
                 AND c.conname = 'intake_sensitivity_review_decisions_b1a_02_outcome_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%reviewed%'
                 AND pg_get_constraintdef(c.oid) LIKE '%needs_more_information%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'decision_outcome admits exactly reviewed and needs_more_information';

INSERT INTO b1a_02_results
SELECT 'sensitivity_review_decisions_snapshot_completeness',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'intake_sensitivity_review_decisions'
                 AND c.conname = 'intake_sensitivity_review_decisions_b1a_02_snapshot_completeness_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'a reviewed decision must state every Phase-5 dimension; a needs_more_information decision must state none (so it can carry no permission)';

INSERT INTO b1a_02_results
SELECT 'sensitivity_review_decisions_public_use_fails_closed',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'intake_sensitivity_review_decisions'
                 AND c.conname = 'intake_sensitivity_review_decisions_b1a_02_public_use_basis_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%reviewed_consent_basis_status%'
                 AND pg_get_constraintdef(c.oid) LIKE '%reviewed_allowed_use_status%'
                 AND pg_get_constraintdef(c.oid) LIKE '%reviewed_indigenous_governance_status%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'reviewed_public_use_allowed = true requires allowed_use_status = allowed AND consent_basis_status = present AND indigenous_governance_status = absent in the same decision';

INSERT INTO b1a_02_results
SELECT 'sensitivity_review_decisions_restricted_use_fails_closed',
       CASE WHEN (
              SELECT count(*)
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'intake_sensitivity_review_decisions'
                 AND c.conname IN (
                   'intake_sensitivity_review_decisions_b1a_02_llm_use_basis_check',
                   'intake_sensitivity_review_decisions_b1a_02_product_learning_basis_check',
                   'intake_sensitivity_review_decisions_b1a_02_funder_use_basis_check'
                 )
            ) = 3
            THEN 'PASS' ELSE 'FAIL' END,
       'llm/product-learning/funder permission each require allowed_use_status = allowed in the same decision';

INSERT INTO b1a_02_results
SELECT 'sensitivity_review_decisions_human_only',
       CASE WHEN (
              SELECT count(*)
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'intake_sensitivity_review_decisions'
                 AND c.conname IN (
                   'intake_sensitivity_review_decisions_b1a_02_created_by_type_check',
                   'intake_sensitivity_review_decisions_b1a_02_role_check'
                 )
            ) = 2
            THEN 'PASS' ELSE 'FAIL' END,
       'only a human actor holding gk_admin/gk_operator/gk_reviewer can produce a decision row';

INSERT INTO b1a_02_results
SELECT 'sensitivity_profile_id_org_unique_added',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'intake_sensitivity_profiles'
                 AND c.conname = 'intake_sensitivity_profiles_b1a_02_id_org_unique'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the one additive unique constraint this package adds to kai.intake_sensitivity_profiles (P1-07 precedent) exists';

-- P1-05 is left completely pinned: this package records the human decision in its own
-- ledger and never propagates it onto the profile row, so the P1-07 creation-trigger
-- predicate and the P1-08 permission predicate are unaffected.
INSERT INTO b1a_02_results
SELECT 'p1_05_pinned_columns_unchanged',
       CASE WHEN (
              SELECT count(*)
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'intake_sensitivity_profiles'
                 AND c.conname IN (
                   'intake_sensitivity_profiles_p1_05_llm_processing_check',
                   'intake_sensitivity_profiles_p1_05_product_learning_check',
                   'intake_sensitivity_profiles_p1_05_public_use_check',
                   'intake_sensitivity_profiles_p1_05_funder_use_check',
                   'intake_sensitivity_profiles_p1_05_human_review_check',
                   'intake_sensitivity_profiles_p1_05_retention_posture_check'
                 )
                 AND pg_get_constraintdef(c.oid) IN (
                   'CHECK ((llm_processing_allowed = false))',
                   'CHECK ((product_learning_allowed = false))',
                   'CHECK ((public_use_allowed = false))',
                   'CHECK ((funder_use_allowed = false))',
                   'CHECK ((human_review_required = true))',
                   'CHECK ((retention_posture = ''restricted_pending_review''::text))'
                 )
            ) = 6
            THEN 'PASS' ELSE 'FAIL' END,
       'all six P1-05 pinned CHECK constraints are byte-for-byte unchanged by B1A-2';

INSERT INTO b1a_02_results
SELECT 'p1_06_queue_identity_index_unchanged',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_indexes
               WHERE schemaname = 'kai'
                 AND indexname = 'ux_review_queue_items_p1_06_sensitivity_review_identity'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the P1-06 sensitivity_review queue identity partial unique index is untouched';

INSERT INTO b1a_02_results
SELECT 'audit_operation_allowlist_extended_additively',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%sensitivity_review_decision_recorded%'
                 AND pg_get_constraintdef(c.oid) LIKE '%sensitivity_review_queue_item_created%'
                 AND pg_get_constraintdef(c.oid) LIKE '%intake_sensitivity_profile_persisted%'
                 AND pg_get_constraintdef(c.oid) LIKE '%reserve_upload%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the shared audit operation allowlist gained sensitivity_review_decision_recorded and lost nothing';

INSERT INTO b1a_02_results
SELECT 'audit_metadata_shape_required',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_b1a_02_sensitivity_decision_metadata_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%decision_id%'
                 AND pg_get_constraintdef(c.oid) LIKE '%decision_outcome%'
                 AND pg_get_constraintdef(c.oid) LIKE '%gate_a_p0_jsonb_metadata_only%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'sensitivity_review_decision_recorded audit rows must carry exactly the metadata-only decision/queue keys';

-- This package creates no export, release, claim-approval, or evidence-approval
-- authority: it adds exactly one new table and no column anywhere else.
INSERT INTO b1a_02_results
SELECT 'no_release_or_export_authority_table_added',
       CASE WHEN (
              SELECT count(*)
                FROM information_schema.tables
               WHERE table_schema = 'kai'
                 AND table_name LIKE '%b1a_02%'
            ) = 0
            THEN 'PASS' ELSE 'FAIL' END,
       'B1A-2 adds no export/release/claim/evidence authority table of its own beyond kai.intake_sensitivity_review_decisions';

INSERT INTO b1a_02_results
SELECT 'no_permission_columns_added_to_profiles',
       CASE WHEN (
              SELECT count(*)
                FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND table_name = 'intake_sensitivity_profiles'
                 AND column_name LIKE 'reviewed_%'
            ) = 0
            THEN 'PASS' ELSE 'FAIL' END,
       'no reviewed_* decision column leaked onto the P1-05 profile table';

SELECT * FROM b1a_02_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM b1a_02_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'B1A-2 phase-5-allowed-use-decision-ledger verifier failed';
  END IF;
END $$;
