import crypto from "node:crypto";

import { withTransaction } from "../db/kaiDb.js";
import { evaluateClaimTraceabilityInTransaction } from "./postgresClaimTraceabilityRepository.js";
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

const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  duplicate_conflict: 409,
  not_found: 404,
  system_error: 500,
});

const CONTENT_TYPE = "evidence_summary";
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
const SHA256_LOWER_PATTERN = /^[0-9a-f]{64}$/;

const COMPLETE_REVIEW_FRESH_PROFILE = GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES[1];
const COMPLETE_REVIEW_RESOLVED_PROFILE = GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES[2];
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

function failure(code) {
  return { ok: false, data: null, error: { code, status: RESULT_STATUS[code] || 500 } };
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

function rollbackFailure(code) {
  throw new RollbackResultError(failure(code));
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

export function fingerprintEvidenceSummaryRequest({ requestedAudience, claimIds }) {
  return crypto
    .createHash("sha256")
    .update(canonicalJson({ contentType: CONTENT_TYPE, requestedAudience, claimIds }))
    .digest("hex");
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
  return hasExactKeys(input, new Set(["organizationId", "requestedAudience", "claimIds", "idempotencyKey", "actorContext", "now"]))
    && UUID_PATTERN.test(input.organizationId)
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
  if (input.contentType !== CONTENT_TYPE || !AUDIENCES.has(input.requestedAudience)) return false;
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

function validateGeneratorResult(result) {
  if (!hasExactKeys(result, new Set(["blocks"])) || !Array.isArray(result.blocks)) return false;
  if (result.blocks.length < 1 || result.blocks.length > 20) return false;
  let totalText = 0;
  const ordinals = result.blocks.map((block) => block.ordinal);
  if (!ordinals.every((ordinal, index) => ordinal === index + 1)) return false;
  for (const block of result.blocks) {
    if (!hasExactKeys(block, new Set(["ordinal", "text", "citations"]))) return false;
    if (typeof block.text !== "string" || block.text.length < 1 || block.text.length > 4000) return false;
    totalText += block.text.length;
    if (!Array.isArray(block.citations) || block.citations.length < 1) return false;
    const seen = new Set();
    for (const citation of block.citations) {
      if (!hasExactKeys(citation, new Set(["claimId", "evidenceItemId"]))) return false;
      if (!UUID_PATTERN.test(citation.claimId) || !UUID_PATTERN.test(citation.evidenceItemId)) return false;
      const key = `${citation.claimId}:${citation.evidenceItemId}`;
      if (seen.has(key)) return false;
      seen.add(key);
    }
  }
  return totalText <= 20000;
}

function prepareRequiredAudit(metadataOnlyAudit, payload) {
  const prepared = metadataOnlyAudit?.prepareMetadataOnlyAudit?.({ payload });
  const descriptor =
    prepared !== null && typeof prepared === "object" && !Array.isArray(prepared)
      ? Object.getOwnPropertyDescriptor(prepared, "ok")
      : undefined;
  if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.value !== true || typeof prepared.publish !== "function") {
    throw new Error("required_audit_prepare_failed");
  }
  return prepared;
}

async function insertRunReservation(tx, input, requestFingerprint) {
  const { rows } = await tx.query(
    `INSERT INTO kai.generation_runs (
       organization_id, idempotency_key, request_fingerprint, content_type,
       requested_audience, created_by_type, created_at
     )
     VALUES ($1::uuid,$2,$3,$4,$5,'system',$6::timestamptz)
     ON CONFLICT (organization_id, idempotency_key) DO NOTHING
     RETURNING generation_run_id::text AS generation_run_id`,
    [input.organizationId, input.idempotencyKey, requestFingerprint, CONTENT_TYPE, input.requestedAudience, input.now],
  );
  return rows[0] || null;
}

async function readExistingState(tx, { organizationId, idempotencyKey }) {
  const runRows = await tx.query(
    `SELECT generation_run_id::text AS generation_run_id, organization_id::text AS organization_id,
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
            organization_id::text AS organization_id, request_fingerprint,
            content_type, requested_audience
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
            review_status, assigned_to, due_at, summary, required_action
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND target_object_type = $2
        AND target_object_id = $3::uuid
        AND queue_type = $4
      ORDER BY review_queue_item_id ASC`,
    [organizationId, REVIEW_TARGET_TYPE, generatedContentDraftId, REVIEW_QUEUE_TYPE],
  );
  return {
    run: runRows.rows[0] || null,
    draft,
    siblingDrafts: siblingDraftRows.rows,
    blocks: blockRows.rows,
    citations: citationRows.rows,
    queues: queueRows.rows,
  };
}

function validateExistingState(state, requestFingerprint, requestedAudience) {
  if (!state?.run) return false;
  if (state.run.request_fingerprint !== requestFingerprint) return "duplicate_conflict";
  if (state.run.content_type !== CONTENT_TYPE || state.run.requested_audience !== requestedAudience || state.run.created_by_type !== "system") return false;
  if (state.drafts.length !== 1 || state.queues.length !== 1 || state.blocks.length < 1) return false;
  const draft = state.drafts[0];
  if (
    draft.generation_run_id !== state.run.generation_run_id ||
    draft.content_type !== CONTENT_TYPE ||
    draft.requested_audience !== requestedAudience ||
    draft.draft_status !== DRAFT_STATUS ||
    draft.review_status !== REVIEW_STATUS ||
    draft.created_by_type !== "system"
  ) return false;
  if (!state.blocks.every((block, index) => block.ordinal === index + 1)) return false;
  const citedBlockIds = new Set(state.citations.map((citation) => citation.generated_content_block_id));
  if (!state.blocks.every((block) => citedBlockIds.has(block.generated_content_block_id))) return false;
  const queue = state.queues[0];
  if (!isGeneratedContentReviewQueueRow(queue, {
    organizationId: state.run.organization_id,
    targetObjectId: draft.generated_content_draft_id,
    requireCreatedByType: true,
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
  const runKeys = new Set(["generation_run_id", "organization_id", "request_fingerprint", "content_type", "requested_audience"]);
  const draftKeys = new Set(["generated_content_draft_id", "generation_run_id", "organization_id", "content_type", "requested_audience", "draft_status", "review_status"]);
  const blockKeys = new Set(["generated_content_block_id", "generated_content_draft_id", "organization_id", "ordinal", "text"]);
  const citationKeys = new Set(["generated_content_citation_id", "generated_content_block_id", "organization_id", "claim_id", "evidence_item_id", "block_ordinal"]);
  if (!state?.run || !state?.draft) return false;
  if (!hasOnlyAllowedKeys(state.run, runKeys) || !hasOnlyAllowedKeys(state.draft, draftKeys)) return "system_error";
  if (!state.blocks.every((block) => hasOnlyAllowedKeys(block, blockKeys))) return "system_error";
  if (!state.citations.every((citation) => hasOnlyAllowedKeys(citation, citationKeys))) return "system_error";
  if (state.run.organization_id !== organizationId || state.run.content_type !== CONTENT_TYPE) return false;
  if (!SHA256_LOWER_PATTERN.test(state.run.request_fingerprint)) return false;
  if (state.siblingDrafts.length !== 1) return false;
  if (state.siblingDrafts[0].generated_content_draft_id !== generatedContentDraftId) return false;
  if (
    state.draft.generated_content_draft_id !== generatedContentDraftId ||
    state.draft.organization_id !== organizationId ||
    state.draft.generation_run_id !== state.run.generation_run_id ||
    state.draft.content_type !== CONTENT_TYPE ||
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
  const queueKeys = new Set(["review_queue_item_id", "organization_id", "queue_type", "target_object_type", "target_object_id", "priority", "queue_status", "review_status", "assigned_to", "due_at", "summary", "required_action"]);
  if (!state.queues.every((queue) => hasOnlyAllowedKeys(queue, queueKeys))) return "system_error";
  if (state.queues.length !== 1) return false;
  const queue = state.queues[0];
  if (!isGeneratedContentReviewQueueRow(queue, { organizationId, targetObjectId: generatedContentDraftId, allowedLifecycleProfiles })) return false;
  return true;
}

function validateReviewPacketRows(state, { organizationId, generatedContentDraftId }, allowedLifecycleProfiles = [GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES[0]]) {
  const graph = validateImmutableGraphRows(state, { organizationId, generatedContentDraftId });
  if (graph === false || graph === "system_error") return graph;
  const queueValidation = validateGeneratedContentReviewQueueRows(state, { organizationId, generatedContentDraftId }, allowedLifecycleProfiles);
  if (queueValidation === false || queueValidation === "system_error") return queueValidation;
  return graph;
}

function validateTraceabilityData(data, { claimId, requestedAudience }) {
  const rootKeys = new Set([
    "claim",
    "evidence",
    "locator",
    "source",
    "source_version",
    "claim_review",
    "candidate",
    "promotion_decision",
    "dimensions",
    "gap_items",
    "client_followup_workflows",
    "potential_conflict_groups",
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
  if (!hasOnlyAllowedKeys(data.evidence, new Set(["evidence_item_id", "evidence_review_status", "support_strength", "review_queue_item_id", "review_queue_status", "review_status"]))) return false;
  if (!hasOnlyAllowedKeys(data.source, new Set(["source_id", "source_code"]))) return false;
  if (!hasOnlyAllowedKeys(data.source_version, new Set(["source_version_id", "is_current"]))) return false;
  return data.claim.claim_id === claimId
    && UUID_PATTERN.test(data.evidence.evidence_item_id)
    && UUID_PATTERN.test(data.source.source_id)
    && UUID_PATTERN.test(data.source_version.source_version_id)
    && data.source_version.is_current === true
    && typeof data.evidence.support_strength === "string"
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
    return { ordinal: block.ordinal, text: block.text, citations };
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
    currentUseEligible: [...evaluatedByClaim.values()].every((evaluated) => evaluated.eligible === true),
    blocks,
  });
}

async function loadGenerationProjection(tx, { organizationId, claimIds, requestedAudience }) {
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
      funder: row.funder_use_allowed === true,
      public: row.public_use_allowed === true,
    },
  }));
}

function toGeneratorInput({ requestedAudience, projections }) {
  const input = {
    contentType: CONTENT_TYPE,
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

async function persistCompleteSet(tx, { input, runId, generatorResult, validation, projections }) {
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
      CONTENT_TYPE,
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
     VALUES ($1::uuid,NULL,$2,$3,$4::uuid,'normal','open',$5,NULL,NULL,NULL,$6,$7,'{}'::jsonb,NULL,'system',$8::timestamptz,$8::timestamptz)
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

async function rereadAsResult(tx, input, requestFingerprint, replayed) {
  const state = await readExistingState(tx, input);
  const validation = validateExistingState(state, requestFingerprint, input.requestedAudience);
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
            queue_metadata, created_by::text AS created_by, created_by_type
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
          return evaluateGeneratedDraftReviewPacketInTransaction(tx, input, evaluator);
        });
      } catch (error) {
        if (error instanceof RollbackResultError) return error.result;
        if (error?.code === "22P02") return failure("validation_blocker");
        if (error?.code === "25001") return failure("conflict_current_state_changed");
        return failure("system_error");
      }
    },
    async createEvidenceSummaryDraft(input, dependencies = {}) {
      if (!validateInput(input)) return failure("validation_blocker");
      if (typeof dependencies.draftGenerator !== "function") return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");
      const requestFingerprint = fingerprintEvidenceSummaryRequest(input);

      try {
        return await runInTransaction(async (tx) => {
          const reservation = await insertRunReservation(tx, input, requestFingerprint);
          if (!reservation) return rereadAsResult(tx, input, requestFingerprint, true);

          const eligibleResults = [];
          for (const claimId of input.claimIds) {
            const result = await evaluator(tx, {
              organizationId: input.organizationId,
              claimId,
              requestedAudience: input.requestedAudience,
            });
            if (!result.ok || result.data?.eligible !== true || result.data?.requestedAudience !== input.requestedAudience) {
              rollbackFailure("validation_blocker");
            }
            eligibleResults.push(result.data);
          }

          const projections = await loadGenerationProjection(tx, input);
          if (!projections) rollbackFailure("conflict_current_state_changed");
          const projectionByClaim = new Map(projections.map((claim) => [claim.claimId, claim]));
          for (const eligible of eligibleResults) {
            const projection = projectionByClaim.get(eligible.claim.claim_id);
            if (!projection || projection.evidenceItemId !== eligible.evidence.evidence_item_id) {
              rollbackFailure("conflict_current_state_changed");
            }
          }

          const generatorInput = toGeneratorInput({ requestedAudience: input.requestedAudience, projections });
          const generatorResult = await dependencies.draftGenerator(generatorInput);
          if (!validateGeneratorResult(generatorResult)) rollbackFailure("validation_blocker");

          const validation = validateGeneratedContentDraft({
            requestedAudience: input.requestedAudience,
            eligibleClaims: projections.map((projection) => ({
              ...projection,
              revalidatedEligible: true,
            })),
            blocks: generatorResult.blocks,
            draftAudience: input.requestedAudience,
          });
          if (!validation.ok) rollbackFailure("validation_blocker");

          for (const claim of projections) {
            const result = await evaluator(tx, {
              organizationId: input.organizationId,
              claimId: claim.claimId,
              requestedAudience: input.requestedAudience,
            });
            if (!result.ok || result.data?.eligible !== true || result.data?.evidence?.evidence_item_id !== claim.evidenceItemId) {
              rollbackFailure("conflict_current_state_changed");
            }
          }

          const persisted = await persistCompleteSet(tx, {
            input,
            runId: reservation.generation_run_id,
            generatorResult,
            validation,
            projections,
          });
          await afterPersist(tx, persisted);
          const postWrite = await rereadAsResult(tx, input, requestFingerprint, false);
          if (!postWrite.ok) throw new RollbackResultError(postWrite);

          const preparedAudit = prepareRequiredAudit(dependencies.metadataOnlyAudit, {
            attempted_operation: AUDIT_OPERATION,
            actor_type: "human",
            object_type: "generated_content_draft",
            request_scope: "organization_generated_content_draft",
            contract: AUDIT_CONTRACT,
          });
          await insertAudit(tx, { input, persisted, projections });
          await preparedAudit.publish();
          return postWrite;
        });
      } catch (error) {
        if (error instanceof RollbackResultError) return error.result;
        if (error?.code === "23505") return failure("conflict_current_state_changed");
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") return failure("validation_blocker");
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
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") return failure("validation_blocker");
        if (error?.code === "25001") return failure("conflict_current_state_changed");
        return failure("system_error");
      }
    },
  });
}

export const __generatedContentRepositoryContract = Object.freeze({
  CONTENT_TYPE,
  DRAFT_STATUS,
  REVIEW_STATUS,
  REVIEW_QUEUE_TYPE,
  REVIEW_TARGET_TYPE,
  REVIEW_SUMMARY,
  REVIEW_REQUIRED_ACTION,
  AUDIT_OPERATION,
  AUDIT_CONTRACT,
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
});

export const __generatedContentRepositoryTestables = Object.freeze({
  validateGeneratorInput,
  validateGeneratorResult,
  validateInput,
  validateReviewPacketInput,
  validateReviewPacketRows,
  validateCompleteReviewInput,
  fingerprintEvidenceSummaryRequest,
  prepareRequiredAudit,
  validateRequestExportReviewInput,
  validateExportReviewRequestStateInput,
  isExportReviewQueueContractRow,
  validateStartExportReviewInput,
});
