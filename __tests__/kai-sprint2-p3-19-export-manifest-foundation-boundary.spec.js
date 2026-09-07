import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateFinalExportEligibility,
} from "../Backend/kai/services/kaiFinalExportEligibilityGateService.js";
import {
  __exportManifestRepositoryTestables,
} from "../Backend/kai/dictionary/postgresExportManifestRepository.js";
import {
  createExportManifest,
  __exportManifestServiceTestables,
} from "../Backend/kai/services/kaiExportManifestService.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const DRAFT = "00000000-0000-4000-8000-000000000301";
const CANDIDATE = "00000000-0000-4000-8000-000000000401";
const QUEUE = "00000000-0000-4000-8000-000000000303";
const DECISION = "00000000-0000-4000-8000-000000000501";

const enabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_GENERATION_ENABLED: "true",
  KAI_PUBLIC_EXPORT_ENABLED: "true",
});

function actorContext(role, id = "90000000-0000-4000-8000-000000000001") {
  return {
    actorType: "human",
    actorUserId: id,
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: role }],
  };
}

const gkAdmin = actorContext("gk_admin");
const gkReviewer = actorContext("gk_reviewer");
const clientReviewer = actorContext("client_reviewer");
const aiActor = { actorType: "ai", actorUserId: "90000000-0000-4000-8000-000000000099", organizationMemberships: [] };

function baseInput(overrides = {}) {
  return {
    organizationId: ORG,
    exportCandidateId: CANDIDATE,
    exportReviewQueueItemId: QUEUE,
    actorContext: gkAdmin,
    now: "2026-09-06T10:00:00.000Z",
    ...overrides,
  };
}

// The public service input contract has no "now" key (it is service-
// generated, never client-suppliable - see the last test below).
function serviceInput(overrides = {}) {
  return {
    organizationId: ORG,
    exportCandidateId: CANDIDATE,
    exportReviewQueueItemId: QUEUE,
    actorContext: gkAdmin,
    ...overrides,
  };
}

// --- Issue 1: the public P3-18 output contract is pinned exactly. ---------

test("evaluateFinalExportEligibility's public data key set is unchanged and never exposes effectiveAuthorityDecisionId", async () => {
  const deps = {
    env: enabledEnv,
    runInTransaction: async (callback) => callback({ async query() { return { rows: [] }; } }),
    loadCandidate: async () => ({
      export_candidate_id: CANDIDATE,
      organization_id: ORG,
      generated_content_draft_id: DRAFT,
      requested_audience: "internal",
    }),
    evaluatePacket: async () => ({
      ok: true,
      data: {
        generatedContentDraftId: DRAFT,
        requestedExportAudience: "internal",
        draftStatus: "draft",
        generatedContentReviewQueueStatus: "resolved",
        generatedContentReviewStatus: "resolved",
        exportReviewQueueStatus: "resolved",
        exportReviewStatus: "resolved",
        currentUseEligible: true,
      },
      error: null,
    }),
    evaluator: async () => ({ ok: true, data: {}, error: null }),
    humanAuthorityDecisionRepository: {
      evaluateEffectiveness: async () => ({
        ok: true,
        data: { effective: true, reason: null, headDecisionId: DECISION },
        error: null,
      }),
    },
  };

  const result = await evaluateFinalExportEligibility(serviceInput({ actorContext: gkAdmin }), deps);
  assert.equal(result.ok, true);
  assert.deepEqual(
    Object.keys(result.data).sort(),
    [
      "effectiveHumanExportAuthority",
      "effectivenessReason",
      "exportCandidateId",
      "finalExportEligible",
      "generatedContentDraftId",
      "requestedExportAudience",
      "validatorResult",
    ].sort(),
  );
  assert.equal(Object.hasOwn(result.data, "effectiveAuthorityDecisionId"), false);
});

// --- P3-19 repository: exact-keys input contract, no client-governance fields. ---

test("createExportManifest repository input rejects each client-supplied governance field individually", () => {
  const forbidden = [
    { requestedAudience: "internal" },
    { finalGate: true },
    { affirmativeHumanExportAuthority: true },
    { eligibility: "pass" },
    { currentness: true },
  ];
  for (const overrides of forbidden) {
    assert.equal(
      __exportManifestRepositoryTestables.isCreateExportManifestInput(baseInput(overrides)),
      false,
      JSON.stringify(overrides),
    );
  }
  assert.equal(__exportManifestRepositoryTestables.isCreateExportManifestInput(baseInput()), true);
});

test("canonicalFingerprint is deterministic and sensitive to every input field", () => {
  const { canonicalFingerprint } = __exportManifestRepositoryTestables;
  const a = canonicalFingerprint({ organizationId: ORG, exportCandidateId: CANDIDATE, effectiveAuthorityDecisionId: DECISION });
  const b = canonicalFingerprint({ organizationId: ORG, exportCandidateId: CANDIDATE, effectiveAuthorityDecisionId: DECISION });
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);

  const differentDecision = canonicalFingerprint({ organizationId: ORG, exportCandidateId: CANDIDATE, effectiveAuthorityDecisionId: "00000000-0000-4000-8000-000000000999" });
  assert.notEqual(a, differentDecision);

  const differentCandidate = canonicalFingerprint({ organizationId: ORG, exportCandidateId: "00000000-0000-4000-8000-000000000999", effectiveAuthorityDecisionId: DECISION });
  assert.notEqual(a, differentCandidate);
});

// --- P3-19 service: gk_admin-only, human-only, tenant-scoped authorization. ---

function serviceDeps(overrides = {}) {
  const calls = { createExportManifest: 0 };
  return {
    deps: {
      env: enabledEnv,
      now: "2026-09-06T10:00:00.000Z",
      repository: {
        async createExportManifest() {
          calls.createExportManifest += 1;
          return { ok: true, data: { exportManifestId: "manifest-1", replayed: false }, error: null };
        },
      },
      metadataOnlyAudit: { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } },
      ...overrides,
    },
    calls,
  };
}

test("client_reviewer is denied before the repository is ever called", async () => {
  const { deps, calls } = serviceDeps();
  const result = await createExportManifest(serviceInput({ actorContext: clientReviewer }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(calls.createExportManifest, 0);
});

test("gk_reviewer is denied before the repository is ever called", async () => {
  const { deps, calls } = serviceDeps();
  const result = await createExportManifest(serviceInput({ actorContext: gkReviewer }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(calls.createExportManifest, 0);
});

test("an AI/system actor is denied before the repository is ever called", async () => {
  const { deps, calls } = serviceDeps();
  const result = await createExportManifest(serviceInput({ actorContext: aiActor }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(calls.createExportManifest, 0);
});

test("a cross-tenant actor (no active membership in organizationId) is denied", async () => {
  const { deps, calls } = serviceDeps();
  const outsider = actorContext("gk_admin");
  outsider.organizationMemberships = [{ organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_admin" }];
  const result = await createExportManifest(serviceInput({ actorContext: outsider }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(calls.createExportManifest, 0);
});

test("gk_admin actor reaches the repository", async () => {
  const { deps, calls } = serviceDeps();
  const result = await createExportManifest(serviceInput({ actorContext: gkAdmin }), deps);
  assert.equal(result.ok, true);
  assert.equal(calls.createExportManifest, 1);
});

test("feature-disabled environment short-circuits before any repository call", async () => {
  const { deps, calls } = serviceDeps({ env: {} });
  const result = await createExportManifest(serviceInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
  assert.equal(calls.createExportManifest, 0);
});

test("service input contract accepts no now/finalGate/eligibility field from the caller", () => {
  assert.equal(
    __exportManifestServiceTestables.isCreateExportManifestInput({
      organizationId: ORG,
      exportCandidateId: CANDIDATE,
      exportReviewQueueItemId: QUEUE,
      actorContext: gkAdmin,
      now: "2026-09-06T10:00:00.000Z",
    }),
    false,
    "now is service-generated, never client-suppliable",
  );
  assert.equal(
    __exportManifestServiceTestables.isCreateExportManifestInput({
      organizationId: ORG,
      exportCandidateId: CANDIDATE,
      exportReviewQueueItemId: QUEUE,
      actorContext: gkAdmin,
      finalGate: true,
    }),
    false,
  );
});
