import pool from "./kaiDb.js";

export async function findIntakeBatchByIdempotencyKey({ organizationId, idempotencyKey }, db = pool) {
  if (!organizationId || !idempotencyKey) return null;
  const { rows } = await db.query(
    `SELECT intake_batch_id, organization_id, engagement_id, batch_code, processing_status,
            review_status, idempotency_key, batch_metadata
       FROM kai.intake_batches
      WHERE organization_id = $1
        AND idempotency_key = $2
      LIMIT 1`,
    [organizationId, idempotencyKey],
  );
  return rows[0] || null;
}

export async function findIntakeFileReservationByIdempotencyKey(
  { organizationId, engagementId, intakeBatchId, idempotencyKey },
  db = pool,
) {
  if (!organizationId || !intakeBatchId || !idempotencyKey) return null;
  const params = [organizationId, intakeBatchId, idempotencyKey];
  const engagementPredicate = engagementId ? "AND engagement_id = $4" : "";
  if (engagementId) params.push(engagementId);
  const { rows } = await db.query(
    `SELECT intake_file_id, intake_batch_id, organization_id, engagement_id, safe_filename,
            storage_provider, storage_bucket, storage_object_key, file_policy_status,
            malware_scan_status, processing_status, parse_status, review_status, file_metadata
       FROM kai.intake_files
      WHERE organization_id = $1
        AND intake_batch_id = $2
        AND file_metadata->>'idempotency_key' = $3
        ${engagementPredicate}
      LIMIT 1`,
    params,
  );
  return rows[0] || null;
}

export async function findIntakeFileReservationByChecksum({ organizationId, checksum }, db = pool) {
  if (!organizationId || !checksum) return null;
  const { rows } = await db.query(
    `SELECT intake_file_id, intake_batch_id, organization_id, engagement_id, checksum,
            hash_algorithm, processing_status, parse_status, review_status, file_metadata
       FROM kai.intake_files
      WHERE organization_id = $1
        AND checksum = $2
        AND force_new_version = false
      LIMIT 1`,
    [organizationId, checksum],
  );
  return rows[0] || null;
}

export async function insertIntakeBatchMetadata(batch, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO kai.intake_batches (
       organization_id,
       engagement_id,
       batch_code,
       intake_method,
       processing_status,
       review_status,
       idempotency_key,
       source_system_name,
       source_system_ref,
       notes,
       batch_metadata,
       created_by,
       created_by_type
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)
     RETURNING intake_batch_id, organization_id, engagement_id, batch_code, processing_status,
       review_status, idempotency_key, batch_metadata`,
    [
      batch.organizationId,
      batch.engagementId || null,
      batch.batchCode,
      batch.intakeMethod || "manual_upload",
      "received",
      "proposed",
      batch.idempotencyKey || null,
      batch.sourceSystemName || null,
      batch.sourceSystemRef || null,
      batch.notes || null,
      JSON.stringify(batch.batchMetadata || {}),
      batch.createdBy,
      batch.createdByType || "human",
    ],
  );
  return rows[0] || null;
}

export async function insertIntakeFileMetadata(file, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO kai.intake_files (
       intake_file_id,
       intake_batch_id,
       organization_id,
       engagement_id,
       original_filename,
       safe_filename,
       storage_uri,
       storage_provider,
       storage_region,
       storage_bucket,
       storage_object_key,
       mime_type,
       file_extension,
       file_size_bytes,
       checksum,
       hash_algorithm,
       raw_file_retained,
       processing_status,
       parse_status,
       review_status,
       file_policy_status,
       malware_scan_status,
       file_metadata,
       created_by,
       created_by_type
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24,$25)
     RETURNING intake_file_id, intake_batch_id, organization_id, engagement_id, safe_filename,
       storage_provider, storage_bucket, storage_object_key, file_policy_status, malware_scan_status,
       processing_status, parse_status, review_status`,
    [
      file.intakeFileId,
      file.intakeBatchId,
      file.organizationId,
      file.engagementId || null,
      file.originalFilename,
      file.safeFilename,
      file.storageUri,
      file.storageProvider,
      file.storageRegion || null,
      file.storageBucket || null,
      file.storageObjectKey || null,
      file.mimeType || null,
      file.fileExtension || null,
      file.fileSizeBytes ?? null,
      file.checksum,
      file.hashAlgorithm || "sha256",
      file.rawFileRetained ?? false,
      "quarantined",
      "quarantined",
      "proposed",
      file.filePolicyStatus || "pending",
      file.malwareScanStatus || "not_configured",
      JSON.stringify(file.fileMetadata || {}),
      file.createdBy,
      file.createdByType || "human",
    ],
  );
  return rows[0] || null;
}

export async function insertReviewQueueItem(item, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO kai.review_queue_items (
       organization_id,
       engagement_id,
       queue_type,
       target_object_type,
       target_object_id,
       priority,
       queue_status,
       review_status,
       blocked_reason,
       summary,
       required_action,
       queue_metadata,
       created_by,
       created_by_type
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
     RETURNING review_queue_item_id, organization_id, queue_type, queue_status, target_object_type, target_object_id`,
    [
      item.organizationId,
      item.engagementId || null,
      item.queueType,
      item.targetObjectType,
      item.targetObjectId,
      item.priority || "medium",
      item.queueStatus || "open",
      item.reviewStatus || "needs_gk_review",
      item.blockedReason || null,
      item.summary,
      item.requiredAction || null,
      JSON.stringify(item.queueMetadata || {}),
      item.createdBy || null,
      item.createdByType || "system",
    ],
  );
  return rows[0] || null;
}

export async function blockIntakeFilePolicyStatus({ organizationId, intakeFileId }, db = pool) {
  const { rows } = await db.query(
    `UPDATE kai.intake_files
        SET file_policy_status = 'blocked'
      WHERE organization_id = $1
        AND intake_file_id = $2
        AND file_policy_status = 'pending'
      RETURNING intake_file_id, intake_batch_id, organization_id, engagement_id, safe_filename,
        mime_type, file_size_bytes, file_policy_status, malware_scan_status, processing_status,
        parse_status, review_status, created_at, updated_at`,
    [organizationId, intakeFileId],
  );
  return rows[0] || null;
}

export async function getScopedIntakeFileReviewQueueItem(
  organizationId,
  reviewQueueItemId,
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT review_queue_item_id, organization_id, queue_type, target_object_type,
            target_object_id, priority, queue_status, due_at, summary, required_action,
            created_at, updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1
        AND review_queue_item_id = $2
        AND queue_type = 'intake_file_review'
        AND target_object_type = 'intake_file'
      LIMIT 1`,
    [organizationId, reviewQueueItemId],
  );
  return rows[0] || null;
}

export async function getScopedReviewQueueLinkedIntakeFile(
  organizationId,
  intakeFileId,
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT intake_file_id, organization_id
       FROM kai.intake_files
      WHERE organization_id = $1
        AND intake_file_id = $2
      LIMIT 1`,
    [organizationId, intakeFileId],
  );
  return rows[0] || null;
}

export async function updateReviewQueueItemStatusIfCurrent(
  { organizationId, reviewQueueItemId, expectedQueueStatus, newQueueStatus },
  db = pool,
) {
  const { rows } = await db.query(
    `UPDATE kai.review_queue_items
        SET queue_status = $4
      WHERE organization_id = $1
        AND review_queue_item_id = $2
        AND queue_type = 'intake_file_review'
        AND target_object_type = 'intake_file'
        AND queue_status = $3
      RETURNING review_queue_item_id, organization_id, queue_type, target_object_type,
        target_object_id, priority, queue_status, due_at, summary, required_action,
        created_at, updated_at`,
    [organizationId, reviewQueueItemId, expectedQueueStatus, newQueueStatus],
  );
  return rows[0] || null;
}

/**
 * P1-06 narrow, tenant-scoped authoritative lookup by the 'sensitivity_review'
 * idempotency identity (organization_id + queue_type + target_object_type +
 * target_object_id). Locks the row FOR UPDATE so the P1-06 repository can decide
 * between "replay this existing row" and "safe to insert" inside one transaction.
 * This is additive: it does not change `insertReviewQueueItem` or any other
 * existing exported query in this module, and it is scoped to queue_type =
 * 'sensitivity_review' / target_object_type = 'intake_sensitivity_profile' only, so
 * no other queue_type's rows are ever read, locked, or affected by it.
 */
export async function getScopedSensitivityReviewQueueItemByIdentity(
  { organizationId, targetObjectId },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT review_queue_item_id, organization_id, queue_type, target_object_type,
            target_object_id, priority, queue_status, assigned_to, due_at, summary,
            required_action, created_at, updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1
        AND queue_type = 'sensitivity_review'
        AND target_object_type = 'intake_sensitivity_profile'
        AND target_object_id = $2
      FOR UPDATE`,
    [organizationId, targetObjectId],
  );
  return rows[0] || null;
}

/**
 * P1-07 narrow, tenant-scoped authoritative lookup by the 'source_candidate_review'
 * idempotency identity (organization_id + queue_type + target_object_type +
 * target_object_id). Locks the row FOR UPDATE so the P1-07 repository can decide
 * between "replay this existing row" and "safe to insert" inside one transaction.
 * This is additive: it does not change any other exported query in this module, and
 * it is scoped to queue_type = 'source_candidate_review' / target_object_type =
 * 'intake_source_candidate' only, so no other queue_type's rows are ever read,
 * locked, or affected by it.
 */
export async function getScopedSourceCandidateReviewQueueItemByIdentity(
  { organizationId, targetObjectId },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT review_queue_item_id, organization_id, queue_type, target_object_type,
            target_object_id, priority, queue_status, assigned_to, due_at, summary,
            required_action, queue_metadata, created_at, updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1
        AND queue_type = 'source_candidate_review'
        AND target_object_type = 'intake_source_candidate'
        AND target_object_id = $2
      FOR UPDATE`,
    [organizationId, targetObjectId],
  );
  return rows[0] || null;
}

/**
 * P1-08 narrow, tenant-scoped authoritative lookup of the P1-07 source candidate
 * this package promotes. Locks the row FOR UPDATE so the P1-08 repository can
 * decide between "replay an existing promotion decision" and "safe to promote"
 * inside one transaction. This is additive: it does not change any other exported
 * query in this module.
 */
export async function getScopedSourceCandidateByIdentity(
  { organizationId, intakeSourceCandidateId },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT intake_source_candidate_id, organization_id, intake_file_id, file_profile_id,
            data_dictionary_id, intake_sensitivity_profile_id, profile_canonical_sha256,
            proposed_source_type, candidate_status, created_at
       FROM kai.intake_source_candidates
      WHERE organization_id = $1
        AND intake_source_candidate_id = $2
      FOR UPDATE`,
    [organizationId, intakeSourceCandidateId],
  );
  return rows[0] || null;
}

/**
 * P1-08 narrow, tenant-scoped authoritative lookup by the P1-08 promotion-decision
 * idempotency identity (organization_id + intake_source_candidate_id). Locks the row
 * FOR UPDATE. Additive: no other exported query in this module is changed.
 */
export async function getScopedSourcePromotionDecisionByIdentity(
  { organizationId, intakeSourceCandidateId },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT intake_promotion_decision_id, organization_id, intake_source_candidate_id,
            review_queue_item_id, reviewed_source_type, decision_status, source_id,
            source_version_id, created_at, decided_at, promoted_at
       FROM kai.intake_promotion_decisions
      WHERE organization_id = $1
        AND intake_source_candidate_id = $2
      FOR UPDATE`,
    [organizationId, intakeSourceCandidateId],
  );
  return rows[0] || null;
}

/**
 * P1-08 narrow, tenant-scoped authoritative lookup of an existing `kai.sources` row
 * by its deterministic identity (organization_id + source_code). Locks the row FOR
 * UPDATE. Additive: no other exported query in this module is changed.
 */
export async function getScopedSourceByCode(
  { organizationId, sourceCode },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT source_id, organization_id, source_code, reviewed_source_type, created_at
       FROM kai.sources
      WHERE organization_id = $1
        AND source_code = $2
      FOR UPDATE`,
    [organizationId, sourceCode],
  );
  return rows[0] || null;
}

/**
 * P1-08 narrow, tenant-scoped authoritative lookup of an existing `kai.sources` row
 * by its primary key (organization_id + source_id), used only to read back a
 * source already bound by a committed `kai.intake_promotion_decisions` row during
 * replay. Never locked FOR UPDATE: replay performs no mutation. Additive: no other
 * exported query in this module is changed.
 */
export async function getScopedSourceById(
  { organizationId, sourceId },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT source_id, organization_id, source_code, reviewed_source_type, created_at
       FROM kai.sources
      WHERE organization_id = $1
        AND source_id = $2`,
    [organizationId, sourceId],
  );
  return rows[0] || null;
}

/**
 * P1-08 narrow, tenant-scoped authoritative lookup of an existing
 * `kai.source_versions` row by its primary key (organization_id +
 * source_version_id), used only to read back a source version already bound by a
 * committed `kai.intake_promotion_decisions` row during replay. Never locked FOR
 * UPDATE: replay performs no mutation. Additive: no other exported query in this
 * module is changed.
 */
export async function getScopedSourceVersionById(
  { organizationId, sourceVersionId },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT source_version_id, organization_id, source_id, intake_source_candidate_id,
            intake_sensitivity_profile_id, profile_canonical_sha256, is_current, created_at
       FROM kai.source_versions
      WHERE organization_id = $1
        AND source_version_id = $2`,
    [organizationId, sourceVersionId],
  );
  return rows[0] || null;
}

/**
 * P1-08 narrow, tenant-scoped authoritative lookup of an existing `kai.source_versions`
 * row by the P1-08 candidate-identity idempotency key (organization_id +
 * intake_source_candidate_id). Locks the row FOR UPDATE. Additive: no other exported
 * query in this module is changed.
 */
/**
 * P2-01 narrow, tenant-scoped authoritative lookup of an existing P1-08
 * `kai.intake_promotion_decisions` row by (organization_id, source_version_id).
 * Never locked FOR UPDATE: P2-01 never mutates this table, only reads its already-
 * committed promotion facts. Additive: no other exported query in this module is
 * changed.
 */
export async function getScopedPromotionDecisionBySourceVersionId(
  { organizationId, sourceVersionId },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT intake_promotion_decision_id, organization_id, intake_source_candidate_id,
            review_queue_item_id, reviewed_source_type, decision_status, source_id,
            source_version_id, created_at, decided_at, promoted_at
       FROM kai.intake_promotion_decisions
      WHERE organization_id = $1
        AND source_version_id = $2`,
    [organizationId, sourceVersionId],
  );
  return rows[0] || null;
}

/**
 * P2-01 narrow, tenant-scoped authoritative lookup of an existing P1-05
 * `kai.intake_sensitivity_profiles` row by (organization_id,
 * intake_sensitivity_profile_id), reading exactly the columns P1-08's own
 * `readScopedSensitivityProfile` already reads against the same table. Added here
 * so both the P1-08 and P2-01 repositories can share one exported lookup rather
 * than duplicating the query text; the P1-08 repository file itself is not
 * modified. Never locked FOR UPDATE: P2-01 never mutates this table. Additive: no
 * other exported query in this module is changed.
 */
export async function getScopedSensitivityProfileById(
  { organizationId, intakeSensitivityProfileId },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT organization_id::text AS organization_id,
            intake_sensitivity_profile_id::text AS intake_sensitivity_profile_id,
            intake_file_id::text AS intake_file_id,
            file_profile_id::text AS file_profile_id,
            data_dictionary_id::text AS data_dictionary_id,
            profile_canonical_sha256,
            human_review_required,
            public_use_allowed,
            funder_use_allowed,
            llm_processing_allowed,
            product_learning_allowed,
            retention_posture
       FROM kai.intake_sensitivity_profiles
      WHERE organization_id = $1
        AND intake_sensitivity_profile_id = $2`,
    [organizationId, intakeSensitivityProfileId],
  );
  return rows[0] || null;
}

/**
 * P2-01 narrow, tenant-scoped authoritative lookup of an existing P1-04
 * `kai.data_dictionaries` row by (organization_id, data_dictionary_id). Never
 * locked FOR UPDATE: P2-01 never mutates this table. Additive: no other exported
 * query in this module is changed.
 */
export async function getScopedDataDictionaryById(
  { organizationId, dataDictionaryId },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT data_dictionary_id, organization_id, intake_file_id, file_profile_id,
            profile_canonical_sha256, dictionary_status, created_at
       FROM kai.data_dictionaries
      WHERE organization_id = $1
        AND data_dictionary_id = $2`,
    [organizationId, dataDictionaryId],
  );
  return rows[0] || null;
}

/**
 * P2-01 narrow, tenant-scoped authoritative read of every committed
 * `kai.data_dictionary_fields` row for one dictionary, ordered deterministically
 * by profile_field_key ASC so evidence composition is reproducible run to run.
 * Reads only the three columns P2-01's deterministic evidence statements are
 * built from - never a sample value, raw content, or free-text column. Never
 * locked FOR UPDATE: P2-01 never mutates this table. Additive: no other exported
 * query in this module is changed.
 */
export async function getScopedDataDictionaryFieldsByDictionaryId(
  { organizationId, dataDictionaryId },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT data_dictionary_field_id, profile_field_key, data_type, sensitivity
       FROM kai.data_dictionary_fields
      WHERE organization_id = $1
        AND data_dictionary_id = $2
      ORDER BY profile_field_key ASC`,
    [organizationId, dataDictionaryId],
  );
  return rows;
}

/**
 * P2-01 narrow, tenant-scoped authoritative lookup of an existing
 * `kai.evidence_items` row by its idempotency identity (organization_id,
 * source_version_id, statement_fingerprint), used to distinguish a fresh insert
 * from an authoritative replay after a losing conditional insert attempt.
 * Additive: no other exported query in this module is changed.
 */
export async function getScopedEvidenceItemByStatementFingerprint(
  { organizationId, sourceVersionId, statementFingerprint },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT evidence_item_id, organization_id, source_id, source_version_id, source_locator_id,
            evidence_type, data_class, sensitivity_level, support_strength, statement, statement_fingerprint,
            evidence_review_status, internal_only, public_use_allowed,
            funder_use_allowed, llm_processing_allowed, product_learning_allowed,
            created_by, created_by_type, created_at
       FROM kai.evidence_items
      WHERE organization_id = $1
        AND source_version_id = $2
        AND statement_fingerprint = $3`,
    [organizationId, sourceVersionId, statementFingerprint],
  );
  return rows[0] || null;
}

/**
 * P2-01 narrow, tenant-scoped authoritative lookup of an existing
 * `kai.source_locators` row by its idempotency identity (organization_id,
 * source_version_id, locator_fingerprint), used to distinguish a fresh insert
 * from an authoritative replay after a losing conditional insert attempt.
 * Additive: no other exported query in this module is changed.
 */
export async function getScopedSourceLocatorByFingerprint(
  { organizationId, sourceVersionId, locatorFingerprint },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT source_locator_id, organization_id, source_version_id, locator_type,
            coordinates, locator_fingerprint, created_by_type, created_at
       FROM kai.source_locators
      WHERE organization_id = $1
        AND source_version_id = $2
        AND locator_fingerprint = $3`,
    [organizationId, sourceVersionId, locatorFingerprint],
  );
  return rows[0] || null;
}

/**
 * P2-01 narrow, tenant-scoped authoritative lookup by the 'evidence_review'
 * idempotency identity (organization_id + queue_type + target_object_type +
 * target_object_id), mirroring the identical P1-06/P1-07 lookup pattern exactly.
 * Additive: no other exported query in this module is changed.
 */
export async function getScopedEvidenceReviewQueueItemByEvidenceItemId(
  { organizationId, evidenceItemId },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT review_queue_item_id, organization_id, queue_type, target_object_type,
            target_object_id, priority, queue_status, review_status, assigned_to,
            due_at, summary, required_action, queue_metadata, created_at, updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1
        AND queue_type = 'evidence_review'
        AND target_object_type = 'evidence_item'
        AND target_object_id = $2`,
    [organizationId, evidenceItemId],
  );
  return rows[0] || null;
}

/**
 * P2-03 narrow, tenant-scoped authoritative lookup of an existing P2-01
 * `kai.evidence_items` row by its primary key (organization_id,
 * evidence_item_id). Never locked FOR UPDATE: P2-03 never mutates this table,
 * only reads its already-committed evidence facts. Additive: no other exported
 * query in this module is changed.
 */
export async function getScopedEvidenceItemById(
  { organizationId, evidenceItemId },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT evidence_item_id, organization_id, source_id, source_version_id, source_locator_id,
            evidence_type, data_class, sensitivity_level, support_strength, statement, statement_fingerprint,
            evidence_review_status, internal_only, public_use_allowed,
            funder_use_allowed, llm_processing_allowed, product_learning_allowed,
            created_by, created_by_type, created_at
       FROM kai.evidence_items
      WHERE organization_id = $1
        AND evidence_item_id = $2`,
    [organizationId, evidenceItemId],
  );
  return rows[0] || null;
}

/**
 * P2-03 narrow, tenant-scoped authoritative lookup of an existing P2-01
 * `kai.source_locators` row by its primary key (organization_id,
 * source_locator_id). Never locked FOR UPDATE: P2-03 never mutates this table.
 * Additive: no other exported query in this module is changed.
 */
export async function getScopedSourceLocatorById(
  { organizationId, sourceLocatorId },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT source_locator_id, organization_id, source_version_id, locator_type,
            coordinates, locator_fingerprint, created_by_type, created_at
       FROM kai.source_locators
      WHERE organization_id = $1
        AND source_locator_id = $2`,
    [organizationId, sourceLocatorId],
  );
  return rows[0] || null;
}

/**
 * P2-03 narrow, tenant-scoped authoritative lookup of an existing `kai.claims`
 * row by its idempotency identity (organization_id, evidence_item_id,
 * claim_type), used to distinguish a fresh insert from an authoritative replay
 * after a losing conditional insert attempt. Additive: no other exported query
 * in this module is changed.
 */
export async function getScopedClaimByEvidenceIdentity(
  { organizationId, evidenceItemId, claimType },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT claim_id, organization_id, evidence_item_id, claim_type, claim_status,
            claim_review_status, claim_strength, statement, statement_fingerprint,
            internal_only, public_use_allowed, funder_use_allowed,
            llm_processing_allowed, product_learning_allowed, export_ready,
            created_by, created_by_type, created_at
       FROM kai.claims
      WHERE organization_id = $1
        AND evidence_item_id = $2
        AND claim_type = $3`,
    [organizationId, evidenceItemId, claimType],
  );
  return rows[0] || null;
}

/**
 * P2-03 narrow, tenant-scoped authoritative lookup of an existing
 * `kai.claim_evidence_links` row by its per-claim idempotency identity
 * (organization_id, claim_id), used to distinguish a fresh insert from an
 * authoritative replay after a losing conditional insert attempt. Additive: no
 * other exported query in this module is changed.
 */
export async function getScopedClaimEvidenceLinkByClaimId(
  { organizationId, claimId },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT claim_evidence_link_id, organization_id, claim_id, evidence_item_id,
            created_by_type, created_at
       FROM kai.claim_evidence_links
      WHERE organization_id = $1
        AND claim_id = $2`,
    [organizationId, claimId],
  );
  return rows[0] || null;
}

/**
 * P2-03 narrow, tenant-scoped authoritative lookup by the 'claim_review'
 * idempotency identity (organization_id + queue_type + target_object_type +
 * target_object_id), mirroring the identical P1-06/P2-01 lookup pattern exactly.
 * Additive: no other exported query in this module is changed.
 */
export async function getScopedClaimReviewQueueItemByClaimId(
  { organizationId, claimId },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT review_queue_item_id, organization_id, queue_type, target_object_type,
            target_object_id, priority, queue_status, review_status, assigned_to,
            due_at, summary, required_action, queue_metadata, created_at, updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1
        AND queue_type = 'claim_review'
        AND target_object_type = 'claim'
        AND target_object_id = $2`,
    [organizationId, claimId],
  );
  return rows[0] || null;
}

export async function getScopedSourceVersionByCandidateIdentity(
  { organizationId, intakeSourceCandidateId },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT source_version_id, organization_id, source_id, intake_source_candidate_id,
            intake_sensitivity_profile_id, profile_canonical_sha256, is_current, created_at
       FROM kai.source_versions
      WHERE organization_id = $1
        AND intake_source_candidate_id = $2
      FOR UPDATE`,
    [organizationId, intakeSourceCandidateId],
  );
  return rows[0] || null;
}
