BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.claims') IS NULL THEN
    RAISE EXCEPTION 'kai.claims is required before P2-04 claim-gap/client-followup migration';
  END IF;
  IF to_regclass('kai.evidence_items') IS NULL THEN
    RAISE EXCEPTION 'kai.evidence_items is required before P2-04 claim-gap/client-followup migration';
  END IF;
  IF to_regclass('kai.source_versions') IS NULL THEN
    RAISE EXCEPTION 'kai.source_versions is required before P2-04 claim-gap/client-followup migration';
  END IF;
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P2-04 claim-gap/client-followup migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P2-04 claim-gap/client-followup migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P2-04 claim-gap/client-followup migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'claims'
       AND c.conname = 'claims_p2_03_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.claims_p2_03_id_org_unique is required before P2-04 claim-gap/client-followup migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'evidence_items'
       AND c.conname = 'evidence_items_p2_01_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.evidence_items_p2_01_id_org_unique is required before P2-04 claim-gap/client-followup migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'source_versions'
       AND c.conname = 'source_versions_p1_08_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.source_versions_p1_08_id_org_unique is required before P2-04 claim-gap/client-followup migration';
  END IF;
END $$;

-- P2-04 foundation table: one row per claim-scoped P2-02 dimension whose
-- authoritative assessment_status is not 'resolved_clear'. This table records
-- only the read-only P2-02 assessment result already computed by
-- Backend/kai/validators/kaiEvidenceCoverageAssessmentValidators.js for the
-- exact source_version the claim's evidence item is bound to - it never forks,
-- renames, or reimplements the P2-02 dimension vocabulary or its three-state
-- assessment_status outcome. dimension_key is pinned to the exact ten P2-02
-- dimension keys; assessment_status excludes 'resolved_clear' by construction,
-- since a resolved_clear dimension never produces a gap row. safe_summary is
-- pinned to the exact deterministic template
-- "Claim gap requires review for dimension: <dimension_key>." - never
-- caller-supplied, never derived from raw content. The four *_count columns are
-- the only "metadata-safe counts" this package persists from the P2-02 result;
-- no sample value, uncovered-field-key list, raw row, or free-text evidence
-- payload is ever persisted here.
CREATE TABLE IF NOT EXISTS kai.gap_log_items (
  gap_log_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  evidence_item_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  dimension_key text NOT NULL,
  assessment_status text NOT NULL,
  validator_key text NOT NULL,
  safe_summary text NOT NULL,

  open_finding_count integer,
  field_count integer,
  undefined_field_count integer,
  uncovered_field_count integer,

  created_by_type text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT gap_log_items_p2_04_identity_unique
    UNIQUE (organization_id, claim_id, dimension_key),
  CONSTRAINT gap_log_items_p2_04_id_org_unique
    UNIQUE (gap_log_item_id, organization_id),
  CONSTRAINT gap_log_items_p2_04_claim_fk
    FOREIGN KEY (claim_id, organization_id)
    REFERENCES kai.claims (claim_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT gap_log_items_p2_04_evidence_item_fk
    FOREIGN KEY (evidence_item_id, organization_id)
    REFERENCES kai.evidence_items (evidence_item_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT gap_log_items_p2_04_source_version_fk
    FOREIGN KEY (source_version_id, organization_id)
    REFERENCES kai.source_versions (source_version_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT gap_log_items_p2_04_dimension_key_check
    CHECK (dimension_key IN (
      'missingness',
      'duplicates',
      'definition_clarity',
      'denominator_clarity',
      'time_period_clarity',
      'entity_level_clarity',
      'small_cell_risk',
      'conflicting_source_indicators',
      'requirement_alignment',
      'coverage_gaps'
    )),
  CONSTRAINT gap_log_items_p2_04_assessment_status_check
    CHECK (assessment_status IN ('resolved_risk_flagged', 'unresolved')),
  CONSTRAINT gap_log_items_p2_04_validator_key_check
    CHECK (validator_key ~ '^VAL-KAI-P2-02-[a-z_]+$'),
  CONSTRAINT gap_log_items_p2_04_safe_summary_check
    CHECK (safe_summary = 'Claim gap requires review for dimension: ' || dimension_key || '.'),
  CONSTRAINT gap_log_items_p2_04_counts_non_negative_check
    CHECK (
      (open_finding_count IS NULL OR open_finding_count >= 0)
      AND (field_count IS NULL OR field_count >= 0)
      AND (undefined_field_count IS NULL OR undefined_field_count >= 0)
      AND (uncovered_field_count IS NULL OR uncovered_field_count >= 0)
    ),
  CONSTRAINT gap_log_items_p2_04_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

CREATE INDEX IF NOT EXISTS ix_gap_log_items_p2_04_tenant_claim
  ON kai.gap_log_items (organization_id, claim_id);

-- P2-04 foundation table: one client-answerable follow-up per open gap on one of
-- the four client-answerable dimensions (definition_clarity, denominator_clarity,
-- time_period_clarity, entity_level_clarity). question_text is pinned to the
-- exact fixed server-owned template for its own dimension_key via
-- client_followup_items_p2_04_dimension_question_pairing_check below - never a
-- caller-supplied, field-identifier-augmented, or otherwise varied question.
-- Every follow-up is immutably linked to its authoritative gap item (and, via
-- that gap item, to its claim and dimension) through the tenant-safe composite
-- FK to kai.gap_log_items.
CREATE TABLE IF NOT EXISTS kai.client_followup_items (
  client_followup_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  gap_log_item_id uuid NOT NULL,
  dimension_key text NOT NULL,
  question_text text NOT NULL,

  created_by_type text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT client_followup_items_p2_04_identity_unique
    UNIQUE (organization_id, claim_id, dimension_key),
  CONSTRAINT client_followup_items_p2_04_id_org_unique
    UNIQUE (client_followup_item_id, organization_id),
  CONSTRAINT client_followup_items_p2_04_one_per_gap_unique
    UNIQUE (organization_id, gap_log_item_id),
  CONSTRAINT client_followup_items_p2_04_claim_fk
    FOREIGN KEY (claim_id, organization_id)
    REFERENCES kai.claims (claim_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT client_followup_items_p2_04_gap_fk
    FOREIGN KEY (gap_log_item_id, organization_id)
    REFERENCES kai.gap_log_items (gap_log_item_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT client_followup_items_p2_04_dimension_key_check
    CHECK (dimension_key IN (
      'definition_clarity',
      'denominator_clarity',
      'time_period_clarity',
      'entity_level_clarity'
    )),
  CONSTRAINT client_followup_items_p2_04_question_text_check
    CHECK (question_text IN (
      'Confirm the business meaning of the unresolved field or measure.',
      'Confirm the denominator and how it is calculated.',
      'Confirm the reporting period represented by this source.',
      'Confirm the entity level represented by the unresolved field or measure.'
    )),
  CONSTRAINT client_followup_items_p2_04_dimension_question_pairing_check
    CHECK (
      (dimension_key = 'definition_clarity' AND question_text = 'Confirm the business meaning of the unresolved field or measure.')
      OR (dimension_key = 'denominator_clarity' AND question_text = 'Confirm the denominator and how it is calculated.')
      OR (dimension_key = 'time_period_clarity' AND question_text = 'Confirm the reporting period represented by this source.')
      OR (dimension_key = 'entity_level_clarity' AND question_text = 'Confirm the entity level represented by the unresolved field or measure.')
    ),
  CONSTRAINT client_followup_items_p2_04_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

CREATE INDEX IF NOT EXISTS ix_client_followup_items_p2_04_tenant_claim
  ON kai.client_followup_items (organization_id, claim_id);

-- P2-04 idempotency identity for the 'client_followup' queue_type only: a
-- partial unique index, not a table-wide constraint, mirroring the exact
-- P1-06/P2-01/P2-03 precedent (ux_review_queue_items_p1_06_sensitivity_review_identity,
-- ux_review_queue_items_p2_01_evidence_review_identity,
-- ux_review_queue_items_p2_03_claim_review_identity). 'client_followup' was
-- already an accepted queue_type value in the P1-06 migration, unused until this
-- package. target_object_type for these rows is the literal
-- 'client_followup_item'; target_object_id is the client_followup_item_id.
CREATE UNIQUE INDEX IF NOT EXISTS ux_review_queue_items_p2_04_client_followup_identity
  ON kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id)
  WHERE queue_type = 'client_followup';

-- P2-04 owner decision: unlike P2-03's narrower required_action-only addition,
-- this package's task specification discloses the complete fixed
-- 'client_followup' queue contract (target_object_type, queue_status,
-- review_status, priority, summary, required_action, assigned_to, due_at) as an
-- explicit deliverable, not merely a non-blank required_action. This single
-- scoped CHECK - for queue_type = 'client_followup' rows only - enforces that
-- complete contract at the database level, while leaving every other queue_type
-- (including every already-accepted P1-06/P2-01/P2-03 row shape) untouched.
ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_p2_04_client_followup_contract_check,
  ADD CONSTRAINT review_queue_items_p2_04_client_followup_contract_check
    CHECK (
      queue_type <> 'client_followup'
      OR (
        target_object_type = 'client_followup_item'
        AND queue_status = 'waiting_on_client'
        AND review_status = 'proposed'
        AND priority = 'normal'
        AND summary = 'Client clarification is required for an unresolved claim gap.'
        AND assigned_to IS NULL
        AND due_at IS NULL
        AND required_action IN (
          'Confirm the business meaning of the unresolved field or measure.',
          'Confirm the denominator and how it is calculated.',
          'Confirm the reporting period represented by this source.',
          'Confirm the entity level represented by the unresolved field or measure.'
        )
      )
    );

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_gate_a_operation_check,
  ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check
    CHECK (operation IN (
      'reserve_upload',
      'start_upload',
      'complete_object_version',
      'confirm_upload',
      'block_upload',
      'abandon_upload',
      'expire_upload',
      'policy_decision_compare_and_set',
      'parser_run_recorded',
      'file_profile_persisted',
      'data_dictionary_draft_persisted',
      'intake_sensitivity_profile_persisted',
      'sensitivity_review_queue_item_created',
      'intake_source_candidate_persisted',
      'source_promotion_decision_persisted',
      'evidence_lineage_extracted',
      'claim_proposed',
      'claim_gap_and_followup_generated'
    ));

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_gate_a_metadata_object_check,
  ADD CONSTRAINT upload_lifecycle_audit_gate_a_metadata_object_check
    CHECK (
      jsonb_typeof(metadata) = 'object'
      AND kai.gate_a_p0_jsonb_metadata_only(metadata)
      AND (
        operation <> 'policy_decision_compare_and_set'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'file_policy_status'
          AND metadata ? 'policy_decision_outcome'
          AND metadata ? 'object_version_bound'
          AND metadata ? 'verified_checksum_bound'
          AND metadata ? 'verified_size_bytes_bound'
          AND metadata ? 'declared_mime'
          AND metadata ? 'extension'
          AND metadata ? 'replay_contract_version'
          AND metadata ? 'validator_key'
          AND NOT metadata ? 'sanitized_result'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'file_policy_status',
            'policy_decision_outcome',
            'object_version_bound',
            'verified_checksum_bound',
            'verified_size_bytes_bound',
            'declared_mime',
            'extension',
            'replay_contract_version',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'parser_run_recorded'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'parser_name'
          AND metadata ? 'parser_version'
          AND metadata ? 'checksum_bound'
          AND metadata ? 'parser_status'
          AND metadata ? 'retry_count'
          AND metadata ? 'error_code'
          AND metadata ? 'error_message_safe'
          AND metadata ? 'validator_key'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'parser_name',
            'parser_version',
            'checksum_bound',
            'parser_status',
            'retry_count',
            'error_code',
            'error_message_safe',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'file_profile_persisted'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'parser_name'
          AND metadata ? 'parser_version'
          AND metadata ? 'checksum_bound'
          AND metadata ? 'profile_canonical_sha256'
          AND metadata ? 'validator_key'
          AND NOT metadata ? 'profile'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'parser_name',
            'parser_version',
            'checksum_bound',
            'profile_canonical_sha256',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'data_dictionary_draft_persisted'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'file_profile_id'
          AND metadata ? 'profile_canonical_sha256'
          AND metadata ? 'dictionary_status'
          AND metadata ? 'field_count'
          AND metadata ? 'mapping_count'
          AND metadata ? 'finding_count'
          AND metadata ? 'validator_key'
          AND NOT metadata ? 'profile'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'file_profile_id',
            'profile_canonical_sha256',
            'dictionary_status',
            'field_count',
            'mapping_count',
            'finding_count',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'intake_sensitivity_profile_persisted'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'file_profile_id'
          AND metadata ? 'data_dictionary_id'
          AND metadata ? 'profile_canonical_sha256'
          AND metadata ? 'human_review_required'
          AND metadata ? 'validator_key'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'file_profile_id',
            'data_dictionary_id',
            'profile_canonical_sha256',
            'human_review_required',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'sensitivity_review_queue_item_created'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'queue_type'
          AND metadata ? 'target_object_type'
          AND metadata ? 'target_object_id'
          AND metadata ? 'queue_status'
          AND metadata ? 'validator_key'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'queue_type',
            'target_object_type',
            'target_object_id',
            'queue_status',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'intake_source_candidate_persisted'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'intake_sensitivity_profile_id'
          AND metadata ? 'profile_canonical_sha256'
          AND metadata ? 'proposed_source_type'
          AND metadata ? 'candidate_status'
          AND metadata ? 'queue_type'
          AND metadata ? 'target_object_type'
          AND metadata ? 'target_object_id'
          AND metadata ? 'queue_status'
          AND metadata ? 'validator_key'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'intake_sensitivity_profile_id',
            'profile_canonical_sha256',
            'proposed_source_type',
            'candidate_status',
            'queue_type',
            'target_object_type',
            'target_object_id',
            'queue_status',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'source_promotion_decision_persisted'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'intake_source_candidate_id'
          AND metadata ? 'intake_sensitivity_profile_id'
          AND metadata ? 'profile_canonical_sha256'
          AND metadata ? 'reviewed_source_type'
          AND metadata ? 'decision_status'
          AND metadata ? 'candidate_status'
          AND metadata ? 'queue_status'
          AND metadata ? 'source_id'
          AND metadata ? 'source_version_id'
          AND metadata ? 'validator_key'
          AND NOT metadata ? 'storage_uri'
          AND NOT metadata ? 'signed_url'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'intake_source_candidate_id',
            'intake_sensitivity_profile_id',
            'profile_canonical_sha256',
            'reviewed_source_type',
            'decision_status',
            'candidate_status',
            'queue_status',
            'source_id',
            'source_version_id',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'evidence_lineage_extracted'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'source_version_id'
          AND metadata ? 'intake_sensitivity_profile_id'
          AND metadata ? 'profile_canonical_sha256'
          AND metadata ? 'evidence_item_count'
          AND metadata ? 'source_locator_count'
          AND metadata ? 'review_queue_item_count'
          AND metadata ? 'fresh_write_count'
          AND metadata ? 'validator_key'
          AND NOT metadata ? 'statement'
          AND NOT metadata ? 'statement_fingerprint'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'source_version_id',
            'intake_sensitivity_profile_id',
            'profile_canonical_sha256',
            'evidence_item_count',
            'source_locator_count',
            'review_queue_item_count',
            'fresh_write_count',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'claim_proposed'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'evidence_item_id'
          AND metadata ? 'claim_id'
          AND metadata ? 'claim_type'
          AND metadata ? 'claim_status'
          AND metadata ? 'claim_review_status'
          AND metadata ? 'requirement_coverage_status'
          AND metadata ? 'warning_count'
          AND metadata ? 'review_queue_item_count'
          AND metadata ? 'fresh_write_count'
          AND metadata ? 'validator_key'
          AND NOT metadata ? 'claim_statement'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'evidence_item_id',
            'claim_id',
            'claim_type',
            'claim_status',
            'claim_review_status',
            'requirement_coverage_status',
            'warning_count',
            'review_queue_item_count',
            'fresh_write_count',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'claim_gap_and_followup_generated'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'claim_id'
          AND metadata ? 'evidence_item_id'
          AND metadata ? 'source_version_id'
          AND metadata ? 'gap_dimension_keys'
          AND metadata ? 'client_followup_dimension_keys'
          AND metadata ? 'gap_count'
          AND metadata ? 'client_followup_count'
          AND metadata ? 'review_queue_item_count'
          AND metadata ? 'fresh_write_count'
          AND metadata ? 'validator_key'
          AND NOT metadata ? 'question_text'
          AND NOT metadata ? 'summary'
          AND NOT metadata ? 'safe_summary'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'claim_id',
            'evidence_item_id',
            'source_version_id',
            'gap_dimension_keys',
            'client_followup_dimension_keys',
            'gap_count',
            'client_followup_count',
            'review_queue_item_count',
            'fresh_write_count',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
    );

COMMIT;
