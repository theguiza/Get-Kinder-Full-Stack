// P3-18 ASSEMBLED PRE-ARTIFACT RELEASE PROOF
//
// Threads ONE consistent generated-content-draft/export-candidate identity
// through the REAL, unmodified existing services:
//
//   generated draft
//     -> generated-content review completion
//     -> export-review request
//     -> export-review start
//     -> export-review completion
//     -> export candidate
//     -> P3-17 human grant (real recordDecision, real evaluateEffectiveness)
//     -> P3-17 evaluateEffectiveness (real, standalone, feeding the gate)
//     -> final-gate composition (real, unmodified evaluateFinalExportEligibility)
//     -> VAL-EXP-001 finalGate=true
//
// Steps 1-6 (draft through export candidate) inject a repository-object-
// level fake (the same seam every one of these services already exposes,
// and the same seam already used by
// kai-sprint2-p3-export-operational-composition-route.spec.js), so the REAL
// service-layer validation/authorization/orchestration in
// kaiGeneratedContentService.js, kaiExportReviewService.js, and
// kaiExportCandidateService.js runs for real and threads real DTOs forward.
//
// Steps 7-10 (grant, effectiveness, final-gate, VAL-EXP-001) use the REAL
// P3-17 repository (createPostgresHumanAuthorityDecisionRepository, not
// reimplemented) and the REAL P3-16 currentness evaluator
// (evaluateExportCandidateCurrentnessInTransaction, its own default) against
// a scripted raw fakeTx - the exact technique already used and reviewed in
// kai-sprint2-p3-18-final-export-eligibility-gate-authority-state-proof.spec.js
// - plus the REAL, unmodified evaluateFinalExportEligibility and the REAL,
// unmodified VAL-EXP-001 validator it calls.
//
// KNOWN, OUT-OF-SCOPE, PRE-EXISTING SCHEMA BOUNDARY (disclosed, not fixed):
// migrations/kai_sprint2_p3_01_generated_content_drafts.sql enforces
// `CHECK (draft_status = 'draft')` - no real generated_content_drafts row
// can ever have any other draft_status. VAL-EXP-001 therefore always fails
// `generated_content_still_draft` against genuinely real draft rows, so
// finalGate=true PASS is not reachable against real production data today
// regardless of authority; reaching it requires a future, separately
// authorized schema/product decision (already flagged in the living
// ExecPlan as follow-on work beyond P3-17/P3-18). To exercise the PASS
// branch of the real, unmodified final-gate composition here, the resolved
// export-review packet's draftStatus is injected as "final" - the exact
// same synthetic-draftStatus technique already used, and already accepted,
// in the STATE B case of the prior committed authority-state-proof file.
// This override touches only the generated-content-review-packet input
// field, never authority or currentness, which stay fully real throughout.

import test from "node:test";
import assert from "node:assert/strict";

import { createEvidenceSummaryDraft, completeGeneratedContentReview } from "../Backend/kai/services/kaiGeneratedContentService.js";
import {
  requestGeneratedDraftExportReview,
  startGeneratedDraftExportReview,
  completeGeneratedDraftExportReview,
} from "../Backend/kai/services/kaiExportReviewService.js";
import { createGeneratedDraftExportCandidate } from "../Backend/kai/services/kaiExportCandidateService.js";
import { recordHumanFinalReleaseAuthorityDecision } from "../Backend/kai/services/kaiHumanAuthorityDecisionService.js";
import {
  evaluateFinalExportEligibility,
  __finalExportEligibilityGateServiceContract,
} from "../Backend/kai/services/kaiFinalExportEligibilityGateService.js";
import { createPostgresHumanAuthorityDecisionRepository } from "../Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js";
import {
  evaluateExportCandidateCurrentnessInTransaction,
  __exportCandidateRepositoryTestables,
} from "../Backend/kai/dictionary/postgresExportCandidateRepository.js";

const { buildCanonicalRepresentation, canonicalFingerprint } = __exportCandidateRepositoryTestables;

const ORG = "00000000-0000-4000-8000-000000000001";
const DRAFT = "00000000-0000-4000-8000-000000000702";
const GC_QUEUE = "00000000-0000-4000-8000-000000000703";
const EXPORT_QUEUE = "00000000-0000-4000-8000-000000000710";
const CANDIDATE = "00000000-0000-4000-8000-000000000810";
const SNAPSHOT = "00000000-0000-4000-8000-000000000811";
const CLAIM = "00000000-0000-4000-8000-000000000501";
const EVIDENCE = "00000000-0000-4000-8000-000000000601";
const SOURCE = "00000000-0000-4000-8000-000000000801";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000901";
const AUDIT_FILE = "00000000-0000-4000-8000-000000000920";
const BLOCK = "block-1";

const enabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_GENERATION_ENABLED: "true",
  KAI_PUBLIC_EXPORT_ENABLED: "true",
});

const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});

function t(offsetSeconds) {
  return new Date(1_800_000_000_000 + offsetSeconds * 1000).toISOString();
}

// --------------------------------------------------------------------------
// Steps 1-6: real services, repository-object-level fakes (the same
// injection seam these services already expose in production).
// --------------------------------------------------------------------------

function createFakeGeneratedContentRepository(state) {
  return {
    async createEvidenceSummaryDraft(input) {
      state.draft = {
        generationRunId: "00000000-0000-4000-8000-000000000700",
        generatedContentDraftId: DRAFT,
        contentType: "evidence_summary",
        requestedAudience: input.requestedAudience,
        draftStatus: "draft",
        reviewQueueItemId: GC_QUEUE,
        queueStatus: "open",
        reviewStatus: "needs_gk_review",
        replayed: false,
      };
      return { ok: true, data: state.draft, error: null };
    },
    async completeGeneratedContentReview(input) {
      assert.equal(input.generatedContentDraftId, DRAFT);
      assert.equal(input.reviewQueueItemId, GC_QUEUE);
      state.draft.queueStatus = "resolved";
      state.draft.reviewStatus = "resolved";
      return {
        ok: true,
        data: { generatedContentDraftId: DRAFT, reviewQueueItemId: GC_QUEUE, queueStatus: "resolved", reviewStatus: "resolved", replayed: false },
        error: null,
      };
    },
    async requestGeneratedDraftExportReview(input) {
      assert.equal(input.generatedContentDraftId, DRAFT);
      state.exportReview = {
        generatedContentDraftId: DRAFT,
        requestedExportAudience: input.requestedExportAudience,
        exportReviewRequestAccepted: true,
        replayed: false,
        reviewQueueItemId: EXPORT_QUEUE,
        queueStatus: "open",
        reviewStatus: "needs_gk_review",
        validatorResult: {},
      };
      return { ok: true, data: state.exportReview, error: null };
    },
    async startGeneratedDraftExportReview(input) {
      assert.equal(input.exportReviewQueueItemId, EXPORT_QUEUE);
      state.exportReview.queueStatus = "in_progress";
      return {
        ok: true,
        data: { generatedContentDraftId: DRAFT, exportReviewQueueItemId: EXPORT_QUEUE, queueStatus: "in_progress", reviewStatus: "needs_gk_review", replayed: false },
        error: null,
      };
    },
    async completeGeneratedDraftExportReview(input) {
      assert.equal(input.exportReviewQueueItemId, EXPORT_QUEUE);
      state.exportReview.queueStatus = "resolved";
      state.exportReview.reviewStatus = "resolved";
      return {
        ok: true,
        data: { generatedContentDraftId: DRAFT, exportReviewQueueItemId: EXPORT_QUEUE, queueStatus: "resolved", reviewStatus: "resolved", replayed: false },
        error: null,
      };
    },
  };
}

function createFakeExportCandidateRepository(state) {
  return {
    async createExportCandidate(input) {
      assert.equal(input.generatedContentDraftId, DRAFT);
      state.candidate = {
        exportCandidateId: CANDIDATE,
        generatedContentDraftId: DRAFT,
        requestedAudience: state.draft.requestedAudience,
        limitationSnapshotId: SNAPSHOT,
        canonicalFingerprint: "n/a-fake-candidate-repo-does-not-persist-fingerprint",
        replayed: false,
      };
      return { ok: true, data: state.candidate, error: null };
    },
  };
}

// --------------------------------------------------------------------------
// Steps 7-10: real P3-17 repository / P3-16 currentness evaluator against a
// scripted raw fakeTx (identical technique to the committed authority-state
// proof).
// --------------------------------------------------------------------------

const BLOCKS = [
  { ordinal: 1, text: "block text", citations: [{ claim_id: CLAIM, evidence_item_id: EVIDENCE, source_id: SOURCE, source_version_id: SOURCE_VERSION }] },
];
const SNAPSHOT_ENTRIES = [{ claim_id: CLAIM, evidence_item_id: EVIDENCE, limitation_codes: ["none"] }];
const CANONICAL_REPRESENTATION = buildCanonicalRepresentation({
  organizationId: ORG,
  generatedContentDraftId: DRAFT,
  contentType: "evidence_summary",
  requestedAudience: "internal",
  blocks: BLOCKS,
  snapshotEntries: SNAPSHOT_ENTRIES,
});
const MATCHING_FINGERPRINT = canonicalFingerprint(CANONICAL_REPRESENTATION);

function fakeTx(rowsByQueryIndex) {
  let call = 0;
  return {
    async query() {
      const rows = rowsByQueryIndex[call] ?? [];
      call += 1;
      return { rows };
    },
  };
}

function candidateRowForAuthority() {
  return [{ export_candidate_id: CANDIDATE, organization_id: ORG, generated_content_draft_id: DRAFT, requested_audience: "internal" }];
}

// The 8 sequential queries evaluateExportCandidateCurrentnessInTransaction
// issues for a *current* candidate, in order: candidate row, bound-snapshot
// exists, no successor, draft row, current-snapshot row, snapshot entries,
// blocks, citations.
function currentCandidateRowSequence() {
  return [
    [{
      export_candidate_id: CANDIDATE,
      organization_id: ORG,
      generated_content_draft_id: DRAFT,
      content_type: "evidence_summary",
      requested_audience: "internal",
      limitation_snapshot_id: SNAPSHOT,
      canonical_fingerprint: MATCHING_FINGERPRINT,
    }],
    [{ limitation_snapshot_id: SNAPSHOT }],
    [], // no successor -> not superseded
    [{ generated_content_draft_id: DRAFT, organization_id: ORG, content_type: "evidence_summary", requested_audience: "internal", draft_status: "draft" }],
    [{ limitation_snapshot_id: SNAPSHOT }],
    [{ claim_id: CLAIM, evidence_item_id: EVIDENCE, limitation_codes: ["none"] }],
    [{ generated_content_block_id: BLOCK, ordinal: 1, text: "block text" }],
    [{ generated_content_block_id: BLOCK, claim_id: CLAIM, evidence_item_id: EVIDENCE, source_id: SOURCE, source_version_id: SOURCE_VERSION }],
  ];
}

// Sanity-check this fixture against the real, unmodified P3-16 evaluator
// before relying on it through recordDecision/evaluateEffectiveness below.
test("fixture sanity: real P3-16 evaluateExportCandidateCurrentnessInTransaction reports current:true for this assembled candidate", async () => {
  const result = await evaluateExportCandidateCurrentnessInTransaction(fakeTx(currentCandidateRowSequence()), {
    organizationId: ORG,
    exportCandidateId: CANDIDATE,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.current, true);
});

function humanAuthorityRepository(rowsByQueryIndex) {
  const tx = fakeTx(rowsByQueryIndex);
  return createPostgresHumanAuthorityDecisionRepository({ runInTransaction: async (callback) => callback(tx) });
}

function gateDependencies(state, { humanAuthorityDecisionRepository, draftStatusOverride }) {
  return {
    env: enabledEnv,
    runInTransaction: async (callback) => callback({ async query() { return { rows: [] }; } }),
    loadCandidate: async () => ({
      export_candidate_id: state.candidate.exportCandidateId,
      organization_id: ORG,
      generated_content_draft_id: state.candidate.generatedContentDraftId,
      requested_audience: state.candidate.requestedAudience,
    }),
    evaluatePacket: async () => ({
      ok: true,
      data: {
        generatedContentDraftId: state.draft.generatedContentDraftId,
        requestedExportAudience: state.exportReview.requestedExportAudience,
        draftStatus: draftStatusOverride ?? state.draft.draftStatus,
        generatedContentReviewQueueStatus: state.draft.queueStatus,
        generatedContentReviewStatus: state.draft.reviewStatus,
        exportReviewQueueStatus: state.exportReview.queueStatus,
        exportReviewStatus: state.exportReview.reviewStatus,
        currentUseEligible: true,
      },
      error: null,
    }),
    evaluator: async () => ({ ok: true, data: {}, error: null }),
    humanAuthorityDecisionRepository,
  };
}

test("ASSEMBLED PRE-ARTIFACT RELEASE PROOF: generated draft -> ... -> P3-17 authority -> final-gate composition -> VAL-EXP-001", async (t2) => {
  const state = { draft: null, exportReview: null, candidate: null };
  const generatedContentRepository = createFakeGeneratedContentRepository(state);
  const exportCandidateRepository = createFakeExportCandidateRepository(state);

  await t2.test("1. generated draft is created", async () => {
    const result = await createEvidenceSummaryDraft(
      {
        organizationId: ORG,
        requestedAudience: "internal",
        claimIds: [CLAIM],
        idempotencyKey: "assembled-proof-idem-key-0001",
        actorContext,
        now: t(0),
      },
      { env: enabledEnv, generatedContentRepository },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.generatedContentDraftId, DRAFT);
    assert.equal(result.data.queueStatus, "open");
  });

  await t2.test("2. generated-content review is completed (resolved)", async () => {
    const result = await completeGeneratedContentReview(
      {
        organizationId: ORG,
        generatedContentDraftId: DRAFT,
        reviewQueueItemId: GC_QUEUE,
        expectedUpdatedAt: t(1),
        actorContext,
        now: t(2),
      },
      { env: enabledEnv, generatedContentRepository },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.queueStatus, "resolved");
    assert.equal(result.data.reviewStatus, "resolved");
  });

  await t2.test("3. export-review request is accepted (open)", async () => {
    const result = await requestGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: DRAFT, requestedExportAudience: "internal", actorContext, now: t(3) },
      { env: enabledEnv, generatedContentRepository },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.exportReviewRequestAccepted, true);
    assert.equal(result.data.queueStatus, "open");
  });

  await t2.test("4. export-review start moves the queue in_progress", async () => {
    const result = await startGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: DRAFT, exportReviewQueueItemId: EXPORT_QUEUE, expectedUpdatedAt: t(3), actorContext, now: t(4) },
      { env: enabledEnv, generatedContentRepository },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.queueStatus, "in_progress");
  });

  await t2.test("5. export-review completion resolves the export review", async () => {
    const result = await completeGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: DRAFT, exportReviewQueueItemId: EXPORT_QUEUE, expectedUpdatedAt: t(4), actorContext, now: t(5) },
      { env: enabledEnv, generatedContentRepository },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.queueStatus, "resolved");
    assert.equal(result.data.reviewStatus, "resolved");
  });

  await t2.test("6. export candidate is created", async () => {
    const result = await createGeneratedDraftExportCandidate(
      { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext, now: t(6) },
      { env: enabledEnv, exportCandidateRepository },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.exportCandidateId, CANDIDATE);
    assert.equal(result.data.requestedAudience, "internal");
  });

  // --- BEFORE effective authority: the final-gate composition, fed the
  // exact state the assembled chain above just produced, plus the REAL
  // P3-17 evaluateEffectiveness reporting no_decision. ---
  await t2.test("BEFORE authority -> BLOCKED", async () => {
    const repo = humanAuthorityRepository([[]]); // real evaluateEffectiveness: head-decision query returns no rows
    const result = await evaluateFinalExportEligibility(
      { organizationId: ORG, exportCandidateId: CANDIDATE, exportReviewQueueItemId: EXPORT_QUEUE, actorContext },
      gateDependencies(state, { humanAuthorityDecisionRepository: repo }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.effectiveHumanExportAuthority, false);
    assert.equal(result.data.effectivenessReason, "no_decision");
    assert.equal(result.data.finalExportEligible, false);
    assert.ok(result.data.validatorResult.evidence.failed_gates.includes("affirmative_human_export_authority_absent"));
  });

  // --- 7. P3-17 human grant: real recordHumanFinalReleaseAuthorityDecision
  // -> real repository.recordDecision -> real currentness + real
  // effectiveness, against this exact CANDIDATE/DRAFT/audience. ---
  let grantDecisionId = null;
  await t2.test("7. P3-17 human grant is recorded (real recordDecision)", async () => {
    const rows = [
      candidateRowForAuthority(),          // Q1  loadExportCandidateForAuthority
      ...currentCandidateRowSequence(),    // Q2-9  pre-write currentness gate
      [],                                   // Q10 loadCurrentDecisionHeadForUpdate (no existing head)
      [],                                   // Q11 INSERT human_authority_decisions (ignored)
      [{ decision_id: "decision-grant-1", decision_action: "grant" }], // Q12 post-write effectiveness head
      ...currentCandidateRowSequence(),    // Q13-20 post-write effectiveness currentness
      [{ intake_file_id: AUDIT_FILE, upload_state: "policy_cleared" }], // Q21 loadAuditFileContext
      [],                                   // Q22 insertDecisionAudit (ignored)
    ];
    const repo = humanAuthorityRepository(rows);
    const result = await recordHumanFinalReleaseAuthorityDecision(
      { organizationId: ORG, exportCandidateId: CANDIDATE, requestedAudience: "internal", decisionAction: "grant", actorContext, now: t(7) },
      {
        env: enabledEnv,
        humanAuthorityDecisionRepository: repo,
        metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) },
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.effective, true);
    assert.equal(result.data.effectivenessReason, null);
    grantDecisionId = result.data.decisionId;
    assert.ok(typeof grantDecisionId === "string" && grantDecisionId.length > 0);
  });

  // --- 8/9. P3-17 evaluateEffectiveness (standalone, real) feeding the
  // final-gate composition (real, unmodified) -> VAL-EXP-001 PASS. ---
  await t2.test("AFTER GRANT -> PASS", async () => {
    const rows = [
      [{ decision_id: grantDecisionId, decision_action: "grant" }], // real evaluateEffectiveness head query
      ...currentCandidateRowSequence(),                            // real P3-16 currentness
    ];
    const repo = humanAuthorityRepository(rows);
    const result = await evaluateFinalExportEligibility(
      { organizationId: ORG, exportCandidateId: CANDIDATE, exportReviewQueueItemId: EXPORT_QUEUE, actorContext },
      // draftStatus override: see file-header disclosure - the real schema's
      // CHECK (draft_status = 'draft') means no real draft row can ever set
      // this to anything but "draft"; this is the only synthetic override
      // in this proof, and it touches review-packet state, never authority
      // or currentness.
      gateDependencies(state, { humanAuthorityDecisionRepository: repo, draftStatusOverride: "final" }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.effectiveHumanExportAuthority, true);
    assert.equal(result.data.validatorResult.severity, "pass");
    assert.equal(result.data.validatorResult.blocking_reason, null);
    assert.equal(result.data.finalExportEligible, true);
  });

  // --- revoke the same grant (append-only supersession) ---
  let revokeDecisionId = null;
  await t2.test("P3-17 revoke supersedes the grant (real recordDecision)", async () => {
    const rows = [
      candidateRowForAuthority(),          // Q1
      ...currentCandidateRowSequence(),    // Q2-9 pre-write currentness gate
      [{ decision_id: grantDecisionId, decision_action: "grant" }], // Q10 existing head (the grant)
      [],                                   // Q11 INSERT (revoke row, ignored)
      [{ decision_id: "decision-revoke-2", decision_action: "revoke" }], // Q12 post-write effectiveness head
      [{ intake_file_id: AUDIT_FILE, upload_state: "policy_cleared" }],  // Q13 loadAuditFileContext
      [],                                   // Q14 insertDecisionAudit (ignored)
    ];
    const repo = humanAuthorityRepository(rows);
    const result = await recordHumanFinalReleaseAuthorityDecision(
      { organizationId: ORG, exportCandidateId: CANDIDATE, requestedAudience: "internal", decisionAction: "revoke", actorContext, now: t(8) },
      {
        env: enabledEnv,
        humanAuthorityDecisionRepository: repo,
        metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) },
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.effective, false);
    assert.equal(result.data.effectivenessReason, "head_is_revoke");
    revokeDecisionId = result.data.decisionId;
    assert.ok(typeof revokeDecisionId === "string" && revokeDecisionId.length > 0);
  });

  await t2.test("AFTER REVOKE -> BLOCKED", async () => {
    const rows = [
      [{ decision_id: revokeDecisionId, decision_action: "revoke" }], // real evaluateEffectiveness head query only - no currentness re-check for a revoke head
    ];
    const repo = humanAuthorityRepository(rows);
    const result = await evaluateFinalExportEligibility(
      { organizationId: ORG, exportCandidateId: CANDIDATE, exportReviewQueueItemId: EXPORT_QUEUE, actorContext },
      gateDependencies(state, { humanAuthorityDecisionRepository: repo, draftStatusOverride: "final" }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.effectiveHumanExportAuthority, false);
    assert.equal(result.data.effectivenessReason, "head_is_revoke");
    assert.equal(result.data.validatorResult.severity, "blocker");
    assert.equal(result.data.finalExportEligible, false);
  });
});

// --------------------------------------------------------------------------
// Artifact-boundary proof: this assembled chain, and every real function it
// exercises, ends at FINAL EXPORT ELIGIBILITY PASS|BLOCKED and creates none
// of: manifest persistence, a renderer, Markdown/PDF/DOCX, artifact bytes,
// artifact storage, a signed URL, download/retrieval, or reuse.
// --------------------------------------------------------------------------

test("artifact boundary: the final-gate composition source contains no manifest/artifact/renderer/download wiring", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../Backend/kai/services/kaiFinalExportEligibilityGateService.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /export_artifact|artifact_id|artifact\s*[:=]|renderer\(|writeFile|signed_url|manifest_id|manifest\s*[:=]|\.pdf|\.docx|download|retrieval|markdown/i);
});

test("artifact boundary: recordHumanFinalReleaseAuthorityDecision source contains no manifest/artifact/renderer/download wiring", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../Backend/kai/services/kaiHumanAuthorityDecisionService.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /export_artifact|artifact_id|artifact\s*[:=]|renderer\(|writeFile|signed_url|manifest_id|manifest\s*[:=]|\.pdf|\.docx|download|retrieval/i);
});

test("artifact boundary: the assembled chain's own result shape carries only FINAL EXPORT ELIGIBILITY fields, no artifact/manifest fields", async () => {
  const repo = humanAuthorityRepository([[]]);
  const state = {
    draft: { generatedContentDraftId: DRAFT, draftStatus: "draft", queueStatus: "resolved", reviewStatus: "resolved" },
    exportReview: { requestedExportAudience: "internal", queueStatus: "resolved", reviewStatus: "resolved" },
    candidate: { exportCandidateId: CANDIDATE, generatedContentDraftId: DRAFT, requestedAudience: "internal" },
  };
  const result = await evaluateFinalExportEligibility(
    { organizationId: ORG, exportCandidateId: CANDIDATE, exportReviewQueueItemId: EXPORT_QUEUE, actorContext },
    gateDependencies(state, { humanAuthorityDecisionRepository: repo }),
  );
  assert.deepEqual(Object.keys(result.data).sort(), [
    "effectiveHumanExportAuthority",
    "effectivenessReason",
    "exportCandidateId",
    "finalExportEligible",
    "generatedContentDraftId",
    "requestedExportAudience",
    "validatorResult",
  ]);
});

test("FINAL_RELEASE_AUTHORITY_DECISION_TYPE used by the assembled chain's gate is exactly P3-17's export_authority_granted", () => {
  assert.equal(__finalExportEligibilityGateServiceContract.FINAL_RELEASE_AUTHORITY_DECISION_TYPE, "export_authority_granted");
});
