import crypto from "node:crypto";

import { withTransaction } from "../db/kaiDb.js";
import { evaluateClaimTraceabilityInTransaction } from "./postgresClaimTraceabilityRepository.js";
import { validateGeneratedContentDraft } from "../validators/kaiGeneratedContentValidators.js";

const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  duplicate_conflict: 409,
  not_found: 404,
  system_error: 500,
});

const CONTENT_TYPE = "evidence_summary";
const DRAFT_STATUS = "draft";
const REVIEW_STATUS = "needs_gk_review";
const REVIEW_QUEUE_TYPE = "generated_content_review";
const REVIEW_TARGET_TYPE = "generated_content_draft";
const REVIEW_SUMMARY = "Generated draft requires human review.";
const REVIEW_REQUIRED_ACTION =
  "Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.";
const AUDIT_OPERATION = "generated_content_draft_created";
const AUDIT_CONTRACT = "p3_01_generated_content_draft_v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AUDIENCES = new Set(["internal", "funder", "public"]);

function failure(code) {
  return { ok: false, data: null, error: { code, status: RESULT_STATUS[code] || 500 } };
}

function success(data) {
  return { ok: true, data, error: null };
}

class RollbackResultError extends Error {
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
  if (
    queue.target_object_id !== draft.generated_content_draft_id ||
    queue.priority !== "normal" ||
    queue.queue_status !== "open" ||
    queue.review_status !== REVIEW_STATUS ||
    queue.summary !== REVIEW_SUMMARY ||
    queue.required_action !== REVIEW_REQUIRED_ACTION ||
    queue.assigned_to !== null ||
    queue.due_at !== null ||
    queue.created_by_type !== "system"
  ) return false;
  return true;
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

export function createPostgresGeneratedContentRepository({
  runInTransaction = withTransaction,
  evaluator = evaluateClaimTraceabilityInTransaction,
  afterPersist = async () => {},
} = {}) {
  return Object.freeze({
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
});

export const __generatedContentRepositoryTestables = Object.freeze({
  validateGeneratorInput,
  validateGeneratorResult,
  validateInput,
  fingerprintEvidenceSummaryRequest,
  prepareRequiredAudit,
});
