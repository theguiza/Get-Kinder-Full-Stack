// KAI P14-09 diagnostic propagation ONLY: proves that every reachable
// validation_blocker branch inside createGeneratedContentDraft (shared by
// createEvidenceSummaryDraft and createImpactNarrativeDraft) now surfaces
// safe structured blocker metadata all the way through
// repository -> service -> API response, instead of the previously silent
// { blockers: [] }. This suite does not change, weaken, or reorder any
// validator/eligibility/persistence decision - every case here proves the
// existing pass/block outcome is unchanged and only the diagnostic detail
// attached to an already-blocked response is new.

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createEvidenceSummaryDraft } from "../Backend/kai/services/kaiGeneratedContentService.js";
import {
  createPostgresGeneratedContentRepository,
  __generatedContentRepositoryTestables,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import { validateGeneratedContentDraft } from "../Backend/kai/validators/kaiGeneratedContentValidators.js";

const {
  TRACEABILITY_RESULT_CONTRACT_VALIDATOR_KEY,
  GENERATOR_RESULT_CONTRACT_VALIDATOR_KEY,
  PERSISTENCE_VALIDATION_VALIDATOR_KEY,
} = __generatedContentRepositoryTestables;

const ORG = "00000000-0000-4000-8000-000000000001";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000501";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";
const OTHER_EVIDENCE = "00000000-0000-4000-8000-000000000202";
const SOURCE = "00000000-0000-4000-8000-000000000301";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000401";
const NOW = "2026-08-06T10:00:00.000Z";
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
  ],
});

function auditRecorder() {
  return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
}

// --- fake authoritative transaction (mirrors the p14-09 funder-evidence-
// summary-boundary suite's fake-tx dispatch-by-SQL-text convention) ---

function claimRow(overrides = {}) {
  return {
    claim_id: CLAIM,
    claim_statement: "Enrollment increased by 12% in 2025.",
    claim_type: "finding",
    evidence_item_id: EVIDENCE,
    internal_only: true,
    funder_use_allowed: true,
    public_use_allowed: false,
    source_id: SOURCE,
    source_version_id: SOURCE_VERSION,
    intake_file_id: "00000000-0000-4000-8000-000000000901",
    upload_state: "confirmed",
    ...overrides,
  };
}

function makeState({ claims = [claimRow()], forcePersistenceErrorCode = null } = {}) {
  return {
    generationRuns: [],
    generatedContentDrafts: [],
    generatedContentBlocks: [],
    generatedContentCitations: [],
    reviewQueueItems: [],
    uploadLifecycleAudit: [],
    claims,
    forcePersistenceErrorCode,
  };
}

function makeFakeTx(draft) {
  return {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();

      if (s.startsWith("INSERT INTO kai.generation_runs")) {
        const [organizationId, engagementId, idempotencyKey, requestFingerprint, contentType, requestedAudience, now] = params;
        const conflict = draft.generationRuns.some((r) => r.organization_id === organizationId && r.idempotency_key === idempotencyKey);
        if (conflict) return { rows: [] };
        const row = {
          generation_run_id: randomUUID(),
          organization_id: organizationId,
          engagement_id: engagementId,
          idempotency_key: idempotencyKey,
          request_fingerprint: requestFingerprint,
          content_type: contentType,
          requested_audience: requestedAudience,
          created_by_type: "system",
          created_at: now,
        };
        draft.generationRuns.push(row);
        return { rows: [{ generation_run_id: row.generation_run_id }] };
      }

      if (s.startsWith("SELECT generation_run_id::text AS generation_run_id")) {
        const [organizationId, idempotencyKey] = params;
        const row = draft.generationRuns.find((r) => r.organization_id === organizationId && r.idempotency_key === idempotencyKey);
        return { rows: row ? [row] : [] };
      }

      if (s.startsWith("SELECT generated_content_draft_id::text AS generated_content_draft_id, generation_run_id")) {
        const [organizationId, generationRunId] = params;
        const rows = draft.generatedContentDrafts.filter((d) => d.organization_id === organizationId && d.generation_run_id === generationRunId);
        return { rows };
      }

      if (s.startsWith("INSERT INTO kai.generated_content_drafts")) {
        const [generationRunId, organizationId, contentType, requestedAudience, draftStatus, reviewStatus, , now] = params;
        const row = {
          generated_content_draft_id: randomUUID(),
          generation_run_id: generationRunId,
          organization_id: organizationId,
          content_type: contentType,
          requested_audience: requestedAudience,
          draft_status: draftStatus,
          review_status: reviewStatus,
          created_by_type: "system",
          created_at: now,
        };
        draft.generatedContentDrafts.push(row);
        return { rows: [{ generated_content_draft_id: row.generated_content_draft_id }] };
      }

      if (s.startsWith("SELECT generated_content_block_id::text AS generated_content_block_id")) {
        const [organizationId, draftId] = params;
        const rows = draft.generatedContentBlocks
          .filter((b) => b.organization_id === organizationId && b.generated_content_draft_id === draftId)
          .sort((a, b) => a.ordinal - b.ordinal);
        return { rows };
      }

      if (s.startsWith("INSERT INTO kai.generated_content_blocks")) {
        if (draft.forcePersistenceErrorCode) {
          throw Object.assign(new Error("simulated persistence constraint failure"), { code: draft.forcePersistenceErrorCode });
        }
        const [draftId, organizationId, ordinal, text, now] = params;
        const row = {
          generated_content_block_id: randomUUID(),
          generated_content_draft_id: draftId,
          organization_id: organizationId,
          ordinal,
          text,
          created_at: now,
        };
        draft.generatedContentBlocks.push(row);
        return { rows: [{ generated_content_block_id: row.generated_content_block_id }] };
      }

      if (s.startsWith("SELECT c.generated_content_citation_id::text AS generated_content_citation_id")) {
        const [organizationId, draftId] = params;
        const blockIds = new Set(draft.generatedContentBlocks.filter((b) => b.generated_content_draft_id === draftId).map((b) => b.generated_content_block_id));
        const rows = draft.generatedContentCitations.filter((c) => c.organization_id === organizationId && blockIds.has(c.generated_content_block_id));
        return { rows };
      }

      if (s.startsWith("INSERT INTO kai.generated_content_citations")) {
        const [blockId, organizationId, claimId, evidenceItemId, now] = params;
        draft.generatedContentCitations.push({
          generated_content_citation_id: randomUUID(),
          generated_content_block_id: blockId,
          organization_id: organizationId,
          claim_id: claimId,
          evidence_item_id: evidenceItemId,
          created_at: now,
        });
        return { rows: [] };
      }

      if (s.startsWith("SELECT c.claim_id::text AS claim_id")) {
        const [, claimIds] = params;
        const rows = draft.claims
          .filter((c) => claimIds.includes(c.claim_id))
          .sort((a, b) => (a.claim_id < b.claim_id ? -1 : 1));
        return { rows };
      }

      if (s.startsWith("SELECT review_queue_item_id::text AS review_queue_item_id") && s.includes("queue_type = $2") && !s.includes("updated_at")) {
        const [organizationId, queueType, targetObjectType, targetObjectId] = params;
        const rows = draft.reviewQueueItems.filter((q) =>
          q.organization_id === organizationId
          && q.queue_type === queueType
          && q.target_object_type === targetObjectType
          && q.target_object_id === targetObjectId);
        return { rows };
      }

      if (s.startsWith("INSERT INTO kai.review_queue_items")) {
        const [organizationId, queueType, targetObjectType, targetObjectId, reviewStatus, summary, requiredAction, now] = params;
        const row = {
          review_queue_item_id: randomUUID(),
          organization_id: organizationId,
          engagement_id: null,
          queue_type: queueType,
          target_object_type: targetObjectType,
          target_object_id: targetObjectId,
          priority: "medium",
          queue_status: "open",
          review_status: reviewStatus,
          blocked_reason: null,
          assigned_to: null,
          due_at: null,
          summary,
          required_action: requiredAction,
          queue_metadata: {},
          created_by: null,
          created_by_type: "system",
          created_at: now,
          updated_at: now,
        };
        draft.reviewQueueItems.push(row);
        return { rows: [{ review_queue_item_id: row.review_queue_item_id }] };
      }

      if (s.startsWith("INSERT INTO kai.upload_lifecycle_audit")) {
        const [organizationId, intakeFileId, operation, fromState, metadataJson, now] = params;
        draft.uploadLifecycleAudit.push({ organization_id: organizationId, intake_file_id: intakeFileId, operation, from_state: fromState, metadata: JSON.parse(metadataJson), created_at: now });
        return { rows: [] };
      }

      throw new Error(`unhandled fake query: ${s}`);
    },
  };
}

function withFakeTransaction(state) {
  return async (callback) => {
    const draft = structuredClone(state);
    const result = await callback(makeFakeTx(draft));
    for (const key of Object.keys(draft)) state[key] = draft[key];
    return result;
  };
}

function makeEvaluator({ eligibleForClaim = () => true, malformedOnCall = null } = {}) {
  const callCounts = new Map();
  return async (tx, { claimId, requestedAudience }) => {
    const n = (callCounts.get(claimId) || 0) + 1;
    callCounts.set(claimId, n);
    if (malformedOnCall === n) {
      // Simulates a malformed/mismatched evaluator result: ok:true but the
      // returned claim/evidence identity does not match what was requested.
      return {
        ok: true,
        data: {
          claim: { claim_id: "00000000-0000-4000-8000-000000000999" },
          evidence: { evidence_item_id: null },
          requestedAudience,
          eligible: true,
          blockerCodes: [],
        },
        error: null,
      };
    }
    return {
      ok: true,
      data: {
        claim: { claim_id: claimId },
        evidence: { evidence_item_id: EVIDENCE },
        requestedAudience,
        eligible: eligibleForClaim(claimId, n),
        blockerCodes: [],
        affectedDimensionKeys: [],
        affectedObjectIds: [],
      },
      error: null,
    };
  };
}

function makeRepository(state, evaluator) {
  return createPostgresGeneratedContentRepository({
    runInTransaction: withFakeTransaction(state),
    evaluator,
  });
}

function evidenceSummaryInput(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    requestedAudience: "internal",
    claimIds: [CLAIM],
    idempotencyKey: "p14-09-diag-key",
    actorContext,
    now: NOW,
    ...overrides,
  };
}

function goodGenerator() {
  return async (input) => ({
    blocks: [{
      ordinal: 1,
      text: input.claims[0].claimStatement,
      citations: [{ claimId: input.claims[0].claimId, evidenceItemId: input.claims[0].evidenceItemId }],
    }],
  });
}

// --- CASE A + B: a real VAL-GEN validator failure (unauthorized/unresolved
// citation reference) must surface the existing validator_key and
// blocking_reason produced by validateGeneratedContentDraft itself - never a
// route-manufactured stand-in. ---

test("P14-09 diagnostic propagation CASE A/B: an unresolved citation reference surfaces the real VAL-GEN-002/VAL-GEN-003 blockers end-to-end through the service", async () => {
  const state = makeState();
  const evaluator = makeEvaluator();
  const repository = makeRepository(state, evaluator);
  const mismatchedGenerator = async (input) => ({
    blocks: [{
      ordinal: 1,
      text: input.claims[0].claimStatement,
      // Structurally valid (passes validateGeneratorResult) but cites an
      // evidence item the requested claim was never projected against.
      citations: [{ claimId: input.claims[0].claimId, evidenceItemId: OTHER_EVIDENCE }],
    }],
  });

  // Independently compute the expected blocker set directly from the real
  // validator, to prove the propagated blockers are not manufactured.
  const expected = validateGeneratedContentDraft({
    requestedAudience: "internal",
    generationClaims: [{
      claimId: CLAIM,
      evidenceItemId: EVIDENCE,
      claimStatement: claimRow().claim_statement,
      requestedAudience: "internal",
      revalidatedForGeneration: true,
      currentEligible: true,
      audienceAuthority: { internal: true, funder: false, public: false },
    }],
    blocks: [{ ordinal: 1, text: claimRow().claim_statement, citations: [{ claimId: CLAIM, evidenceItemId: OTHER_EVIDENCE }] }],
    draftAudience: "internal",
  });
  assert.equal(expected.ok, false);
  const expectedKeys = expected.blockers.map((b) => b.validator_key).sort();
  assert.deepEqual(expectedKeys, ["VAL-GEN-002", "VAL-GEN-003"]);

  const result = await createEvidenceSummaryDraft(evidenceSummaryInput(), {
    generatedContentRepository: {
      createEvidenceSummaryDraft: (input, deps) => repository.createEvidenceSummaryDraft(input, deps),
    },
    getEngagementForOrganization: async () => ({ engagement_id: ENGAGEMENT, organization_id: ORG }),
    draftGenerator: mismatchedGenerator,
    metadataOnlyAudit: auditRecorder(),
    env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.error.status, 422);
  const gotKeys = result.blockers.map((b) => b.validator_key).sort();
  assert.deepEqual(gotKeys, expectedKeys);
  const byKey = new Map(result.blockers.map((b) => [b.validator_key, b]));
  assert.equal(byKey.get("VAL-GEN-002").blocking_reason, "missing_or_unresolved_exact_citation");
  assert.equal(byKey.get("VAL-GEN-003").blocking_reason, "unauthorized_claim_reference");

  // No durable state from the blocked attempt.
  assert.equal(state.generationRuns.length, 0);
  assert.equal(state.generatedContentDrafts.length, 0);
});

// --- CASE C: VAL-GEN-004 unsupported numeric/causal assertion ---

test("P14-09 diagnostic propagation CASE C: an unsupported causal assertion surfaces VAL-GEN-004", async () => {
  const state = makeState();
  const evaluator = makeEvaluator();
  const repository = makeRepository(state, evaluator);
  const causalGenerator = async (input) => ({
    blocks: [{
      ordinal: 1,
      text: "Enrollment caused 13% growth in 2025.",
      citations: [{ claimId: input.claims[0].claimId, evidenceItemId: input.claims[0].evidenceItemId }],
    }],
  });

  const result = await repository.createEvidenceSummaryDraft(evidenceSummaryInput({ idempotencyKey: "p14-09-diag-004" }), {
    draftGenerator: causalGenerator,
    metadataOnlyAudit: auditRecorder(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.ok(result.blockers.some((b) => b.validator_key === "VAL-GEN-004" && b.blocking_reason === "unsupported_numeric_or_causal_assertion"));
});

// --- CASE D: VAL-GEN-005 audience-authority failure ---

test("P14-09 diagnostic propagation CASE D: a claim without internal audience authority surfaces VAL-GEN-005 / draft_audience_exceeds_authority", async () => {
  const state = makeState({ claims: [claimRow({ internal_only: false })] });
  const evaluator = makeEvaluator();
  const repository = makeRepository(state, evaluator);

  const result = await repository.createEvidenceSummaryDraft(evidenceSummaryInput({ idempotencyKey: "p14-09-diag-005" }), {
    draftGenerator: goodGenerator(),
    metadataOnlyAudit: auditRecorder(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.deepEqual(result.blockers.map((b) => b.validator_key), ["VAL-GEN-005"]);
  assert.equal(result.blockers[0].blocking_reason, "draft_audience_exceeds_authority");
});

// --- CASE E: generator-result contract invalid (fail-closed, bounded stage
// discriminator only - no VAL-GEN key, since the VAL-GEN validator never ran) ---

test("P14-09 diagnostic propagation CASE E: an invalid generator result (e.g. empty blocks) remains fail-closed with only the bounded generator-result discriminator", async () => {
  const state = makeState();
  const evaluator = makeEvaluator();
  const repository = makeRepository(state, evaluator);

  const result = await repository.createEvidenceSummaryDraft(evidenceSummaryInput({ idempotencyKey: "p14-09-diag-e" }), {
    draftGenerator: async () => ({ blocks: [] }),
    metadataOnlyAudit: auditRecorder(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.error.status, 422);
  assert.deepEqual(result.blockers, [{
    validator_key: GENERATOR_RESULT_CONTRACT_VALIDATOR_KEY,
    severity: "blocker",
    blocking_reason: "generator_result_blocks_empty",
  }]);
  assert.equal(state.generationRuns.length, 0);
  assert.equal(state.generatedContentDrafts.length, 0);
});

// --- CASE F: malformed traceability-result contract ---

test("P14-09 diagnostic propagation CASE F: a malformed pre-generation traceability result remains fail-closed with only the bounded traceability-result discriminator", async () => {
  const state = makeState();
  const evaluator = makeEvaluator({ malformedOnCall: 1 });
  const repository = makeRepository(state, evaluator);

  const result = await repository.createEvidenceSummaryDraft(evidenceSummaryInput({ idempotencyKey: "p14-09-diag-f" }), {
    draftGenerator: goodGenerator(),
    metadataOnlyAudit: auditRecorder(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.deepEqual(result.blockers, [{
    validator_key: TRACEABILITY_RESULT_CONTRACT_VALIDATOR_KEY,
    severity: "blocker",
    blocking_reason: "traceability_result_contract_invalid",
  }]);
  assert.equal(state.generationRuns.length, 0);
});

// --- CASE G: persistence-originated validation mapping ---

test("P14-09 diagnostic propagation CASE G: an existing mapped persistence validation failure (23503) keeps its 422/validation_blocker semantics and exposes only the bounded persistence discriminator, never raw DB detail", async () => {
  const state = makeState({ forcePersistenceErrorCode: "23503" });
  const evaluator = makeEvaluator();
  const repository = makeRepository(state, evaluator);

  const result = await repository.createEvidenceSummaryDraft(evidenceSummaryInput({ idempotencyKey: "p14-09-diag-g" }), {
    draftGenerator: goodGenerator(),
    metadataOnlyAudit: auditRecorder(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.error.status, 422);
  assert.deepEqual(result.blockers, [{
    validator_key: PERSISTENCE_VALIDATION_VALIDATOR_KEY,
    severity: "blocker",
    blocking_reason: "persistence_validation_rejected",
  }]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("simulated"), false);
  assert.equal(serialized.includes("23503"), false);
});

// --- CASE H: successful generation is behaviorally unchanged (no blockers key) ---

test("P14-09 diagnostic propagation CASE H: a successful generation carries no blockers key at all", async () => {
  const state = makeState();
  const evaluator = makeEvaluator();
  const repository = makeRepository(state, evaluator);

  const result = await repository.createEvidenceSummaryDraft(evidenceSummaryInput({ idempotencyKey: "p14-09-diag-h" }), {
    draftGenerator: goodGenerator(),
    metadataOnlyAudit: auditRecorder(),
  });

  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result, "blockers"), false);
});

// --- CASE I: funder eligibility branches are untouched by this repair (no
// blockers attached; distinct error code from validation_blocker) ---

test("P14-09 diagnostic propagation CASE I: funder eligibility loss still returns funder_use_not_currently_eligible with no blockers attached (unchanged by this repair)", async () => {
  const state = makeState();
  const evaluator = makeEvaluator({ eligibleForClaim: () => false });
  const repository = makeRepository(state, evaluator);

  const result = await repository.createEvidenceSummaryDraft(
    evidenceSummaryInput({ requestedAudience: "funder", idempotencyKey: "p14-09-diag-i" }),
    { draftGenerator: goodGenerator(), metadataOnlyAudit: auditRecorder() },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "funder_use_not_currently_eligible");
  assert.equal(Object.hasOwn(result, "blockers"), false);
});
