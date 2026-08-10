BEGIN;

DELETE FROM kai.upload_lifecycle_audit
 WHERE operation = 'claim_proposed';

ALTER TABLE IF EXISTS kai.upload_lifecycle_audit
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
      'evidence_lineage_extracted'
    ));

ALTER TABLE IF EXISTS kai.upload_lifecycle_audit
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
    );

ALTER TABLE IF EXISTS kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_p2_03_claim_review_required_action_check;

DROP INDEX IF EXISTS kai.ux_review_queue_items_p2_03_claim_review_identity;

DROP TABLE IF EXISTS kai.claim_evidence_links;
DROP TABLE IF EXISTS kai.claims;

COMMIT;
