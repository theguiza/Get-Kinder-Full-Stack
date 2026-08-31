import pool from "./kaiDb.js";

/**
 * pg returns bigint columns (file_size_bytes) as strings to avoid silent
 * precision loss on values outside the JS safe-integer range. The upload
 * read model is the only caller that needs a JS number, so the narrow
 * conversion happens here rather than via a global pg bigint type parser:
 * out-of-range or malformed strings are left untouched and still fail the
 * caller's Number.isSafeInteger validation, unchanged from today.
 */
function withSafeIntegerFileSizeBytes(row) {
  if (!row || typeof row.file_size_bytes !== "string" || !/^-?\d+$/.test(row.file_size_bytes)) {
    return row;
  }
  const parsed = Number(row.file_size_bytes);
  if (!Number.isSafeInteger(parsed) || String(parsed) !== row.file_size_bytes) return row;
  return { ...row, file_size_bytes: parsed };
}

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
            parse_status, review_status, created_at, updated_at,
            r.parser_status,
            (
              r.parser_status = 'completed'
              AND r.output_profile_id IS NOT NULL
              AND EXISTS (
                SELECT 1
                  FROM kai.intake_file_profiles p
                 WHERE p.organization_id = kai.intake_files.organization_id
                   AND p.intake_file_id = kai.intake_files.intake_file_id
                   AND p.file_profile_id = r.output_profile_id
              )
            ) AS file_profile_complete,
            (
              r.parser_status = 'completed'
              AND EXISTS (
                SELECT 1
                  FROM kai.data_dictionaries d
                 WHERE d.organization_id = kai.intake_files.organization_id
                   AND d.intake_file_id = kai.intake_files.intake_file_id
                   AND d.file_profile_id = r.output_profile_id
              )
            ) AS data_dictionary_complete,
            (
              r.parser_status = 'completed'
              AND EXISTS (
                SELECT 1
                  FROM kai.intake_sensitivity_profiles sp
                 WHERE sp.organization_id = kai.intake_files.organization_id
                   AND sp.intake_file_id = kai.intake_files.intake_file_id
                   AND sp.file_profile_id = r.output_profile_id
              )
            ) AS sensitivity_profile_complete
       FROM kai.intake_files
       LEFT JOIN LATERAL (
         SELECT pr.parser_status, pr.output_profile_id
           FROM kai.intake_parser_runs pr
          WHERE pr.organization_id = kai.intake_files.organization_id
            AND pr.intake_file_id = kai.intake_files.intake_file_id
            AND pr.checksum = kai.intake_files.verified_checksum
          ORDER BY pr.created_at DESC, pr.parser_run_id DESC
          LIMIT 1
       ) r ON true
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
            mime_type, file_size_bytes, file_policy_status, malware_scan_status, processing_status,
            parse_status, review_status, created_at, updated_at
       FROM kai.intake_files
      WHERE organization_id = $1
        AND intake_file_id = $2
      LIMIT 1`,
    [organizationId, intakeFileId],
  );
  return rows[0] || null;
}

/**
 * Upload-authorization callers (requestUploadUrl, confirmUpload,
 * uploadReservedIntakeFile) need the server-owned storage reservation facts
 * that getIntakeFileMetadata deliberately withholds from general-purpose
 * callers like the file-detail route, so they get their own query instead of
 * a broadened shared one.
 */
export async function getIntakeFileUploadMetadata(organizationId, intakeFileId, db = pool) {
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
  return withSafeIntegerFileSizeBytes(rows[0] || null);
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

const SECURITY_ASSESSMENT_AUDIT_ACTIONS = Object.freeze([
  "apply_security_assessment_policy_decision",
  "record_security_assessment_diagnostic",
]);

/**
 * Narrow, organization/file-scoped read of the single most recent
 * security-assessment audit event for one intake file, used only to build
 * the safe `security_assessment` projection on the file-detail response.
 * Explicit columns only (action, reason_code, and the one bounded
 * assessment_category metadata field) - never the raw metadata jsonb, actor
 * fields, or any other audit_events column.
 */
export async function getScopedLatestSecurityAssessmentAuditProjection(organizationId, intakeFileId, db = pool) {
  const { rows } = await db.query(
    `SELECT action, reason_code, metadata->>'assessment_category' AS assessment_category
       FROM kai.audit_events
      WHERE organization_id = $1
        AND metadata->>'object_id' = $2
        AND action = ANY($3::text[])
      ORDER BY created_at DESC
      LIMIT 1`,
    [organizationId, intakeFileId, SECURITY_ASSESSMENT_AUDIT_ACTIONS],
  );
  return rows[0] || null;
}

/**
 * Read-only, tenant/file-scoped projection of the automatic P1 lifecycle.
 *
 * The parser run is bound to the intake file's CURRENT verified checksum,
 * so a historical run for an older object version cannot make the current
 * file appear complete.
 *
 * No raw profile, dictionary, sensitivity, storage, or object-version data
 * is returned.
 */
export async function getScopedIntakeFileP1Lifecycle(
  organizationId,
  intakeFileId,
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT
       f.organization_id,
       f.intake_file_id,
       r.parser_status,
       (
         r.parser_status = 'completed'
         AND p.file_profile_id IS NOT NULL
       ) AS file_profile_complete,
       (
         r.parser_status = 'completed'
         AND p.file_profile_id IS NOT NULL
         AND EXISTS (
           SELECT 1
             FROM kai.data_dictionaries d
            WHERE d.organization_id = f.organization_id
              AND d.intake_file_id = f.intake_file_id
              AND d.file_profile_id = p.file_profile_id
         )
       ) AS data_dictionary_complete,
       (
         r.parser_status = 'completed'
         AND p.file_profile_id IS NOT NULL
         AND EXISTS (
           SELECT 1
             FROM kai.intake_sensitivity_profiles s
            WHERE s.organization_id = f.organization_id
              AND s.intake_file_id = f.intake_file_id
              AND s.file_profile_id = p.file_profile_id
         )
       ) AS sensitivity_profile_complete,
       -- KAI B1A-3B-R2: the server-grounded P1-05 sensitivity profile identity for
       -- this exact file lineage. kai.intake_sensitivity_profiles carries
       -- UNIQUE (organization_id, file_profile_id, data_dictionary_id), and
       -- kai.data_dictionaries carries UNIQUE (organization_id, file_profile_id)
       -- (data_dictionaries_p1_04_bundle_identity_unique) - so for the single
       -- current file_profile_id resolved above (bound to the file's current
       -- verified_checksum, same as every other completeness flag in this
       -- projection) there is at most one intake_sensitivity_profile row. This
       -- is a deterministic lookup, never an unordered/newest-row guess.
       s.intake_sensitivity_profile_id AS intake_sensitivity_profile_id
       FROM kai.intake_files f
       LEFT JOIN LATERAL (
         SELECT
           pr.parser_status,
           pr.output_profile_id,
           pr.created_at,
           pr.parser_run_id
           FROM kai.intake_parser_runs pr
          WHERE pr.organization_id = f.organization_id
            AND pr.intake_file_id = f.intake_file_id
            AND pr.checksum = f.verified_checksum
          ORDER BY pr.created_at DESC, pr.parser_run_id DESC
          LIMIT 1
       ) r ON true
       LEFT JOIN kai.intake_file_profiles p
         ON p.organization_id = f.organization_id
        AND p.intake_file_id = f.intake_file_id
        AND p.file_profile_id = r.output_profile_id
       LEFT JOIN kai.intake_sensitivity_profiles s
         ON s.organization_id = f.organization_id
        AND s.intake_file_id = f.intake_file_id
        AND s.file_profile_id = p.file_profile_id
      WHERE f.organization_id = $1
        AND f.intake_file_id = $2
      LIMIT 1`,
    [organizationId, intakeFileId],
  );

  return rows[0] || null;
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
