import crypto from "node:crypto";

import { withTransaction } from "../db/kaiDb.js";
import {
  evaluateClaimTraceabilityInTransaction,
  AUDIENCE_AUTHORITY_BLOCKER_CODES,
} from "./postgresClaimTraceabilityRepository.js";
import { validateGeneratedContentDraft } from "../validators/kaiGeneratedContentValidators.js";
import {
  validateExportManifestEligibility,
  __exportManifestEligibilityValidatorContract,
} from "../validators/kaiExportManifestEligibilityValidators.js";
import {
  GENERATED_CONTENT_REVIEW_QUEUE_CONTRACT,
  GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES,
  isGeneratedContentReviewQueueRow,
} from "./generatedContentReviewQueueContract.js";
import {
  EXPORT_REVIEW_QUEUE_STATIC_CONTRACT,
  EXPORT_REVIEW_LIFECYCLE_PROFILES,
  isExportReviewQueueContractRow,
} from "./exportReviewQueueContract.js";
import {
  loadExportManifestIdentityForReviewQueueItemInTransaction,
  loadExportManifestHistoryForReviewQueueItemInTransaction,
} from "./postgresExportManifestRepository.js";

const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  duplicate_conflict: 409,
  not_found: 404,
  system_error: 500,
  // P14-09: distinct, structured failure for governed funder generation
  // only - a freshly evaluated claim that is not currently funder-eligible.
  // Never used for internal generation (Package 14-05 preserves internal
  // admission regardless of current audience/use eligibility).
  funder_use_not_currently_eligible: 422,
});

const CONTENT_TYPE = "evidence_summary";
const IMPACT_NARRATIVE_CONTENT_TYPE = "impact_narrative";
const ALLOWED_GENERATED_CONTENT_TYPES = new Set([CONTENT_TYPE, IMPACT_NARRATIVE_CONTENT_TYPE]);
const DRAFT_STATUS = "draft";
const REVIEW_STATUS = GENERATED_CONTENT_REVIEW_QUEUE_CONTRACT.reviewStatus;
const REVIEW_QUEUE_TYPE = GENERATED_CONTENT_REVIEW_QUEUE_CONTRACT.queueType;
const REVIEW_TARGET_TYPE = GENERATED_CONTENT_REVIEW_QUEUE_CONTRACT.targetObjectType;
const REVIEW_SUMMARY = GENERATED_CONTENT_REVIEW_QUEUE_CONTRACT.summary;
const REVIEW_REQUIRED_ACTION = GENERATED_CONTENT_REVIEW_QUEUE_CONTRACT.requiredAction;
const AUDIT_OPERATION = "generated_content_draft_created";
const AUDIT_CONTRACT = "p3_01_generated_content_draft_v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AUDIENCES = new Set(["internal", "funder", "public"]);
// Grant Response Packet membership is funder-oriented only - "internal" and
// "public" requested-audience content is never packet-eligible, no matter
// how eligible/resolved it is. Reuses the existing requested_audience
// vocabulary already governing generation/traceability; no second audience
// concept.
const GRANT_RESPONSE_PACKET_AUDIENCE = "funder";
const EVIDENCE_SENSITIVITY_LEVELS = new Set(["unknown"]);
const SHA256_LOWER_PATTERN = /^[0-9a-f]{64}$/;

// P14-09 diagnostic propagation only: bounded, metadata-safe stage
// discriminators for the two createGeneratedContentDraft validation_blocker
// branches that previously carried no structured detail at all (unlike the
// VAL-GEN-001..005 branch, which already produces one and merely needed it
// preserved through to rollbackFailure below). These never change whether a
// branch blocks, and never carry generated text, claim/evidence content, or
// database internals - only which already-fail-closed stage produced the
// response.
const TRACEABILITY_RESULT_CONTRACT_VALIDATOR_KEY = "VAL-GEN-TRACE-P0-001";
const GENERATOR_RESULT_CONTRACT_VALIDATOR_KEY = "VAL-GEN-RESULT-P0-001";
const PERSISTENCE_VALIDATION_VALIDATOR_KEY = "VAL-GEN-PERSIST-P0-001";

// P14-09-FUND-GEN-RESULT-001: closed, metadata-only subreason vocabulary for
// the single VAL-GEN-RESULT-P0-001 / generator_result_contract_invalid
// boundary. The validator_key and HTTP/error semantics never change - only
// which of these bounded strings is attached as blocking_reason. Every value
// here traces to an actual predicate in classifyGeneratorResult below (or,
// for the first five, to a point inside the production generator where the
// same predicate would otherwise already be destroyed before reaching this
// file - see GENERATOR_RESULT_REASON). None of these values, or anything
// derived from them, may ever carry raw model/provider text, prompts, claim
// or evidence content, citation values, or database internals.
export const GENERATOR_RESULT_REASONS = Object.freeze({
  // Preserved from inside the generator, before normalization would
  // otherwise collapse each of these into the same empty-blocks shape.
  INPUT_CONTRACT_REJECTED: "generator_result_input_contract_rejected",
  PROVIDER_TEXT_MISSING: "generator_result_provider_text_missing",
  JSON_PARSE_FAILED: "generator_result_json_parse_failed",
  JSON_ROOT_INVALID: "generator_result_json_root_invalid",
  BLOCKS_FIELD_INVALID: "generator_result_blocks_field_invalid",
  // Classified directly from validateGeneratorResult's own predicates below,
  // against values that are still current/undestroyed at this stage.
  RESULT_SHAPE_INVALID: "generator_result_shape_invalid",
  BLOCKS_EMPTY: "generator_result_blocks_empty",
  BLOCKS_TOO_MANY: "generator_result_blocks_too_many",
  BLOCK_ORDINAL_INVALID: "generator_result_block_ordinal_invalid",
  BLOCK_SHAPE_INVALID: "generator_result_block_shape_invalid",
  BLOCK_TEXT_INVALID: "generator_result_block_text_invalid",
  BLOCK_TEXT_TOO_LONG: "generator_result_block_text_too_long",
  CITATIONS_MISSING: "generator_result_citations_missing",
  CITATION_SHAPE_INVALID: "generator_result_citation_shape_invalid",
  CITATION_ID_INVALID: "generator_result_citation_id_invalid",
  CITATION_DUPLICATE: "generator_result_citation_duplicate",
  TEXT_TOTAL_TOO_LONG: "generator_result_text_total_too_long",
});

// Non-enumerable carrier for the generator-side early-loss reason (see
// kaiEvidenceSummaryDraftGenerator.js). Using a symbol key that the
// generator attaches via Object.defineProperty(..., { enumerable: false })
// means Object.keys/JSON.stringify/spread/hasExactKeys of the generator
// result are byte-for-byte unchanged whether or not the tag is present -
// only classifyGeneratorResult below ever reads it.
export const GENERATOR_RESULT_REASON = Symbol("kai.generatorResultReason");

function stageBlocker(validatorKey, blockingReason) {
  return [{ validator_key: validatorKey, severity: "blocker", blocking_reason: blockingReason }];
}

const COMPLETE_REVIEW_FRESH_PROFILE = GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES[1];
const COMPLETE_REVIEW_RESOLVED_PROFILE = GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES[2];
const START_REVIEW_FRESH_PROFILE = GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES[0];
const START_REVIEW_IN_PROGRESS_PROFILE = GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES[1];
const START_REVIEW_AUDIT_OPERATION = "generated_content_review_started";
const START_REVIEW_AUDIT_CONTRACT = "p3_stage_b_generated_content_review_start_v1";
const START_REVIEW_VALIDATOR_KEYS = ["VAL-REV-START-001"];
const COMPLETE_REVIEW_AUDIT_OPERATION = "generated_content_review_completed";
const COMPLETE_REVIEW_AUDIT_CONTRACT = "p3_04_generated_content_review_completion_v1";
const COMPLETE_REVIEW_VALIDATOR_KEYS = ["VAL-REV-001"];

const EXPORT_REVIEW_QUEUE_TYPE = EXPORT_REVIEW_QUEUE_STATIC_CONTRACT.queueType;
const EXPORT_REVIEW_TARGET_TYPE = EXPORT_REVIEW_QUEUE_STATIC_CONTRACT.targetObjectType;
const EXPORT_REVIEW_PRIORITY = EXPORT_REVIEW_QUEUE_STATIC_CONTRACT.priority;
const EXPORT_REVIEW_SUMMARY = EXPORT_REVIEW_QUEUE_STATIC_CONTRACT.summary;
const EXPORT_REVIEW_REQUIRED_ACTION = EXPORT_REVIEW_QUEUE_STATIC_CONTRACT.requiredAction;
const EXPORT_REVIEW_QUEUE_STATUS = EXPORT_REVIEW_LIFECYCLE_PROFILES[0].queueStatus;
const EXPORT_REVIEW_REVIEW_STATUS = EXPORT_REVIEW_LIFECYCLE_PROFILES[0].reviewStatus;
const EXPORT_REVIEW_AUDIT_OPERATION = "export_review_requested";
const EXPORT_REVIEW_AUDIT_CONTRACT = "p3_05_export_review_request_v1";
const EXPORT_REVIEW_READINESS_FAILED_GATES = Object.freeze([
  "generated_content_still_draft",
  "affirmative_human_export_authority_absent",
  "final_export_gate_absent",
]);

const EXPORT_REVIEW_START_QUEUE_STATUS = EXPORT_REVIEW_LIFECYCLE_PROFILES[1].queueStatus;
const EXPORT_REVIEW_START_LIFECYCLE_PROFILE = EXPORT_REVIEW_LIFECYCLE_PROFILES[1];
const EXPORT_REVIEW_START_AUDIT_OPERATION = "export_review_started";
const EXPORT_REVIEW_START_AUDIT_CONTRACT = "p3_09_export_review_start_v1";
const EXPORT_REVIEW_START_VALIDATOR_KEYS = Object.freeze(["VAL-EXP-002"]);

const EXPORT_REVIEW_COMPLETE_QUEUE_STATUS = EXPORT_REVIEW_LIFECYCLE_PROFILES[2].queueStatus;
const EXPORT_REVIEW_COMPLETE_REVIEW_STATUS = EXPORT_REVIEW_LIFECYCLE_PROFILES[2].reviewStatus;
const EXPORT_REVIEW_COMPLETE_LIFECYCLE_PROFILE = EXPORT_REVIEW_LIFECYCLE_PROFILES[2];
const EXPORT_REVIEW_COMPLETE_AUDIT_OPERATION = "export_review_completed";
const EXPORT_REVIEW_COMPLETE_AUDIT_CONTRACT = "p3_13_export_review_completion_v1";
const EXPORT_REVIEW_COMPLETE_VALIDATOR_KEYS = Object.freeze(["VAL-EXP-003"]);

function failure(code, blockers) {
  return {
    ok: false,
    data: null,
    error: { code, status: RESULT_STATUS[code] || 500 },
    ...(blockers ? { blockers } : {}),
  };
}

function success(data) {
  return { ok: true, data, error: null };
}

export class RollbackResultError extends Error {
  constructor(result) {
    super("rollback generated-content transaction");
    this.name = "RollbackResultError";
    this.result = result;
  }
}

function rollbackFailure(code, blockers) {
  throw new RollbackResultError(failure(code, blockers));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprintGeneratedContentRequest(contentType, { requestedAudience, claimIds, engagementId }) {
  return crypto
    .createHash("sha256")
    .update(canonicalJson({ contentType, requestedAudience, claimIds, engagementId }))
    .digest("hex");
}

export function fingerprintEvidenceSummaryRequest({ requestedAudience, claimIds, engagementId }) {
  return fingerprintGeneratedContentRequest(CONTENT_TYPE, { requestedAudience, claimIds, engagementId });
}

export function fingerprintImpactNarrativeRequest({ requestedAudience, claimIds, engagementId }) {
  return fingerprintGeneratedContentRequest(IMPACT_NARRATIVE_CONTENT_TYPE, { requestedAudience, claimIds, engagementId });
}

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function validateInput(input) {
  let normalizedNow = null;
  try {
    normalizedNow = new Date(input?.now).toISOString();
  } catch {
    return false;
  }
  return hasExactKeys(input, new Set(["organizationId", "engagementId", "requestedAudience", "claimIds", "idempotencyKey", "actorContext", "now"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && AUDIENCES.has(input.requestedAudience)
    && Array.isArray(input.claimIds)
    && input.claimIds.length >= 1
    && input.claimIds.every((claimId) => typeof claimId === "string" && UUID_PATTERN.test(claimId))
    && input.claimIds.length === new Set(input.claimIds).size
    && input.claimIds.every((claimId, index, arr) => index === 0 || arr[index - 1] < claimId)
    && typeof input.idempotencyKey === "string"
    && input.idempotencyKey === input.idempotencyKey.trim()
    && /^[ -~]{8,128}$/.test(input.idempotencyKey)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext)
    && typeof input.now === "string"
    && normalizedNow === input.now;
}

function validateReviewPacketInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "generatedContentDraftId"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.generatedContentDraftId);
}

function validateGrantResponsePacketMembershipInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "engagementId"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId);
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string") return false;
  let normalized = null;
  try {
    normalized = new Date(value).toISOString();
  } catch {
    return false;
  }
  return normalized === value;
}

function asCanonicalUtcTimestamp(value) {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function validateCompleteReviewInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "generatedContentDraftId",
    "reviewQueueItemId",
    "expectedUpdatedAt",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.generatedContentDraftId)
    && UUID_PATTERN.test(input.reviewQueueItemId)
    && isCanonicalUtcTimestamp(input.expectedUpdatedAt)
    && isCanonicalUtcTimestamp(input.now)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext);
}

function validateGeneratorInput(input) {
  if (!hasExactKeys(input, new Set(["contentType", "requestedAudience", "claims"]))) return false;
  if (!ALLOWED_GENERATED_CONTENT_TYPES.has(input.contentType) || !AUDIENCES.has(input.requestedAudience)) return false;
  if (!Array.isArray(input.claims) || input.claims.length === 0) return false;
  const allowedClaimKeys = new Set([
    "claimId",
    "claimStatement",
    "claimType",
    "evidenceItemId",
    "sourceId",
    "sourceVersionId",
    "limitationCodes",
  ]);
  for (const claim of input.claims) {
    if (!hasExactKeys(claim, allowedClaimKeys)) return false;
    if (!UUID_PATTERN.test(claim.claimId)) return false;
    if (typeof claim.claimStatement !== "string" || claim.claimStatement.length === 0) return false;
    if (typeof claim.claimType !== "string") return false;
    if (!UUID_PATTERN.test(claim.evidenceItemId)) return false;
    if (!UUID_PATTERN.test(claim.sourceId)) return false;
    if (!UUID_PATTERN.test(claim.sourceVersionId)) return false;
    if (!Array.isArray(claim.limitationCodes)) return false;
    if (!claim.limitationCodes.every((code) => typeof code === "string" && /^[a-z][a-z0-9_.:-]{0,95}$/.test(code))) {
      return false;
    }
  }
  return true;
}

// Pure classification: identical acceptance semantics to the original
// validateGeneratorResult (every predicate below, and its order, is
// unchanged from that function) - the only difference is that each
// rejection now also returns which closed subreason fired, instead of a
// bare boolean. validateGeneratorResult (still exported for existing
// callers) is now a thin projection of this.
function classifyGeneratorResult(result) {
  if (!hasExactKeys(result, new Set(["blocks"])) || !Array.isArray(result?.blocks)) {
    return { ok: false, reason: GENERATOR_RESULT_REASONS.RESULT_SHAPE_INVALID };
  }
  if (result.blocks.length < 1) {
    // The one point where several generator-side conditions (missing
    // provider text, JSON parse failure, invalid JSON root, missing/invalid
    // blocks field, a generator input-contract rejection, or the model
    // genuinely returning zero blocks) have always collapsed into the same
    // `{ blocks: [] }` shape. If the generator preserved a more specific
    // early-loss reason on this exact object (see GENERATOR_RESULT_REASON),
    // surface that instead of the generic "blocks empty" classification.
    return { ok: false, reason: result[GENERATOR_RESULT_REASON] || GENERATOR_RESULT_REASONS.BLOCKS_EMPTY };
  }
  if (result.blocks.length > 20) {
    return { ok: false, reason: GENERATOR_RESULT_REASONS.BLOCKS_TOO_MANY };
  }
  const ordinals = result.blocks.map((block) => block.ordinal);
  if (!ordinals.every((ordinal, index) => ordinal === index + 1)) {
    return { ok: false, reason: GENERATOR_RESULT_REASONS.BLOCK_ORDINAL_INVALID };
  }
  let totalText = 0;
  for (const block of result.blocks) {
    if (!hasExactKeys(block, new Set(["ordinal", "text", "citations"]))) {
      return { ok: false, reason: GENERATOR_RESULT_REASONS.BLOCK_SHAPE_INVALID };
    }
    if (typeof block.text !== "string" || block.text.length < 1) {
      return { ok: false, reason: GENERATOR_RESULT_REASONS.BLOCK_TEXT_INVALID };
    }
    if (block.text.length > 4000) {
      return { ok: false, reason: GENERATOR_RESULT_REASONS.BLOCK_TEXT_TOO_LONG };
    }
    totalText += block.text.length;
    if (!Array.isArray(block.citations) || block.citations.length < 1) {
      return { ok: false, reason: GENERATOR_RESULT_REASONS.CITATIONS_MISSING };
    }
    const seen = new Set();
    for (const citation of block.citations) {
      if (!hasExactKeys(citation, new Set(["claimId", "evidenceItemId"]))) {
        return { ok: false, reason: GENERATOR_RESULT_REASONS.CITATION_SHAPE_INVALID };
      }
      if (!UUID_PATTERN.test(citation.claimId) || !UUID_PATTERN.test(citation.evidenceItemId)) {
        return { ok: false, reason: GENERATOR_RESULT_REASONS.CITATION_ID_INVALID };
      }
      const key = `${citation.claimId}:${citation.evidenceItemId}`;
      if (seen.has(key)) {
        return { ok: false, reason: GENERATOR_RESULT_REASONS.CITATION_DUPLICATE };
      }
      seen.add(key);
    }
  }
  if (totalText > 20000) {
    return { ok: false, reason: GENERATOR_RESULT_REASONS.TEXT_TOTAL_TOO_LONG };
  }
  return { ok: true, reason: null };
}

function validateGeneratorResult(result) {
  return classifyGeneratorResult(result).ok;
}

function prepareRequiredAudit(metadataOnlyAudit, payload, db) {
  const prepared = metadataOnlyAudit?.prepareMetadataOnlyAudit?.({ payload, db });
  const descriptor =
    prepared !== null && typeof prepared === "object" && !Array.isArray(prepared)
      ? Object.getOwnPropertyDescriptor(prepared, "ok")
      : undefined;
  if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.value !== true || typeof prepared.publish !== "function") {
    throw new Error("required_audit_prepare_failed");
  }
  return prepared;
}

async function insertRunReservation(tx, input, requestFingerprint, contentType) {
  const { rows } = await tx.query(
    `INSERT INTO kai.generation_runs (
       organization_id, engagement_id, idempotency_key, request_fingerprint, content_type,
       requested_audience, created_by_type, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,'system',$7::timestamptz)
     ON CONFLICT (organization_id, idempotency_key) DO NOTHING
     RETURNING generation_run_id::text AS generation_run_id`,
    [input.organizationId, input.engagementId, input.idempotencyKey, requestFingerprint, contentType, input.requestedAudience, input.now],
  );
  return rows[0] || null;
}

async function readExistingState(tx, { organizationId, idempotencyKey }) {
  const runRows = await tx.query(
    `SELECT generation_run_id::text AS generation_run_id, organization_id::text AS organization_id,
            engagement_id::text AS engagement_id,
            idempotency_key, request_fingerprint, content_type, requested_audience,
            created_by_type, created_at
       FROM kai.generation_runs
      WHERE organization_id = $1::uuid AND idempotency_key = $2`,
    [organizationId, idempotencyKey],
  );
  const run = runRows.rows[0] || null;
  if (!run) return null;
  const draftRows = await tx.query(
    `SELECT generated_content_draft_id::text AS generated_content_draft_id,
            generation_run_id::text AS generation_run_id, organization_id::text AS organization_id,
            content_type, requested_audience, draft_status, review_status, created_by_type, created_at
       FROM kai.generated_content_drafts
      WHERE organization_id = $1::uuid AND generation_run_id = $2::uuid`,
    [organizationId, run.generation_run_id],
  );
  const drafts = draftRows.rows;
  const draftId = drafts[0]?.generated_content_draft_id || null;
  const blockRows = draftId
    ? await tx.query(
        `SELECT generated_content_block_id::text AS generated_content_block_id,
                generated_content_draft_id::text AS generated_content_draft_id,
                organization_id::text AS organization_id, ordinal, text
           FROM kai.generated_content_blocks
          WHERE organization_id = $1::uuid AND generated_content_draft_id = $2::uuid
          ORDER BY ordinal ASC`,
        [organizationId, draftId],
      )
    : { rows: [] };
  const citationRows = draftId
    ? await tx.query(
        `SELECT c.generated_content_citation_id::text AS generated_content_citation_id,
                c.generated_content_block_id::text AS generated_content_block_id,
                c.organization_id::text AS organization_id, c.claim_id::text AS claim_id,
                c.evidence_item_id::text AS evidence_item_id
           FROM kai.generated_content_citations c
           JOIN kai.generated_content_blocks b
             ON b.generated_content_block_id = c.generated_content_block_id
          WHERE c.organization_id = $1::uuid AND b.generated_content_draft_id = $2::uuid
          ORDER BY b.ordinal ASC, c.claim_id ASC, c.evidence_item_id ASC`,
        [organizationId, draftId],
      )
    : { rows: [] };
  const queueRows = draftId
    ? await tx.query(
        `SELECT review_queue_item_id::text AS review_queue_item_id, organization_id::text AS organization_id,
                queue_type, target_object_type, target_object_id::text AS target_object_id,
                priority, queue_status, review_status, assigned_to, due_at, summary, required_action, created_by_type
           FROM kai.review_queue_items
          WHERE organization_id = $1::uuid
            AND queue_type = $2
            AND target_object_type = $3
            AND target_object_id = $4::uuid`,
        [organizationId, REVIEW_QUEUE_TYPE, REVIEW_TARGET_TYPE, draftId],
      )
    : { rows: [] };
  return { run, drafts, blocks: blockRows.rows, citations: citationRows.rows, queues: queueRows.rows };
}

async function readReviewPacketState(tx, { organizationId, generatedContentDraftId }) {
  const draftRows = await tx.query(
    `SELECT generated_content_draft_id::text AS generated_content_draft_id,
            generation_run_id::text AS generation_run_id, organization_id::text AS organization_id,
            content_type, requested_audience, draft_status, review_status
       FROM kai.generated_content_drafts
      WHERE organization_id = $1::uuid
        AND generated_content_draft_id = $2::uuid`,
    [organizationId, generatedContentDraftId],
  );
  if (draftRows.rows.length === 0) return null;
  const draft = draftRows.rows[0];
  const runRows = await tx.query(
    `SELECT generation_run_id::text AS generation_run_id,
            organization_id::text AS organization_id, engagement_id::text AS engagement_id,
            request_fingerprint, content_type, requested_audience
       FROM kai.generation_runs
      WHERE generation_run_id = $1::uuid`,
    [draft.generation_run_id],
  );
  const siblingDraftRows = await tx.query(
    `SELECT generated_content_draft_id::text AS generated_content_draft_id,
            generation_run_id::text AS generation_run_id, organization_id::text AS organization_id,
            content_type, requested_audience, draft_status, review_status
       FROM kai.generated_content_drafts
      WHERE generation_run_id = $1::uuid
      ORDER BY generated_content_draft_id ASC`,
    [draft.generation_run_id],
  );
  const blockRows = await tx.query(
    `SELECT generated_content_block_id::text AS generated_content_block_id,
            generated_content_draft_id::text AS generated_content_draft_id,
            organization_id::text AS organization_id, ordinal, text
       FROM kai.generated_content_blocks
      WHERE generated_content_draft_id = $1::uuid
      ORDER BY ordinal ASC, generated_content_block_id ASC`,
    [generatedContentDraftId],
  );
  const blockIds = blockRows.rows.map((block) => block.generated_content_block_id);
  const citationRows = blockIds.length === 0
    ? { rows: [] }
    : await tx.query(
        `SELECT c.generated_content_citation_id::text AS generated_content_citation_id,
                c.generated_content_block_id::text AS generated_content_block_id,
                c.organization_id::text AS organization_id,
                c.claim_id::text AS claim_id,
                c.evidence_item_id::text AS evidence_item_id,
                b.ordinal AS block_ordinal
           FROM kai.generated_content_citations c
           JOIN kai.generated_content_blocks b
             ON b.generated_content_block_id = c.generated_content_block_id
          WHERE c.generated_content_block_id = ANY($1::uuid[])
          ORDER BY b.ordinal ASC, c.claim_id ASC, c.evidence_item_id ASC, c.generated_content_citation_id ASC`,
        [blockIds],
      );
  const queueRows = await tx.query(
    `SELECT review_queue_item_id::text AS review_queue_item_id,
            organization_id::text AS organization_id, queue_type, target_object_type,
            target_object_id::text AS target_object_id, priority, queue_status,
            review_status, assigned_to, due_at, summary, required_action,
            updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND target_object_type = $2
        AND target_object_id = $3::uuid
        AND queue_type = $4
      ORDER BY review_queue_item_id ASC`,
    [organizationId, REVIEW_TARGET_TYPE, generatedContentDraftId, REVIEW_QUEUE_TYPE],
  );
  // Durable read recovery: the same exact-cardinality export_review lookup
  // requestGeneratedDraftExportReview already relies on
  // (ux_review_queue_items_p3_05_export_review_identity guarantees at most
  // one row per organization_id/generated_content_draft_id) - never a
  // latest/LIMIT-1 guess, and 0 rows is a legitimate, real state (no export
  // review requested yet), not an error.
  const exportReviewQueueRows = await loadExportReviewQueueRows(tx, { organizationId, generatedContentDraftId });
  return {
    run: runRows.rows[0] || null,
    draft,
    siblingDrafts: siblingDraftRows.rows,
    blocks: blockRows.rows,
    citations: citationRows.rows,
    queues: queueRows.rows,
    exportReviewQueues: exportReviewQueueRows,
  };
}

function validateExistingState(state, requestFingerprint, requestedAudience, contentType, engagementId) {
  if (!state?.run) return false;
  if (state.run.request_fingerprint !== requestFingerprint) return "duplicate_conflict";
  if (state.run.content_type !== contentType || state.run.requested_audience !== requestedAudience || state.run.created_by_type !== "system") return false;
  if (state.run.engagement_id !== engagementId) return false;
  if (state.drafts.length !== 1 || state.queues.length !== 1 || state.blocks.length < 1) return false;
  const draft = state.drafts[0];
  if (
    draft.generation_run_id !== state.run.generation_run_id ||
    draft.content_type !== contentType ||
    draft.requested_audience !== requestedAudience ||
    draft.draft_status !== DRAFT_STATUS ||
    draft.review_status !== REVIEW_STATUS ||
    draft.created_by_type !== "system"
  ) return false;
  if (!state.blocks.every((block, index) => block.ordinal === index + 1)) return false;
  const citedBlockIds = new Set(state.citations.map((citation) => citation.generated_content_block_id));
  if (!state.blocks.every((block) => citedBlockIds.has(block.generated_content_block_id))) return false;
  const queue = state.queues[0];
  // Exact replay of the immutable generation identity must not depend on
  // downstream-mutable review progress: once review legitimately starts or
  // resolves, this queue row moves through
  // GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES[1]/[2] and a replay of the
  // same idempotency_key + request fingerprint must still recognize it as
  // the same generation, not a conflict. Only a queue row outside the
  // canonical lifecycle (wrong org/target/type, or a status pairing no
  // profile admits) fails closed here.
  if (!isGeneratedContentReviewQueueRow(queue, {
    organizationId: state.run.organization_id,
    targetObjectId: draft.generated_content_draft_id,
    requireCreatedByType: true,
    allowedLifecycleProfiles: GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES,
  })) return false;
  return true;
}

function hasOnlyAllowedKeys(value, allowedKeys) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).every((key) => allowedKeys.has(key));
}

function validateImmutableGraphRows(state, { organizationId, generatedContentDraftId }) {
  const runKeys = new Set(["generation_run_id", "organization_id", "engagement_id", "request_fingerprint", "content_type", "requested_audience"]);
  const draftKeys = new Set(["generated_content_draft_id", "generation_run_id", "organization_id", "content_type", "requested_audience", "draft_status", "review_status"]);
  const blockKeys = new Set(["generated_content_block_id", "generated_content_draft_id", "organization_id", "ordinal", "text"]);
  const citationKeys = new Set(["generated_content_citation_id", "generated_content_block_id", "organization_id", "claim_id", "evidence_item_id", "block_ordinal"]);
  if (!state?.run || !state?.draft) return false;
  if (!hasOnlyAllowedKeys(state.run, runKeys) || !hasOnlyAllowedKeys(state.draft, draftKeys)) return "system_error";
  if (!state.blocks.every((block) => hasOnlyAllowedKeys(block, blockKeys))) return "system_error";
  if (!state.citations.every((citation) => hasOnlyAllowedKeys(citation, citationKeys))) return "system_error";
  if (state.run.organization_id !== organizationId || !ALLOWED_GENERATED_CONTENT_TYPES.has(state.run.content_type)) return false;
  if (!SHA256_LOWER_PATTERN.test(state.run.request_fingerprint)) return false;
  if (state.siblingDrafts.length !== 1) return false;
  if (state.siblingDrafts[0].generated_content_draft_id !== generatedContentDraftId) return false;
  if (
    state.draft.generated_content_draft_id !== generatedContentDraftId ||
    state.draft.organization_id !== organizationId ||
    state.draft.generation_run_id !== state.run.generation_run_id ||
    state.draft.content_type !== state.run.content_type ||
    state.draft.draft_status !== DRAFT_STATUS ||
    state.draft.requested_audience !== state.run.requested_audience ||
    state.draft.review_status !== REVIEW_STATUS
  ) return false;
  if (state.blocks.length < 1 || state.blocks.length > 20) return false;
  let totalText = 0;
  for (const [index, block] of state.blocks.entries()) {
    if (
      block.organization_id !== organizationId ||
      block.generated_content_draft_id !== generatedContentDraftId ||
      block.ordinal !== index + 1 ||
      typeof block.text !== "string" ||
      block.text.length < 1 ||
      block.text.length > 4000
    ) return false;
    totalText += block.text.length;
  }
  if (totalText > 20000) return false;
  const blockById = new Map(state.blocks.map((block) => [block.generated_content_block_id, block]));
  const citationsByBlock = new Map(state.blocks.map((block) => [block.generated_content_block_id, []]));
  for (const citation of state.citations) {
    const block = blockById.get(citation.generated_content_block_id);
    if (!block || citation.organization_id !== organizationId || citation.block_ordinal !== block.ordinal) return false;
    citationsByBlock.get(citation.generated_content_block_id).push(citation);
  }
  for (const [blockId, citations] of citationsByBlock.entries()) {
    if (citations.length < 1) return false;
    const seen = new Set();
    for (const citation of citations) {
      if (!UUID_PATTERN.test(citation.claim_id) || !UUID_PATTERN.test(citation.evidence_item_id)) return false;
      const key = `${citation.claim_id}:${citation.evidence_item_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
    }
    citationsByBlock.set(blockId, citations);
  }
  return { citationsByBlock };
}

function validateGeneratedContentReviewQueueRows(state, { organizationId, generatedContentDraftId }, allowedLifecycleProfiles) {
  const queueKeys = new Set(["review_queue_item_id", "organization_id", "queue_type", "target_object_type", "target_object_id", "priority", "queue_status", "review_status", "assigned_to", "due_at", "summary", "required_action", "updated_at"]);
  if (!state.queues.every((queue) => hasOnlyAllowedKeys(queue, queueKeys))) return "system_error";
  if (state.queues.length !== 1) return false;
  const queue = state.queues[0];
  if (!isGeneratedContentReviewQueueRow(queue, { organizationId, targetObjectId: generatedContentDraftId, allowedLifecycleProfiles })) return false;
  return true;
}

// 0 or 1 row only - the same ux_review_queue_items_p3_05_export_review_identity
// unique index requestGeneratedDraftExportReview relies on guarantees this is
// never ambiguous. More than 1 row is a genuine system_error, not a pick.
function validateExportReviewQueueRows(state, { organizationId, generatedContentDraftId }) {
  const queueKeys = new Set([
    "review_queue_item_id", "organization_id", "queue_type", "target_object_type",
    "target_object_id", "priority", "queue_status", "review_status", "blocked_reason",
    "assigned_to", "due_at", "summary", "required_action", "queue_metadata",
    "created_by", "created_by_type", "updated_at",
  ]);
  if (!state.exportReviewQueues.every((queue) => hasOnlyAllowedKeys(queue, queueKeys))) return "system_error";
  if (state.exportReviewQueues.length > 1) return "system_error";
  if (state.exportReviewQueues.length === 0) return true;
  return isExportReviewQueueContractRow(state.exportReviewQueues[0], {
    organizationId,
    targetObjectId: generatedContentDraftId,
    allowedLifecycleProfiles: EXPORT_REVIEW_LIFECYCLE_PROFILES,
  });
}

function validateReviewPacketRows(state, { organizationId, generatedContentDraftId }, allowedLifecycleProfiles = [GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES[0]]) {
  const graph = validateImmutableGraphRows(state, { organizationId, generatedContentDraftId });
  if (graph === false || graph === "system_error") return graph;
  const queueValidation = validateGeneratedContentReviewQueueRows(state, { organizationId, generatedContentDraftId }, allowedLifecycleProfiles);
  if (queueValidation === false || queueValidation === "system_error") return queueValidation;
  const exportReviewValidation = validateExportReviewQueueRows(state, { organizationId, generatedContentDraftId });
  if (exportReviewValidation === false || exportReviewValidation === "system_error") return exportReviewValidation;
  return graph;
}

const TRACEABILITY_GRAPH_RELATIONSHIP_KEYS = new Set([
  "relationship_type",
  "from_object_type",
  "from_object_id",
  "to_object_type",
  "to_object_id",
]);
const TRACEABILITY_GRAPH_COMPLETENESS_KEYS = new Set([
  "complete",
  "missing_relationship_types",
  "invalid_relationship_count",
]);
const TRACEABILITY_EVIDENCE_REVIEW_DECISION_KEYS = new Set(["decision_id", "decision_outcome"]);
const TRACEABILITY_CLAIM_REVIEW_DECISION_KEYS = new Set(["decision_id", "decision_outcome", "approved_audiences"]);

function isStringArrayValue(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function validateNullableReviewDecision(value, allowedKeys, { requireApprovedAudiences }) {
  if (value === null) return true;
  if (!hasOnlyAllowedKeys(value, allowedKeys)) return false;
  if (!UUID_PATTERN.test(value.decision_id) || typeof value.decision_outcome !== "string") return false;
  if (!requireApprovedAudiences) return true;
  return value.approved_audiences === null || isStringArrayValue(value.approved_audiences);
}

function validateGraphRelationships(value) {
  if (!Array.isArray(value) || value.length < 1) return false;
  return value.every((relationship) => (
    hasOnlyAllowedKeys(relationship, TRACEABILITY_GRAPH_RELATIONSHIP_KEYS)
    && typeof relationship.relationship_type === "string"
    && typeof relationship.from_object_type === "string"
    && typeof relationship.to_object_type === "string"
    && UUID_PATTERN.test(relationship.from_object_id)
    && UUID_PATTERN.test(relationship.to_object_id)
  ));
}

function validateGraphTraceCompletenessData(value) {
  return hasOnlyAllowedKeys(value, TRACEABILITY_GRAPH_COMPLETENESS_KEYS)
    && typeof value.complete === "boolean"
    && isStringArrayValue(value.missing_relationship_types)
    && typeof value.invalid_relationship_count === "number";
}

function validateTraceabilityData(data, { claimId, requestedAudience }) {
  const rootKeys = new Set([
    "claim",
    "evidence",
    "locator",
    "source",
    "source_version",
    "claim_review",
    "evidence_review_decision",
    "claim_review_decision",
    "candidate",
    "promotion_decision",
    "dimensions",
    "gap_items",
    "client_followup_workflows",
    "potential_conflict_groups",
    "graph_relationships",
    "graph_trace_completeness",
    "requestedAudience",
    "eligible",
    "blockerCodes",
    "affectedDimensionKeys",
    "affectedObjectIds",
    "truncated",
  ]);
  if (!hasExactKeys(data, rootKeys)) return false;
  if (data.requestedAudience !== requestedAudience || typeof data.eligible !== "boolean") return false;
  if (!Array.isArray(data.blockerCodes) || !Array.isArray(data.affectedDimensionKeys) || !Array.isArray(data.affectedObjectIds)) return false;
  if (!hasOnlyAllowedKeys(data.claim, new Set(["claim_id", "claim_type", "claim_status", "claim_review_status", "claim_strength", "audience_gates"]))) return false;
  if (!hasOnlyAllowedKeys(data.evidence, new Set(["evidence_item_id", "evidence_review_status", "support_strength", "review_queue_item_id", "review_queue_status", "review_status", "updated_at", "sensitivity_level"]))) return false;
  if (!hasOnlyAllowedKeys(data.source, new Set(["source_id", "source_code"]))) return false;
  if (!hasOnlyAllowedKeys(data.source_version, new Set(["source_version_id", "is_current"]))) return false;
  if (!validateNullableReviewDecision(data.evidence_review_decision, TRACEABILITY_EVIDENCE_REVIEW_DECISION_KEYS, { requireApprovedAudiences: false })) return false;
  if (!validateNullableReviewDecision(data.claim_review_decision, TRACEABILITY_CLAIM_REVIEW_DECISION_KEYS, { requireApprovedAudiences: true })) return false;
  if (!validateGraphRelationships(data.graph_relationships)) return false;
  if (!validateGraphTraceCompletenessData(data.graph_trace_completeness)) return false;
  return data.claim.claim_id === claimId
    && UUID_PATTERN.test(data.evidence.evidence_item_id)
    && UUID_PATTERN.test(data.source.source_id)
    && UUID_PATTERN.test(data.source_version.source_version_id)
    && data.source_version.is_current === true
    && typeof data.evidence.support_strength === "string"
    && isCanonicalUtcTimestamp(data.evidence.updated_at)
    && EVIDENCE_SENSITIVITY_LEVELS.has(data.evidence.sensitivity_level)
    && typeof data.claim.claim_review_status === "string"
    && typeof data.evidence.evidence_review_status === "string";
}

async function toReviewPacket(tx, state, input, validation, evaluator) {
  const evaluatedByClaim = new Map();
  const uniqueClaimIds = [...new Set(state.citations.map((citation) => citation.claim_id))].sort();
  for (const claimId of uniqueClaimIds) {
    const result = await evaluator(tx, {
      organizationId: input.organizationId,
      claimId,
      requestedAudience: state.draft.requested_audience,
    });
    if (!result.ok) return failure("conflict_current_state_changed");
    if (!validateTraceabilityData(result.data, { claimId, requestedAudience: state.draft.requested_audience })) {
      return failure("conflict_current_state_changed");
    }
    evaluatedByClaim.set(claimId, result.data);
  }

  const blocks = state.blocks.map((block) => {
    const citations = validation.citationsByBlock.get(block.generated_content_block_id).map((citation) => {
      const evaluated = evaluatedByClaim.get(citation.claim_id);
      if (citation.evidence_item_id !== evaluated.evidence.evidence_item_id) {
        throw new RollbackResultError(failure("conflict_current_state_changed"));
      }
      return {
        generatedContentCitationId: citation.generated_content_citation_id,
        claimId: citation.claim_id,
        evidenceItemId: citation.evidence_item_id,
        sourceId: evaluated.source.source_id,
        sourceVersionId: evaluated.source_version.source_version_id,
        supportStrength: evaluated.evidence.support_strength,
        claimReviewStatus: evaluated.claim.claim_review_status,
        evidenceReviewStatus: evaluated.evidence.evidence_review_status,
        currentEligible: evaluated.eligible,
        blockerCodes: [...new Set(evaluated.blockerCodes)],
        affectedDimensionKeys: evaluated.affectedDimensionKeys,
        affectedObjectIds: evaluated.affectedObjectIds,
      };
    });
    return {
      generatedContentBlockId: block.generated_content_block_id,
      ordinal: block.ordinal,
      text: block.text,
      citations,
    };
  });
  return success({
    generationRunId: state.run.generation_run_id,
    generatedContentDraftId: state.draft.generated_content_draft_id,
    contentType: state.draft.content_type,
    draftStatus: state.draft.draft_status,
    requestedAudience: state.draft.requested_audience,
    reviewQueueItemId: state.queues[0].review_queue_item_id,
    queueStatus: state.queues[0].queue_status,
    reviewStatus: state.queues[0].review_status,
    reviewUpdatedAt: asCanonicalUtcTimestamp(state.queues[0].updated_at),
    currentUseEligible: [...evaluatedByClaim.values()].every((evaluated) => evaluated.eligible === true),
    // Durable read recovery (minimum safe, allowlisted export-review
    // projection only): identity/state, never the export-review packet's
    // own blocks/citations/validatorResult, which stay behind the existing
    // gk_admin-only get_generated_draft_export_review_packet read.
    exportReviewQueueItemId: state.exportReviewQueues[0]?.review_queue_item_id ?? null,
    exportReviewQueueStatus: state.exportReviewQueues[0]?.queue_status ?? null,
    exportReviewStatus: state.exportReviewQueues[0]?.review_status ?? null,
    blocks,
  });
}

async function loadGenerationProjection(tx, { organizationId, claimIds, requestedAudience }, funderAuthorityByClaimId) {
  const { rows } = await tx.query(
    `SELECT c.claim_id::text AS claim_id,
            c.statement AS claim_statement,
            c.claim_type,
            c.evidence_item_id::text AS evidence_item_id,
            c.internal_only,
            c.funder_use_allowed,
            c.public_use_allowed,
            e.source_id::text AS source_id,
            e.source_version_id::text AS source_version_id,
            f.intake_file_id::text AS intake_file_id,
            f.upload_state
       FROM kai.claims c
       JOIN kai.evidence_items e
         ON e.organization_id = c.organization_id
        AND e.evidence_item_id = c.evidence_item_id
       JOIN kai.source_versions sv
         ON sv.organization_id = e.organization_id
        AND sv.source_version_id = e.source_version_id
       JOIN kai.intake_source_candidates isc
         ON isc.organization_id = sv.organization_id
        AND isc.intake_source_candidate_id = sv.intake_source_candidate_id
       JOIN kai.intake_files f
         ON f.organization_id = isc.organization_id
        AND f.intake_file_id = isc.intake_file_id
      WHERE c.organization_id = $1::uuid
        AND c.claim_id = ANY($2::uuid[])
      ORDER BY c.claim_id ASC`,
    [organizationId, claimIds],
  );
  if (rows.length !== claimIds.length) return null;

  return rows.map((row) => ({
    claimId: row.claim_id,
    claimStatement: row.claim_statement,
    claimType: row.claim_type,
    evidenceItemId: row.evidence_item_id,
    sourceId: row.source_id,
    sourceVersionId: row.source_version_id,
    requestedAudience,
    limitationCodes: [],
    intakeFileId: row.intake_file_id,
    uploadState: row.upload_state,
    audienceAuthority: {
      internal: row.internal_only === true,
      // The funder key must reflect the exact same effective funder
      // authority verdict P2-06 (evaluateClaimTraceabilityInTransaction, via
      // approvalForAudience) already computed for this exact claim/audience
      // in the fresh per-claim evaluation this function's caller performed
      // just above it - never the legacy claims.funder_use_allowed column,
      // which is schema-pinned false and carries no authority. Only
      // computed when the request is actually for the funder audience;
      // internal/public generation never depend on this value (see
      // audienceAllowed in kaiGeneratedContentValidators.js).
      funder: requestedAudience === "funder"
        ? funderAuthorityByClaimId?.get(row.claim_id) === true
        : row.funder_use_allowed === true,
      public: row.public_use_allowed === true,
    },
  }));
}

function toGeneratorInput({ requestedAudience, projections, contentType }) {
  const input = {
    contentType,
    requestedAudience,
    claims: projections.map((claim) => ({
      claimId: claim.claimId,
      claimStatement: claim.claimStatement,
      claimType: claim.claimType,
      evidenceItemId: claim.evidenceItemId,
      sourceId: claim.sourceId,
      sourceVersionId: claim.sourceVersionId,
      limitationCodes: claim.limitationCodes,
    })),
  };
  if (!validateGeneratorInput(input)) throw new Error("invalid_generator_input_contract");
  return input;
}

async function persistCompleteSet(tx, { input, runId, generatorResult, validation, projections, contentType }) {
  const draftRows = await tx.query(
    `INSERT INTO kai.generated_content_drafts (
       generation_run_id, organization_id, content_type, requested_audience,
       draft_status, review_status, validator_results, created_by_type, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::jsonb,'system',$8::timestamptz)
     RETURNING generated_content_draft_id::text AS generated_content_draft_id`,
    [
      runId,
      input.organizationId,
      contentType,
      input.requestedAudience,
      DRAFT_STATUS,
      REVIEW_STATUS,
      JSON.stringify(validation.results),
      input.now,
    ],
  );
  const draftId = draftRows.rows[0].generated_content_draft_id;
  const blocks = [];
  for (const block of generatorResult.blocks) {
    const blockRows = await tx.query(
      `INSERT INTO kai.generated_content_blocks (
         generated_content_draft_id, organization_id, ordinal, text, created_at
       )
       VALUES ($1::uuid,$2::uuid,$3::int,$4,$5::timestamptz)
       RETURNING generated_content_block_id::text AS generated_content_block_id`,
      [draftId, input.organizationId, block.ordinal, block.text, input.now],
    );
    const blockId = blockRows.rows[0].generated_content_block_id;
    blocks.push({ blockId, ordinal: block.ordinal, text: block.text, citations: block.citations });
    for (const citation of block.citations) {
      await tx.query(
        `INSERT INTO kai.generated_content_citations (
           generated_content_block_id, organization_id, claim_id, evidence_item_id, created_at
         )
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::timestamptz)`,
        [blockId, input.organizationId, citation.claimId, citation.evidenceItemId, input.now],
      );
    }
  }
  const queueRows = await tx.query(
    `INSERT INTO kai.review_queue_items (
       organization_id, engagement_id, queue_type, target_object_type, target_object_id,
       priority, queue_status, review_status, blocked_reason, assigned_to, due_at,
       summary, required_action, queue_metadata, created_by, created_by_type, created_at, updated_at
     )
     VALUES ($1::uuid,NULL,$2,$3,$4::uuid,'medium','open',$5,NULL,NULL,NULL,$6,$7,'{}'::jsonb,NULL,'system',$8::timestamptz,$8::timestamptz)
     RETURNING review_queue_item_id::text AS review_queue_item_id`,
    [input.organizationId, REVIEW_QUEUE_TYPE, REVIEW_TARGET_TYPE, draftId, REVIEW_STATUS, REVIEW_SUMMARY, REVIEW_REQUIRED_ACTION, input.now],
  );
  return {
    generationRunId: runId,
    generatedContentDraftId: draftId,
    reviewQueueItemId: queueRows.rows[0].review_queue_item_id,
    blocks,
    auditIntakeFileId: projections[0].intakeFileId,
    auditUploadState: projections[0].uploadState,
  };
}

async function insertAudit(tx, { input, persisted, projections }) {
  await tx.query(
    `INSERT INTO kai.upload_lifecycle_audit (
       organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3,$4,$4,'success',$5::jsonb,$6::timestamptz)`,
    [
      input.organizationId,
      persisted.auditIntakeFileId,
      AUDIT_OPERATION,
      persisted.auditUploadState,
      JSON.stringify({
        metadata_only: true,
        contract: AUDIT_CONTRACT,
        generation_run_id: persisted.generationRunId,
        generated_content_draft_id: persisted.generatedContentDraftId,
        queue_type: REVIEW_QUEUE_TYPE,
        queue_status: "open",
        review_status: REVIEW_STATUS,
        requested_audience: input.requestedAudience,
        claim_count: projections.length,
        block_count: persisted.blocks.length,
        validator_keys: ["VAL-GEN-001", "VAL-GEN-002", "VAL-GEN-003", "VAL-GEN-004", "VAL-GEN-005"],
      }),
      input.now,
    ],
  );
}

function toResult(state, replayed = false) {
  const draft = state.drafts?.[0];
  const blocks = state.blocks || [];
  const citationsByBlock = new Map();
  for (const citation of state.citations || []) {
    if (!citationsByBlock.has(citation.generated_content_block_id)) citationsByBlock.set(citation.generated_content_block_id, []);
    citationsByBlock.get(citation.generated_content_block_id).push({
      claimId: citation.claim_id,
      evidenceItemId: citation.evidence_item_id,
    });
  }
  return {
    generationRunId: state.run.generation_run_id,
    generatedContentDraftId: draft.generated_content_draft_id,
    requestedAudience: draft.requested_audience,
    draftStatus: draft.draft_status,
    reviewStatus: draft.review_status,
    reviewQueueItemId: state.queues[0].review_queue_item_id,
    blocks: blocks.map((block) => ({
      ordinal: block.ordinal,
      text: block.text,
      citations: citationsByBlock.get(block.generated_content_block_id) || [],
    })),
    replayed,
  };
}

async function createGeneratedContentDraft(contentType, fingerprintRequest, input, dependencies, { runInTransaction, evaluator, afterPersist }) {
  if (!validateInput(input)) return failure("validation_blocker");
  if (contentType === IMPACT_NARRATIVE_CONTENT_TYPE && input.requestedAudience !== "internal") return failure("validation_blocker");
  if (typeof dependencies.draftGenerator !== "function") return failure("validation_blocker");
  if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");
  const requestFingerprint = fingerprintRequest(input);

  try {
    return await runInTransaction(async (tx) => {
      const reservation = await insertRunReservation(tx, input, requestFingerprint, contentType);
      if (!reservation) return rereadAsResult(tx, input, requestFingerprint, true, contentType);

      // Package 14-05: governed INTERNAL draft generation requires fresh
      // P2-06 traceability revalidation of every requested claim -- proof
      // that the transaction is still about the same governed claim and
      // evidence object -- but current audience/use eligibility
      // (result.data.eligible) is a separate, stricter downstream fact
      // and is intentionally NOT required here. `eligible=false` alone
      // must never reject INTERNAL draft creation.
      const traceabilityResults = [];
      for (const claimId of input.claimIds) {
        const result = await evaluator(tx, {
          organizationId: input.organizationId,
          claimId,
          requestedAudience: input.requestedAudience,
        });
        if (
          !result.ok
          || result.data?.requestedAudience !== input.requestedAudience
          || result.data?.claim?.claim_id !== claimId
          || !result.data?.evidence?.evidence_item_id
        ) {
          rollbackFailure(
            "validation_blocker",
            stageBlocker(TRACEABILITY_RESULT_CONTRACT_VALIDATOR_KEY, "traceability_result_contract_invalid"),
          );
        }
        traceabilityResults.push(result.data);
      }

      // Authority-source repair: derive generation-time funder audience
      // authority from the SAME fresh per-claim P2-06 result just computed
      // above, for this exact claim/requestedAudience - never from the
      // legacy claims.funder_use_allowed column. A claim's blockerCodes
      // excludes every AUDIENCE_AUTHORITY_BLOCKER_CODES entry if and only if
      // P2-06's approvalForAudience granted authority; this is a strictly
      // narrower signal than `eligible` (which also reflects unrelated
      // blockers such as evidence/coverage/follow-up state), so authority
      // and current-use eligibility remain distinct even though both derive
      // from the same evaluation.
      const funderAuthorityByClaimId = new Map(
        traceabilityResults.map((traceability) => [
          traceability.claim.claim_id,
          !AUDIENCE_AUTHORITY_BLOCKER_CODES.some((code) => (traceability.blockerCodes || []).includes(code)),
        ]),
      );

      // P14-09: governed FUNDER draft generation additionally requires every
      // requested claim's fresh P2-06 traceability evaluation (just above,
      // for this exact transaction) to be currently funder-eligible. Unlike
      // INTERNAL (Package 14-05, unchanged above), eligible=false must fail
      // closed here - before the generator is ever invoked - using the
      // authoritative evaluator result only (never libraryStatus, display
      // state, or blocker counts).
      if (
        input.requestedAudience === "funder"
        && !traceabilityResults.every((traceability) => traceability.eligible === true)
      ) {
        rollbackFailure("funder_use_not_currently_eligible");
      }

      const projections = await loadGenerationProjection(tx, input, funderAuthorityByClaimId);
      if (!projections) rollbackFailure("conflict_current_state_changed");
      const projectionByClaim = new Map(projections.map((claim) => [claim.claimId, claim]));
      const traceabilityByClaimId = new Map(traceabilityResults.map((traceability) => [traceability.claim.claim_id, traceability]));
      for (const traceability of traceabilityResults) {
        const projection = projectionByClaim.get(traceability.claim.claim_id);
        if (!projection || projection.evidenceItemId !== traceability.evidence.evidence_item_id) {
          rollbackFailure("conflict_current_state_changed");
        }
        // Preserve real current limitations/blockers into the existing
        // limitationCodes generator channel: an internally admitted but
        // currently ineligible claim must not have its blockers silently
        // erased. Deterministic ordering, de-duplicated, no fabrication.
        const blockerCodes = Array.isArray(traceability.blockerCodes) ? traceability.blockerCodes : [];
        projection.limitationCodes = [...new Set(blockerCodes)].sort();
      }

      const generatorInput = toGeneratorInput({ requestedAudience: input.requestedAudience, projections, contentType });
      const generatorResult = await dependencies.draftGenerator(generatorInput);
      const generatorResultClassification = classifyGeneratorResult(generatorResult);
      if (!generatorResultClassification.ok) {
        rollbackFailure(
          "validation_blocker",
          stageBlocker(GENERATOR_RESULT_CONTRACT_VALIDATOR_KEY, generatorResultClassification.reason),
        );
      }

      const validation = validateGeneratedContentDraft({
        requestedAudience: input.requestedAudience,
        generationClaims: projections.map((projection) => ({
          ...projection,
          revalidatedForGeneration: true,
          currentEligible: traceabilityByClaimId.get(projection.claimId)?.eligible === true,
        })),
        blocks: generatorResult.blocks,
        draftAudience: input.requestedAudience,
      });
      if (!validation.ok) rollbackFailure("validation_blocker", validation.blockers);

      // Post-generation revalidation remains a current-state/lineage
      // integrity check only: it must still fail closed if traceability
      // fails, or returns a different claim/evidence identity than the
      // object generation began against. It must NOT require
      // eligible=true, and must NOT convert eligible=false into true.
      for (const claim of projections) {
        const result = await evaluator(tx, {
          organizationId: input.organizationId,
          claimId: claim.claimId,
          requestedAudience: input.requestedAudience,
        });
        if (
          !result.ok
          || result.data?.claim?.claim_id !== claim.claimId
          || result.data?.evidence?.evidence_item_id !== claim.evidenceItemId
        ) {
          rollbackFailure("conflict_current_state_changed");
        }
        // P14-09: for FUNDER only, this same post-generation revalidation
        // pass must also fail closed (rolling back everything generated
        // above, before any persistence) if current funder eligibility was
        // lost between the pre-generation check and now. INTERNAL semantics
        // above remain untouched - eligible is not read for internal.
        if (input.requestedAudience === "funder" && result.data?.eligible !== true) {
          rollbackFailure("funder_use_not_currently_eligible");
        }
      }

      const persisted = await persistCompleteSet(tx, {
        input,
        runId: reservation.generation_run_id,
        generatorResult,
        validation,
        projections,
        contentType,
      });
      await afterPersist(tx, persisted);
      const postWrite = await rereadAsResult(tx, input, requestFingerprint, false, contentType);
      if (!postWrite.ok) throw new RollbackResultError(postWrite);

      const preparedAudit = prepareRequiredAudit(dependencies.metadataOnlyAudit, {
        attempted_operation: AUDIT_OPERATION,
        actor_type: "human",
        object_type: "generated_content_draft",
        request_scope: "organization_generated_content_draft",
        contract: AUDIT_CONTRACT,
        generated_content_draft_id: persisted.generatedContentDraftId,
      }, tx);
      await insertAudit(tx, { input, persisted, projections });
      await preparedAudit.publish();
      return postWrite;
    });
  } catch (error) {
    if (error instanceof RollbackResultError) return error.result;
    if (error?.code === "23505") return failure("conflict_current_state_changed");
    if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") {
      return failure(
        "validation_blocker",
        stageBlocker(PERSISTENCE_VALIDATION_VALIDATOR_KEY, "persistence_validation_rejected"),
      );
    }
    return failure("system_error");
  }
}

async function rereadAsResult(tx, input, requestFingerprint, replayed, contentType) {
  const state = await readExistingState(tx, input);
  const validation = validateExistingState(state, requestFingerprint, input.requestedAudience, contentType, input.engagementId);
  if (validation === "duplicate_conflict") return failure("duplicate_conflict");
  if (validation !== true) return failure("conflict_current_state_changed");
  return success(toResult(state, replayed));
}

export async function evaluateGeneratedDraftReviewPacketInTransaction(
  tx,
  input,
  evaluator = evaluateClaimTraceabilityInTransaction,
  { allowedLifecycleProfiles = [GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES[0]] } = {},
) {
  if (!validateReviewPacketInput(input)) return failure("validation_blocker");
  const state = await readReviewPacketState(tx, input);
  if (!state) return failure("not_found");
  const validation = validateReviewPacketRows(state, input, allowedLifecycleProfiles);
  if (validation === "system_error") return failure("system_error");
  if (validation === false) return failure("conflict_current_state_changed");
  return toReviewPacket(tx, state, input, validation, evaluator);
}

// Grant Response Packet membership resolves EXCLUSIVELY through
// generation_runs.engagement_id (never latest/newest/preferred draft
// selection, never browser state). A generation run with engagement_id
// IS NULL is real, permanent legacy state per the P14-01 migration comment
// - plain equality against $2::uuid already never matches NULL, so legacy
// runs are excluded here without any special-case guess. An engagementId
// belonging to a different organization_id, or that does not exist at all,
// resolves to zero membership rows below (never a cross-tenant read),
// and is rejected up front as not_found so callers cannot distinguish
// "empty engagement" from "wrong tenant" by response shape alone.
async function loadGrantResponsePacketEngagement(tx, { organizationId, engagementId }) {
  const { rows } = await tx.query(
    `SELECT engagement_id::text AS engagement_id, organization_id::text AS organization_id
       FROM kai.engagements
      WHERE organization_id = $1::uuid
        AND engagement_id = $2::uuid`,
    [organizationId, engagementId],
  );
  return rows[0] || null;
}

async function loadGrantResponsePacketMemberDraftIds(tx, { organizationId, engagementId }) {
  const { rows } = await tx.query(
    `SELECT d.generated_content_draft_id::text AS generated_content_draft_id
       FROM kai.generated_content_drafts d
       JOIN kai.generation_runs r
         ON r.generation_run_id = d.generation_run_id
        AND r.organization_id = d.organization_id
      WHERE d.organization_id = $1::uuid
        AND r.engagement_id = $2::uuid
        AND d.content_type = ANY($3::text[])
        AND d.draft_status = $4
        AND d.requested_audience = $5
      ORDER BY d.generated_content_draft_id ASC`,
    [organizationId, engagementId, [...ALLOWED_GENERATED_CONTENT_TYPES], DRAFT_STATUS, GRANT_RESPONSE_PACKET_AUDIENCE],
  );
  return rows.map((row) => row.generated_content_draft_id);
}

async function loadExportReviewQueueRowsBatch(tx, { organizationId, generatedContentDraftIds }) {
  if (generatedContentDraftIds.length === 0) return [];
  const { rows } = await tx.query(
    `SELECT review_queue_item_id::text AS review_queue_item_id,
            organization_id::text AS organization_id, queue_type, target_object_type,
            target_object_id::text AS target_object_id, priority, queue_status, review_status,
            blocked_reason, assigned_to::text AS assigned_to, due_at, summary, required_action,
            queue_metadata, created_by::text AS created_by, created_by_type
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND queue_type = $2
        AND target_object_type = $3
        AND target_object_id = ANY($4::uuid[])`,
    [organizationId, EXPORT_REVIEW_QUEUE_TYPE, EXPORT_REVIEW_TARGET_TYPE, generatedContentDraftIds],
  );
  return rows;
}

// Bounded/batched replacement for the per-draft read-packet fan-out: exactly
// the same six row groups readReviewPacketState reads for one draft
// (draft/run/siblingDrafts/blocks/citations/queues/exportReviewQueues), read
// once each across every member draft id via `= ANY($ids::uuid[])` instead
// of once per draft. Query count stays fixed regardless of membership size.
// Returns a Map keyed by generated_content_draft_id, each value shaped
// identically to readReviewPacketState's per-draft return so the existing
// validateReviewPacketRows/toReviewPacket validators need no second
// contract.
async function readReviewPacketStatesBatch(tx, { organizationId, generatedContentDraftIds }) {
  const statesByDraftId = new Map();
  if (generatedContentDraftIds.length === 0) return statesByDraftId;

  const draftRows = await tx.query(
    `SELECT generated_content_draft_id::text AS generated_content_draft_id,
            generation_run_id::text AS generation_run_id, organization_id::text AS organization_id,
            content_type, requested_audience, draft_status, review_status
       FROM kai.generated_content_drafts
      WHERE organization_id = $1::uuid
        AND generated_content_draft_id = ANY($2::uuid[])`,
    [organizationId, generatedContentDraftIds],
  );
  const draftsById = new Map(draftRows.rows.map((row) => [row.generated_content_draft_id, row]));
  if (draftsById.size === 0) return statesByDraftId;
  const memberDraftIds = [...draftsById.keys()];

  const runIds = [...new Set(draftRows.rows.map((row) => row.generation_run_id))];
  const runRows = await tx.query(
    `SELECT generation_run_id::text AS generation_run_id,
            organization_id::text AS organization_id, engagement_id::text AS engagement_id,
            request_fingerprint, content_type, requested_audience
       FROM kai.generation_runs
      WHERE generation_run_id = ANY($1::uuid[])`,
    [runIds],
  );
  const runsById = new Map(runRows.rows.map((row) => [row.generation_run_id, row]));

  const siblingDraftRows = await tx.query(
    `SELECT generated_content_draft_id::text AS generated_content_draft_id,
            generation_run_id::text AS generation_run_id, organization_id::text AS organization_id,
            content_type, requested_audience, draft_status, review_status
       FROM kai.generated_content_drafts
      WHERE generation_run_id = ANY($1::uuid[])
      ORDER BY generation_run_id ASC, generated_content_draft_id ASC`,
    [runIds],
  );
  const siblingDraftsByRunId = new Map();
  for (const row of siblingDraftRows.rows) {
    if (!siblingDraftsByRunId.has(row.generation_run_id)) siblingDraftsByRunId.set(row.generation_run_id, []);
    siblingDraftsByRunId.get(row.generation_run_id).push(row);
  }

  const blockRows = await tx.query(
    `SELECT generated_content_block_id::text AS generated_content_block_id,
            generated_content_draft_id::text AS generated_content_draft_id,
            organization_id::text AS organization_id, ordinal, text
       FROM kai.generated_content_blocks
      WHERE generated_content_draft_id = ANY($1::uuid[])
      ORDER BY generated_content_draft_id ASC, ordinal ASC, generated_content_block_id ASC`,
    [memberDraftIds],
  );
  const blocksByDraftId = new Map();
  for (const row of blockRows.rows) {
    if (!blocksByDraftId.has(row.generated_content_draft_id)) blocksByDraftId.set(row.generated_content_draft_id, []);
    blocksByDraftId.get(row.generated_content_draft_id).push(row);
  }

  const blockIds = blockRows.rows.map((row) => row.generated_content_block_id);
  const citationRows = blockIds.length === 0
    ? { rows: [] }
    : await tx.query(
        `SELECT c.generated_content_citation_id::text AS generated_content_citation_id,
                c.generated_content_block_id::text AS generated_content_block_id,
                c.organization_id::text AS organization_id,
                c.claim_id::text AS claim_id,
                c.evidence_item_id::text AS evidence_item_id,
                b.ordinal AS block_ordinal
           FROM kai.generated_content_citations c
           JOIN kai.generated_content_blocks b
             ON b.generated_content_block_id = c.generated_content_block_id
          WHERE c.generated_content_block_id = ANY($1::uuid[])
          ORDER BY b.ordinal ASC, c.claim_id ASC, c.evidence_item_id ASC, c.generated_content_citation_id ASC`,
        [blockIds],
      );
  const citationsByBlockId = new Map();
  for (const row of citationRows.rows) {
    if (!citationsByBlockId.has(row.generated_content_block_id)) citationsByBlockId.set(row.generated_content_block_id, []);
    citationsByBlockId.get(row.generated_content_block_id).push(row);
  }

  const queueRows = await tx.query(
    `SELECT review_queue_item_id::text AS review_queue_item_id,
            organization_id::text AS organization_id, queue_type, target_object_type,
            target_object_id::text AS target_object_id, priority, queue_status,
            review_status, assigned_to, due_at, summary, required_action,
            updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND target_object_type = $2
        AND target_object_id = ANY($3::uuid[])
        AND queue_type = $4
      ORDER BY target_object_id ASC, review_queue_item_id ASC`,
    [organizationId, REVIEW_TARGET_TYPE, memberDraftIds, REVIEW_QUEUE_TYPE],
  );
  const queuesByDraftId = new Map();
  for (const row of queueRows.rows) {
    if (!queuesByDraftId.has(row.target_object_id)) queuesByDraftId.set(row.target_object_id, []);
    queuesByDraftId.get(row.target_object_id).push(row);
  }

  const exportReviewQueueRows = await loadExportReviewQueueRowsBatch(tx, { organizationId, generatedContentDraftIds: memberDraftIds });
  const exportReviewQueuesByDraftId = new Map();
  for (const row of exportReviewQueueRows) {
    if (!exportReviewQueuesByDraftId.has(row.target_object_id)) exportReviewQueuesByDraftId.set(row.target_object_id, []);
    exportReviewQueuesByDraftId.get(row.target_object_id).push(row);
  }

  for (const [draftId, draft] of draftsById.entries()) {
    const blocks = blocksByDraftId.get(draftId) || [];
    statesByDraftId.set(draftId, {
      run: runsById.get(draft.generation_run_id) || null,
      draft,
      siblingDrafts: siblingDraftsByRunId.get(draft.generation_run_id) || [],
      blocks,
      citations: blocks.flatMap((block) => citationsByBlockId.get(block.generated_content_block_id) || []),
      queues: queuesByDraftId.get(draftId) || [],
      exportReviewQueues: exportReviewQueuesByDraftId.get(draftId) || [],
    });
  }

  return statesByDraftId;
}

// toReviewPacket's own per-draft evaluator memoization (evaluatedByClaim)
// only dedupes repeat citations of the same claim within one draft - it
// does not see across drafts. A claim cited by more than one member draft
// in the same engagement would otherwise be re-evaluated once per citing
// draft. Because the whole membership read runs inside one
// REPEATABLE READ READ ONLY transaction, evaluator(tx, {claimId,
// requestedAudience}) is a pure function of that fixed snapshot - reusing
// a prior result for the same (claimId, requestedAudience) pair across
// drafts is exactly the same read, never a weaker or staler one. This
// wrapper is the only cross-draft reuse added; the evaluator's own
// authoritative per-claim traceability computation is untouched.
function memoizeEvaluatorAcrossDrafts(evaluator) {
  const cache = new Map();
  return async (tx, args) => {
    const key = `${args.claimId}::${args.requestedAudience}`;
    if (cache.has(key)) return cache.get(key);
    const result = await evaluator(tx, args);
    cache.set(key, result);
    return result;
  };
}

// Reuses the exact same governed single-draft packet validators/projection
// (validateReviewPacketRows/toReviewPacket - review status, queue status,
// per-citation current-use eligibility/blocker codes) this file already
// authoritatively computes for the P3-02 review-packet read - no second
// eligibility vocabulary. A draft is packet-eligible only when its
// generated_content_review queue is fully resolved (the
// GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES[2] "resolved/resolved"
// profile) and every one of its cited claims is currently eligible
// (currentUseEligible === true, the same blocked/superseded-evidence gate
// toReviewPacket already enforces) - blocked or not-yet-reviewed content
// can never become valid packet membership. State is read once, batched
// across every member draft id (readReviewPacketStatesBatch) rather than
// once per draft, so query count never scales with membership size.
// The claim-traceability evaluator invoked by toReviewPacket is NOT part
// of that batched structural read - it authoritatively recomputes
// current-use eligibility per unique claim id and still does real,
// non-batchable SQL work per claim (see
// postgresClaimTraceabilityRepository.js). This function reuses that
// exact evaluator unmodified (no weaker eligibility rule) but shares one
// memoized wrapper across every member draft in the loop below so a claim
// cited by multiple drafts in the same engagement is evaluated at most
// once per packet read, never once per citing draft.
// Per-member export-manifest identity/history recovery (export/reuse
// foundation): reuses the exact P3-20 durable-read functions the single-
// draft export-review packet already exposes
// (loadExportManifestIdentityForReviewQueueItemInTransaction /
// loadExportManifestHistoryForReviewQueueItemInTransaction) - never a new
// manifest lookup, never a latest/current selection, never a query when a
// member has no exportReviewQueueItemId at all (nothing has been submitted
// for export review yet, so there is nothing to recover). Reads happen in
// the SAME REPEATABLE READ READ ONLY transaction as the rest of the
// membership scan - an exact snapshot-consistent recovery, not a separate
// best-effort follow-up.
async function loadPacketMemberExportManifestLinkage(tx, { organizationId, exportReviewQueueItemId }, manifestReaders) {
  if (exportReviewQueueItemId === null) return { exportManifestId: null, exportManifestHistory: [] };
  const identity = await manifestReaders.loadManifestIdentity(tx, { organizationId, exportReviewQueueItemId });
  const history = await manifestReaders.loadManifestHistory(tx, { organizationId, exportReviewQueueItemId });
  return {
    exportManifestId: identity?.exportManifestId ?? null,
    exportManifestHistory: history?.exportManifestHistory ?? [],
  };
}

const DEFAULT_GRANT_RESPONSE_PACKET_MANIFEST_READERS = Object.freeze({
  loadManifestIdentity: loadExportManifestIdentityForReviewQueueItemInTransaction,
  loadManifestHistory: loadExportManifestHistoryForReviewQueueItemInTransaction,
});

export async function evaluateGrantResponsePacketMembershipInTransaction(
  tx,
  input,
  evaluator = evaluateClaimTraceabilityInTransaction,
  manifestReaders = DEFAULT_GRANT_RESPONSE_PACKET_MANIFEST_READERS,
) {
  if (!validateGrantResponsePacketMembershipInput(input)) return failure("validation_blocker");
  const { organizationId, engagementId } = input;

  const engagement = await loadGrantResponsePacketEngagement(tx, { organizationId, engagementId });
  if (!engagement) return failure("not_found");

  const draftIds = await loadGrantResponsePacketMemberDraftIds(tx, { organizationId, engagementId });
  const statesByDraftId = await readReviewPacketStatesBatch(tx, { organizationId, generatedContentDraftIds: draftIds });
  const memoizedEvaluator = memoizeEvaluatorAcrossDrafts(evaluator);

  const drafts = [];
  for (const generatedContentDraftId of draftIds) {
    const state = statesByDraftId.get(generatedContentDraftId);
    if (!state) continue;
    const validation = validateReviewPacketRows(
      state,
      { organizationId, generatedContentDraftId },
      GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES,
    );
    if (validation === "system_error") return failure("system_error");
    // Matches the single-draft review-packet read's own validation
    // contract exactly: a structurally invalid draft/queue graph is a
    // conflict_current_state_changed failure that aborts the whole
    // membership evaluation, never a silent per-draft skip - only a
    // genuinely absent draft (handled by the `!state` check above) is
    // skipped.
    if (validation === false) return failure("conflict_current_state_changed");

    const packetResult = await toReviewPacket(tx, state, { organizationId, generatedContentDraftId }, validation, memoizedEvaluator);
    if (!packetResult.ok) return packetResult;
    const packet = packetResult.data;
    const resolvedProfile = GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES[2];
    if (packet.queueStatus !== resolvedProfile.queueStatus || packet.reviewStatus !== resolvedProfile.reviewStatus) continue;
    if (packet.currentUseEligible !== true) continue;
    const manifestLinkage = await loadPacketMemberExportManifestLinkage(
      tx,
      { organizationId, exportReviewQueueItemId: packet.exportReviewQueueItemId },
      manifestReaders,
    );
    drafts.push({ ...packet, ...manifestLinkage });
  }

  return success({ organizationId, engagementId, packetAudience: GRANT_RESPONSE_PACKET_AUDIENCE, drafts });
}

async function lockImmutableDraftRoot(tx, { organizationId, generatedContentDraftId }) {
  const { rows } = await tx.query(
    `SELECT generated_content_draft_id::text AS generated_content_draft_id
       FROM kai.generated_content_drafts
      WHERE organization_id = $1::uuid AND generated_content_draft_id = $2::uuid
      FOR UPDATE`,
    [organizationId, generatedContentDraftId],
  );
  return rows.length > 0;
}

async function loadReviewQueueItemById(tx, reviewQueueItemId) {
  const { rows } = await tx.query(
    `SELECT review_queue_item_id::text AS review_queue_item_id,
            organization_id::text AS organization_id,
            queue_type, target_object_type,
            target_object_id::text AS target_object_id,
            queue_status, review_status
       FROM kai.review_queue_items
      WHERE review_queue_item_id = $1::uuid`,
    [reviewQueueItemId],
  );
  return rows[0] || null;
}

function isExactReviewQueueTarget(queueRow, { organizationId, generatedContentDraftId }) {
  return Boolean(queueRow)
    && queueRow.organization_id === organizationId
    && queueRow.queue_type === REVIEW_QUEUE_TYPE
    && queueRow.target_object_type === REVIEW_TARGET_TYPE
    && queueRow.target_object_id === generatedContentDraftId;
}

function toCompleteReviewResult(packet, replayed) {
  return {
    generationRunId: packet.generationRunId,
    generatedContentDraftId: packet.generatedContentDraftId,
    reviewQueueItemId: packet.reviewQueueItemId,
    draftStatus: packet.draftStatus,
    queueStatus: packet.queueStatus,
    reviewStatus: packet.reviewStatus,
    replayed,
  };
}

function toStartReviewResult(packet, replayed) {
  return {
    generationRunId: packet.generationRunId,
    generatedContentDraftId: packet.generatedContentDraftId,
    reviewQueueItemId: packet.reviewQueueItemId,
    draftStatus: packet.draftStatus,
    queueStatus: packet.queueStatus,
    reviewStatus: packet.reviewStatus,
    replayed,
  };
}

function buildGeneratedContentStartReviewAuditMetadata({ input, packet, previousQueueStatus, previousReviewStatus }) {
  return {
    contract: START_REVIEW_AUDIT_CONTRACT,
    organization_id: input.organizationId,
    generation_run_id: packet.generationRunId,
    generated_content_draft_id: input.generatedContentDraftId,
    review_queue_item_id: input.reviewQueueItemId,
    actor_id: input.actorContext.actorUserId,
    actor_type: "human",
    expected_updated_at: input.expectedUpdatedAt,
    requested_start_timestamp: input.now,
    previous_queue_status: previousQueueStatus,
    resulting_queue_status: START_REVIEW_IN_PROGRESS_PROFILE.queueStatus,
    previous_review_status: previousReviewStatus,
    resulting_review_status: START_REVIEW_IN_PROGRESS_PROFILE.reviewStatus,
    validator_keys: START_REVIEW_VALIDATOR_KEYS,
  };
}

function buildCompleteReviewAuditMetadata({ input, packet, previousQueueStatus, previousReviewStatus }) {
  return {
    contract: COMPLETE_REVIEW_AUDIT_CONTRACT,
    organization_id: input.organizationId,
    generation_run_id: packet.generationRunId,
    generated_content_draft_id: input.generatedContentDraftId,
    review_queue_item_id: input.reviewQueueItemId,
    actor_id: input.actorContext.actorUserId,
    actor_type: "human",
    expected_updated_at: input.expectedUpdatedAt,
    requested_completion_timestamp: input.now,
    previous_queue_status: previousQueueStatus,
    resulting_queue_status: COMPLETE_REVIEW_RESOLVED_PROFILE.queueStatus,
    previous_review_status: previousReviewStatus,
    resulting_review_status: COMPLETE_REVIEW_RESOLVED_PROFILE.reviewStatus,
    validator_keys: COMPLETE_REVIEW_VALIDATOR_KEYS,
  };
}

async function loadAuditFileContext(tx, { organizationId, generatedContentDraftId }) {
  const { rows } = await tx.query(
    `SELECT f.intake_file_id::text AS intake_file_id, f.upload_state
       FROM kai.generated_content_blocks b
       JOIN kai.generated_content_citations c
         ON c.generated_content_block_id = b.generated_content_block_id
       JOIN kai.claims cl
         ON cl.organization_id = c.organization_id AND cl.claim_id = c.claim_id
       JOIN kai.evidence_items e
         ON e.organization_id = cl.organization_id AND e.evidence_item_id = cl.evidence_item_id
       JOIN kai.source_versions sv
         ON sv.organization_id = e.organization_id AND sv.source_version_id = e.source_version_id
       JOIN kai.intake_source_candidates isc
         ON isc.organization_id = sv.organization_id AND isc.intake_source_candidate_id = sv.intake_source_candidate_id
       JOIN kai.intake_files f
         ON f.organization_id = isc.organization_id AND f.intake_file_id = isc.intake_file_id
      WHERE b.organization_id = $1::uuid AND b.generated_content_draft_id = $2::uuid
      ORDER BY b.ordinal ASC, c.claim_id ASC
      LIMIT 1`,
    [organizationId, generatedContentDraftId],
  );
  return rows[0] || null;
}

async function insertCompleteReviewAudit(tx, { input, packet, auditFileContext }) {
  await tx.query(
    `INSERT INTO kai.upload_lifecycle_audit (
       organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3,$4,$4,'success',$5::jsonb,$6::timestamptz)`,
    [
      input.organizationId,
      auditFileContext.intake_file_id,
      COMPLETE_REVIEW_AUDIT_OPERATION,
      auditFileContext.upload_state,
      JSON.stringify(buildCompleteReviewAuditMetadata({
        input,
        packet,
        previousQueueStatus: COMPLETE_REVIEW_FRESH_PROFILE.queueStatus,
        previousReviewStatus: COMPLETE_REVIEW_FRESH_PROFILE.reviewStatus,
      })),
      input.now,
    ],
  );
}

async function insertGeneratedContentStartReviewAudit(tx, { input, packet, auditFileContext }) {
  await tx.query(
    `INSERT INTO kai.upload_lifecycle_audit (
       organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3,$4,$4,'success',$5::jsonb,$6::timestamptz)`,
    [
      input.organizationId,
      auditFileContext.intake_file_id,
      START_REVIEW_AUDIT_OPERATION,
      auditFileContext.upload_state,
      JSON.stringify(buildGeneratedContentStartReviewAuditMetadata({
        input,
        packet,
        previousQueueStatus: START_REVIEW_FRESH_PROFILE.queueStatus,
        previousReviewStatus: START_REVIEW_FRESH_PROFILE.reviewStatus,
      })),
      input.now,
    ],
  );
}

function auditMetadataMatchesGeneratedContentStart(metadata, { input, packet }) {
  return metadata
    && metadata.generation_run_id === packet.generationRunId
    && metadata.generated_content_draft_id === input.generatedContentDraftId
    && metadata.review_queue_item_id === input.reviewQueueItemId
    && metadata.actor_id === input.actorContext.actorUserId
    && metadata.actor_type === "human"
    && metadata.expected_updated_at === input.expectedUpdatedAt
    && metadata.requested_start_timestamp === input.now
    && metadata.previous_queue_status === START_REVIEW_FRESH_PROFILE.queueStatus
    && metadata.resulting_queue_status === START_REVIEW_IN_PROGRESS_PROFILE.queueStatus
    && metadata.previous_review_status === START_REVIEW_FRESH_PROFILE.reviewStatus
    && metadata.resulting_review_status === START_REVIEW_IN_PROGRESS_PROFILE.reviewStatus;
}

async function findMatchingGeneratedContentStartReviewAudit(tx, { input, packet }) {
  const { rows } = await tx.query(
    `SELECT metadata
       FROM kai.upload_lifecycle_audit
      WHERE organization_id = $1::uuid
        AND operation = $2
        AND outcome = 'success'
        AND metadata->>'generated_content_draft_id' = $3
        AND metadata->>'review_queue_item_id' = $4`,
    [input.organizationId, START_REVIEW_AUDIT_OPERATION, input.generatedContentDraftId, input.reviewQueueItemId],
  );
  const matches = rows.filter((row) => auditMetadataMatchesGeneratedContentStart(row.metadata, { input, packet }));
  return matches.length === 1;
}

function auditMetadataMatchesCompletion(metadata, { input, packet }) {
  return metadata
    && metadata.generation_run_id === packet.generationRunId
    && metadata.generated_content_draft_id === input.generatedContentDraftId
    && metadata.review_queue_item_id === input.reviewQueueItemId
    && metadata.actor_id === input.actorContext.actorUserId
    && metadata.actor_type === "human"
    && metadata.expected_updated_at === input.expectedUpdatedAt
    && metadata.requested_completion_timestamp === input.now
    && metadata.previous_queue_status === COMPLETE_REVIEW_FRESH_PROFILE.queueStatus
    && metadata.resulting_queue_status === COMPLETE_REVIEW_RESOLVED_PROFILE.queueStatus
    && metadata.previous_review_status === COMPLETE_REVIEW_FRESH_PROFILE.reviewStatus
    && metadata.resulting_review_status === COMPLETE_REVIEW_RESOLVED_PROFILE.reviewStatus;
}

async function findMatchingCompletionAudit(tx, { input, packet }) {
  const { rows } = await tx.query(
    `SELECT metadata
       FROM kai.upload_lifecycle_audit
      WHERE organization_id = $1::uuid
        AND operation = $2
        AND outcome = 'success'
        AND metadata->>'generated_content_draft_id' = $3
        AND metadata->>'review_queue_item_id' = $4`,
    [input.organizationId, COMPLETE_REVIEW_AUDIT_OPERATION, input.generatedContentDraftId, input.reviewQueueItemId],
  );
  const matches = rows.filter((row) => auditMetadataMatchesCompletion(row.metadata, { input, packet }));
  return matches.length === 1;
}

async function evaluateCompleteReviewReplayOrConflict(tx, input, evaluator) {
  const packetResult = await evaluateGeneratedDraftReviewPacketInTransaction(
    tx,
    { organizationId: input.organizationId, generatedContentDraftId: input.generatedContentDraftId },
    evaluator,
    { allowedLifecycleProfiles: GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES },
  );
  if (!packetResult.ok) {
    return packetResult.error.code === "not_found" ? failure("not_found") : failure("conflict_current_state_changed");
  }
  const packet = packetResult.data;
  if (packet.reviewQueueItemId !== input.reviewQueueItemId) return failure("conflict_current_state_changed");
  if (
    packet.queueStatus !== COMPLETE_REVIEW_RESOLVED_PROFILE.queueStatus ||
    packet.reviewStatus !== COMPLETE_REVIEW_RESOLVED_PROFILE.reviewStatus
  ) {
    return failure("conflict_current_state_changed");
  }
  const hasMatchingAudit = await findMatchingCompletionAudit(tx, { input, packet });
  if (!hasMatchingAudit) return failure("conflict_current_state_changed");
  return success(toCompleteReviewResult(packet, true));
}

async function evaluateStartReviewReplayOrConflict(tx, input, evaluator) {
  const packetResult = await evaluateGeneratedDraftReviewPacketInTransaction(
    tx,
    { organizationId: input.organizationId, generatedContentDraftId: input.generatedContentDraftId },
    evaluator,
    { allowedLifecycleProfiles: GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES },
  );
  if (!packetResult.ok) {
    return packetResult.error.code === "not_found" ? failure("not_found") : failure("conflict_current_state_changed");
  }
  const packet = packetResult.data;
  if (packet.reviewQueueItemId !== input.reviewQueueItemId) return failure("conflict_current_state_changed");
  if (
    packet.queueStatus !== START_REVIEW_IN_PROGRESS_PROFILE.queueStatus ||
    packet.reviewStatus !== START_REVIEW_IN_PROGRESS_PROFILE.reviewStatus
  ) {
    return failure("conflict_current_state_changed");
  }
  const hasMatchingAudit = await findMatchingGeneratedContentStartReviewAudit(tx, { input, packet });
  if (!hasMatchingAudit) return failure("conflict_current_state_changed");
  return success(toStartReviewResult(packet, true));
}

function validateRequestExportReviewInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "generatedContentDraftId",
    "requestedExportAudience",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.generatedContentDraftId)
    && AUDIENCES.has(input.requestedExportAudience)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

function validateExportReviewRequestStateInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "generatedContentDraftId",
    "exportReviewQueueItemId",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.generatedContentDraftId)
    && UUID_PATTERN.test(input.exportReviewQueueItemId);
}

async function loadExportReviewQueueRows(tx, { organizationId, generatedContentDraftId }) {
  const { rows } = await tx.query(
    `SELECT review_queue_item_id::text AS review_queue_item_id,
            organization_id::text AS organization_id, queue_type, target_object_type,
            target_object_id::text AS target_object_id, priority, queue_status, review_status,
            blocked_reason, assigned_to::text AS assigned_to, due_at, summary, required_action,
            queue_metadata, created_by::text AS created_by, created_by_type
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND queue_type = $2
        AND target_object_type = $3
        AND target_object_id = $4::uuid`,
    [organizationId, EXPORT_REVIEW_QUEUE_TYPE, EXPORT_REVIEW_TARGET_TYPE, generatedContentDraftId],
  );
  return rows;
}

async function loadExportReviewQueueRowById(tx, { organizationId, exportReviewQueueItemId }) {
  const { rows } = await tx.query(
    `SELECT review_queue_item_id::text AS review_queue_item_id,
            organization_id::text AS organization_id, queue_type, target_object_type,
            target_object_id::text AS target_object_id, priority, queue_status, review_status,
            blocked_reason, assigned_to::text AS assigned_to, due_at, summary, required_action,
            queue_metadata, created_by::text AS created_by, created_by_type, updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND review_queue_item_id = $2::uuid`,
    [organizationId, exportReviewQueueItemId],
  );
  return rows[0] || null;
}

function buildCanonicalExportReviewValidatorResult(generatedContentDraftId) {
  const contract = __exportManifestEligibilityValidatorContract;
  return {
    validator_key: contract.VALIDATOR_KEY,
    severity: "blocker",
    object_type: contract.OBJECT_TYPE,
    object_code: contract.OBJECT_CODE,
    object_id: generatedContentDraftId,
    message: "Export manifest eligibility gates failed.",
    blocking_reason: contract.BLOCKING_REASON,
    required_fix: null,
    evidence: { failed_gates: [...EXPORT_REVIEW_READINESS_FAILED_GATES] },
  };
}

async function evaluateExportReviewReadiness(tx, input, evaluator) {
  const packetResult = await evaluateGeneratedDraftReviewPacketInTransaction(
    tx,
    { organizationId: input.organizationId, generatedContentDraftId: input.generatedContentDraftId },
    evaluator,
    { allowedLifecycleProfiles: [COMPLETE_REVIEW_RESOLVED_PROFILE] },
  );
  if (!packetResult.ok) {
    return { ok: false, code: packetResult.error.code === "not_found" ? "not_found" : "conflict_current_state_changed" };
  }
  const packet = packetResult.data;
  const validatorResult = validateExportManifestEligibility({
    generatedContentDraftId: input.generatedContentDraftId,
    requestedExportAudience: input.requestedExportAudience,
    draftAudience: packet.requestedAudience,
    draftIsStillDraft: packet.draftStatus === "draft",
    reviewIsResolved: packet.queueStatus === "resolved" && packet.reviewStatus === "resolved",
    currentUseEligible: packet.currentUseEligible === true,
    finalGate: false,
    affirmativeHumanExportAuthority: false,
  });
  const failedGates = validatorResult.evidence?.failed_gates || [];
  const ready = failedGates.length === EXPORT_REVIEW_READINESS_FAILED_GATES.length
    && EXPORT_REVIEW_READINESS_FAILED_GATES.every((code) => failedGates.includes(code))
    && input.requestedExportAudience === packet.requestedAudience;
  return { ok: true, packet, validatorResult, ready };
}

function toBlockedExportReviewResult(input, validatorResult) {
  return {
    generatedContentDraftId: input.generatedContentDraftId,
    requestedExportAudience: input.requestedExportAudience,
    exportReviewRequestAccepted: false,
    replayed: false,
    reviewQueueItemId: null,
    queueStatus: null,
    reviewStatus: null,
    validatorResult,
  };
}

function toAcceptedExportReviewResult(input, reviewQueueItemId, replayed, validatorResult) {
  return {
    generatedContentDraftId: input.generatedContentDraftId,
    requestedExportAudience: input.requestedExportAudience,
    exportReviewRequestAccepted: true,
    replayed,
    reviewQueueItemId,
    queueStatus: EXPORT_REVIEW_QUEUE_STATUS,
    reviewStatus: EXPORT_REVIEW_REVIEW_STATUS,
    validatorResult,
  };
}

function buildExportReviewAuditMetadata({ input, reviewQueueItemId }) {
  return {
    contract: EXPORT_REVIEW_AUDIT_CONTRACT,
    organization_id: input.organizationId,
    generated_content_draft_id: input.generatedContentDraftId,
    review_queue_item_id: reviewQueueItemId,
    requested_export_audience: input.requestedExportAudience,
    actor_id: input.actorContext.actorUserId,
    actor_type: "human",
    requested_timestamp: input.now,
    validator_key: __exportManifestEligibilityValidatorContract.VALIDATOR_KEY,
    failed_gates: [...EXPORT_REVIEW_READINESS_FAILED_GATES],
  };
}

async function insertExportReviewAudit(tx, { input, auditFileContext, reviewQueueItemId }) {
  await tx.query(
    `INSERT INTO kai.upload_lifecycle_audit (
       organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3,$4,$4,'success',$5::jsonb,$6::timestamptz)`,
    [
      input.organizationId,
      auditFileContext.intake_file_id,
      EXPORT_REVIEW_AUDIT_OPERATION,
      auditFileContext.upload_state,
      JSON.stringify(buildExportReviewAuditMetadata({ input, reviewQueueItemId })),
      input.now,
    ],
  );
}

function auditMetadataMatchesExportReview(metadata, { input, reviewQueueItemId }) {
  return metadata
    && metadata.contract === EXPORT_REVIEW_AUDIT_CONTRACT
    && metadata.organization_id === input.organizationId
    && metadata.generated_content_draft_id === input.generatedContentDraftId
    && metadata.review_queue_item_id === reviewQueueItemId
    && metadata.requested_export_audience === input.requestedExportAudience
    && metadata.actor_type === "human"
    && typeof metadata.actor_id === "string" && metadata.actor_id.length > 0
    && isCanonicalUtcTimestamp(metadata.requested_timestamp)
    && metadata.validator_key === __exportManifestEligibilityValidatorContract.VALIDATOR_KEY
    && Array.isArray(metadata.failed_gates)
    && metadata.failed_gates.length === EXPORT_REVIEW_READINESS_FAILED_GATES.length
    && EXPORT_REVIEW_READINESS_FAILED_GATES.every((code, index) => metadata.failed_gates[index] === code);
}

async function findMatchingExportReviewAudit(tx, { input, reviewQueueItemId }) {
  const { rows } = await tx.query(
    `SELECT metadata
       FROM kai.upload_lifecycle_audit
      WHERE organization_id = $1::uuid
        AND operation = $2
        AND outcome = 'success'
        AND metadata->>'generated_content_draft_id' = $3
        AND metadata->>'review_queue_item_id' = $4`,
    [input.organizationId, EXPORT_REVIEW_AUDIT_OPERATION, input.generatedContentDraftId, reviewQueueItemId],
  );
  const matches = rows.filter((row) => auditMetadataMatchesExportReview(row.metadata, { input, reviewQueueItemId }));
  return matches.length === 1;
}

async function replayExportReviewFromExistingRow(tx, input, existingRow) {
  if (!isExportReviewQueueContractRow(existingRow, {
    organizationId: input.organizationId,
    targetObjectId: input.generatedContentDraftId,
  })) {
    return failure("conflict_current_state_changed");
  }
  const reviewQueueItemId = existingRow.review_queue_item_id;
  const hasMatchingAudit = await findMatchingExportReviewAudit(tx, { input, reviewQueueItemId });
  if (!hasMatchingAudit) return failure("conflict_current_state_changed");
  return success(toAcceptedExportReviewResult(
    input,
    reviewQueueItemId,
    true,
    buildCanonicalExportReviewValidatorResult(input.generatedContentDraftId),
  ));
}

function validateStartExportReviewInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "generatedContentDraftId",
    "exportReviewQueueItemId",
    "expectedUpdatedAt",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.generatedContentDraftId)
    && UUID_PATTERN.test(input.exportReviewQueueItemId)
    && isCanonicalUtcTimestamp(input.expectedUpdatedAt)
    && isCanonicalUtcTimestamp(input.now)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext);
}

function toStartExportReviewResult(input, replayed) {
  return {
    generatedContentDraftId: input.generatedContentDraftId,
    exportReviewQueueItemId: input.exportReviewQueueItemId,
    queueStatus: EXPORT_REVIEW_START_QUEUE_STATUS,
    reviewStatus: EXPORT_REVIEW_REVIEW_STATUS,
    replayed,
  };
}

function buildStartExportReviewAuditMetadata({ input, previousQueueStatus, resultingQueueStatus }) {
  return {
    contract: EXPORT_REVIEW_START_AUDIT_CONTRACT,
    organization_id: input.organizationId,
    generated_content_draft_id: input.generatedContentDraftId,
    review_queue_item_id: input.exportReviewQueueItemId,
    actor_id: input.actorContext.actorUserId,
    actor_type: "human",
    expected_updated_at: input.expectedUpdatedAt,
    requested_start_timestamp: input.now,
    previous_queue_status: previousQueueStatus,
    resulting_queue_status: resultingQueueStatus,
    previous_review_status: EXPORT_REVIEW_REVIEW_STATUS,
    resulting_review_status: EXPORT_REVIEW_REVIEW_STATUS,
    validator_keys: [...EXPORT_REVIEW_START_VALIDATOR_KEYS],
  };
}

function auditMetadataMatchesStart(metadata, { input }) {
  return metadata
    && metadata.contract === EXPORT_REVIEW_START_AUDIT_CONTRACT
    && metadata.organization_id === input.organizationId
    && metadata.generated_content_draft_id === input.generatedContentDraftId
    && metadata.review_queue_item_id === input.exportReviewQueueItemId
    && metadata.actor_type === "human"
    && typeof metadata.actor_id === "string" && metadata.actor_id.length > 0
    && metadata.actor_id === input.actorContext.actorUserId
    && metadata.expected_updated_at === input.expectedUpdatedAt
    && metadata.requested_start_timestamp === input.now
    && metadata.previous_queue_status === EXPORT_REVIEW_QUEUE_STATUS
    && metadata.resulting_queue_status === EXPORT_REVIEW_START_QUEUE_STATUS
    && metadata.previous_review_status === EXPORT_REVIEW_REVIEW_STATUS
    && metadata.resulting_review_status === EXPORT_REVIEW_REVIEW_STATUS
    && Array.isArray(metadata.validator_keys)
    && metadata.validator_keys.length === EXPORT_REVIEW_START_VALIDATOR_KEYS.length
    && EXPORT_REVIEW_START_VALIDATOR_KEYS.every((key, index) => metadata.validator_keys[index] === key);
}

async function insertStartExportReviewAudit(tx, { input, auditFileContext }) {
  await tx.query(
    `INSERT INTO kai.upload_lifecycle_audit (
       organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3,$4,$4,'success',$5::jsonb,$6::timestamptz)`,
    [
      input.organizationId,
      auditFileContext.intake_file_id,
      EXPORT_REVIEW_START_AUDIT_OPERATION,
      auditFileContext.upload_state,
      JSON.stringify(buildStartExportReviewAuditMetadata({
        input,
        previousQueueStatus: EXPORT_REVIEW_QUEUE_STATUS,
        resultingQueueStatus: EXPORT_REVIEW_START_QUEUE_STATUS,
      })),
      input.now,
    ],
  );
}

async function findMatchingStartExportReviewAudit(tx, { input }) {
  const { rows } = await tx.query(
    `SELECT metadata
       FROM kai.upload_lifecycle_audit
      WHERE organization_id = $1::uuid
        AND operation = $2
        AND outcome = 'success'
        AND metadata->>'generated_content_draft_id' = $3
        AND metadata->>'review_queue_item_id' = $4`,
    [input.organizationId, EXPORT_REVIEW_START_AUDIT_OPERATION, input.generatedContentDraftId, input.exportReviewQueueItemId],
  );
  const matches = rows.filter((row) => auditMetadataMatchesStart(row.metadata, { input }));
  return matches.length === 1;
}

async function evaluateStartExportReviewReplayOrConflict(tx, input) {
  const queueRow = await loadExportReviewQueueRowById(tx, {
    organizationId: input.organizationId,
    exportReviewQueueItemId: input.exportReviewQueueItemId,
  });
  if (!queueRow) return failure("not_found");
  if (queueRow.target_object_type !== EXPORT_REVIEW_TARGET_TYPE || queueRow.target_object_id !== input.generatedContentDraftId) {
    return failure("conflict_current_state_changed");
  }
  if (!isExportReviewQueueContractRow(queueRow, {
    organizationId: input.organizationId,
    targetObjectId: input.generatedContentDraftId,
    allowedLifecycleProfiles: [EXPORT_REVIEW_START_LIFECYCLE_PROFILE],
  })) {
    return failure("conflict_current_state_changed");
  }
  const auditRows = await tx.query(
    `SELECT metadata
       FROM kai.upload_lifecycle_audit
      WHERE organization_id = $1::uuid
        AND operation = $2
        AND outcome = 'success'
        AND metadata->>'generated_content_draft_id' = $3
        AND metadata->>'review_queue_item_id' = $4`,
    [input.organizationId, EXPORT_REVIEW_START_AUDIT_OPERATION, input.generatedContentDraftId, input.exportReviewQueueItemId],
  );
  if (auditRows.rows.length !== 1) return failure("conflict_current_state_changed");
  if (!auditMetadataMatchesStart(auditRows.rows[0].metadata, { input })) return failure("conflict_current_state_changed");
  return success(toStartExportReviewResult(input, true));
}

export async function evaluateExportReviewRequestStateInTransaction(tx, input) {
  if (!validateExportReviewRequestStateInput(input)) return failure("validation_blocker");
  const queueRow = await loadExportReviewQueueRowById(tx, input);
  if (!queueRow) return failure("not_found");
  if (!isExportReviewQueueContractRow(queueRow, {
    organizationId: input.organizationId,
    targetObjectId: input.generatedContentDraftId,
    allowedLifecycleProfiles: EXPORT_REVIEW_LIFECYCLE_PROFILES,
  })) {
    return failure("conflict_current_state_changed");
  }
  const auditRows = await tx.query(
    `SELECT metadata
       FROM kai.upload_lifecycle_audit
      WHERE organization_id = $1::uuid
        AND operation = $2
        AND outcome = 'success'
        AND metadata->>'generated_content_draft_id' = $3
        AND metadata->>'review_queue_item_id' = $4`,
    [
      input.organizationId,
      EXPORT_REVIEW_AUDIT_OPERATION,
      input.generatedContentDraftId,
      queueRow.review_queue_item_id,
    ],
  );
  const matching = auditRows.rows
    .map((row) => row.metadata)
    .filter((metadata) => auditMetadataMatchesExportReview(metadata, {
      input: {
        organizationId: input.organizationId,
        generatedContentDraftId: input.generatedContentDraftId,
        requestedExportAudience: metadata?.requested_export_audience,
      },
      reviewQueueItemId: queueRow.review_queue_item_id,
    }));
  if (matching.length !== 1) return failure("conflict_current_state_changed");
  const metadata = matching[0];
  if (!AUDIENCES.has(metadata.requested_export_audience)) return failure("conflict_current_state_changed");
  return success({
    requestedExportAudience: metadata.requested_export_audience,
    exportReviewQueueItemId: queueRow.review_queue_item_id,
    exportReviewQueueStatus: queueRow.queue_status,
    exportReviewStatus: queueRow.review_status,
    exportReviewUpdatedAt: asCanonicalUtcTimestamp(queueRow.updated_at),
  });
}

export async function evaluateGeneratedDraftExportReviewPacketInTransaction(
  tx,
  input,
  evaluator = evaluateClaimTraceabilityInTransaction,
) {
  if (!validateExportReviewRequestStateInput(input)) return failure("validation_blocker");
  const packetResult = await evaluateGeneratedDraftReviewPacketInTransaction(
    tx,
    { organizationId: input.organizationId, generatedContentDraftId: input.generatedContentDraftId },
    evaluator,
    { allowedLifecycleProfiles: [COMPLETE_REVIEW_RESOLVED_PROFILE] },
  );
  if (!packetResult.ok) return packetResult.error.code === "not_found" ? failure("not_found") : failure("conflict_current_state_changed");
  const exportReviewResult = await evaluateExportReviewRequestStateInTransaction(tx, input);
  if (!exportReviewResult.ok) return exportReviewResult;
  if (exportReviewResult.data.requestedExportAudience !== packetResult.data.requestedAudience) {
    return failure("conflict_current_state_changed");
  }
  const validatorResult = validateExportManifestEligibility({
    generatedContentDraftId: input.generatedContentDraftId,
    requestedExportAudience: exportReviewResult.data.requestedExportAudience,
    draftAudience: packetResult.data.requestedAudience,
    draftIsStillDraft: true,
    reviewIsResolved: true,
    currentUseEligible: packetResult.data.currentUseEligible,
    finalGate: false,
    affirmativeHumanExportAuthority: false,
  });
  return success({
    generationRunId: packetResult.data.generationRunId,
    generatedContentDraftId: packetResult.data.generatedContentDraftId,
    contentType: packetResult.data.contentType,
    draftStatus: packetResult.data.draftStatus,
    requestedExportAudience: exportReviewResult.data.requestedExportAudience,
    generatedContentReviewQueueStatus: packetResult.data.queueStatus,
    generatedContentReviewStatus: packetResult.data.reviewStatus,
    exportReviewQueueItemId: exportReviewResult.data.exportReviewQueueItemId,
    exportReviewQueueStatus: exportReviewResult.data.exportReviewQueueStatus,
    exportReviewStatus: exportReviewResult.data.exportReviewStatus,
    currentUseEligible: packetResult.data.currentUseEligible,
    exportEligible: validatorResult.severity === "pass",
    validatorResult,
    blocks: packetResult.data.blocks,
    exportReviewUpdatedAt: exportReviewResult.data.exportReviewUpdatedAt,
  });
}

export function createPostgresGeneratedContentRepository({
  runInTransaction = withTransaction,
  evaluator = evaluateClaimTraceabilityInTransaction,
  afterPersist = async () => {},
} = {}) {
  return Object.freeze({
    async getGeneratedDraftReviewPacket(input) {
      if (!validateReviewPacketInput(input)) return failure("validation_blocker");
      try {
        return await runInTransaction(async (tx) => {
          await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
          return evaluateGeneratedDraftReviewPacketInTransaction(tx, input, evaluator, {
            allowedLifecycleProfiles: GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES,
          });
        });
      } catch (error) {
        if (error instanceof RollbackResultError) return error.result;
        if (error?.code === "22P02") return failure("validation_blocker");
        if (error?.code === "25001") return failure("conflict_current_state_changed");
        return failure("system_error");
      }
    },
    async getGrantResponsePacket(input) {
      if (!validateGrantResponsePacketMembershipInput(input)) return failure("validation_blocker");
      try {
        return await runInTransaction(async (tx) => {
          await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
          return evaluateGrantResponsePacketMembershipInTransaction(tx, input, evaluator);
        });
      } catch (error) {
        if (error instanceof RollbackResultError) return error.result;
        if (error?.code === "22P02") return failure("validation_blocker");
        if (error?.code === "25001") return failure("conflict_current_state_changed");
        return failure("system_error");
      }
    },
    async createEvidenceSummaryDraft(input, dependencies = {}) {
      return createGeneratedContentDraft(
        CONTENT_TYPE,
        fingerprintEvidenceSummaryRequest,
        input,
        dependencies,
        { runInTransaction, evaluator, afterPersist },
      );
    },
    async createImpactNarrativeDraft(input, dependencies = {}) {
      return createGeneratedContentDraft(
        IMPACT_NARRATIVE_CONTENT_TYPE,
        fingerprintImpactNarrativeRequest,
        input,
        dependencies,
        { runInTransaction, evaluator, afterPersist },
      );
    },
    async startGeneratedContentReview(input, dependencies = {}) {
      if (!validateCompleteReviewInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");

      try {
        return await runInTransaction(async (tx) => {
          const draftLocked = await lockImmutableDraftRoot(tx, input);
          if (!draftLocked) return failure("not_found");

          const queueRow = await loadReviewQueueItemById(tx, input.reviewQueueItemId);
          if (!queueRow) return failure("not_found");
          if (!isExactReviewQueueTarget(queueRow, input)) return failure("conflict_current_state_changed");

          const packetResult = await evaluateGeneratedDraftReviewPacketInTransaction(
            tx,
            { organizationId: input.organizationId, generatedContentDraftId: input.generatedContentDraftId },
            evaluator,
            { allowedLifecycleProfiles: GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES },
          );
          if (!packetResult.ok) {
            return packetResult.error.code === "not_found" ? failure("not_found") : failure("conflict_current_state_changed");
          }
          const packet = packetResult.data;
          if (packet.reviewQueueItemId !== input.reviewQueueItemId) return failure("conflict_current_state_changed");

          const updateResult = await tx.query(
            `UPDATE kai.review_queue_items
                SET queue_status = $1,
                    updated_at = $2::timestamptz
              WHERE organization_id = $3::uuid
                AND review_queue_item_id = $4::uuid
                AND target_object_type = $5
                AND target_object_id = $6::uuid
                AND queue_status = $7
                AND review_status = $8
                AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $9::timestamptz)
              RETURNING review_queue_item_id::text AS review_queue_item_id`,
            [
              START_REVIEW_IN_PROGRESS_PROFILE.queueStatus,
              input.now,
              input.organizationId,
              input.reviewQueueItemId,
              REVIEW_TARGET_TYPE,
              input.generatedContentDraftId,
              START_REVIEW_FRESH_PROFILE.queueStatus,
              START_REVIEW_FRESH_PROFILE.reviewStatus,
              input.expectedUpdatedAt,
            ],
          );

          if (updateResult.rowCount !== 1) {
            return evaluateStartReviewReplayOrConflict(tx, input, evaluator);
          }

          const postWrite = await evaluateGeneratedDraftReviewPacketInTransaction(
            tx,
            { organizationId: input.organizationId, generatedContentDraftId: input.generatedContentDraftId },
            evaluator,
            { allowedLifecycleProfiles: [START_REVIEW_IN_PROGRESS_PROFILE] },
          );
          if (!postWrite.ok) throw new RollbackResultError(postWrite);
          if (postWrite.data.reviewQueueItemId !== input.reviewQueueItemId) {
            throw new RollbackResultError(failure("conflict_current_state_changed"));
          }

          const auditFileContext = await loadAuditFileContext(tx, input);
          if (!auditFileContext) throw new RollbackResultError(failure("system_error"));

          const preparedAudit = prepareRequiredAudit(dependencies.metadataOnlyAudit, {
            attempted_operation: START_REVIEW_AUDIT_OPERATION,
            actor_type: "human",
            object_type: "generated_content_review_queue_item",
            request_scope: "organization_generated_content_review_queue_item",
            contract: START_REVIEW_AUDIT_CONTRACT,
          });
          await insertGeneratedContentStartReviewAudit(tx, { input, packet: postWrite.data, auditFileContext });
          await preparedAudit.publish();

          return success(toStartReviewResult(postWrite.data, false));
        });
      } catch (error) {
        if (error instanceof RollbackResultError) return error.result;
        if (error?.code === "22P02" || error?.code === "23514") {
          return failure(
            "validation_blocker",
            stageBlocker(START_REVIEW_VALIDATOR_KEYS[0], "generated_content_review_start_currently_blocked"),
          );
        }
        if (error?.code === "25001") return failure("conflict_current_state_changed");
        return failure("system_error");
      }
    },
    async completeGeneratedContentReview(input, dependencies = {}) {
      if (!validateCompleteReviewInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");

      try {
        return await runInTransaction(async (tx) => {
          const draftLocked = await lockImmutableDraftRoot(tx, input);
          if (!draftLocked) return failure("not_found");

          const queueRow = await loadReviewQueueItemById(tx, input.reviewQueueItemId);
          if (!queueRow) return failure("not_found");
          if (!isExactReviewQueueTarget(queueRow, input)) return failure("conflict_current_state_changed");

          const packetResult = await evaluateGeneratedDraftReviewPacketInTransaction(
            tx,
            { organizationId: input.organizationId, generatedContentDraftId: input.generatedContentDraftId },
            evaluator,
            { allowedLifecycleProfiles: GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES },
          );
          if (!packetResult.ok) {
            return packetResult.error.code === "not_found" ? failure("not_found") : failure("conflict_current_state_changed");
          }
          const packet = packetResult.data;
          if (packet.reviewQueueItemId !== input.reviewQueueItemId) return failure("conflict_current_state_changed");

          const updateResult = await tx.query(
            `UPDATE kai.review_queue_items
                SET queue_status = $1,
                    review_status = $2,
                    updated_at = $3::timestamptz
              WHERE organization_id = $4::uuid
                AND review_queue_item_id = $5::uuid
                AND target_object_type = $6
                AND target_object_id = $7::uuid
                AND queue_status = $8
                AND review_status = $9
                AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $10::timestamptz)
              RETURNING review_queue_item_id::text AS review_queue_item_id`,
            [
              COMPLETE_REVIEW_RESOLVED_PROFILE.queueStatus,
              COMPLETE_REVIEW_RESOLVED_PROFILE.reviewStatus,
              input.now,
              input.organizationId,
              input.reviewQueueItemId,
              REVIEW_TARGET_TYPE,
              input.generatedContentDraftId,
              COMPLETE_REVIEW_FRESH_PROFILE.queueStatus,
              COMPLETE_REVIEW_FRESH_PROFILE.reviewStatus,
              input.expectedUpdatedAt,
            ],
          );

          if (updateResult.rowCount !== 1) {
            return evaluateCompleteReviewReplayOrConflict(tx, input, evaluator);
          }

          const postWrite = await evaluateGeneratedDraftReviewPacketInTransaction(
            tx,
            { organizationId: input.organizationId, generatedContentDraftId: input.generatedContentDraftId },
            evaluator,
            { allowedLifecycleProfiles: [COMPLETE_REVIEW_RESOLVED_PROFILE] },
          );
          if (!postWrite.ok) throw new RollbackResultError(postWrite);
          if (postWrite.data.reviewQueueItemId !== input.reviewQueueItemId) {
            throw new RollbackResultError(failure("conflict_current_state_changed"));
          }

          const auditFileContext = await loadAuditFileContext(tx, input);
          if (!auditFileContext) throw new RollbackResultError(failure("system_error"));

          const preparedAudit = prepareRequiredAudit(dependencies.metadataOnlyAudit, {
            attempted_operation: COMPLETE_REVIEW_AUDIT_OPERATION,
            actor_type: "human",
            object_type: "generated_content_review_queue_item",
            request_scope: "organization_generated_content_review_queue_item",
            contract: COMPLETE_REVIEW_AUDIT_CONTRACT,
          });
          await insertCompleteReviewAudit(tx, { input, packet: postWrite.data, auditFileContext });
          await preparedAudit.publish();

          return success(toCompleteReviewResult(postWrite.data, false));
        });
      } catch (error) {
        if (error instanceof RollbackResultError) return error.result;
        if (error?.code === "22P02") return failure("validation_blocker");
        if (error?.code === "23514") return failure("validation_blocker");
        if (error?.code === "25001") return failure("conflict_current_state_changed");
        return failure("system_error");
      }
    },
    async requestGeneratedDraftExportReview(input, dependencies = {}) {
      if (!validateRequestExportReviewInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");

      try {
        return await runInTransaction(async (tx) => {
          const existingRows = await loadExportReviewQueueRows(tx, input);
          if (existingRows.length > 1) return failure("conflict_current_state_changed");
          if (existingRows.length === 1) {
            return replayExportReviewFromExistingRow(tx, input, existingRows[0]);
          }

          const readiness = await evaluateExportReviewReadiness(tx, input, evaluator);
          if (!readiness.ok) return failure(readiness.code);
          if (!readiness.ready) {
            return success(toBlockedExportReviewResult(input, readiness.validatorResult));
          }

          const inserted = await tx.query(
            `INSERT INTO kai.review_queue_items (
               organization_id, engagement_id, queue_type, target_object_type, target_object_id,
               priority, queue_status, review_status, blocked_reason, assigned_to, due_at,
               summary, required_action, queue_metadata, created_by, created_by_type, created_at, updated_at
             )
             VALUES ($1::uuid,NULL,$2,$3,$4::uuid,$5,$6,$7,NULL,NULL,NULL,$8,$9,'{}'::jsonb,NULL,'system',$10::timestamptz,$10::timestamptz)
             ON CONFLICT (organization_id, queue_type, target_object_type, target_object_id)
               WHERE queue_type = 'export_review'
               DO NOTHING
             RETURNING review_queue_item_id::text AS review_queue_item_id`,
            [
              input.organizationId,
              EXPORT_REVIEW_QUEUE_TYPE,
              EXPORT_REVIEW_TARGET_TYPE,
              input.generatedContentDraftId,
              EXPORT_REVIEW_PRIORITY,
              EXPORT_REVIEW_QUEUE_STATUS,
              EXPORT_REVIEW_REVIEW_STATUS,
              EXPORT_REVIEW_SUMMARY,
              EXPORT_REVIEW_REQUIRED_ACTION,
              input.now,
            ],
          );

          const postInsertRows = await loadExportReviewQueueRows(tx, input);
          if (postInsertRows.length !== 1) throw new RollbackResultError(failure("system_error"));
          const queueRow = postInsertRows[0];

          if (inserted.rows.length !== 1) {
            return replayExportReviewFromExistingRow(tx, input, queueRow);
          }

          if (!isExportReviewQueueContractRow(queueRow, {
            organizationId: input.organizationId,
            targetObjectId: input.generatedContentDraftId,
          })) {
            throw new RollbackResultError(failure("conflict_current_state_changed"));
          }
          const reviewQueueItemId = queueRow.review_queue_item_id;

          const auditFileContext = await loadAuditFileContext(tx, input);
          if (!auditFileContext) throw new RollbackResultError(failure("system_error"));

          const preparedAudit = prepareRequiredAudit(dependencies.metadataOnlyAudit, {
            attempted_operation: EXPORT_REVIEW_AUDIT_OPERATION,
            actor_type: "human",
            object_type: "export_review_queue_item",
            request_scope: "organization_export_review_queue_item",
            contract: EXPORT_REVIEW_AUDIT_CONTRACT,
          });
          await insertExportReviewAudit(tx, { input, auditFileContext, reviewQueueItemId });
          await preparedAudit.publish();

          const hasMatchingAudit = await findMatchingExportReviewAudit(tx, { input, reviewQueueItemId });
          if (!hasMatchingAudit) throw new RollbackResultError(failure("system_error"));

          return success(toAcceptedExportReviewResult(input, reviewQueueItemId, false, readiness.validatorResult));
        });
      } catch (error) {
        if (error instanceof RollbackResultError) return error.result;
        if (error?.code === "23505") return failure("conflict_current_state_changed");
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") return failure("validation_blocker");
        if (error?.code === "25001") return failure("conflict_current_state_changed");
        return failure("system_error");
      }
    },
    async startGeneratedDraftExportReview(input, dependencies = {}) {
      if (!validateStartExportReviewInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");

      try {
        return await runInTransaction(async (tx) => {
          const queueRow = await loadExportReviewQueueRowById(tx, {
            organizationId: input.organizationId,
            exportReviewQueueItemId: input.exportReviewQueueItemId,
          });
          if (!queueRow) return failure("not_found");
          if (
            queueRow.target_object_type !== EXPORT_REVIEW_TARGET_TYPE
            || queueRow.target_object_id !== input.generatedContentDraftId
          ) {
            return failure("conflict_current_state_changed");
          }

          const updateResult = await tx.query(
            `UPDATE kai.review_queue_items
                SET queue_status = $1,
                    updated_at = $2::timestamptz
              WHERE organization_id = $3::uuid
                AND review_queue_item_id = $4::uuid
                AND queue_type = $5
                AND target_object_type = $6
                AND target_object_id = $7::uuid
                AND queue_status = $8
                AND review_status = $9
                AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $10::timestamptz)
              RETURNING review_queue_item_id::text AS review_queue_item_id`,
            [
              EXPORT_REVIEW_START_QUEUE_STATUS,
              input.now,
              input.organizationId,
              input.exportReviewQueueItemId,
              EXPORT_REVIEW_QUEUE_TYPE,
              EXPORT_REVIEW_TARGET_TYPE,
              input.generatedContentDraftId,
              EXPORT_REVIEW_QUEUE_STATUS,
              EXPORT_REVIEW_REVIEW_STATUS,
              input.expectedUpdatedAt,
            ],
          );

          if (updateResult.rowCount !== 1) {
            return evaluateStartExportReviewReplayOrConflict(tx, input);
          }

          const postWriteRow = await loadExportReviewQueueRowById(tx, {
            organizationId: input.organizationId,
            exportReviewQueueItemId: input.exportReviewQueueItemId,
          });
          if (!postWriteRow) throw new RollbackResultError(failure("system_error"));
          if (!isExportReviewQueueContractRow(postWriteRow, {
            organizationId: input.organizationId,
            targetObjectId: input.generatedContentDraftId,
            allowedLifecycleProfiles: [EXPORT_REVIEW_START_LIFECYCLE_PROFILE],
          })) {
            throw new RollbackResultError(failure("conflict_current_state_changed"));
          }

          const auditFileContext = await loadAuditFileContext(tx, input);
          if (!auditFileContext) throw new RollbackResultError(failure("system_error"));

          const preparedAudit = prepareRequiredAudit(dependencies.metadataOnlyAudit, {
            attempted_operation: EXPORT_REVIEW_START_AUDIT_OPERATION,
            actor_type: "human",
            object_type: "export_review_queue_item",
            request_scope: "organization_export_review_queue_item",
            contract: EXPORT_REVIEW_START_AUDIT_CONTRACT,
          });
          await insertStartExportReviewAudit(tx, { input, auditFileContext });
          await preparedAudit.publish();

          const hasMatchingAudit = await findMatchingStartExportReviewAudit(tx, { input });
          if (!hasMatchingAudit) throw new RollbackResultError(failure("system_error"));

          return success(toStartExportReviewResult(input, false));
        });
      } catch (error) {
        if (error instanceof RollbackResultError) return error.result;
        if (error?.code === "23505") return failure("conflict_current_state_changed");
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") {
          return failure(
            "validation_blocker",
            stageBlocker(EXPORT_REVIEW_START_VALIDATOR_KEYS[0], "export_review_start_currently_blocked"),
          );
        }
        if (error?.code === "25001") return failure("conflict_current_state_changed");
        return failure("system_error");
      }
    },
    async completeGeneratedDraftExportReview(input, dependencies = {}) {
      if (!validateCompleteExportReviewInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");

      try {
        return await runInTransaction(async (tx) => {
          const queueRow = await loadExportReviewQueueRowById(tx, {
            organizationId: input.organizationId,
            exportReviewQueueItemId: input.exportReviewQueueItemId,
          });
          if (!queueRow) return failure("not_found");
          if (
            queueRow.target_object_type !== EXPORT_REVIEW_TARGET_TYPE
            || queueRow.target_object_id !== input.generatedContentDraftId
          ) {
            return failure("conflict_current_state_changed");
          }

          const updateResult = await tx.query(
            `UPDATE kai.review_queue_items
                SET queue_status = $1,
                    review_status = $2,
                    updated_at = $3::timestamptz
              WHERE organization_id = $4::uuid
                AND review_queue_item_id = $5::uuid
                AND queue_type = $6
                AND target_object_type = $7
                AND target_object_id = $8::uuid
                AND queue_status = $9
                AND review_status = $10
                AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $11::timestamptz)
              RETURNING review_queue_item_id::text AS review_queue_item_id`,
            [
              EXPORT_REVIEW_COMPLETE_QUEUE_STATUS,
              EXPORT_REVIEW_COMPLETE_REVIEW_STATUS,
              input.now,
              input.organizationId,
              input.exportReviewQueueItemId,
              EXPORT_REVIEW_QUEUE_TYPE,
              EXPORT_REVIEW_TARGET_TYPE,
              input.generatedContentDraftId,
              EXPORT_REVIEW_START_LIFECYCLE_PROFILE.queueStatus,
              EXPORT_REVIEW_START_LIFECYCLE_PROFILE.reviewStatus,
              input.expectedUpdatedAt,
            ],
          );

          if (updateResult.rowCount !== 1) {
            return evaluateCompleteExportReviewReplayOrConflict(tx, input);
          }

          const postWriteRow = await loadExportReviewQueueRowById(tx, {
            organizationId: input.organizationId,
            exportReviewQueueItemId: input.exportReviewQueueItemId,
          });
          if (!postWriteRow) throw new RollbackResultError(failure("system_error"));
          if (!isExportReviewQueueContractRow(postWriteRow, {
            organizationId: input.organizationId,
            targetObjectId: input.generatedContentDraftId,
            allowedLifecycleProfiles: [EXPORT_REVIEW_COMPLETE_LIFECYCLE_PROFILE],
          })) {
            throw new RollbackResultError(failure("conflict_current_state_changed"));
          }

          const auditFileContext = await loadAuditFileContext(tx, input);
          if (!auditFileContext) throw new RollbackResultError(failure("system_error"));

          const preparedAudit = prepareRequiredAudit(dependencies.metadataOnlyAudit, {
            attempted_operation: EXPORT_REVIEW_COMPLETE_AUDIT_OPERATION,
            actor_type: "human",
            object_type: "export_review_queue_item",
            request_scope: "organization_export_review_queue_item",
            contract: EXPORT_REVIEW_COMPLETE_AUDIT_CONTRACT,
          });
          await insertCompleteExportReviewAudit(tx, { input, auditFileContext });
          await preparedAudit.publish();

          const hasMatchingAudit = await findMatchingCompleteExportReviewAudit(tx, { input });
          if (!hasMatchingAudit) throw new RollbackResultError(failure("system_error"));

          return success(toCompleteExportReviewResult(input, false));
        });
      } catch (error) {
        if (error instanceof RollbackResultError) return error.result;
        if (error?.code === "23505") return failure("conflict_current_state_changed");
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") return failure("validation_blocker");
        if (error?.code === "25001") return failure("conflict_current_state_changed");
        return failure("system_error");
      }
    },
  });
}

function validateCompleteExportReviewInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "generatedContentDraftId",
    "exportReviewQueueItemId",
    "expectedUpdatedAt",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.generatedContentDraftId)
    && UUID_PATTERN.test(input.exportReviewQueueItemId)
    && isCanonicalUtcTimestamp(input.expectedUpdatedAt)
    && isCanonicalUtcTimestamp(input.now)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext);
}

function toCompleteExportReviewResult(input, replayed) {
  return {
    generatedContentDraftId: input.generatedContentDraftId,
    exportReviewQueueItemId: input.exportReviewQueueItemId,
    queueStatus: EXPORT_REVIEW_COMPLETE_QUEUE_STATUS,
    reviewStatus: EXPORT_REVIEW_COMPLETE_REVIEW_STATUS,
    replayed,
  };
}

function buildCompleteExportReviewAuditMetadata({ input, previousQueueStatus, resultingQueueStatus }) {
  return {
    contract: EXPORT_REVIEW_COMPLETE_AUDIT_CONTRACT,
    organization_id: input.organizationId,
    generated_content_draft_id: input.generatedContentDraftId,
    review_queue_item_id: input.exportReviewQueueItemId,
    actor_id: input.actorContext.actorUserId,
    actor_type: "human",
    expected_updated_at: input.expectedUpdatedAt,
    requested_completion_timestamp: input.now,
    previous_queue_status: previousQueueStatus,
    resulting_queue_status: resultingQueueStatus,
    previous_review_status: EXPORT_REVIEW_START_LIFECYCLE_PROFILE.reviewStatus,
    resulting_review_status: EXPORT_REVIEW_COMPLETE_REVIEW_STATUS,
    validator_keys: [...EXPORT_REVIEW_COMPLETE_VALIDATOR_KEYS],
  };
}

function auditMetadataMatchesComplete(metadata, { input }) {
  return metadata
    && metadata.contract === EXPORT_REVIEW_COMPLETE_AUDIT_CONTRACT
    && metadata.organization_id === input.organizationId
    && metadata.generated_content_draft_id === input.generatedContentDraftId
    && metadata.review_queue_item_id === input.exportReviewQueueItemId
    && metadata.actor_type === "human"
    && typeof metadata.actor_id === "string" && metadata.actor_id.length > 0
    && metadata.actor_id === input.actorContext.actorUserId
    && metadata.expected_updated_at === input.expectedUpdatedAt
    && metadata.requested_completion_timestamp === input.now
    && metadata.previous_queue_status === EXPORT_REVIEW_START_LIFECYCLE_PROFILE.queueStatus
    && metadata.resulting_queue_status === EXPORT_REVIEW_COMPLETE_QUEUE_STATUS
    && metadata.previous_review_status === EXPORT_REVIEW_START_LIFECYCLE_PROFILE.reviewStatus
    && metadata.resulting_review_status === EXPORT_REVIEW_COMPLETE_REVIEW_STATUS
    && Array.isArray(metadata.validator_keys)
    && metadata.validator_keys.length === EXPORT_REVIEW_COMPLETE_VALIDATOR_KEYS.length
    && EXPORT_REVIEW_COMPLETE_VALIDATOR_KEYS.every((key, index) => metadata.validator_keys[index] === key);
}

async function insertCompleteExportReviewAudit(tx, { input, auditFileContext }) {
  await tx.query(
    `INSERT INTO kai.upload_lifecycle_audit (
       organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3,$4,$4,'success',$5::jsonb,$6::timestamptz)`,
    [
      input.organizationId,
      auditFileContext.intake_file_id,
      EXPORT_REVIEW_COMPLETE_AUDIT_OPERATION,
      auditFileContext.upload_state,
      JSON.stringify(buildCompleteExportReviewAuditMetadata({
        input,
        previousQueueStatus: EXPORT_REVIEW_START_LIFECYCLE_PROFILE.queueStatus,
        resultingQueueStatus: EXPORT_REVIEW_COMPLETE_QUEUE_STATUS,
      })),
      input.now,
    ],
  );
}

async function findMatchingCompleteExportReviewAudit(tx, { input }) {
  const { rows } = await tx.query(
    `SELECT metadata
       FROM kai.upload_lifecycle_audit
      WHERE organization_id = $1::uuid
        AND operation = $2
        AND outcome = 'success'
        AND metadata->>'generated_content_draft_id' = $3
        AND metadata->>'review_queue_item_id' = $4`,
    [input.organizationId, EXPORT_REVIEW_COMPLETE_AUDIT_OPERATION, input.generatedContentDraftId, input.exportReviewQueueItemId],
  );
  const matches = rows.filter((row) => auditMetadataMatchesComplete(row.metadata, { input }));
  return matches.length === 1;
}

async function evaluateCompleteExportReviewReplayOrConflict(tx, input) {
  const queueRow = await loadExportReviewQueueRowById(tx, {
    organizationId: input.organizationId,
    exportReviewQueueItemId: input.exportReviewQueueItemId,
  });
  if (!queueRow) return failure("not_found");
  if (queueRow.target_object_type !== EXPORT_REVIEW_TARGET_TYPE || queueRow.target_object_id !== input.generatedContentDraftId) {
    return failure("conflict_current_state_changed");
  }
  if (!isExportReviewQueueContractRow(queueRow, {
    organizationId: input.organizationId,
    targetObjectId: input.generatedContentDraftId,
    allowedLifecycleProfiles: [EXPORT_REVIEW_COMPLETE_LIFECYCLE_PROFILE],
  })) {
    return failure("conflict_current_state_changed");
  }
  const auditRows = await tx.query(
    `SELECT metadata
       FROM kai.upload_lifecycle_audit
      WHERE organization_id = $1::uuid
        AND operation = $2
        AND outcome = 'success'
        AND metadata->>'generated_content_draft_id' = $3
        AND metadata->>'review_queue_item_id' = $4`,
    [input.organizationId, EXPORT_REVIEW_COMPLETE_AUDIT_OPERATION, input.generatedContentDraftId, input.exportReviewQueueItemId],
  );
  if (auditRows.rows.length !== 1) return failure("conflict_current_state_changed");
  if (!auditMetadataMatchesComplete(auditRows.rows[0].metadata, { input })) return failure("conflict_current_state_changed");
  return success(toCompleteExportReviewResult(input, true));
}

export const __generatedContentRepositoryContract = Object.freeze({
  CONTENT_TYPE,
  IMPACT_NARRATIVE_CONTENT_TYPE,
  ALLOWED_GENERATED_CONTENT_TYPES,
  DRAFT_STATUS,
  REVIEW_STATUS,
  REVIEW_QUEUE_TYPE,
  REVIEW_TARGET_TYPE,
  REVIEW_SUMMARY,
  REVIEW_REQUIRED_ACTION,
  AUDIT_OPERATION,
  AUDIT_CONTRACT,
  START_REVIEW_FRESH_PROFILE,
  START_REVIEW_IN_PROGRESS_PROFILE,
  START_REVIEW_AUDIT_OPERATION,
  START_REVIEW_AUDIT_CONTRACT,
  START_REVIEW_VALIDATOR_KEYS,
  COMPLETE_REVIEW_FRESH_PROFILE,
  COMPLETE_REVIEW_RESOLVED_PROFILE,
  COMPLETE_REVIEW_AUDIT_OPERATION,
  COMPLETE_REVIEW_AUDIT_CONTRACT,
  EXPORT_REVIEW_QUEUE_TYPE,
  EXPORT_REVIEW_TARGET_TYPE,
  EXPORT_REVIEW_PRIORITY,
  EXPORT_REVIEW_SUMMARY,
  EXPORT_REVIEW_REQUIRED_ACTION,
  EXPORT_REVIEW_QUEUE_STATUS,
  EXPORT_REVIEW_REVIEW_STATUS,
  EXPORT_REVIEW_AUDIT_OPERATION,
  EXPORT_REVIEW_AUDIT_CONTRACT,
  EXPORT_REVIEW_READINESS_FAILED_GATES,
  EXPORT_REVIEW_LIFECYCLE_PROFILES,
  EXPORT_REVIEW_START_QUEUE_STATUS,
  EXPORT_REVIEW_START_AUDIT_OPERATION,
  EXPORT_REVIEW_START_AUDIT_CONTRACT,
  EXPORT_REVIEW_START_VALIDATOR_KEYS,
  EXPORT_REVIEW_COMPLETE_QUEUE_STATUS,
  EXPORT_REVIEW_COMPLETE_REVIEW_STATUS,
  EXPORT_REVIEW_COMPLETE_AUDIT_OPERATION,
  EXPORT_REVIEW_COMPLETE_AUDIT_CONTRACT,
  EXPORT_REVIEW_COMPLETE_VALIDATOR_KEYS,
});

export const __generatedContentRepositoryTestables = Object.freeze({
  validateGeneratorInput,
  validateGeneratorResult,
  validateInput,
  validateExistingState,
  validateReviewPacketInput,
  validateReviewPacketRows,
  validateExportReviewQueueRows,
  validateCompleteReviewInput,
  fingerprintEvidenceSummaryRequest,
  fingerprintImpactNarrativeRequest,
  prepareRequiredAudit,
  validateRequestExportReviewInput,
  validateExportReviewRequestStateInput,
  isExportReviewQueueContractRow,
  validateStartExportReviewInput,
  validateCompleteExportReviewInput,
  validateGrantResponsePacketMembershipInput,
  validateTraceabilityData,
  loadGenerationProjection,
  TRACEABILITY_RESULT_CONTRACT_VALIDATOR_KEY,
  GENERATOR_RESULT_CONTRACT_VALIDATOR_KEY,
  PERSISTENCE_VALIDATION_VALIDATOR_KEY,
  classifyGeneratorResult,
  GENERATOR_RESULT_REASONS,
  GENERATOR_RESULT_REASON,
});
