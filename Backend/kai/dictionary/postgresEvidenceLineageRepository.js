import { createHash } from "node:crypto";
import { withTransaction } from "../db/kaiDb.js";
import {
  getScopedSourceVersionById,
  getScopedSourceById,
  getScopedSourceCandidateByIdentity,
  getScopedPromotionDecisionBySourceVersionId,
  getScopedSensitivityProfileById,
  getScopedDataDictionaryById,
  getScopedDataDictionaryFieldsByDictionaryId,
  getScopedEvidenceItemByStatementFingerprint,
  getScopedSourceLocatorByFingerprint,
  getScopedEvidenceReviewQueueItemByEvidenceItemId,
} from "../db/kaiIntakeQueries.js";
import { validateEvidenceHasSourceLineage } from "../validators/kaiEvidenceLineageValidators.js";

/**
 * KAI P2-01 deterministic evidence-lineage repository adapter: server-derived-only
 * extraction of deterministic evidence statements from the CURRENT
 * `kai.source_versions` row of a fully promoted P1-08 source, atomically compounded
 * with the `kai.source_locators` 'column' coordinate each per-field fact is bound
 * to, and the `kai.review_queue_items` 'evidence_review' item each fresh evidence
 * item requires.
 *
 * This module is the only authorized location for P2-01's own SQL and row
 * locking, other than the reused `getScoped*` lookups added to
 * Backend/kai/db/kaiIntakeQueries.js. Every fact this package writes is derived
 * only from rows already committed by P1-04/P1-05/P1-07/P1-08 - never from raw
 * file content, a sample value, a filename, or caller-supplied input beyond the
 * organizationId/sourceVersionId identity itself.
 *
 * Applies the exact P1-07 correction lesson (see
 * Backend/kai/dictionary/postgresSourceCandidateRepository.js and its ExecPlan
 * history: "removed the silent partial-replay repair path"): the review-queue-item
 * insert is gated strictly on whether THIS call's own evidence-item insert
 * returned a row (a fresh write), never on "a queue item happens to be missing".
 * An already-existing evidence item with a missing matching queue item is a
 * conflict (ConcurrentStateChangedError), never a silent repair-insert.
 */

const EVIDENCE_LINEAGE_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

const EVIDENCE_LINEAGE_AUDIT_CONTRACT = "p2_evidence_lineage_extraction_v1";

/**
 * VAL-KAI-P2-01-001 (source-lineage/promotion completeness, cross-row lineage
 * equality, checksum completeness, and reapplied permission predicate) is this
 * package's disclosed convention-consistent validator key, following the exact
 * P1-08 VAL-KAI-P1-08-00N naming idiom. It is not quoted from, and is not claimed
 * to be mandated by, any owner-authorized governing source.
 */
const EVIDENCE_LINEAGE_VALIDATOR_KEY = "VAL-KAI-P2-01-001";
const EVIDENCE_LINEAGE_AUDIT_OPERATION = "evidence_lineage_extracted";

const EVIDENCE_TYPE_FIELD_COUNT_FACT = "dictionary_field_count_fact";
const EVIDENCE_TYPE_FIELD_PRESENCE_FACT = "dictionary_field_presence_fact";
const EVIDENCE_DATA_CLASS = "organization_committed_metadata";
const LOCATOR_TYPE_COLUMN = "column";

const REVIEW_QUEUE_TYPE = "evidence_review";
const REVIEW_TARGET_OBJECT_TYPE = "evidence_item";
const REVIEW_QUEUE_STATUS_OPEN = "open";
const REVIEW_STATUS_NEEDS_GK_REVIEW = "needs_gk_review";
/**
 * P2-01 owner decision: a fixed literal summary for every evidence-review queue
 * item this package creates. Never templated from caller input or derived
 * content - the caller does not, and cannot, supply this text.
 */
const REVIEW_SUMMARY_NEW_EVIDENCE_ITEM = "New evidence item requires GK review.";

function evidenceLineageFailure(code) {
  return {
    ok: false,
    data: null,
    error: {
      code,
      status: EVIDENCE_LINEAGE_RESULT_STATUS[code],
    },
  };
}

function evidenceLineageSuccess(data) {
  return { ok: true, data, error: null };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNormalizedNow(value) {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString() === value;
}

function isMetadataOnlyAuditDependency(value) {
  return Boolean(value) && typeof value.prepareMetadataOnlyAudit === "function";
}

function validateExtractInput(input) {
  const allowedKeys = new Set(["organizationId", "sourceVersionId", "actorUserId", "now", "metadataOnlyAudit"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    isNonEmptyString(input.organizationId) &&
    isNonEmptyString(input.sourceVersionId) &&
    isNonEmptyString(input.actorUserId) &&
    isNormalizedNow(input.now) &&
    isMetadataOnlyAuditDependency(input.metadataOnlyAudit)
  );
}

function asIso(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

/**
 * Deterministic locator-fingerprint generation: a sha256 hex digest computed only
 * from the identity/coordinate tuple this package is authorized to depend on -
 * organizationId, sourceVersionId, locatorType, and the exact committed
 * column_name. Never a filename, sample value, AI output, or external lookup.
 */
function computeLocatorFingerprint({ organizationId, sourceVersionId, locatorType, columnName }) {
  return createHash("sha256")
    .update(`${organizationId}|${sourceVersionId}|${locatorType}|${columnName}`)
    .digest("hex");
}

/**
 * Deterministic statement-fingerprint generation: a sha256 hex digest computed
 * only from the identity/statement tuple this package is authorized to depend on -
 * organizationId, sourceVersionId, evidenceType, and the exact deterministically
 * composed statement text. Never a filename, sample value, AI output, or external
 * lookup.
 */
function computeStatementFingerprint({ organizationId, sourceVersionId, evidenceType, statement }) {
  return createHash("sha256")
    .update(`${organizationId}|${sourceVersionId}|${evidenceType}|${statement}`)
    .digest("hex");
}

/**
 * Deterministic evidence-composition plan: one aggregate item (no locator), then
 * one per-field item per already-committed `kai.data_dictionary_fields` row, in
 * the deterministic `profile_field_key ASC` order the read query already applies.
 * Every statement and coordinate is server-derived only from `fieldRows` - never
 * from caller input, raw file content, or a sample value.
 */
function buildEvidenceCompositionPlan({ organizationId, sourceVersionId, fieldRows }) {
  const aggregateStatement = `Source version's committed data dictionary contains ${fieldRows.length} field(s).`;
  const items = [
    {
      evidenceType: EVIDENCE_TYPE_FIELD_COUNT_FACT,
      statement: aggregateStatement,
      statementFingerprint: computeStatementFingerprint({
        organizationId,
        sourceVersionId,
        evidenceType: EVIDENCE_TYPE_FIELD_COUNT_FACT,
        statement: aggregateStatement,
      }),
      needsLocator: false,
    },
  ];

  for (const field of fieldRows) {
    const statement = `Source version's committed data dictionary includes field "${field.profile_field_key}" of committed type "${field.data_type}".`;
    const coordinates = { column_name: field.profile_field_key };
    const locatorFingerprint = computeLocatorFingerprint({
      organizationId,
      sourceVersionId,
      locatorType: LOCATOR_TYPE_COLUMN,
      columnName: field.profile_field_key,
    });
    items.push({
      evidenceType: EVIDENCE_TYPE_FIELD_PRESENCE_FACT,
      statement,
      statementFingerprint: computeStatementFingerprint({
        organizationId,
        sourceVersionId,
        evidenceType: EVIDENCE_TYPE_FIELD_PRESENCE_FACT,
        statement,
      }),
      needsLocator: true,
      locatorType: LOCATOR_TYPE_COLUMN,
      coordinates,
      locatorFingerprint,
    });
  }

  return items;
}

async function insertSourceLocatorIfAbsent(tx, { organizationId, sourceVersionId, locatorType, coordinates, locatorFingerprint, createdByType }) {
  const result = await tx.query(
    `INSERT INTO kai.source_locators (
       organization_id, source_version_id, locator_type, coordinates, locator_fingerprint, created_by_type
     ) VALUES ($1,$2,$3,$4::jsonb,$5,$6)
     ON CONFLICT (organization_id, source_version_id, locator_fingerprint)
       DO NOTHING
     RETURNING source_locator_id, organization_id, source_version_id, locator_type,
               coordinates, locator_fingerprint, created_by_type, created_at`,
    [organizationId, sourceVersionId, locatorType, JSON.stringify(coordinates), locatorFingerprint, createdByType || "system"],
  );
  return result.rows[0] ?? null;
}

async function insertEvidenceItemIfAbsent(tx, { organizationId, sourceVersionId, sourceLocatorId, evidenceType, statement, statementFingerprint, createdBy, createdByType }) {
  const result = await tx.query(
    `INSERT INTO kai.evidence_items (
       organization_id, source_version_id, source_locator_id, evidence_type, data_class,
       statement, statement_fingerprint, created_by, created_by_type
     ) VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (organization_id, source_version_id, statement_fingerprint)
       DO NOTHING
     RETURNING evidence_item_id, organization_id, source_version_id, source_locator_id,
               evidence_type, data_class, statement, statement_fingerprint,
               evidence_review_status, internal_only, public_use_allowed, funder_use_allowed,
               llm_processing_allowed, product_learning_allowed, created_by, created_by_type, created_at`,
    [
      organizationId,
      sourceVersionId,
      sourceLocatorId || null,
      evidenceType,
      EVIDENCE_DATA_CLASS,
      statement,
      statementFingerprint,
      createdBy || null,
      createdByType || "human",
    ],
  );
  return result.rows[0] ?? null;
}

async function insertEvidenceReviewQueueItemIfAbsent(tx, { organizationId, evidenceItemId, createdByType }) {
  const result = await tx.query(
    `INSERT INTO kai.review_queue_items (
       organization_id, queue_type, target_object_type, target_object_id,
       priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
     ) VALUES ($1,$2,$3,$4::uuid,'normal',$5,$6,$7,NULL,'{}'::jsonb,$8)
     ON CONFLICT (organization_id, queue_type, target_object_type, target_object_id)
       WHERE queue_type = 'evidence_review'
       DO NOTHING
     RETURNING review_queue_item_id, organization_id, queue_type, target_object_type,
               target_object_id, queue_status, review_status, summary, required_action,
               queue_metadata, created_at, updated_at`,
    [
      organizationId,
      REVIEW_QUEUE_TYPE,
      REVIEW_TARGET_OBJECT_TYPE,
      evidenceItemId,
      REVIEW_QUEUE_STATUS_OPEN,
      REVIEW_STATUS_NEEDS_GK_REVIEW,
      REVIEW_SUMMARY_NEW_EVIDENCE_ITEM,
      createdByType || "system",
    ],
  );
  return result.rows[0] ?? null;
}

/**
 * Authoritative post-write count of every evidence item and matching
 * evidence_review queue item now bound to this source_version, plus the total
 * locator count. Never trusts this call's own in-memory bookkeeping alone -
 * re-reads from the database so a genuine drift (e.g. a queue item resolved or
 * removed by something else between this call's own inserts) is caught.
 */
async function countAuthoritativeEvidenceLineageTotals(tx, { organizationId, sourceVersionId }) {
  const evidenceResult = await tx.query(
    `SELECT count(*)::int AS count
       FROM kai.evidence_items
      WHERE organization_id = $1::uuid
        AND source_version_id = $2::uuid`,
    [organizationId, sourceVersionId],
  );
  const locatorResult = await tx.query(
    `SELECT count(*)::int AS count
       FROM kai.source_locators
      WHERE organization_id = $1::uuid
        AND source_version_id = $2::uuid`,
    [organizationId, sourceVersionId],
  );
  const queueResult = await tx.query(
    `SELECT count(*)::int AS count
       FROM kai.review_queue_items q
      WHERE q.organization_id = $1::uuid
        AND q.queue_type = $3
        AND q.target_object_type = $4
        AND q.target_object_id IN (
          SELECT evidence_item_id FROM kai.evidence_items
           WHERE organization_id = $1::uuid AND source_version_id = $2::uuid
        )`,
    [organizationId, sourceVersionId, REVIEW_QUEUE_TYPE, REVIEW_TARGET_OBJECT_TYPE],
  );
  return {
    evidenceItemCount: evidenceResult.rows[0].count,
    sourceLocatorCount: locatorResult.rows[0].count,
    queueItemCount: queueResult.rows[0].count,
  };
}

/**
 * Tenant-scoped read of the P0/Gate-A upload_state this package's own required
 * audit row must carry, matching the identical read every prior package performs
 * against the same table.
 */
async function readScopedUploadState(tx, organizationId, intakeFileId) {
  const result = await tx.query(
    `SELECT upload_state
       FROM kai.intake_files
      WHERE organization_id = $1::uuid
        AND intake_file_id = $2::uuid`,
    [organizationId, intakeFileId],
  );
  return result.rows[0]?.upload_state ?? null;
}

async function insertAudit(tx, { organizationId, intakeFileId, uploadState, metadata, now }) {
  await tx.query(
    `INSERT INTO kai.upload_lifecycle_audit (
       organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
     )
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'success', $6::jsonb, $7::timestamptz)`,
    [organizationId, intakeFileId, EVIDENCE_LINEAGE_AUDIT_OPERATION, uploadState, uploadState, JSON.stringify(metadata), now],
  );
}

function rowToSourceVersionRecord(row) {
  return {
    source_version_id: row.source_version_id,
    organization_id: row.organization_id,
    source_id: row.source_id,
    intake_source_candidate_id: row.intake_source_candidate_id,
    intake_sensitivity_profile_id: row.intake_sensitivity_profile_id,
    profile_canonical_sha256: row.profile_canonical_sha256,
    is_current: row.is_current,
    created_at: asIso(row.created_at),
  };
}

function rowToSourceRecord(row) {
  return {
    source_id: row.source_id,
    organization_id: row.organization_id,
    source_code: row.source_code,
    reviewed_source_type: row.reviewed_source_type,
    created_at: asIso(row.created_at),
  };
}

function rowToLocatorRecord(row) {
  return {
    source_locator_id: row.source_locator_id,
    organization_id: row.organization_id,
    source_version_id: row.source_version_id,
    locator_type: row.locator_type,
    coordinates: row.coordinates,
    locator_fingerprint: row.locator_fingerprint,
    created_by_type: row.created_by_type,
    created_at: asIso(row.created_at),
  };
}

function rowToEvidenceRecord(row) {
  return {
    evidence_item_id: row.evidence_item_id,
    organization_id: row.organization_id,
    source_version_id: row.source_version_id,
    source_locator_id: row.source_locator_id,
    evidence_type: row.evidence_type,
    data_class: row.data_class,
    statement: row.statement,
    statement_fingerprint: row.statement_fingerprint,
    evidence_review_status: row.evidence_review_status,
    internal_only: row.internal_only,
    public_use_allowed: row.public_use_allowed,
    funder_use_allowed: row.funder_use_allowed,
    llm_processing_allowed: row.llm_processing_allowed,
    product_learning_allowed: row.product_learning_allowed,
    created_by: row.created_by,
    created_by_type: row.created_by_type,
    created_at: asIso(row.created_at),
  };
}

function rowToReviewQueueRecord(row) {
  return {
    review_queue_item_id: row.review_queue_item_id,
    organization_id: row.organization_id,
    queue_type: row.queue_type,
    target_object_type: row.target_object_type,
    target_object_id: row.target_object_id,
    queue_status: row.queue_status,
    review_status: row.review_status ?? null,
  };
}

class MalformedInsertedRowError extends Error {
  constructor(what) {
    super(`inserted ${what} row failed validation`);
    this.name = "MalformedInsertedRowError";
  }
}

class ConcurrentStateChangedError extends Error {
  constructor(what) {
    super(`${what} changed concurrently during evidence-lineage extraction`);
    this.name = "ConcurrentStateChangedError";
  }
}

/**
 * Rejection of the required metadata-only audit must roll back every mutation
 * performed in this operation, so it is raised as an error rather than returned.
 */
class RequiredAuditRejectedError extends Error {
  constructor() {
    super("required metadata-only audit was rejected");
    this.name = "RequiredAuditRejectedError";
  }
}

function buildEvidenceLineageAuditMetadata({ sourceVersionId, intakeSensitivityProfileId, profileCanonicalSha256, evidenceItemCount, sourceLocatorCount, reviewQueueItemCount, freshWriteCount }) {
  return {
    metadata_only: true,
    contract: EVIDENCE_LINEAGE_AUDIT_CONTRACT,
    source_version_id: sourceVersionId,
    intake_sensitivity_profile_id: intakeSensitivityProfileId,
    profile_canonical_sha256: profileCanonicalSha256,
    evidence_item_count: evidenceItemCount,
    source_locator_count: sourceLocatorCount,
    review_queue_item_count: reviewQueueItemCount,
    fresh_write_count: freshWriteCount,
    validator_key: EVIDENCE_LINEAGE_VALIDATOR_KEY,
  };
}

function buildEvidenceLineageAuditPayload(context) {
  return {
    attempted_operation: EVIDENCE_LINEAGE_AUDIT_OPERATION,
    actor_type: "human",
    contract: EVIDENCE_LINEAGE_AUDIT_CONTRACT,
    object_type: "evidence_item",
    request_scope: "organization_source_version",
    route_contract: "unwired_synthetic_evidence_lineage_extraction",
    sprint_phase: "kai_sprint2_p2_01",
    validator_key: EVIDENCE_LINEAGE_VALIDATOR_KEY,
    evidence_item_count: context.evidenceItemCount,
    source_locator_count: context.sourceLocatorCount,
    review_queue_item_count: context.reviewQueueItemCount,
    fresh_write_count: context.freshWriteCount,
  };
}

/**
 * Preserves the exact own-boolean-data-property audit predicate established by
 * P1-05 through P1-08's `prepareRequiredAudit`: an own-property descriptor read
 * (never a getter) whose `value` is exactly `true`, alongside a callable `publish`.
 */
function prepareRequiredAudit(metadataOnlyAudit, context) {
  const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: buildEvidenceLineageAuditPayload(context),
  });

  const okDescriptor =
    prepared !== null && typeof prepared === "object" && !Array.isArray(prepared)
      ? Object.getOwnPropertyDescriptor(prepared, "ok")
      : undefined;

  const auditConfirmed =
    okDescriptor !== undefined &&
    Object.hasOwn(okDescriptor, "value") &&
    okDescriptor.value === true &&
    typeof prepared.publish === "function";

  if (!auditConfirmed) {
    throw new RequiredAuditRejectedError();
  }

  return prepared;
}

function shapeEvidenceLineageError(error) {
  if (error instanceof MalformedInsertedRowError) return evidenceLineageFailure("system_error");
  if (error instanceof ConcurrentStateChangedError) return evidenceLineageFailure("conflict_current_state_changed");
  if (error instanceof RequiredAuditRejectedError) return evidenceLineageFailure("validation_blocker");
  if (error?.code === "23503") return evidenceLineageFailure("not_found");
  if (error?.code === "23514" || error?.code === "P0001" || error?.code === "22P02") {
    return evidenceLineageFailure("validation_blocker");
  }
  return evidenceLineageFailure("system_error");
}

export function createPostgresEvidenceLineageRepository({
  runInTransaction = withTransaction,
  beforeInsert = async () => {},
} = {}) {
  return Object.freeze({
    /**
     * Organization-scoped, human-authorized, idempotent extraction of
     * deterministic evidence statements from the CURRENT source_version of a
     * fully promoted P1-08 source. See the module doc comment for scope and the
     * P1-07 partial-replay-repair correction this package deliberately avoids.
     *
     * Genuinely concurrent identical extraction converges entirely via
     * PostgreSQL's unique constraints: every locator/evidence/review-queue-item
     * write uses `INSERT ... ON CONFLICT ... DO NOTHING RETURNING` followed by
     * an authoritative reread on a lost race - never a raised 23505 catch or any
     * application-level synchronization primitive.
     */
    async extractEvidenceFromSourceVersion(input) {
      if (!validateExtractInput(input)) return evidenceLineageFailure("validation_blocker");
      const { organizationId, sourceVersionId, actorUserId, now, metadataOnlyAudit } = input;
      try {
        return await runInTransaction(async (tx) => {
          // Test-only rendezvous seam, called once, before any row is read or
          // locked - in particular, before the FOR UPDATE lock
          // getScopedSourceCandidateByIdentity takes below, which is the real
          // serialization point for two genuinely concurrent calls on the same
          // identity (mirrors the exact P1-08 precedent: beforeInsert must run
          // before that lock is acquired, or a losing transaction would block on
          // the lock before ever reaching this seam, and a concurrency test could
          // never observe both calls having arrived).
          await beforeInsert();

          const sourceVersionRow = await getScopedSourceVersionById({ organizationId, sourceVersionId }, tx);
          if (!sourceVersionRow) return evidenceLineageFailure("not_found");

          const sourceRow = await getScopedSourceById({ organizationId, sourceId: sourceVersionRow.source_id }, tx);
          if (!sourceRow) return evidenceLineageFailure("not_found");

          const candidateRow = await getScopedSourceCandidateByIdentity(
            { organizationId, intakeSourceCandidateId: sourceVersionRow.intake_source_candidate_id },
            tx,
          );
          if (!candidateRow) return evidenceLineageFailure("not_found");

          const decisionRow = await getScopedPromotionDecisionBySourceVersionId({ organizationId, sourceVersionId }, tx);
          if (!decisionRow) return evidenceLineageFailure("not_found");

          const profileRow = await getScopedSensitivityProfileById(
            { organizationId, intakeSensitivityProfileId: candidateRow.intake_sensitivity_profile_id },
            tx,
          );
          if (!profileRow) return evidenceLineageFailure("not_found");

          const dictionaryRow = await getScopedDataDictionaryById(
            { organizationId, dataDictionaryId: candidateRow.data_dictionary_id },
            tx,
          );
          if (!dictionaryRow) return evidenceLineageFailure("not_found");

          const validation = validateEvidenceHasSourceLineage({
            sourceVersionRow,
            sourceRow,
            candidateRow,
            decisionRow,
            profileRow,
            dictionaryRow,
          });
          if (!validation.ok) return evidenceLineageFailure(validation.code);

          const fieldRows = await getScopedDataDictionaryFieldsByDictionaryId(
            { organizationId, dataDictionaryId: dictionaryRow.data_dictionary_id },
            tx,
          );

          const plan = buildEvidenceCompositionPlan({ organizationId, sourceVersionId, fieldRows });

          let freshWriteCount = 0;
          const evidenceRecords = [];
          const locatorRecords = [];
          const queueRecords = [];

          for (const item of plan) {
            let sourceLocatorId = null;
            if (item.needsLocator) {
              const insertedLocatorRow = await insertSourceLocatorIfAbsent(tx, {
                organizationId,
                sourceVersionId,
                locatorType: item.locatorType,
                coordinates: item.coordinates,
                locatorFingerprint: item.locatorFingerprint,
                createdByType: "system",
              });
              let locatorRecord;
              if (insertedLocatorRow) {
                locatorRecord = rowToLocatorRecord(insertedLocatorRow);
              } else {
                const existingLocatorRow = await getScopedSourceLocatorByFingerprint(
                  { organizationId, sourceVersionId, locatorFingerprint: item.locatorFingerprint },
                  tx,
                );
                if (!existingLocatorRow) throw new MalformedInsertedRowError("source_locators");
                locatorRecord = rowToLocatorRecord(existingLocatorRow);
              }
              sourceLocatorId = locatorRecord.source_locator_id;
              locatorRecords.push(locatorRecord);
            }

            const insertedEvidenceRow = await insertEvidenceItemIfAbsent(tx, {
              organizationId,
              sourceVersionId,
              sourceLocatorId,
              evidenceType: item.evidenceType,
              statement: item.statement,
              statementFingerprint: item.statementFingerprint,
              createdBy: actorUserId,
              createdByType: "human",
            });

            let evidenceRecord;
            let isFreshlyCreated;
            if (insertedEvidenceRow) {
              evidenceRecord = rowToEvidenceRecord(insertedEvidenceRow);
              isFreshlyCreated = true;
              freshWriteCount += 1;
            } else {
              const existingEvidenceRow = await getScopedEvidenceItemByStatementFingerprint(
                { organizationId, sourceVersionId, statementFingerprint: item.statementFingerprint },
                tx,
              );
              if (!existingEvidenceRow) throw new MalformedInsertedRowError("evidence_items");
              evidenceRecord = rowToEvidenceRecord(existingEvidenceRow);
              isFreshlyCreated = false;
            }
            evidenceRecords.push(evidenceRecord);

            // P1-07 correction lesson reapplied: the review-queue-item write is
            // gated strictly on THIS call's own isFreshlyCreated result for THIS
            // evidence item, never on "a queue item happens to be missing".
            if (isFreshlyCreated) {
              const insertedQueueRow = await insertEvidenceReviewQueueItemIfAbsent(tx, {
                organizationId,
                evidenceItemId: evidenceRecord.evidence_item_id,
                createdByType: "system",
              });
              if (!insertedQueueRow) {
                // A genuine race on the SAME evidence item is only reachable if
                // isFreshlyCreated was itself won on a race - an extremely narrow
                // window. Never silently reread-and-continue: report conflict.
                throw new ConcurrentStateChangedError("review_queue_item");
              }
              queueRecords.push(rowToReviewQueueRecord(insertedQueueRow));
            } else {
              const existingQueueRow = await getScopedEvidenceReviewQueueItemByEvidenceItemId(
                { organizationId, evidenceItemId: evidenceRecord.evidence_item_id },
                tx,
              );
              if (!existingQueueRow) throw new ConcurrentStateChangedError("review_queue_item");
              queueRecords.push(rowToReviewQueueRecord(existingQueueRow));
            }
          }

          const totals = await countAuthoritativeEvidenceLineageTotals(tx, { organizationId, sourceVersionId });
          if (totals.evidenceItemCount !== totals.queueItemCount) {
            throw new MalformedInsertedRowError("evidence_review_consistency");
          }

          if (freshWriteCount === 0) {
            // Full identical replay: zero writes, zero audit.
            return evidenceLineageSuccess({
              sourceVersion: rowToSourceVersionRecord(sourceVersionRow),
              source: rowToSourceRecord(sourceRow),
              evidenceItems: evidenceRecords,
              sourceLocators: locatorRecords,
              reviewQueueItems: queueRecords,
              replayed: true,
            });
          }

          const uploadState = await readScopedUploadState(tx, organizationId, candidateRow.intake_file_id);
          if (!uploadState) return evidenceLineageFailure("not_found");

          const auditContext = {
            evidenceItemCount: totals.evidenceItemCount,
            sourceLocatorCount: totals.sourceLocatorCount,
            reviewQueueItemCount: totals.queueItemCount,
            freshWriteCount,
          };
          const preparedAudit = prepareRequiredAudit(metadataOnlyAudit, auditContext);
          await insertAudit(tx, {
            organizationId,
            intakeFileId: candidateRow.intake_file_id,
            uploadState,
            metadata: buildEvidenceLineageAuditMetadata({
              sourceVersionId,
              intakeSensitivityProfileId: candidateRow.intake_sensitivity_profile_id,
              profileCanonicalSha256: candidateRow.profile_canonical_sha256,
              ...auditContext,
            }),
            now,
          });
          await preparedAudit.publish();

          return evidenceLineageSuccess({
            sourceVersion: rowToSourceVersionRecord(sourceVersionRow),
            source: rowToSourceRecord(sourceRow),
            evidenceItems: evidenceRecords,
            sourceLocators: locatorRecords,
            reviewQueueItems: queueRecords,
            replayed: false,
          });
        });
      } catch (error) {
        return shapeEvidenceLineageError(error);
      }
    },
  });
}

export const __evidenceLineageRepositoryContract = Object.freeze({
  EVIDENCE_TYPE_FIELD_COUNT_FACT,
  EVIDENCE_TYPE_FIELD_PRESENCE_FACT,
  EVIDENCE_DATA_CLASS,
  LOCATOR_TYPE_COLUMN,
  REVIEW_QUEUE_TYPE,
  REVIEW_TARGET_OBJECT_TYPE,
  REVIEW_QUEUE_STATUS_OPEN,
  REVIEW_STATUS_NEEDS_GK_REVIEW,
  REVIEW_SUMMARY_NEW_EVIDENCE_ITEM,
  EVIDENCE_LINEAGE_AUDIT_CONTRACT,
  EVIDENCE_LINEAGE_VALIDATOR_KEY,
  EVIDENCE_LINEAGE_AUDIT_OPERATION,
});

export const __evidenceLineageRepositoryTestables = Object.freeze({
  validateEvidenceHasSourceLineage,
  computeLocatorFingerprint,
  computeStatementFingerprint,
  buildEvidenceCompositionPlan,
  prepareRequiredAudit,
  RequiredAuditRejectedError,
  ConcurrentStateChangedError,
  MalformedInsertedRowError,
});
