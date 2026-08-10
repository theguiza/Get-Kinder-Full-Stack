import pool from "./kaiDb.js";

export async function listIntakeBatchesForOrganization(organizationId, db = pool) {
  const { rows } = await db.query(
    `SELECT intake_batch_id, organization_id, engagement_id, batch_code, processing_status,
            review_status, created_at, updated_at
       FROM kai.intake_batches
      WHERE organization_id = $1
      ORDER BY created_at DESC
      LIMIT 100`,
    [organizationId],
  );
  return rows;
}

export async function getIntakeBatchDetail(organizationId, intakeBatchId, db = pool) {
  const { rows } = await db.query(
    `SELECT intake_batch_id, organization_id, engagement_id, batch_code, processing_status,
            review_status, idempotency_key, source_system_name, source_system_ref, created_at, updated_at
       FROM kai.intake_batches
      WHERE organization_id = $1
        AND intake_batch_id = $2
      LIMIT 1`,
    [organizationId, intakeBatchId],
  );
  return rows[0] || null;
}

export async function listIntakeFilesForBatch(
  organizationId,
  intakeBatchId,
  { limit, cursor = null },
  db = pool,
) {
  const cursorPredicate = cursor
    ? `\n        AND (\n          created_at < $3\n          OR (created_at = $3 AND intake_file_id < $4)\n        )`
    : "";
  const params = cursor
    ? [organizationId, intakeBatchId, cursor.created_at, cursor.intake_file_id, limit + 1]
    : [organizationId, intakeBatchId, limit + 1];
  const limitParameter = cursor ? "$5" : "$3";
  const { rows } = await db.query(
    `SELECT intake_file_id, intake_batch_id, organization_id, engagement_id, safe_filename,
            mime_type, file_size_bytes, file_policy_status, malware_scan_status, processing_status,
            parse_status, review_status, created_at, updated_at
       FROM kai.intake_files
      WHERE organization_id = $1
        AND intake_batch_id = $2${cursorPredicate}
      ORDER BY created_at DESC, intake_file_id DESC
      LIMIT ${limitParameter}`,
    params,
  );
  return rows;
}

export async function getIntakeFileMetadata(organizationId, intakeFileId, db = pool) {
  const { rows } = await db.query(
    `SELECT intake_file_id, intake_batch_id, organization_id, engagement_id, safe_filename,
            storage_provider, storage_bucket, storage_object_key, mime_type, file_size_bytes,
            checksum, hash_algorithm, file_policy_status, malware_scan_status, processing_status,
            parse_status, review_status, created_at, updated_at
       FROM kai.intake_files
      WHERE organization_id = $1
        AND intake_file_id = $2
      LIMIT 1`,
    [organizationId, intakeFileId],
  );
  return rows[0] || null;
}

export async function listIntakeFileReviewQueueItems(
  organizationId,
  { limit, cursor = null },
  db = pool,
) {
  const cursorPredicate = cursor
    ? `\n        AND (\n          created_at < $2\n          OR (created_at = $2 AND review_queue_item_id < $3)\n        )`
    : "";
  const params = cursor
    ? [organizationId, cursor.created_at, cursor.review_queue_item_id, limit + 1]
    : [organizationId, limit + 1];
  const limitParameter = cursor ? "$4" : "$2";
  const { rows } = await db.query(
    `SELECT review_queue_item_id, organization_id, queue_type, target_object_type,
            target_object_id, priority, queue_status, due_at, summary, required_action,
            created_at, updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1
        AND queue_type = 'intake_file_review'
        AND target_object_type = 'intake_file'
        AND queue_status IN ('open', 'in_progress', 'blocked', 'waiting_on_client', 'waiting_on_gk')
        ${cursorPredicate}
      ORDER BY created_at DESC, review_queue_item_id DESC
      LIMIT ${limitParameter}`,
    params,
  );
  return rows;
}

export async function getDataDictionaryDraftSummary(organizationId, dataDictionaryId, db = pool) {
  const { rows } = await db.query(
    `SELECT data_dictionary_id, organization_id, engagement_id, intake_batch_id,
            intake_file_id, dictionary_name, review_status, created_at, updated_at
       FROM kai.data_dictionaries
      WHERE organization_id = $1
        AND data_dictionary_id = $2
      LIMIT 1`,
    [organizationId, dataDictionaryId],
  );
  return rows[0] || null;
}
