BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.intake_sensitivity_profiles') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_sensitivity_profiles is required before B1A-2 phase-5-allowed-use-decision-ledger migration';
  END IF;
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before B1A-2 phase-5-allowed-use-decision-ledger migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before B1A-2 phase-5-allowed-use-decision-ledger migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before B1A-2 phase-5-allowed-use-decision-ledger migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'intake_sensitivity_profiles'
       AND c.conname = 'intake_sensitivity_profiles_p1_05_identity_unique'
  ) THEN
    RAISE EXCEPTION 'kai.intake_sensitivity_profiles_p1_05_identity_unique is required before B1A-2 phase-5-allowed-use-decision-ledger migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = ic.relnamespace
     WHERE n.nspname = 'kai'
       AND ic.relname = 'ux_review_queue_items_p1_06_sensitivity_review_identity'
  ) THEN
    RAISE EXCEPTION 'kai.ux_review_queue_items_p1_06_sensitivity_review_identity is required before B1A-2 phase-5-allowed-use-decision-ledger migration';
  END IF;
END $$;

-- B1A-2 owner policy: Phase-5 sensitivity/allowed-use classification currently has
-- NO human authority record at all. kai.intake_sensitivity_profiles (P1-05) is a
-- machine-written, fully fail-closed foundation row whose every permission column is
-- hard-pinned by a CHECK constraint (llm_processing_allowed = false,
-- product_learning_allowed = false, public_use_allowed = false,
-- funder_use_allowed = false, human_review_required = true,
-- retention_posture = 'restricted_pending_review'), and whose only committed review
-- fact is that flag. There is therefore no way to record what a human reviewer
-- actually decided, and "the sensitivity_review queue item is resolved" is the only
-- available proxy - a queue status is not an authority record.
--
-- This migration introduces a real, immutable, append-only human-decision ledger for
-- that Phase-5 review, bound atomically to the existing P1-06 'sensitivity_review'
-- queue transition (see
-- Backend/kai/dictionary/postgresSensitivityAllowedUseReviewRepository.js). Lineage
-- follows the P2-12 (kai_sprint2_p2_12_human_review_decision_ledger.sql) append-only
-- ledger pattern exactly: a backward pointer (supersedes_decision_id) written once,
-- at INSERT time, on the new row - never a forward pointer and never an UPDATE of an
-- existing row - but this is a NEW table, not a reuse or mutation of
-- kai.evidence_review_decisions / kai.claim_review_decisions /
-- kai.human_authority_decisions.
--
-- Deliberately NOT touched by this package:
--   * every pinned column and CHECK constraint on kai.intake_sensitivity_profiles
--     (P1-05) - the ledger records the human decision, it does not propagate it onto
--     the profile row. Propagation is explicitly reserved for a future package;
--   * the P1-07 creation-trigger predicate
--     (Backend/kai/dictionary/postgresSourceCandidateRepository.js
--     satisfiesCreationTriggerPredicate) and the P1-08 permission predicate
--     (Backend/kai/dictionary/postgresSourcePromotionRepository.js
--     satisfiesPermissionPredicate), both of which continue to read only the pinned
--     P1-05 columns and are therefore unaffected;
--   * the generic POST /admin/review-queue/:id/status endpoint's open -> in_progress
--     only semantics (kai.review_queue_items is transitioned here by this package's
--     own compare-and-set, not by that endpoint);
--   * every claim/evidence/generated-content/export table. This ledger grants no
--     export, release, claim-approval, or evidence-approval authority whatsoever.

-- kai.intake_sensitivity_profiles carries no unique constraint on
-- (intake_sensitivity_profile_id, organization_id) that a tenant-scoped composite
-- FOREIGN KEY can reference (P1-05 declares only
-- intake_sensitivity_profiles_p1_05_identity_unique on
-- (organization_id, file_profile_id, data_dictionary_id); P1-07 added its own
-- intake_sensitivity_profiles_p1_07_candidate_lineage_unique on a four-column
-- superset). Following P1-07's precedent exactly, this package adds the one narrow
-- additive unique constraint it needs. It adds no column, changes no default, and
-- touches no CHECK constraint on that table.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'intake_sensitivity_profiles'
       AND c.conname = 'intake_sensitivity_profiles_b1a_02_id_org_unique'
  ) THEN
    ALTER TABLE kai.intake_sensitivity_profiles
      ADD CONSTRAINT intake_sensitivity_profiles_b1a_02_id_org_unique
      UNIQUE (intake_sensitivity_profile_id, organization_id);
  END IF;
END $$;

CREATE TABLE kai.intake_sensitivity_review_decisions (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  intake_sensitivity_profile_id uuid NOT NULL,
  review_queue_item_id uuid NOT NULL,
  decision_outcome text NOT NULL,

  -- The reviewed Phase-5 snapshot: exactly the P1-05 dimension vocabulary, prefixed
  -- `reviewed_` so a decision fact can never be confused with the machine-written
  -- profile column of the same name. Every one of these is NULL for a
  -- 'needs_more_information' decision and NOT NULL for a 'reviewed' decision (see
  -- intake_sensitivity_review_decisions_b1a_02_snapshot_completeness_check): a
  -- needs_more_information row is structurally incapable of carrying a permission.
  reviewed_personal_data_status text,
  reviewed_minor_data_status text,
  reviewed_health_housing_justice_immigration_status text,
  reviewed_indigenous_governance_status text,
  reviewed_staff_notes_status text,
  reviewed_story_testimonial_status text,
  reviewed_small_cell_risk_status text,
  reviewed_financial_records_status text,
  reviewed_consent_basis_status text,
  reviewed_allowed_use_status text,
  reviewed_llm_processing_allowed boolean,
  reviewed_product_learning_allowed boolean,
  reviewed_public_use_allowed boolean,
  reviewed_funder_use_allowed boolean,

  decided_by uuid NOT NULL,
  decided_by_role text NOT NULL,
  target_updated_at timestamptz NOT NULL,
  supersedes_decision_id uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_id_org_unique
    UNIQUE (decision_id, organization_id),
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_id_org_profile_unique
    UNIQUE (decision_id, organization_id, intake_sensitivity_profile_id),
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_profile_fk
    FOREIGN KEY (intake_sensitivity_profile_id, organization_id)
    REFERENCES kai.intake_sensitivity_profiles (intake_sensitivity_profile_id, organization_id)
    ON DELETE RESTRICT,
  -- kai.review_queue_items.target_object_id is shared by many queue_types that each
  -- point at a different target table, so the "this queue item must be the
  -- 'sensitivity_review' item for THIS profile" scoping cannot be expressed as a
  -- table-wide FK. Exactly as P2-12 does, the repository authoritatively re-reads the
  -- queue row filtered on (organization_id, review_queue_item_id, queue_type =
  -- 'sensitivity_review', target_object_type = 'intake_sensitivity_profile',
  -- target_object_id = this profile) inside the same transaction as the insert. This
  -- plain FK to the queue table's own primary key is strictly additional referential
  -- protection on top of that.
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_queue_item_fk
    FOREIGN KEY (review_queue_item_id)
    REFERENCES kai.review_queue_items (review_queue_item_id)
    ON DELETE RESTRICT,
  -- The predecessor referenced by supersedes_decision_id must already exist and must
  -- belong to the same organization AND the same sensitivity profile as the new row:
  -- a cross-tenant or cross-profile successor is structurally impossible.
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_supersedes_fk
    FOREIGN KEY (supersedes_decision_id, organization_id, intake_sensitivity_profile_id)
    REFERENCES kai.intake_sensitivity_review_decisions (decision_id, organization_id, intake_sensitivity_profile_id)
    ON DELETE RESTRICT,
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_not_self_superseding
    CHECK (supersedes_decision_id IS DISTINCT FROM decision_id),

  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_outcome_check
    CHECK (decision_outcome IN ('reviewed', 'needs_more_information')),

  -- A 'reviewed' decision must state every Phase-5 dimension explicitly; a
  -- 'needs_more_information' decision must state none of them. There is no partial
  -- form, and no permission column can ever be non-NULL on a
  -- needs_more_information row.
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_snapshot_completeness_check
    CHECK (
      (
        decision_outcome = 'reviewed'
        AND reviewed_personal_data_status IS NOT NULL
        AND reviewed_minor_data_status IS NOT NULL
        AND reviewed_health_housing_justice_immigration_status IS NOT NULL
        AND reviewed_indigenous_governance_status IS NOT NULL
        AND reviewed_staff_notes_status IS NOT NULL
        AND reviewed_story_testimonial_status IS NOT NULL
        AND reviewed_small_cell_risk_status IS NOT NULL
        AND reviewed_financial_records_status IS NOT NULL
        AND reviewed_consent_basis_status IS NOT NULL
        AND reviewed_allowed_use_status IS NOT NULL
        AND reviewed_llm_processing_allowed IS NOT NULL
        AND reviewed_product_learning_allowed IS NOT NULL
        AND reviewed_public_use_allowed IS NOT NULL
        AND reviewed_funder_use_allowed IS NOT NULL
      )
      OR (
        decision_outcome = 'needs_more_information'
        AND reviewed_personal_data_status IS NULL
        AND reviewed_minor_data_status IS NULL
        AND reviewed_health_housing_justice_immigration_status IS NULL
        AND reviewed_indigenous_governance_status IS NULL
        AND reviewed_staff_notes_status IS NULL
        AND reviewed_story_testimonial_status IS NULL
        AND reviewed_small_cell_risk_status IS NULL
        AND reviewed_financial_records_status IS NULL
        AND reviewed_consent_basis_status IS NULL
        AND reviewed_allowed_use_status IS NULL
        AND reviewed_llm_processing_allowed IS NULL
        AND reviewed_product_learning_allowed IS NULL
        AND reviewed_public_use_allowed IS NULL
        AND reviewed_funder_use_allowed IS NULL
      )
    ),

  -- 'unknown' is a real, distinct, queryable value on every presence dimension,
  -- exactly as in P1-05: it never collapses into absent/false/safe/permitted, and it
  -- is never silently upgraded to a permissive value.
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_personal_data_check
    CHECK (reviewed_personal_data_status IS NULL OR reviewed_personal_data_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_minor_data_check
    CHECK (reviewed_minor_data_status IS NULL OR reviewed_minor_data_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_hhji_check
    CHECK (reviewed_health_housing_justice_immigration_status IS NULL OR reviewed_health_housing_justice_immigration_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_indig_gov_check
    CHECK (reviewed_indigenous_governance_status IS NULL OR reviewed_indigenous_governance_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_staff_notes_check
    CHECK (reviewed_staff_notes_status IS NULL OR reviewed_staff_notes_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_story_testimonial_check
    CHECK (reviewed_story_testimonial_status IS NULL OR reviewed_story_testimonial_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_small_cell_risk_check
    CHECK (reviewed_small_cell_risk_status IS NULL OR reviewed_small_cell_risk_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_fin_records_check
    CHECK (reviewed_financial_records_status IS NULL OR reviewed_financial_records_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_consent_basis_check
    CHECK (reviewed_consent_basis_status IS NULL OR reviewed_consent_basis_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_allowed_use_check
    CHECK (reviewed_allowed_use_status IS NULL OR reviewed_allowed_use_status IN ('unknown', 'allowed', 'not_allowed')),

  -- Fail-closed permission basis, expressed only in terms of fields the current
  -- Phase-5 model already has. No permissive flag may be true unless this same
  -- decision independently states that allowed use is 'allowed'; public use
  -- additionally requires a 'present' consent basis. An 'unknown' or 'not_allowed'
  -- allowed-use status can therefore never carry any permission, and no permission is
  -- ever derivable from an absence of detected sensitivity.
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_llm_use_basis_check
    CHECK (reviewed_llm_processing_allowed IS NOT TRUE OR reviewed_allowed_use_status = 'allowed'),
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_product_learning_basis_check
    CHECK (reviewed_product_learning_allowed IS NOT TRUE OR reviewed_allowed_use_status = 'allowed'),
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_funder_use_basis_check
    CHECK (reviewed_funder_use_allowed IS NOT TRUE OR reviewed_allowed_use_status = 'allowed'),
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_public_use_basis_check
    CHECK (
      reviewed_public_use_allowed IS NOT TRUE
      OR (
        reviewed_allowed_use_status = 'allowed'
        AND reviewed_consent_basis_status = 'present'
        AND reviewed_indigenous_governance_status = 'absent'
      )
    ),

  -- Human ownership: only the roles the existing P1-06 sensitivity_review contract
  -- already authorizes (SENSITIVITY_REVIEW_ALLOWED_ROLES in
  -- Backend/kai/services/kaiReviewQueueService.js) may ever decide a Phase-5 review -
  -- never a client actor, never an assistant/AI/system/import actor.
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_role_check
    CHECK (decided_by_role IN ('gk_admin', 'gk_operator', 'gk_reviewer')),
  CONSTRAINT intake_sensitivity_review_decisions_b1a_02_created_by_type_check
    CHECK (created_by_type = 'human')
);

-- At most one root (first) decision per (organization, sensitivity profile) lineage:
-- a lineage is a single chain, never a forest.
CREATE UNIQUE INDEX ux_intake_sensitivity_review_decisions_b1a_02_root_per_lineage
  ON kai.intake_sensitivity_review_decisions (organization_id, intake_sensitivity_profile_id)
  WHERE supersedes_decision_id IS NULL;

-- At most one direct successor per predecessor: two concurrent decisions racing from
-- the same current head can each attempt their own INSERT, but only one can commit.
-- Together with the root index above, this guarantees exactly one current head (the
-- row with no successor) per lineage.
CREATE UNIQUE INDEX ux_intake_sensitivity_review_decisions_b1a_02_single_successor
  ON kai.intake_sensitivity_review_decisions (supersedes_decision_id)
  WHERE supersedes_decision_id IS NOT NULL;

CREATE INDEX ix_intake_sensitivity_review_decisions_b1a_02_tenant_profile
  ON kai.intake_sensitivity_review_decisions (organization_id, intake_sensitivity_profile_id);

CREATE OR REPLACE FUNCTION kai.b1a_02_reject_sensitivity_review_decision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'B1A-2 phase-5-allowed-use-decision-ledger history is append-only: % of %.% is not permitted', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER intake_sensitivity_review_decisions_b1a_02_append_only
  BEFORE UPDATE OR DELETE ON kai.intake_sensitivity_review_decisions
  FOR EACH ROW EXECUTE FUNCTION kai.b1a_02_reject_sensitivity_review_decision_mutation();

-- Additive extension of the shared upload_lifecycle_audit operation allowlist. The
-- allowlist has been widened by several packages since Gate A, so the current
-- definition is read back and extended in place rather than restated from a literal
-- list (restating it would silently drop whichever operations a later migration
-- added).
DO $$
DECLARE
  existing_definition text;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
    INTO existing_definition
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'upload_lifecycle_audit'
     AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check';

  IF existing_definition IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit_gate_a_operation_check is required before B1A-2 phase-5-allowed-use-decision-ledger migration';
  END IF;

  IF position('sensitivity_review_queue_item_created' IN existing_definition) = 0 THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit_gate_a_operation_check must already admit sensitivity_review_queue_item_created (P1-06) before B1A-2';
  END IF;

  IF position('sensitivity_review_decision_recorded' IN existing_definition) = 0 THEN
    existing_definition := replace(
      existing_definition,
      '''sensitivity_review_queue_item_created''::text',
      '''sensitivity_review_queue_item_created''::text, ''sensitivity_review_decision_recorded''::text'
    );
    EXECUTE format(
      'ALTER TABLE kai.upload_lifecycle_audit DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check, ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check %s',
      existing_definition
    );
  END IF;
END $$;

-- Metadata-only audit shape for the new operation: decision identity, actor-free
-- queue transition facts, and the validator key. The reviewed Phase-5 snapshot itself
-- is deliberately NOT dumped into the audit row (it is classification content, and
-- kai.gate_a_p0_jsonb_metadata_only would reject several of its own column names
-- outright).
ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_b1a_02_sensitivity_decision_metadata_check,
  ADD CONSTRAINT upload_lifecycle_audit_b1a_02_sensitivity_decision_metadata_check
    CHECK (
      operation <> 'sensitivity_review_decision_recorded'
      OR (
        jsonb_typeof(metadata) = 'object'
        AND kai.gate_a_p0_jsonb_metadata_only(metadata)
        AND metadata ? 'metadata_only'
        AND metadata ? 'contract'
        AND metadata ? 'intake_sensitivity_profile_id'
        AND metadata ? 'review_queue_item_id'
        AND metadata ? 'decision_id'
        AND metadata ? 'decision_outcome'
        AND metadata ? 'supersedes_decision_id'
        AND metadata ? 'previous_queue_status'
        AND metadata ? 'resulting_queue_status'
        AND metadata ? 'previous_review_status'
        AND metadata ? 'resulting_review_status'
        AND metadata ? 'validator_key'
        AND metadata - ARRAY[
          'metadata_only',
          'contract',
          'intake_sensitivity_profile_id',
          'review_queue_item_id',
          'decision_id',
          'decision_outcome',
          'supersedes_decision_id',
          'previous_queue_status',
          'resulting_queue_status',
          'previous_review_status',
          'resulting_review_status',
          'validator_key'
        ] = '{}'::jsonb
      )
    );

COMMIT;
