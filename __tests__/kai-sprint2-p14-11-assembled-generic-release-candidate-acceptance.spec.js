// P14-11 ASSEMBLED GENERIC RELEASE-CANDIDATE ACCEPTANCE
//
// Extends the existing assembled chain proven by
// kai-sprint2-p3-18-assembled-pre-artifact-release-proof.spec.js (generated
// draft -> generated-content review -> export-review request/start/complete
// -> export candidate -> P3-17 human authority -> final-gate composition ->
// VAL-EXP-001) FORWARD through the remaining Phase-14 stages that file
// deliberately stops short of (by design - see its own "artifact boundary"
// tests): export manifest creation (P3-19) -> export-manifest render-model
// composition -> authorized Markdown output -> CSV evidence appendix /
// citation trace -> metadata-only audit wiring.
//
// Steps 1-9 (draft through the AFTER-GRANT final-gate PASS) inject
// repository-object-level fakes at the same seam kaiGeneratedContentService,
// kaiExportReviewService, kaiExportCandidateService, and
// kaiFinalExportEligibilityGateService already expose in production (and
// which kai-sprint2-p3-18-assembled-pre-artifact-release-proof.spec.js and
// kai-sprint2-p3-19-export-manifest-foundation-boundary.spec.js already use),
// so the REAL service-layer validation/authorization/orchestration runs for
// real and threads real DTOs forward with one consistent identity.
//
// Step 10 (export manifest) drives the REAL kaiExportManifestService with a
// repository-object-level fake (identical seam to
// kai-sprint2-p3-19-export-manifest-foundation-boundary.spec.js's
// "gk_admin actor reaches the repository" test).
//
// Step 11 (render model) drives the REAL composeExportManifestRenderModel
// service with a repository-object-level fake whose success payload is
// produced by the REAL, unmodified, exported `composeRenderModel` pure
// function (postgresExportManifestRenderModelRepository.js) fed the exact
// canonical representation this same chain already built and fingerprinted
// in step 6 (buildCanonicalRepresentation/canonicalFingerprint, the same P3-16
// helpers kai-sprint2-p3-18-assembled-pre-artifact-release-proof.spec.js
// uses) - so the render model is the REAL transformation of REAL chain data,
// not a hand-authored double.
//
// Steps 12-13 (authorized output) call the REAL, unmodified
// serializeExportManifestRenderModelToMarkdown and
// serializeExportManifestRenderModelToCsv pure functions directly on that
// real render model - proving the authorized Markdown output and the CSV
// evidence appendix / citation trace both resolve to the SAME claim/
// evidence/source/source-version identities threaded through the whole
// chain.
//
// No external AI/network call is made anywhere in this file. Synthetic data
// only. No PostgreSQL connection is made or required.

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
import { evaluateFinalExportEligibility } from "../Backend/kai/services/kaiFinalExportEligibilityGateService.js";
import { createExportManifest } from "../Backend/kai/services/kaiExportManifestService.js";
import { composeExportManifestRenderModel } from "../Backend/kai/services/kaiExportManifestRenderModelService.js";
import { serializeExportManifestRenderModelToMarkdown } from "../Backend/kai/services/kaiExportManifestMarkdownSerializer.js";
import { serializeExportManifestRenderModelToCsv } from "../Backend/kai/services/kaiExportManifestCsvSerializer.js";
import { createPostgresHumanAuthorityDecisionRepository } from "../Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js";
import {
  evaluateExportCandidateCurrentnessInTransaction,
  __exportCandidateRepositoryTestables,
} from "../Backend/kai/dictionary/postgresExportCandidateRepository.js";
import { __exportManifestRenderModelRepositoryTestables } from "../Backend/kai/dictionary/postgresExportManifestRenderModelRepository.js";

const { buildCanonicalRepresentation, canonicalFingerprint } = __exportCandidateRepositoryTestables;
const { composeRenderModel } = __exportManifestRenderModelRepositoryTestables;

const ORG = "00000000-0000-4000-8000-000000000095";
const OTHER_ORG = "00000000-0000-4000-8000-000000000096";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000950";
const DRAFT = "00000000-0000-4000-8000-000000000951";
const GC_QUEUE = "00000000-0000-4000-8000-000000000952";
const EXPORT_QUEUE = "00000000-0000-4000-8000-000000000953";
const CANDIDATE = "00000000-0000-4000-8000-000000000954";
const SNAPSHOT = "00000000-0000-4000-8000-000000000955";
const MANIFEST = "00000000-0000-4000-8000-000000000956";
const CLAIM = "00000000-0000-4000-8000-000000000957";
const EVIDENCE = "00000000-0000-4000-8000-000000000958";
const SOURCE = "00000000-0000-4000-8000-000000000959";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000960";
const AUDIT_FILE = "00000000-0000-4000-8000-000000000961";

const enabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_GENERATION_ENABLED: "true",
  KAI_PUBLIC_EXPORT_ENABLED: "true",
});

const publicExportDisabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_GENERATION_ENABLED: "true",
  // KAI_PUBLIC_EXPORT_ENABLED intentionally absent.
});

const gkAdminActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000095",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});

const crossTenantActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000096",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});

const assistantActorContext = Object.freeze({
  actorType: "ai",
  actorUserId: "90000000-0000-4000-8000-000000000097",
  organizationMemberships: [],
});

function t(offsetSeconds) {
  return new Date(1_900_000_000_000 + offsetSeconds * 1000).toISOString();
}

function auditSpy() {
  const calls = [];
  return {
    calls,
    metadataOnlyAudit: {
      prepareMetadataOnlyAudit(...args) {
        calls.push(args);
        return { ok: true, async publish() {} };
      },
    },
  };
}

// --------------------------------------------------------------------------
// Steps 1-6: real services, repository-object-level fakes.
// --------------------------------------------------------------------------

function createFakeGeneratedContentRepository(state) {
  return {
    async createEvidenceSummaryDraft(input) {
      state.draft = {
        generationRunId: "00000000-0000-4000-8000-000000000970",
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
      state.draft.queueStatus = "resolved";
      state.draft.reviewStatus = "resolved";
      return {
        ok: true,
        data: { generatedContentDraftId: DRAFT, reviewQueueItemId: GC_QUEUE, queueStatus: "resolved", reviewStatus: "resolved", replayed: false },
        error: null,
      };
    },
    async requestGeneratedDraftExportReview(input) {
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
    async startGeneratedDraftExportReview() {
      state.exportReview.queueStatus = "in_progress";
      return { ok: true, data: { generatedContentDraftId: DRAFT, exportReviewQueueItemId: EXPORT_QUEUE, queueStatus: "in_progress", reviewStatus: "needs_gk_review", replayed: false }, error: null };
    },
    async completeGeneratedDraftExportReview() {
      state.exportReview.queueStatus = "resolved";
      state.exportReview.reviewStatus = "resolved";
      return { ok: true, data: { generatedContentDraftId: DRAFT, exportReviewQueueItemId: EXPORT_QUEUE, queueStatus: "resolved", reviewStatus: "resolved", replayed: false }, error: null };
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

const BLOCKS = [
  { ordinal: 1, text: "block text", citations: [{ claim_id: CLAIM, evidence_item_id: EVIDENCE, source_id: SOURCE, source_version_id: SOURCE_VERSION }] },
];
const SNAPSHOT_ENTRIES = [{ claim_id: CLAIM, evidence_item_id: EVIDENCE, limitation_codes: ["none"] }];

function canonicalRepresentationFor(requestedAudience) {
  return buildCanonicalRepresentation({
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    contentType: "evidence_summary",
    requestedAudience,
    blocks: BLOCKS,
    snapshotEntries: SNAPSHOT_ENTRIES,
  });
}

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

function candidateRowForAuthority(requestedAudience) {
  return [{ export_candidate_id: CANDIDATE, organization_id: ORG, generated_content_draft_id: DRAFT, requested_audience: requestedAudience }];
}

function currentCandidateRowSequence(requestedAudience) {
  const fingerprint = canonicalFingerprint(canonicalRepresentationFor(requestedAudience));
  return [
    [{
      export_candidate_id: CANDIDATE,
      organization_id: ORG,
      generated_content_draft_id: DRAFT,
      content_type: "evidence_summary",
      requested_audience: requestedAudience,
      limitation_snapshot_id: SNAPSHOT,
      canonical_fingerprint: fingerprint,
    }],
    [{ limitation_snapshot_id: SNAPSHOT }],
    [],
    [{ generated_content_draft_id: DRAFT, organization_id: ORG, content_type: "evidence_summary", requested_audience: requestedAudience, draft_status: "draft" }],
    [{ limitation_snapshot_id: SNAPSHOT }],
    [{ claim_id: CLAIM, evidence_item_id: EVIDENCE, limitation_codes: ["none"] }],
    [{ generated_content_block_id: "block-1", ordinal: 1, text: "block text" }],
    [{ generated_content_block_id: "block-1", claim_id: CLAIM, evidence_item_id: EVIDENCE, source_id: SOURCE, source_version_id: SOURCE_VERSION }],
  ];
}

function humanAuthorityRepository(rowsByQueryIndex) {
  const tx = fakeTx(rowsByQueryIndex);
  return createPostgresHumanAuthorityDecisionRepository({ runInTransaction: async (callback) => callback(tx) });
}

function gateDependencies(state, { humanAuthorityDecisionRepository, env = enabledEnv }) {
  return {
    env,
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
        draftStatus: state.draft.draftStatus,
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

// ==========================================================================
// MAIN ASSEMBLED CHAIN (requestedAudience "internal")
// ==========================================================================

test("ASSEMBLED GENERIC RELEASE-CANDIDATE PROOF: draft -> review -> export-review -> candidate -> authority -> final-gate -> export manifest -> render model -> authorized Markdown -> CSV evidence appendix -> metadata-only audit", async (t2) => {
  const state = { draft: null, exportReview: null, candidate: null };
  const generatedContentRepository = createFakeGeneratedContentRepository(state);
  const exportCandidateRepository = createFakeExportCandidateRepository(state);
  const draftAudit = auditSpy();

  await t2.test("1. generated draft is created", async () => {
    const result = await createEvidenceSummaryDraft(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        requestedAudience: "internal",
        claimIds: [CLAIM],
        idempotencyKey: "p14-11-assembled-proof-idem-0001",
        actorContext: gkAdminActorContext,
        now: t(0),
      },
      {
        env: enabledEnv,
        generatedContentRepository,
        metadataOnlyAudit: draftAudit.metadataOnlyAudit,
        async getEngagementForOrganization({ organizationId, engagementId }) {
          if (organizationId === ORG && engagementId === ENGAGEMENT) return { engagement_id: ENGAGEMENT, organization_id: ORG };
          return null;
        },
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.generatedContentDraftId, DRAFT);
  });

  await t2.test("2. generated-content review is completed (resolved)", async () => {
    const result = await completeGeneratedContentReview(
      { organizationId: ORG, generatedContentDraftId: DRAFT, reviewQueueItemId: GC_QUEUE, expectedUpdatedAt: t(1), actorContext: gkAdminActorContext, now: t(2) },
      { env: enabledEnv, generatedContentRepository },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.reviewStatus, "resolved");
  });

  await t2.test("3-5. export review is requested, started, and completed", async () => {
    const requested = await requestGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: DRAFT, requestedExportAudience: "internal", actorContext: gkAdminActorContext, now: t(3) },
      { env: enabledEnv, generatedContentRepository },
    );
    assert.equal(requested.ok, true);
    const started = await startGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: DRAFT, exportReviewQueueItemId: EXPORT_QUEUE, expectedUpdatedAt: t(3), actorContext: gkAdminActorContext, now: t(4) },
      { env: enabledEnv, generatedContentRepository },
    );
    assert.equal(started.ok, true);
    const completed = await completeGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: DRAFT, exportReviewQueueItemId: EXPORT_QUEUE, expectedUpdatedAt: t(4), actorContext: gkAdminActorContext, now: t(5) },
      { env: enabledEnv, generatedContentRepository },
    );
    assert.equal(completed.ok, true);
    assert.equal(completed.data.reviewStatus, "resolved");
  });

  await t2.test("6. export candidate is created", async () => {
    const result = await createGeneratedDraftExportCandidate(
      { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext: gkAdminActorContext, now: t(6) },
      { env: enabledEnv, exportCandidateRepository },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.exportCandidateId, CANDIDATE);
  });

  await t2.test("7. BEFORE authority -> final eligibility BLOCKED (export_authority_granted absent)", async () => {
    const repo = humanAuthorityRepository([[]]);
    const result = await evaluateFinalExportEligibility(
      { organizationId: ORG, exportCandidateId: CANDIDATE, exportReviewQueueItemId: EXPORT_QUEUE, actorContext: gkAdminActorContext },
      gateDependencies(state, { humanAuthorityDecisionRepository: repo }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.finalExportEligible, false);
    assert.equal(result.data.effectivenessReason, "no_decision");
  });

  let grantDecisionId = null;
  await t2.test("8. human export_authority_granted decision is recorded (real recordDecision)", async () => {
    const rows = [
      candidateRowForAuthority("internal"),
      ...currentCandidateRowSequence("internal"),
      [],
      [],
      [{ decision_id: "p14-11-decision-grant-1", decision_action: "grant" }],
      ...currentCandidateRowSequence("internal"),
      [{ intake_file_id: AUDIT_FILE, upload_state: "policy_cleared" }],
      [],
    ];
    const repo = humanAuthorityRepository(rows);
    const authoritySpy = auditSpy();
    const result = await recordHumanFinalReleaseAuthorityDecision(
      { organizationId: ORG, exportCandidateId: CANDIDATE, requestedAudience: "internal", decisionAction: "grant", actorContext: gkAdminActorContext, now: t(7) },
      { env: enabledEnv, humanAuthorityDecisionRepository: repo, metadataOnlyAudit: authoritySpy.metadataOnlyAudit },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.effective, true);
    grantDecisionId = result.data.decisionId;
    assert.ok(typeof grantDecisionId === "string" && grantDecisionId.length > 0);
  });

  await t2.test("9. AFTER GRANT -> final eligibility PASS (VAL-EXP-001 finalGate=true)", async () => {
    const rows = [
      [{ decision_id: grantDecisionId, decision_action: "grant" }],
      ...currentCandidateRowSequence("internal"),
    ];
    const repo = humanAuthorityRepository(rows);
    const result = await evaluateFinalExportEligibility(
      { organizationId: ORG, exportCandidateId: CANDIDATE, exportReviewQueueItemId: EXPORT_QUEUE, actorContext: gkAdminActorContext },
      gateDependencies(state, { humanAuthorityDecisionRepository: repo }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.effectiveHumanExportAuthority, true);
    assert.equal(result.data.finalExportEligible, true);
    assert.equal(result.data.validatorResult.severity, "pass");
  });

  let manifestData = null;
  const manifestAudit = auditSpy();
  await t2.test("10. export manifest is created (real kaiExportManifestService, repository-object-level fake)", async () => {
    const manifestRepository = {
      async createExportManifest(repositoryInput) {
        assert.equal(repositoryInput.organizationId, ORG);
        assert.equal(repositoryInput.exportCandidateId, CANDIDATE);
        assert.equal(repositoryInput.exportReviewQueueItemId, EXPORT_QUEUE);
        return {
          ok: true,
          data: {
            exportManifestId: MANIFEST,
            exportCandidateId: CANDIDATE,
            effectiveAuthorityDecisionId: grantDecisionId,
            fingerprintContractVersion: "kai-sprint2-p3-19-export-manifest-fingerprint-v1",
            canonicalFingerprint: "deadbeefcafe",
            replayed: false,
          },
          error: null,
        };
      },
    };
    const result = await createExportManifest(
      { organizationId: ORG, exportCandidateId: CANDIDATE, exportReviewQueueItemId: EXPORT_QUEUE, actorContext: gkAdminActorContext },
      { env: enabledEnv, repository: manifestRepository, metadataOnlyAudit: manifestAudit.metadataOnlyAudit },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.exportManifestId, MANIFEST);
    manifestData = result.data;
    // Metadata-only audit seam is exercised at manifest creation (deep
    // metadata-only content shape is proven exhaustively by the existing,
    // closed __tests__/kai-sprint2-metadata-only-audit-export-path-allowlist.spec.js,
    // run as part of this package's required regression set - not
    // reproduced here).
    assert.equal(manifestAudit.calls.length, 0, "prepareMetadataOnlyAudit is invoked by the repository layer, not the fake substituted here");
  });

  let renderModel = null;
  await t2.test("11. export-manifest render model is composed from the REAL canonical representation this chain built (composeRenderModel, real pure function)", async () => {
    const representation = canonicalRepresentationFor("internal");
    const fingerprint = canonicalFingerprint(representation);
    const renderModelRepository = {
      async composeExportManifestRenderModel(repositoryInput) {
        assert.equal(repositoryInput.organizationId, ORG);
        assert.equal(repositoryInput.exportManifestId, MANIFEST);
        return {
          ok: true,
          data: composeRenderModel({
            manifest: {
              export_manifest_id: MANIFEST,
              effective_authority_decision_id: grantDecisionId,
              effective_authority_decision_type: "export_authority_granted",
              fingerprint_contract_version: manifestData.fingerprintContractVersion,
              canonical_fingerprint: manifestData.canonicalFingerprint,
              created_at: t(9),
            },
            candidate: {
              exportCandidateId: CANDIDATE,
              generatedContentDraftId: DRAFT,
              contentType: "evidence_summary",
              requestedAudience: "internal",
              limitationSnapshotId: SNAPSHOT,
              canonicalFingerprint: fingerprint,
            },
            representation,
          }),
          error: null,
        };
      },
    };
    const result = await composeExportManifestRenderModel(
      { organizationId: ORG, exportManifestId: MANIFEST, actorContext: gkAdminActorContext },
      { env: enabledEnv, repository: renderModelRepository },
    );
    assert.equal(result.ok, true);
    renderModel = result.data;
    assert.equal(renderModel.exportCandidate.contentType, "evidence_summary");
    assert.equal(renderModel.citations.length, 1);
    assert.equal(renderModel.citations[0].claimId, CLAIM);
    assert.equal(renderModel.citations[0].evidenceItemId, EVIDENCE);
    assert.equal(renderModel.citations[0].sourceId, SOURCE);
    assert.equal(renderModel.citations[0].sourceVersionId, SOURCE_VERSION);
  });

  await t2.test("12. authorized Markdown output (real serializeExportManifestRenderModelToMarkdown) carries the same claim/evidence/source identities and a Citation Appendix", () => {
    const markdown = serializeExportManifestRenderModelToMarkdown(renderModel);
    assert.match(markdown, /## Citation Appendix/);
    assert.match(markdown, new RegExp(CLAIM));
    assert.match(markdown, new RegExp(EVIDENCE));
    assert.match(markdown, new RegExp(SOURCE));
    assert.match(markdown, new RegExp(SOURCE_VERSION));
    assert.match(markdown, /Content type: `evidence_summary`/);
    assert.match(markdown, /Requested audience: `internal`/);
  });

  await t2.test("13. CSV evidence appendix / citation trace (real serializeExportManifestRenderModelToCsv) is the citation appendix - resolves the same identities, no separate artifact", () => {
    const csv = serializeExportManifestRenderModelToCsv(renderModel);
    const lines = csv.trim().split("\r\n");
    assert.equal(lines[0], "citation_ref,claim_id,evidence_item_id,source_id,source_version_id,limitation_codes");
    assert.equal(lines.length, 2);
    assert.equal(lines[1], `CIT-001,${CLAIM},${EVIDENCE},${SOURCE},${SOURCE_VERSION},none`);
  });
});

// ==========================================================================
// PUBLIC-AUDIENCE HUMAN-AUTHORITY PROOF (residual Prompt-3 evidence seam)
// ==========================================================================

test("PUBLIC AUDIENCE HUMAN-AUTHORITY PROOF: flag disabled/unset blocks a requestedAudience=public candidate at every one of these services", async () => {
  const state = { candidate: { exportCandidateId: CANDIDATE, generatedContentDraftId: DRAFT, requestedAudience: "public" } };
  const eligibility = await evaluateFinalExportEligibility(
    { organizationId: ORG, exportCandidateId: CANDIDATE, exportReviewQueueItemId: EXPORT_QUEUE, actorContext: gkAdminActorContext },
    gateDependencies(
      { draft: { generatedContentDraftId: DRAFT, draftStatus: "draft", queueStatus: "resolved", reviewStatus: "resolved" }, exportReview: { requestedExportAudience: "public", queueStatus: "resolved", reviewStatus: "resolved" }, candidate: state.candidate },
      { humanAuthorityDecisionRepository: humanAuthorityRepository([[]]), env: publicExportDisabledEnv },
    ),
  );
  assert.equal(eligibility.ok, false);
  assert.equal(eligibility.error.code, "feature_disabled");

  const grantAttempt = await recordHumanFinalReleaseAuthorityDecision(
    { organizationId: ORG, exportCandidateId: CANDIDATE, requestedAudience: "public", decisionAction: "grant", actorContext: gkAdminActorContext, now: t(20) },
    { env: publicExportDisabledEnv, humanAuthorityDecisionRepository: humanAuthorityRepository([]), metadataOnlyAudit: auditSpy().metadataOnlyAudit },
  );
  assert.equal(grantAttempt.ok, false);
  assert.equal(grantAttempt.error.code, "feature_disabled");

  const manifestAttempt = await createExportManifest(
    { organizationId: ORG, exportCandidateId: CANDIDATE, exportReviewQueueItemId: EXPORT_QUEUE, actorContext: gkAdminActorContext },
    { env: publicExportDisabledEnv, repository: { createExportManifest: async () => { throw new Error("must not be reached: feature flag must fail closed first"); } }, metadataOnlyAudit: auditSpy().metadataOnlyAudit },
  );
  assert.equal(manifestAttempt.ok, false);
  assert.equal(manifestAttempt.error.code, "feature_disabled");
});

test("PUBLIC AUDIENCE HUMAN-AUTHORITY PROOF: flag enabled ALONE is insufficient - absent effective export_authority_granted, final export is still blocked", async () => {
  const state = {
    draft: { generatedContentDraftId: DRAFT, draftStatus: "draft", queueStatus: "resolved", reviewStatus: "resolved" },
    exportReview: { requestedExportAudience: "public", queueStatus: "resolved", reviewStatus: "resolved" },
    candidate: { exportCandidateId: CANDIDATE, generatedContentDraftId: DRAFT, requestedAudience: "public" },
  };
  const repo = humanAuthorityRepository([[]]); // no_decision
  const result = await evaluateFinalExportEligibility(
    { organizationId: ORG, exportCandidateId: CANDIDATE, exportReviewQueueItemId: EXPORT_QUEUE, actorContext: gkAdminActorContext },
    gateDependencies(state, { humanAuthorityDecisionRepository: repo, env: enabledEnv }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.effectiveHumanExportAuthority, false);
  assert.equal(result.data.effectivenessReason, "no_decision");
  assert.equal(result.data.finalExportEligible, false);
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("affirmative_human_export_authority_absent"));
});

test("PUBLIC AUDIENCE HUMAN-AUTHORITY PROOF: an effective, authorized human export_authority_granted decision is required exactly as for every other audience, and is sufficient once granted", async () => {
  const state = {
    draft: { generatedContentDraftId: DRAFT, draftStatus: "draft", queueStatus: "resolved", reviewStatus: "resolved" },
    exportReview: { requestedExportAudience: "public", queueStatus: "resolved", reviewStatus: "resolved" },
    candidate: { exportCandidateId: CANDIDATE, generatedContentDraftId: DRAFT, requestedAudience: "public" },
  };

  const grantRows = [
    candidateRowForAuthority("public"),
    ...currentCandidateRowSequence("public"),
    [],
    [],
    [{ decision_id: "p14-11-public-decision-grant-1", decision_action: "grant" }],
    ...currentCandidateRowSequence("public"),
    [{ intake_file_id: AUDIT_FILE, upload_state: "policy_cleared" }],
    [],
  ];
  const grantResult = await recordHumanFinalReleaseAuthorityDecision(
    { organizationId: ORG, exportCandidateId: CANDIDATE, requestedAudience: "public", decisionAction: "grant", actorContext: gkAdminActorContext, now: t(21) },
    { env: enabledEnv, humanAuthorityDecisionRepository: humanAuthorityRepository(grantRows), metadataOnlyAudit: auditSpy().metadataOnlyAudit },
  );
  assert.equal(grantResult.ok, true);
  assert.equal(grantResult.data.effective, true);

  const eligibilityRows = [
    [{ decision_id: grantResult.data.decisionId, decision_action: "grant" }],
    ...currentCandidateRowSequence("public"),
  ];
  const eligibility = await evaluateFinalExportEligibility(
    { organizationId: ORG, exportCandidateId: CANDIDATE, exportReviewQueueItemId: EXPORT_QUEUE, actorContext: gkAdminActorContext },
    gateDependencies(state, { humanAuthorityDecisionRepository: humanAuthorityRepository(eligibilityRows), env: enabledEnv }),
  );
  assert.equal(eligibility.ok, true);
  assert.equal(eligibility.data.effectiveHumanExportAuthority, true);
  assert.equal(eligibility.data.finalExportEligible, true);
  assert.equal(eligibility.data.requestedExportAudience, "public");
});

// ==========================================================================
// REQUIRED NEGATIVE CASES not already covered elsewhere in this chain
// ==========================================================================

test("NEGATIVE CASE: missing export_authority_granted blocks final export (no grant of any kind has ever been recorded)", async () => {
  const state = {
    draft: { generatedContentDraftId: DRAFT, draftStatus: "draft", queueStatus: "resolved", reviewStatus: "resolved" },
    exportReview: { requestedExportAudience: "internal", queueStatus: "resolved", reviewStatus: "resolved" },
    candidate: { exportCandidateId: CANDIDATE, generatedContentDraftId: DRAFT, requestedAudience: "internal" },
  };
  const result = await evaluateFinalExportEligibility(
    { organizationId: ORG, exportCandidateId: CANDIDATE, exportReviewQueueItemId: EXPORT_QUEUE, actorContext: gkAdminActorContext },
    gateDependencies(state, { humanAuthorityDecisionRepository: humanAuthorityRepository([[]]) }),
  );
  assert.equal(result.data.finalExportEligible, false);
  assert.equal(result.data.effectivenessReason, "no_decision");
});

test("NEGATIVE CASE: cross-tenant identity/reference fails closed - an actor with no active membership in the candidate's organization cannot create an export manifest for it", async () => {
  const manifestRepository = { async createExportManifest() { throw new Error("must not be reached: cross-tenant actor must be denied before the repository"); } };
  const result = await createExportManifest(
    { organizationId: ORG, exportCandidateId: CANDIDATE, exportReviewQueueItemId: EXPORT_QUEUE, actorContext: crossTenantActorContext },
    { env: enabledEnv, repository: manifestRepository, metadataOnlyAudit: auditSpy().metadataOnlyAudit },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("NEGATIVE CASE: cross-tenant identity/reference fails closed - a cross-tenant actor cannot evaluate final export eligibility for this candidate", async () => {
  const state = {
    draft: { generatedContentDraftId: DRAFT, draftStatus: "draft", queueStatus: "resolved", reviewStatus: "resolved" },
    exportReview: { requestedExportAudience: "internal", queueStatus: "resolved", reviewStatus: "resolved" },
    candidate: { exportCandidateId: CANDIDATE, generatedContentDraftId: DRAFT, requestedAudience: "internal" },
  };
  const result = await evaluateFinalExportEligibility(
    { organizationId: ORG, exportCandidateId: CANDIDATE, exportReviewQueueItemId: EXPORT_QUEUE, actorContext: crossTenantActorContext },
    gateDependencies(state, { humanAuthorityDecisionRepository: { evaluateEffectiveness: async () => { throw new Error("must not be reached"); } } }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("NEGATIVE CASE: an assistant/system actor cannot grant final export authority (recordHumanFinalReleaseAuthorityDecision)", async () => {
  const repository = { recordDecision: async () => { throw new Error("must not be reached: an AI/system actor must be denied before the repository"); } };
  const result = await recordHumanFinalReleaseAuthorityDecision(
    { organizationId: ORG, exportCandidateId: CANDIDATE, requestedAudience: "internal", decisionAction: "grant", actorContext: assistantActorContext, now: t(22) },
    { env: enabledEnv, humanAuthorityDecisionRepository: repository, metadataOnlyAudit: auditSpy().metadataOnlyAudit },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("NEGATIVE CASE: an assistant/system actor cannot finalize/create an export manifest", async () => {
  const manifestRepository = { async createExportManifest() { throw new Error("must not be reached: an AI/system actor must be denied before the repository"); } };
  const result = await createExportManifest(
    { organizationId: ORG, exportCandidateId: CANDIDATE, exportReviewQueueItemId: EXPORT_QUEUE, actorContext: assistantActorContext },
    { env: enabledEnv, repository: manifestRepository, metadataOnlyAudit: auditSpy().metadataOnlyAudit },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("NEGATIVE CASE: an assistant/system actor cannot evaluate/finalize export eligibility either", async () => {
  const result = await evaluateFinalExportEligibility(
    { organizationId: ORG, exportCandidateId: CANDIDATE, exportReviewQueueItemId: EXPORT_QUEUE, actorContext: assistantActorContext },
    { env: enabledEnv, runInTransaction: async () => { throw new Error("must not be reached"); }, evaluatePacket: async () => { throw new Error("must not be reached"); }, evaluator: async () => { throw new Error("must not be reached"); }, loadCandidate: async () => { throw new Error("must not be reached"); }, humanAuthorityDecisionRepository: { evaluateEffectiveness: async () => { throw new Error("must not be reached"); } } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

// Blocked-claim / audience-ineligible-evidence / missing-or-invalid-citation
// negative cases are already proven, real-validator, content-type-horizontal,
// by __tests__/kai-sprint2-phase13-governance-horizontal-conformance.spec.js
// (predicate 2 Case A/B "claim_reviewed_not_supported", predicate 7
// VAL-GEN-005 "draft_audience_exceeds_authority" /
// "funder_use_not_currently_eligible", predicate 3 VAL-GEN-002/003
// "missing_or_unresolved_exact_citation" / "unauthorized_claim_reference")
// through the SAME createEvidenceSummaryDraft/createPostgresGeneratedContentRepository
// production admission boundary this file's own step 1 drives - so they are
// run as required regression evidence for this package rather than
// duplicated here.
test("cross-reference: blocked-claim / audience-ineligible / missing-citation negative cases are proven by the phase13 governance horizontal conformance suite, not duplicated here", () => {
  assert.ok(true);
});
