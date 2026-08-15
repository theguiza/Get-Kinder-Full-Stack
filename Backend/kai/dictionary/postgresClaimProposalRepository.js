import { createHash } from "node:crypto";
import {
  getScopedEvidenceItemById,
  getScopedSourceLocatorById,
  getScopedSourceById,
  getScopedSourceVersionById,
  getScopedSourceCandidateByIdentity,
  getScopedPromotionDecisionBySourceVersionId,
  getScopedEvidenceReviewQueueItemByEvidenceItemId,
  getScopedClaimByEvidenceIdentity,
  getScopedClaimEvidenceLinkByClaimId,
  getScopedClaimReviewQueueItemByClaimId,
} from "../db/kaiIntakeQueries.js";
import {
  validateClaimHasLoadBearingEvidence,
  validateUnsupportedClaimPromotion,
  validateClaimRequirementCoverage,
} from "../validators/kaiClaimProposalValidators.js";

/**
 * KAI P2-03 deterministic claim-proposal repository adapter: server-derived-only
 * proposal of one internal-only, GK-review-gated `finding` claim per already-
 * committed P2-01 `kai.evidence_items` row, atomically compounded with the
 * `kai.claim_evidence_links` canonical link row and the `kai.review_queue_items`
 * `claim_review` item each fresh claim requires. Every claim carries a
 * `claim_type` of exactly `'finding'`, `claim_status = 'proposed'`,
 * `claim_review_status = 'needs_gk_review'`, `claim_strength = 'unassessed'`,
 * `internal_only = true`, and every audience-gate boolean
 * (public/funder/llm-processing/product-learning) plus `export_ready` pinned to
 * `false`.
 *
 * This module is the only authorized location for P2-03's own SQL and row
 * locking, other than the reused `getScoped*` lookups added to
 * Backend/kai/db/kaiIntakeQueries.js. The claim statement is derived only from
 * the evidence item's own locator coordinates (never from the evidence item's
 * own `statement` text, which could smuggle a different evidence_type's
 * semantics into the claim) - deterministically, so it can only ever say "the
 * field exists at this locator," never participant counts, outcomes,
 * denominators, reporting periods, causality, requirement satisfaction, or
 * external eligibility.
 *
 * Applies the exact P1-07/P2-01 correction lesson ("removed the silent partial-
 * replay repair path"): both the claim-evidence-link insert and the
 * claim_review queue-item insert are gated strictly on whether THIS call's own
 * claim insert returned a row (a fresh write), never on "a link or queue item
 * happens to be missing". An already-existing claim with a missing matching
 * link or queue item is a conflict (ConcurrentStateChangedError), never a
 * silent repair-insert.
 */

const CLAIM_PROPOSAL_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

const CLAIM_PROPOSAL_AUDIT_CONTRACT = "p2_claim_proposal_v1";

/**
 * VAL-KAI-P2-03-00N (see Backend/kai/validators/kaiClaimProposalValidators.js)
 * is this package's disclosed convention-consistent validator key, following
 * the exact P1-08/P2-01 VAL-KAI-PN-0N-00N naming idiom. It is not quoted from,
 * and is not claimed to be mandated by, any owner-authorized governing source.
 */
const CLAIM_PROPOSAL_VALIDATOR_KEY = "VAL-KAI-P2-03-001";
const CLAIM_PROPOSAL_AUDIT_OPERATION = "claim_proposed";

const CLAIM_TYPE_FINDING = "finding";
const CLAIM_STATUS_PROPOSED = "proposed";
const CLAIM_REVIEW_STATUS_NEEDS_GK_REVIEW = "needs_gk_review";
const CLAIM_STRENGTH_UNASSESSED = "unassessed";

const CLAIM_REVIEW_QUEUE_TYPE = "claim_review";
const CLAIM_REVIEW_TARGET_OBJECT_TYPE = "claim";
const CLAIM_REVIEW_QUEUE_STATUS_OPEN = "open";
/**
 * P2-03 owner decision: a fixed literal summary/required_action for every
 * claim-review queue item this package creates. Never templated from caller
 * input or derived content - the caller does not, and cannot, supply this text.
 * The apostrophe below is a plain ASCII apostrophe, written as ordinary prose.
 */
const CLAIM_REVIEW_SUMMARY = "Review proposed internal-only claim.";
const CLAIM_REVIEW_REQUIRED_ACTION =
  "Review the claim's evidence lineage, support strength, limitations, requirement coverage, and audience eligibility before any use.";

const REQUIREMENT_COVERAGE_STATUS_UNRESOLVED = "unresolved";

function claimProposalFailure(code) {
  return {
    ok: false,
    data: null,
    error: {
      code,
      status: CLAIM_PROPOSAL_RESULT_STATUS[code],
    },
  };
}

function claimProposalSuccess(data) {
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

function validateProposeClaimInput(input) {
  const allowedKeys = new Set(["organizationId", "evidenceItemId", "actorUserId", "now", "metadataOnlyAudit"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    isNonEmptyString(input.organizationId) &&
    isNonEmptyString(input.evidenceItemId) &&
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
 * Deterministic claim statement composition: derived only from the evidence
 * item's own locator coordinates - the exact committed
 * `data_dictionary_fields.profile_field_key` the locator was created for - and
 * the locator's own deterministic fingerprint. Never copies the evidence item's
 * own `statement` text verbatim, never reads raw file content or a sample
 * value, and never accepts caller-supplied text.
 */
function composeClaimStatement({ columnName, locatorFingerprint }) {
  return `The promoted source contains the committed data-dictionary field "${columnName}" identified by locator ${locatorFingerprint}.`;
}

/**
 * Deterministic statement-fingerprint generation: a sha256 hex digest computed
 * only from the identity/statement tuple this package is authorized to depend
 * on - organizationId, evidenceItemId, claimType, and the exact deterministically
 * composed statement text. Never a filename, sample value, AI output, or
 * external lookup.
 */
function computeClaimStatementFingerprint({ organizationId, evidenceItemId, claimType, statement }) {
  return createHash("sha256")
    .update(`${organizationId}|${evidenceItemId}|${claimType}|${statement}`)
    .digest("hex");
}

async function insertClaimIfAbsent(tx, { organizationId, evidenceItemId, statement, statementFingerprint, createdBy, createdByType }) {
  const result = await tx.query(
    `INSERT INTO kai.claims (
       organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength,
       statement, statement_fingerprint, created_by, created_by_type
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (organization_id, evidence_item_id, claim_type)
       DO NOTHING
     RETURNING claim_id, organization_id, evidence_item_id, claim_type, claim_status, claim_review_status,
               claim_strength, statement, statement_fingerprint, internal_only, public_use_allowed,
               funder_use_allowed, llm_processing_allowed, product_learning_allowed, export_ready,
               created_by, created_by_type, created_at`,
    [
      organizationId,
      evidenceItemId,
      CLAIM_TYPE_FINDING,
      CLAIM_STATUS_PROPOSED,
      CLAIM_REVIEW_STATUS_NEEDS_GK_REVIEW,
      CLAIM_STRENGTH_UNASSESSED,
      statement,
      statementFingerprint,
      createdBy || null,
      createdByType || "human",
    ],
  );
  return result.rows[0] ?? null;
}

async function insertClaimEvidenceLinkIfAbsent(tx, { organizationId, claimId, evidenceItemId, createdByType }) {
  const result = await tx.query(
    `INSERT INTO kai.claim_evidence_links (
       organization_id, claim_id, evidence_item_id, created_by_type
     ) VALUES ($1,$2,$3,$4)
     ON CONFLICT (organization_id, claim_id, evidence_item_id)
       DO NOTHING
     RETURNING claim_evidence_link_id, organization_id, claim_id, evidence_item_id, created_by_type, created_at`,
    [organizationId, claimId, evidenceItemId, createdByType || "system"],
  );
  return result.rows[0] ?? null;
}

async function insertClaimReviewQueueItemIfAbsent(tx, { organizationId, claimId, createdByType }) {
  const result = await tx.query(
    `INSERT INTO kai.review_queue_items (
       organization_id, queue_type, target_object_type, target_object_id,
       priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
     ) VALUES ($1,$2,$3,$4::uuid,'normal',$5,$6,$7,$8,'{}'::jsonb,$9)
     ON CONFLICT (organization_id, queue_type, target_object_type, target_object_id)
       WHERE queue_type = 'claim_review'
       DO NOTHING
     RETURNING review_queue_item_id, organization_id, queue_type, target_object_type,
               target_object_id, queue_status, review_status, summary, required_action,
               queue_metadata, created_at, updated_at`,
    [
      organizationId,
      CLAIM_REVIEW_QUEUE_TYPE,
      CLAIM_REVIEW_TARGET_OBJECT_TYPE,
      claimId,
      CLAIM_REVIEW_QUEUE_STATUS_OPEN,
      CLAIM_REVIEW_STATUS_NEEDS_GK_REVIEW,
      CLAIM_REVIEW_SUMMARY,
      CLAIM_REVIEW_REQUIRED_ACTION,
      createdByType || "system",
    ],
  );
  return result.rows[0] ?? null;
}

/**
 * Tenant-scoped read of the P0/Gate-A upload_state this package's own required
 * audit row must carry, matching the identical read every prior package
 * performs against the same table.
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
    [organizationId, intakeFileId, CLAIM_PROPOSAL_AUDIT_OPERATION, uploadState, uploadState, JSON.stringify(metadata), now],
  );
}

function rowToClaimRecord(row) {
  return {
    claim_id: row.claim_id,
    organization_id: row.organization_id,
    evidence_item_id: row.evidence_item_id,
    claim_type: row.claim_type,
    claim_status: row.claim_status,
    claim_review_status: row.claim_review_status,
    claim_strength: row.claim_strength,
    statement: row.statement,
    statement_fingerprint: row.statement_fingerprint,
    internal_only: row.internal_only,
    public_use_allowed: row.public_use_allowed,
    funder_use_allowed: row.funder_use_allowed,
    llm_processing_allowed: row.llm_processing_allowed,
    product_learning_allowed: row.product_learning_allowed,
    export_ready: row.export_ready,
    created_by: row.created_by,
    created_by_type: row.created_by_type,
    created_at: asIso(row.created_at),
  };
}

function rowToClaimEvidenceLinkRecord(row) {
  return {
    claim_evidence_link_id: row.claim_evidence_link_id,
    organization_id: row.organization_id,
    claim_id: row.claim_id,
    evidence_item_id: row.evidence_item_id,
    created_by_type: row.created_by_type,
    created_at: asIso(row.created_at),
  };
}

function rowToClaimReviewQueueRecord(row) {
  return {
    review_queue_item_id: row.review_queue_item_id,
    organization_id: row.organization_id,
    queue_type: row.queue_type,
    target_object_type: row.target_object_type,
    target_object_id: row.target_object_id,
    queue_status: row.queue_status,
    review_status: row.review_status ?? null,
    required_action: row.required_action ?? null,
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
    super(`${what} changed concurrently during claim proposal`);
    this.name = "ConcurrentStateChangedError";
  }
}

/**
 * Rejection of the required metadata-only audit must roll back every mutation
 * performed in this operation, so it is raised as an error rather than
 * returned.
 */
class RequiredAuditRejectedError extends Error {
  constructor() {
    super("required metadata-only audit was rejected");
    this.name = "RequiredAuditRejectedError";
  }
}

/**
 * Post-write/replay contract verification: re-verifies the full immutable
 * contract on the claim/link/queue rows now in hand, whether freshly inserted
 * or reread on replay. Throws MalformedInsertedRowError on any mismatch.
 */
function verifyPostWriteContract({ claimRecord, linkRecord, queueRecord, organizationId, evidenceItemId, expectedStatement, expectedStatementFingerprint }) {
  const claimOk =
    claimRecord.organization_id === organizationId &&
    claimRecord.evidence_item_id === evidenceItemId &&
    claimRecord.claim_type === CLAIM_TYPE_FINDING &&
    claimRecord.statement === expectedStatement &&
    claimRecord.statement_fingerprint === expectedStatementFingerprint &&
    claimRecord.claim_status === CLAIM_STATUS_PROPOSED &&
    claimRecord.claim_review_status === CLAIM_REVIEW_STATUS_NEEDS_GK_REVIEW &&
    claimRecord.claim_strength === CLAIM_STRENGTH_UNASSESSED &&
    claimRecord.internal_only === true &&
    claimRecord.public_use_allowed === false &&
    claimRecord.funder_use_allowed === false &&
    claimRecord.llm_processing_allowed === false &&
    claimRecord.product_learning_allowed === false &&
    claimRecord.export_ready === false;
  if (!claimOk) throw new MalformedInsertedRowError("claims");

  const linkOk =
    linkRecord.organization_id === organizationId &&
    linkRecord.claim_id === claimRecord.claim_id &&
    linkRecord.evidence_item_id === evidenceItemId;
  if (!linkOk) throw new MalformedInsertedRowError("claim_evidence_links");

  const queueOk =
    queueRecord.organization_id === organizationId &&
    queueRecord.queue_type === CLAIM_REVIEW_QUEUE_TYPE &&
    queueRecord.target_object_type === CLAIM_REVIEW_TARGET_OBJECT_TYPE &&
    queueRecord.target_object_id === claimRecord.claim_id &&
    isNonEmptyString(queueRecord.required_action);
  if (!queueOk) throw new MalformedInsertedRowError("review_queue_items");
}

function buildClaimProposalAuditMetadata({ evidenceItemId, claimId, warningCount, reviewQueueItemCount, freshWriteCount }) {
  return {
    metadata_only: true,
    contract: CLAIM_PROPOSAL_AUDIT_CONTRACT,
    evidence_item_id: evidenceItemId,
    claim_id: claimId,
    claim_type: CLAIM_TYPE_FINDING,
    claim_status: CLAIM_STATUS_PROPOSED,
    claim_review_status: CLAIM_REVIEW_STATUS_NEEDS_GK_REVIEW,
    requirement_coverage_status: REQUIREMENT_COVERAGE_STATUS_UNRESOLVED,
    warning_count: warningCount,
    review_queue_item_count: reviewQueueItemCount,
    fresh_write_count: freshWriteCount,
    validator_key: CLAIM_PROPOSAL_VALIDATOR_KEY,
  };
}

function buildClaimProposalAuditPayload(context) {
  return {
    attempted_operation: CLAIM_PROPOSAL_AUDIT_OPERATION,
    actor_type: "human",
    contract: CLAIM_PROPOSAL_AUDIT_CONTRACT,
    object_type: "claim",
    request_scope: "organization_evidence_item",
    route_contract: "unwired_synthetic_claim_proposal",
    sprint_phase: "kai_sprint2_p2_03",
    validator_key: CLAIM_PROPOSAL_VALIDATOR_KEY,
    evidence_item_id: context.evidenceItemId,
    claim_id: context.claimId,
    warning_count: context.warningCount,
    review_queue_item_count: context.reviewQueueItemCount,
    fresh_write_count: context.freshWriteCount,
  };
}

/**
 * Preserves the exact own-boolean-data-property audit predicate established by
 * P1-05 through P2-01's `prepareRequiredAudit`: an own-property descriptor read
 * (never a getter) whose `value` is exactly `true`, alongside a callable
 * `publish`.
 */
function prepareRequiredAudit(metadataOnlyAudit, tx, context) {
  const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: buildClaimProposalAuditPayload(context),
    db: tx,
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

function shapeClaimProposalError(error) {
  if (error instanceof MalformedInsertedRowError) return claimProposalFailure("system_error");
  if (error instanceof ConcurrentStateChangedError) return claimProposalFailure("conflict_current_state_changed");
  if (error instanceof RequiredAuditRejectedError) return claimProposalFailure("validation_blocker");
  if (error?.code === "23503") return claimProposalFailure("not_found");
  if (error?.code === "23514" || error?.code === "P0001" || error?.code === "22P02") {
    return claimProposalFailure("validation_blocker");
  }
  return claimProposalFailure("system_error");
}

/**
 * This factory does not statically import `withTransaction` from
 * Backend/kai/db/kaiDb.js at module load, following the exact P2-01C
 * PostgreSQL-isolation correction: a static top-level import there
 * unconditionally executes Backend/db/pg.js, which is itself capable of
 * import-time construction of the ambient application connection pool from
 * whatever DATABASE_URL/DATABASE_URL_LOCAL/etc happens to be set in the process
 * environment - exactly the import-time database initialization the P2-03
 * PostgreSQL-isolation test suite must never trigger. Every real caller that
 * does not inject its own `runInTransaction` still gets the identical default
 * behavior via this lazy, deferred import, executed only the first time this
 * repository actually runs a transaction.
 */
async function resolveDefaultRunInTransaction() {
  const { withTransaction } = await import("../db/kaiDb.js");
  return withTransaction;
}

export function createPostgresClaimProposalRepository({
  runInTransaction,
  beforeInsert = async () => {},
} = {}) {
  return Object.freeze({
    /**
     * Organization-scoped, human-authorized, idempotent proposal of exactly one
     * internal-only `finding` claim per already-committed P2-01
     * `kai.evidence_items` row. See the module doc comment for scope and the
     * P1-07/P2-01 partial-replay-repair correction this package deliberately
     * avoids.
     *
     * Genuinely concurrent identical proposal converges entirely via
     * PostgreSQL's unique constraints: every claim/link/queue-item write uses
     * `INSERT ... ON CONFLICT ... DO NOTHING RETURNING` followed by an
     * authoritative reread on a lost race - never a raised 23505 catch or any
     * application-level synchronization primitive.
     */
    async proposeClaim(input) {
      if (!validateProposeClaimInput(input)) return claimProposalFailure("validation_blocker");
      const { organizationId, evidenceItemId, actorUserId, now, metadataOnlyAudit } = input;
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      try {
        return await run(async (tx) => {
          // Test-only rendezvous seam, called once, before any row is read or
          // locked - in particular, before the FOR UPDATE lock
          // getScopedSourceCandidateByIdentity takes below, which is the real
          // serialization point for two genuinely concurrent calls on the same
          // identity (mirrors the exact P1-08/P2-01 precedent).
          await beforeInsert();

          const evidenceItemRow = await getScopedEvidenceItemById({ organizationId, evidenceItemId }, tx);
          if (!evidenceItemRow) return claimProposalFailure("not_found");

          const locatorRow = await getScopedSourceLocatorById(
            { organizationId, sourceLocatorId: evidenceItemRow.source_locator_id },
            tx,
          );
          if (!locatorRow) return claimProposalFailure("not_found");

          const sourceRow = await getScopedSourceById({ organizationId, sourceId: evidenceItemRow.source_id }, tx);
          if (!sourceRow) return claimProposalFailure("not_found");

          const sourceVersionRow = await getScopedSourceVersionById(
            { organizationId, sourceVersionId: evidenceItemRow.source_version_id },
            tx,
          );
          if (!sourceVersionRow) return claimProposalFailure("not_found");

          const candidateRow = await getScopedSourceCandidateByIdentity(
            { organizationId, intakeSourceCandidateId: sourceVersionRow.intake_source_candidate_id },
            tx,
          );
          if (!candidateRow) return claimProposalFailure("not_found");

          const decisionRow = await getScopedPromotionDecisionBySourceVersionId(
            { organizationId, sourceVersionId: evidenceItemRow.source_version_id },
            tx,
          );
          if (!decisionRow) return claimProposalFailure("not_found");

          const evidenceReviewQueueItemRow = await getScopedEvidenceReviewQueueItemByEvidenceItemId(
            { organizationId, evidenceItemId },
            tx,
          );
          if (!evidenceReviewQueueItemRow) return claimProposalFailure("not_found");

          const lineageValidation = validateClaimHasLoadBearingEvidence({
            evidenceItemRow,
            locatorRow,
            sourceRow,
            sourceVersionRow,
            candidateRow,
            decisionRow,
            evidenceReviewQueueItemRow,
          });
          if (!lineageValidation.ok) return claimProposalFailure(lineageValidation.code);

          const promotionValidation = validateUnsupportedClaimPromotion({
            claimStatus: CLAIM_STATUS_PROPOSED,
            claimReviewStatus: CLAIM_REVIEW_STATUS_NEEDS_GK_REVIEW,
            claimStrength: CLAIM_STRENGTH_UNASSESSED,
            internalOnly: true,
            publicUseAllowed: false,
            funderUseAllowed: false,
            llmProcessingAllowed: false,
            productLearningAllowed: false,
            exportReady: false,
          });
          if (!promotionValidation.ok) return claimProposalFailure(promotionValidation.code);

          const requirementValidation = validateClaimRequirementCoverage();
          if (!requirementValidation.ok) return claimProposalFailure(requirementValidation.code);

          const warnings = [
            ...(lineageValidation.warnings || []),
            ...(promotionValidation.warnings || []),
            ...(requirementValidation.warnings || []),
          ];

          const columnName = locatorRow.coordinates?.column_name;
          const statement = composeClaimStatement({ columnName, locatorFingerprint: locatorRow.locator_fingerprint });
          const statementFingerprint = computeClaimStatementFingerprint({
            organizationId,
            evidenceItemId,
            claimType: CLAIM_TYPE_FINDING,
            statement,
          });

          const insertedClaimRow = await insertClaimIfAbsent(tx, {
            organizationId,
            evidenceItemId,
            statement,
            statementFingerprint,
            createdBy: actorUserId,
            createdByType: "human",
          });

          let claimRecord;
          let isFreshlyCreated;
          if (insertedClaimRow) {
            claimRecord = rowToClaimRecord(insertedClaimRow);
            isFreshlyCreated = true;
          } else {
            const existingClaimRow = await getScopedClaimByEvidenceIdentity(
              { organizationId, evidenceItemId, claimType: CLAIM_TYPE_FINDING },
              tx,
            );
            if (!existingClaimRow) throw new MalformedInsertedRowError("claims");
            claimRecord = rowToClaimRecord(existingClaimRow);
            isFreshlyCreated = false;
            // A mismatched immutable claim identity on reread (statement drift
            // against what this call would have written for the same identity)
            // is a genuine conflict, never a silent replay.
            if (claimRecord.statement_fingerprint !== statementFingerprint) {
              throw new ConcurrentStateChangedError("claim");
            }
          }

          // P1-07/P2-01 correction lesson reapplied: the link and queue-item
          // writes are gated strictly on THIS call's own isFreshlyCreated result
          // for THIS claim, never on "a link or queue item happens to be
          // missing".
          let linkRecord;
          let queueRecord;
          if (isFreshlyCreated) {
            const insertedLinkRow = await insertClaimEvidenceLinkIfAbsent(tx, {
              organizationId,
              claimId: claimRecord.claim_id,
              evidenceItemId,
              createdByType: "system",
            });
            if (!insertedLinkRow) throw new ConcurrentStateChangedError("claim_evidence_link");
            linkRecord = rowToClaimEvidenceLinkRecord(insertedLinkRow);

            const insertedQueueRow = await insertClaimReviewQueueItemIfAbsent(tx, {
              organizationId,
              claimId: claimRecord.claim_id,
              createdByType: "system",
            });
            if (!insertedQueueRow) throw new ConcurrentStateChangedError("claim_review_queue_item");
            queueRecord = rowToClaimReviewQueueRecord(insertedQueueRow);
          } else {
            const existingLinkRow = await getScopedClaimEvidenceLinkByClaimId(
              { organizationId, claimId: claimRecord.claim_id },
              tx,
            );
            if (!existingLinkRow) throw new ConcurrentStateChangedError("claim_evidence_link");
            linkRecord = rowToClaimEvidenceLinkRecord(existingLinkRow);

            const existingQueueRow = await getScopedClaimReviewQueueItemByClaimId(
              { organizationId, claimId: claimRecord.claim_id },
              tx,
            );
            if (!existingQueueRow) throw new ConcurrentStateChangedError("claim_review_queue_item");
            queueRecord = rowToClaimReviewQueueRecord(existingQueueRow);
          }

          verifyPostWriteContract({
            claimRecord,
            linkRecord,
            queueRecord,
            organizationId,
            evidenceItemId,
            expectedStatement: statement,
            expectedStatementFingerprint: statementFingerprint,
          });

          if (!isFreshlyCreated) {
            // Full identical replay: zero writes, zero audit.
            return claimProposalSuccess({
              claim: claimRecord,
              claimEvidenceLink: linkRecord,
              reviewQueueItem: queueRecord,
              warnings,
              replayed: true,
            });
          }

          const uploadState = await readScopedUploadState(tx, organizationId, candidateRow.intake_file_id);
          if (!uploadState) return claimProposalFailure("not_found");

          const auditContext = {
            evidenceItemId,
            claimId: claimRecord.claim_id,
            warningCount: warnings.length,
            reviewQueueItemCount: 1,
            freshWriteCount: 1,
          };
          const preparedAudit = prepareRequiredAudit(metadataOnlyAudit, tx, auditContext);
          await insertAudit(tx, {
            organizationId,
            intakeFileId: candidateRow.intake_file_id,
            uploadState,
            metadata: buildClaimProposalAuditMetadata(auditContext),
            now,
          });
          await preparedAudit.publish();

          return claimProposalSuccess({
            claim: claimRecord,
            claimEvidenceLink: linkRecord,
            reviewQueueItem: queueRecord,
            warnings,
            replayed: false,
          });
        });
      } catch (error) {
        return shapeClaimProposalError(error);
      }
    },
  });
}

export const __claimProposalRepositoryContract = Object.freeze({
  CLAIM_TYPE_FINDING,
  CLAIM_STATUS_PROPOSED,
  CLAIM_REVIEW_STATUS_NEEDS_GK_REVIEW,
  CLAIM_STRENGTH_UNASSESSED,
  CLAIM_REVIEW_QUEUE_TYPE,
  CLAIM_REVIEW_TARGET_OBJECT_TYPE,
  CLAIM_REVIEW_QUEUE_STATUS_OPEN,
  CLAIM_REVIEW_SUMMARY,
  CLAIM_REVIEW_REQUIRED_ACTION,
  CLAIM_PROPOSAL_AUDIT_CONTRACT,
  CLAIM_PROPOSAL_VALIDATOR_KEY,
  CLAIM_PROPOSAL_AUDIT_OPERATION,
  REQUIREMENT_COVERAGE_STATUS_UNRESOLVED,
});

export const __claimProposalRepositoryTestables = Object.freeze({
  composeClaimStatement,
  computeClaimStatementFingerprint,
  prepareRequiredAudit,
  RequiredAuditRejectedError,
  ConcurrentStateChangedError,
  MalformedInsertedRowError,
});
