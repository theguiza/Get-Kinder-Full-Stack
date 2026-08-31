/**
 * KAI P2-12 (Problem A1) human-review-decision ledger repository: pure SQL
 * read/write primitives against kai.evidence_review_decisions and
 * kai.claim_review_decisions (see
 * migrations/kai_sprint2_p2_12_human_review_decision_ledger.sql). No business
 * rules, no HTTP-shaped errors - callers (Backend/kai/dictionary/postgresHumanReviewRepository.js)
 * own the CAS/queue-transition/audit orchestration and interpret these
 * results. Mirrors postgresHumanAuthorityDecisionRepository.js's style: a
 * head-finding query using the NOT EXISTS "no successor" pattern, and fails
 * closed (throws) if lineage is ambiguous (more than one head found) rather
 * than silently picking one.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AmbiguousDecisionLineageError extends Error {
  constructor(what) {
    super(`${what} decision lineage is ambiguous: more than one head row found`);
    this.name = "AmbiguousDecisionLineageError";
  }
}

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, allowed) {
  return (
    isPlainObject(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key))
  );
}

function isNullableNonEmptyStringArray(value) {
  if (value === null || value === undefined) return true;
  return (
    Array.isArray(value)
    && value.length > 0
    && value.every((entry) => typeof entry === "string" && entry.trim().length > 0)
  );
}

/**
 * Read the current lineage-head evidence-review decision for one evidence
 * item (the row with no successor). Returns null if no decision has ever
 * been recorded. Throws AmbiguousDecisionLineageError if more than one head
 * row is found (lineage corruption) - this deliberately fails closed rather
 * than guessing.
 */
export async function findCurrentEvidenceReviewDecision(tx, { organizationId, evidenceItemId }) {
  if (!isUuid(organizationId) || !isUuid(evidenceItemId)) {
    throw new TypeError("findCurrentEvidenceReviewDecision requires organizationId and evidenceItemId UUIDs.");
  }
  const { rows } = await tx.query(
    `SELECT d.decision_id, d.organization_id, d.evidence_item_id, d.review_queue_item_id,
            d.decision_outcome, d.limitation_notes, d.decided_by, d.decided_by_role,
            d.target_updated_at, d.supersedes_decision_id, d.created_by_type, d.created_at
       FROM kai.evidence_review_decisions d
      WHERE d.organization_id = $1::uuid
        AND d.evidence_item_id = $2::uuid
        AND NOT EXISTS (
              SELECT 1 FROM kai.evidence_review_decisions s
               WHERE s.supersedes_decision_id = d.decision_id
            )`,
    [organizationId, evidenceItemId],
  );
  if (rows.length > 1) throw new AmbiguousDecisionLineageError("evidence_review");
  return rows[0] || null;
}

/**
 * Read the current lineage-head claim-review decision for one claim (the row
 * with no successor). Same contract as findCurrentEvidenceReviewDecision.
 */
export async function findCurrentClaimReviewDecision(tx, { organizationId, claimId }) {
  if (!isUuid(organizationId) || !isUuid(claimId)) {
    throw new TypeError("findCurrentClaimReviewDecision requires organizationId and claimId UUIDs.");
  }
  const { rows } = await tx.query(
    `SELECT d.decision_id, d.organization_id, d.claim_id, d.review_queue_item_id,
            d.decision_outcome, d.limitation_notes, d.approved_audiences, d.decided_by,
            d.decided_by_role, d.target_updated_at, d.supersedes_decision_id,
            d.created_by_type, d.created_at
       FROM kai.claim_review_decisions d
      WHERE d.organization_id = $1::uuid
        AND d.claim_id = $2::uuid
        AND NOT EXISTS (
              SELECT 1 FROM kai.claim_review_decisions s
               WHERE s.supersedes_decision_id = d.decision_id
            )`,
    [organizationId, claimId],
  );
  if (rows.length > 1) throw new AmbiguousDecisionLineageError("claim_review");
  return rows[0] || null;
}

function isInsertEvidenceReviewDecisionInput(input) {
  const allowedKeys = new Set([
    "organizationId", "evidenceItemId", "reviewQueueItemId", "decisionOutcome",
    "limitationNotes", "decidedBy", "decidedByRole", "targetUpdatedAt", "supersedesDecisionId",
  ]);
  if (!hasExactKeys(input, allowedKeys)) return false;
  return (
    isUuid(input.organizationId)
    && isUuid(input.evidenceItemId)
    && isUuid(input.reviewQueueItemId)
    && isNonEmptyString(input.decisionOutcome)
    && isNullableNonEmptyStringArray(input.limitationNotes)
    && isUuid(input.decidedBy)
    && isNonEmptyString(input.decidedByRole)
    && isNonEmptyString(input.targetUpdatedAt)
    && (input.supersedesDecisionId === null || isUuid(input.supersedesDecisionId))
  );
}

/**
 * Insert one new evidence-review decision row. Pure INSERT ... RETURNING *:
 * no CAS, no domain-column write, no audit - the caller orchestrates those
 * in the same transaction. supersedesDecisionId must be null for a lineage
 * root or the current head's decision_id to append a successor; the
 * database's own unique/FK constraints (see the p2_12 migration) are the
 * final authority on lineage integrity.
 */
export async function insertEvidenceReviewDecision(tx, input) {
  if (!isInsertEvidenceReviewDecisionInput(input)) {
    throw new TypeError("insertEvidenceReviewDecision received a malformed input.");
  }
  const {
    organizationId, evidenceItemId, reviewQueueItemId, decisionOutcome,
    limitationNotes, decidedBy, decidedByRole, targetUpdatedAt, supersedesDecisionId,
  } = input;
  const { rows } = await tx.query(
    `INSERT INTO kai.evidence_review_decisions (
       organization_id, evidence_item_id, review_queue_item_id, decision_outcome,
       limitation_notes, decided_by, decided_by_role, target_updated_at, supersedes_decision_id
     )
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::text[], $6::uuid, $7, $8::timestamptz, $9::uuid)
     RETURNING decision_id, organization_id, evidence_item_id, review_queue_item_id,
               decision_outcome, limitation_notes, decided_by, decided_by_role,
               target_updated_at, supersedes_decision_id, created_by_type, created_at`,
    [
      organizationId, evidenceItemId, reviewQueueItemId, decisionOutcome,
      limitationNotes || null, decidedBy, decidedByRole, targetUpdatedAt, supersedesDecisionId,
    ],
  );
  return rows[0];
}

function isInsertClaimReviewDecisionInput(input) {
  const allowedKeys = new Set([
    "organizationId", "claimId", "reviewQueueItemId", "decisionOutcome",
    "limitationNotes", "approvedAudiences", "decidedBy", "decidedByRole",
    "targetUpdatedAt", "supersedesDecisionId",
  ]);
  if (!hasExactKeys(input, allowedKeys)) return false;
  return (
    isUuid(input.organizationId)
    && isUuid(input.claimId)
    && isUuid(input.reviewQueueItemId)
    && isNonEmptyString(input.decisionOutcome)
    && isNullableNonEmptyStringArray(input.limitationNotes)
    && isNullableNonEmptyStringArray(input.approvedAudiences)
    && isUuid(input.decidedBy)
    && isNonEmptyString(input.decidedByRole)
    && isNonEmptyString(input.targetUpdatedAt)
    && (input.supersedesDecisionId === null || isUuid(input.supersedesDecisionId))
  );
}

/**
 * Insert one new claim-review decision row. Same contract as
 * insertEvidenceReviewDecision, plus approvedAudiences.
 */
export async function insertClaimReviewDecision(tx, input) {
  if (!isInsertClaimReviewDecisionInput(input)) {
    throw new TypeError("insertClaimReviewDecision received a malformed input.");
  }
  const {
    organizationId, claimId, reviewQueueItemId, decisionOutcome,
    limitationNotes, approvedAudiences, decidedBy, decidedByRole,
    targetUpdatedAt, supersedesDecisionId,
  } = input;
  const { rows } = await tx.query(
    `INSERT INTO kai.claim_review_decisions (
       organization_id, claim_id, review_queue_item_id, decision_outcome,
       limitation_notes, approved_audiences, decided_by, decided_by_role,
       target_updated_at, supersedes_decision_id
     )
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::text[], $6::text[], $7::uuid, $8, $9::timestamptz, $10::uuid)
     RETURNING decision_id, organization_id, claim_id, review_queue_item_id,
               decision_outcome, limitation_notes, approved_audiences, decided_by,
               decided_by_role, target_updated_at, supersedes_decision_id,
               created_by_type, created_at`,
    [
      organizationId, claimId, reviewQueueItemId, decisionOutcome,
      limitationNotes || null, approvedAudiences || null, decidedBy, decidedByRole,
      targetUpdatedAt, supersedesDecisionId,
    ],
  );
  return rows[0];
}

export const __humanReviewDecisionRepositoryTestables = Object.freeze({
  UUID_PATTERN,
  isInsertEvidenceReviewDecisionInput,
  isInsertClaimReviewDecisionInput,
});
