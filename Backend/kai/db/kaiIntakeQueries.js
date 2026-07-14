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
