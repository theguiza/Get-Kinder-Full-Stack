import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateFinalExportEligibility,
} from "../Backend/kai/services/kaiFinalExportEligibilityGateService.js";
import {
  __exportManifestRepositoryTestables,
  createPostgresExportManifestRepository,
} from "../Backend/kai/dictionary/postgresExportManifestRepository.js";
import {
  createExportManifest,
  __exportManifestServiceTestables,
} from "../Backend/kai/services/kaiExportManifestService.js";
import {
  unstructuredExportManifestDiagnosticBlocker,
  exportManifestConstraintDiagnosticBlocker,
} from "../Backend/kai/errors/kaiErrors.js";
import { createProductionMetadataOnlyAuditForExportManifest } from "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js";

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

// --- Phase-14 self-diagnosing ordinary manifest failure: the repository must
// preserve the VAL-EXP-001 validatorResult it already computes through
// evaluateFinalExportEligibilityInTransaction, instead of collapsing an
// ineligible outcome to a bare "validation_blocker" with no blockers. -------

function eligibilityPacket(overrides = {}) {
  return {
    ok: true,
    data: {
      generatedContentDraftId: DRAFT,
      requestedExportAudience: "internal",
      draftStatus: "final",
      generatedContentReviewQueueStatus: "resolved",
      generatedContentReviewStatus: "resolved",
      exportReviewQueueStatus: "resolved",
      exportReviewStatus: "resolved",
      currentUseEligible: true,
      ...overrides,
    },
    error: null,
  };
}

function eligibilityDeps(overrides = {}) {
  return {
    loadCandidate: async () => ({
      export_candidate_id: CANDIDATE,
      organization_id: ORG,
      generated_content_draft_id: DRAFT,
      requested_audience: "internal",
    }),
    evaluatePacket: async () => eligibilityPacket(),
    evaluator: async () => ({ ok: true, data: {}, error: null }),
    evaluateAuthorityEffectiveness: async () => ({
      ok: true,
      data: { effective: true, reason: null, headDecisionId: DECISION },
      error: null,
    }),
    evaluateCandidateCurrentness: async () => ({ ok: true, data: {}, error: null }),
    ...overrides,
  };
}

function manifestRepository() {
  return createPostgresExportManifestRepository({
    runInTransaction: async (callback) => callback({ async query() { return { rows: [] }; } }),
  });
}

const manifestMetadataOnlyAudit = { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };

test("Test 1: an unresolved-review ordinary blocker survives repository as a VAL-EXP-001 blocker", async () => {
  const repository = manifestRepository();
  const deps = eligibilityDeps({
    evaluatePacket: async () => eligibilityPacket({ generatedContentReviewStatus: "pending" }),
  });
  const result = await repository.createExportManifest(baseInput(), { ...deps, metadataOnlyAudit: manifestMetadataOnlyAudit });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(Array.isArray(result.blockers), true);
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0].validator_key, "VAL-EXP-001");
  assert.equal(result.blockers[0].severity, "blocker");
  assert.deepEqual(result.blockers[0].evidence.failed_gates, ["generated_content_review_unresolved"]);
});

test("Test 2: missing-authority blocker survives with VAL-EXP-001, failed_gates, and the effectivenessReason preserved internally", async () => {
  const repository = manifestRepository();
  const deps = eligibilityDeps({
    evaluateAuthorityEffectiveness: async () => ({
      ok: true,
      data: { effective: false, reason: "no_decision", headDecisionId: null },
      error: null,
    }),
  });
  const result = await repository.createExportManifest(baseInput(), { ...deps, metadataOnlyAudit: manifestMetadataOnlyAudit });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.blockers[0].validator_key, "VAL-EXP-001");
  assert.deepEqual(result.blockers[0].evidence.failed_gates, ["affirmative_human_export_authority_absent"]);
  // effectivenessReason is preserved internally on the repository's own
  // failure result (no existing public HTTP `data` contract for it), AND -
  // because the authority gate is the one that failed here - copied into the
  // blocker's own evidence so the HTTP response is self-diagnosing too.
  assert.equal(result.data.effectivenessReason, "no_decision");
  assert.equal(result.blockers[0].evidence.authority_effectiveness_reason, "no_decision");
});

test("Test 3: a stale candidate (fingerprint_mismatch) still surfaces affirmative_human_export_authority_absent, with the currentness reason preserved internally and in the blocker's evidence", async () => {
  const repository = manifestRepository();
  const deps = eligibilityDeps({
    evaluateAuthorityEffectiveness: async () => ({
      ok: true,
      data: { effective: false, reason: "fingerprint_mismatch", headDecisionId: null },
      error: null,
    }),
  });
  const result = await repository.createExportManifest(baseInput(), { ...deps, metadataOnlyAudit: manifestMetadataOnlyAudit });

  assert.equal(result.ok, false);
  assert.ok(result.blockers[0].evidence.failed_gates.includes("affirmative_human_export_authority_absent"));
  assert.equal(result.data.effectivenessReason, "fingerprint_mismatch");
  assert.equal(result.blockers[0].evidence.authority_effectiveness_reason, "fingerprint_mismatch");
});

test("Test 3b: a non-authority blocker does not gain an authority_effectiveness_reason, even when effectivenessReason is set", async () => {
  const repository = manifestRepository();
  const deps = eligibilityDeps({
    evaluatePacket: async () => eligibilityPacket({ generatedContentReviewStatus: "pending" }),
    // effective:true means the authority gate did not fail, but the
    // evaluator can still carry a non-null reason - that must never leak
    // into a blocker whose failed_gates does not include the authority gate.
    evaluateAuthorityEffectiveness: async () => ({
      ok: true,
      data: { effective: true, reason: "lineage_ambiguous", headDecisionId: DECISION },
      error: null,
    }),
  });
  const result = await repository.createExportManifest(baseInput(), { ...deps, metadataOnlyAudit: manifestMetadataOnlyAudit });

  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers[0].evidence.failed_gates, ["generated_content_review_unresolved"]);
  assert.equal(Object.hasOwn(result.blockers[0].evidence, "authority_effectiveness_reason"), false);
});

test("Test 4: multiple failed gates all survive, unchanged and in the validator's existing order", async () => {
  const repository = manifestRepository();
  const deps = eligibilityDeps({
    evaluatePacket: async () => eligibilityPacket({ generatedContentReviewStatus: "pending", currentUseEligible: false }),
    evaluateAuthorityEffectiveness: async () => ({
      ok: true,
      data: { effective: false, reason: "no_decision", headDecisionId: null },
      error: null,
    }),
  });
  const result = await repository.createExportManifest(baseInput(), { ...deps, metadataOnlyAudit: manifestMetadataOnlyAudit });

  assert.equal(result.ok, false);
  assert.deepEqual(result.blockers[0].evidence.failed_gates, [
    "generated_content_review_unresolved",
    "current_use_ineligible",
    "affirmative_human_export_authority_absent",
  ]);
  assert.equal(result.blockers[0].evidence.authority_effectiveness_reason, "no_decision");
  assert.equal(Object.keys(result.blockers[0].evidence).length, 2, "authority_effectiveness_reason must appear exactly once, alongside failed_gates only");
});

test("Test 5: an eligible candidate still creates/replays the manifest exactly as before", async () => {
  const insertedRows = [{ export_manifest_id: "00000000-0000-4000-8000-000000000999" }];
  const repository = createPostgresExportManifestRepository({
    runInTransaction: async (callback) => callback({
      async query(sql) {
        if (/INSERT INTO kai\.export_manifests/.test(sql)) return { rows: insertedRows };
        return { rows: [] };
      },
    }),
  });
  const deps = eligibilityDeps();
  const result = await repository.createExportManifest(baseInput(), { ...deps, metadataOnlyAudit: manifestMetadataOnlyAudit });

  assert.equal(result.ok, true);
  assert.equal(result.data.exportManifestId, "00000000-0000-4000-8000-000000000999");
  assert.equal(result.data.replayed, false);
  assert.equal(Object.hasOwn(result, "blockers"), false);
});

// --- Observability repair: an eligibility-chain dependency (here, the
// tx-scoped P3-17 authority-effectiveness evaluator) can itself fail closed
// with an unstructured { ok:false, error.code:"validation_blocker" } and no
// blockers. This must never reach the ordinary export-manifest response as a
// bare { blockers: [] } - evaluateFinalExportEligibilityInTransaction
// normalizes it into one bounded diagnostic blocker before the repository
// ever sees it. This is distinct from Test 1/2 above (a real VAL-EXP-001
// denial) - no eligibility decision is made here at all. --------------------

test("Test 6: an unstructured validation_blocker from evaluateAuthorityEffectiveness is normalized into a self-diagnosing blocker before reaching the repository boundary", async () => {
  const repository = manifestRepository();
  const deps = eligibilityDeps({
    evaluateAuthorityEffectiveness: async () => ({ ok: false, data: null, error: { code: "validation_blocker", status: 422 } }),
  });
  const result = await repository.createExportManifest(baseInput(), { ...deps, metadataOnlyAudit: manifestMetadataOnlyAudit });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0].validator_key, "VAL-SYS-P0-001");
  assert.equal(result.blockers[0].blocking_reason, "unstructured_export_eligibility_blocker");
  assert.equal(result.blockers[0].evidence.failure_stage, "authority_effectiveness_evaluation");
  assert.equal(result.blockers[0].evidence.upstream_error_code, "validation_blocker");
});

// --- Test 7: the repository's own final boundary fallback (defense-in-depth
// only - Test 6 above proves the upstream gate-service normalization already
// prevents this in practice). Exercised directly against the exported pure
// function, since evaluateFinalExportEligibilityInTransaction is not
// injectable from this repository and already normalizes every real
// unstructured case before returning. -----------------------------------

test("Test 7: the repository's final fallback converts a hypothetical still-unstructured eligibility failure into failure_stage=final_export_eligibility_evaluation", () => {
  const { applyEligibilityFailureFallback } = __exportManifestRepositoryTestables;
  const result = applyEligibilityFailureFallback({ ok: false, data: null, error: { code: "validation_blocker", status: 422 } });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0].evidence.failure_stage, "final_export_eligibility_evaluation");
  assert.equal(result.blockers[0].evidence.upstream_error_code, "validation_blocker");
});

test("Test 7b: the repository's final fallback preserves a real blocker unchanged (Rule A) and leaves non-validation_blocker failures untouched", () => {
  const { applyEligibilityFailureFallback } = __exportManifestRepositoryTestables;

  const realBlocker = [{ validator_key: "VAL-EXP-001", severity: "blocker", blocking_reason: "export_manifest_not_eligible" }];
  const withRealBlocker = { ok: false, data: null, error: { code: "validation_blocker", status: 422 }, blockers: realBlocker };
  assert.deepEqual(applyEligibilityFailureFallback(withRealBlocker), withRealBlocker);

  const notFound = { ok: false, data: null, error: { code: "not_found", status: 404 } };
  assert.deepEqual(applyEligibilityFailureFallback(notFound), notFound);
});

// --- Ordinary export-manifest bare-422 diagnostic: the three remaining bare
// validation_blocker branches in createExportManifest itself (not the
// eligibility chain above) must also self-diagnose instead of returning
// { blockers: [] }. -------------------------------------------------------

test("invalid repository input produces a single VAL-SYS-P0-001 blocker with failure_stage=repository_input_contract", async () => {
  const repository = manifestRepository();
  const result = await repository.createExportManifest(
    { organizationId: ORG },
    { ...eligibilityDeps(), metadataOnlyAudit: manifestMetadataOnlyAudit },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0].validator_key, "VAL-SYS-P0-001");
  assert.equal(result.blockers[0].blocking_reason, "unstructured_export_manifest_failure");
  assert.equal(result.blockers[0].evidence.failure_stage, "repository_input_contract");
});

test("missing metadataOnlyAudit dependency produces a single VAL-SYS-P0-001 blocker with failure_stage=metadata_only_audit_dependency", async () => {
  const repository = manifestRepository();
  const result = await repository.createExportManifest(baseInput(), { ...eligibilityDeps() });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0].validator_key, "VAL-SYS-P0-001");
  assert.equal(result.blockers[0].blocking_reason, "unstructured_export_manifest_failure");
  assert.equal(result.blockers[0].evidence.failure_stage, "metadata_only_audit_dependency");
});

test("a 23503/22P02/23514 export-manifest insert failure produces a single VAL-SYS-P0-001 blocker carrying the exact upstream Postgres code", async () => {
  for (const pgCode of ["23503", "22P02", "23514"]) {
    const repository = createPostgresExportManifestRepository({
      runInTransaction: async (callback) => callback({
        async query(sql) {
          if (/INSERT INTO kai\.export_manifests/.test(sql)) {
            const error = new Error("constraint violated");
            error.code = pgCode;
            throw error;
          }
          return { rows: [] };
        },
      }),
    });
    const result = await repository.createExportManifest(baseInput(), {
      ...eligibilityDeps(),
      metadataOnlyAudit: manifestMetadataOnlyAudit,
    });

    assert.equal(result.ok, false, pgCode);
    assert.equal(result.error.code, "validation_blocker", pgCode);
    assert.equal(result.blockers.length, 1, pgCode);
    assert.equal(result.blockers[0].validator_key, "VAL-SYS-P0-001", pgCode);
    assert.equal(result.blockers[0].blocking_reason, "unstructured_export_manifest_failure", pgCode);
    assert.equal(result.blockers[0].evidence.failure_stage, "export_manifest_insert", pgCode);
    assert.equal(result.blockers[0].evidence.upstream_error_code, pgCode, pgCode);
  }
});

function repositoryWithInsertError(pgCode, constraintName) {
  return createPostgresExportManifestRepository({
    runInTransaction: async (callback) => callback({
      async query(sql) {
        if (/INSERT INTO kai\.export_manifests/.test(sql)) {
          const error = new Error("constraint violated");
          error.code = pgCode;
          error.constraint = constraintName;
          // Adversarial: raw postgres detail/message text must never leak
          // into the resulting blocker even though it is present on the
          // thrown driver error, exactly as node-postgres would populate it.
          error.detail =
            `Key (export_candidate_id)=(${CANDIDATE}) is not present in table "export_candidates".`;
          throw error;
        }
        return { rows: [] };
      },
    }),
  });
}

const KNOWN_CONSTRAINT_CASES = [
  {
    constraintName: "export_manifests_p3_19_authority_decision_fk",
    pgCode: "23503",
    objectCode: "export_manifest_authority_reference",
    blockingReason: "export_authority_reference_invalid",
    constraintKey: "authority_decision_fk",
  },
  {
    constraintName: "export_manifests_p3_19_candidate_fk",
    pgCode: "23503",
    objectCode: "export_manifest_candidate_reference",
    blockingReason: "export_candidate_reference_invalid",
    constraintKey: "candidate_fk",
  },
  {
    constraintName: "export_manifests_p3_20_review_queue_item_fk",
    pgCode: "23503",
    objectCode: "export_manifest_review_reference",
    blockingReason: "export_review_reference_invalid",
    constraintKey: "review_queue_item_fk",
  },
  {
    constraintName: "export_manifests_p3_19_canonical_fingerprint_check",
    pgCode: "23514",
    objectCode: "export_manifest_canonical_fingerprint",
    blockingReason: "canonical_fingerprint_invalid",
    constraintKey: "canonical_fingerprint_check",
  },
];

for (const testCase of KNOWN_CONSTRAINT_CASES) {
  test(`a ${testCase.pgCode} insert failure on the known constraint ${testCase.constraintName} produces an actionable ${testCase.blockingReason} blocker`, async () => {
    const repository = repositoryWithInsertError(testCase.pgCode, testCase.constraintName);
    const result = await repository.createExportManifest(baseInput(), {
      ...eligibilityDeps(),
      metadataOnlyAudit: manifestMetadataOnlyAudit,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
    assert.equal(result.blockers.length, 1);
    const [blocker] = result.blockers;
    assert.equal(blocker.validator_key, "VAL-SYS-P0-001");
    assert.equal(blocker.object_type, "export_manifest");
    assert.equal(blocker.object_code, testCase.objectCode);
    assert.equal(blocker.blocking_reason, testCase.blockingReason);
    assert.equal(blocker.evidence.failure_stage, "export_manifest_insert");
    assert.equal(blocker.evidence.upstream_error_code, testCase.pgCode);
    assert.equal(blocker.evidence.constraint_key, testCase.constraintKey);

    // Raw database internals must never reach the blocker.
    assert.doesNotMatch(JSON.stringify(blocker), /export_candidates|is not present in table|constraint violated/i);
    assert.doesNotMatch(JSON.stringify(blocker), new RegExp(testCase.constraintName));
  });
}

test("a 23503 insert failure on an unknown constraint falls back to the existing generic export_manifest_insert diagnostic", async () => {
  const repository = repositoryWithInsertError("23503", "some_future_unmapped_fk");
  const result = await repository.createExportManifest(baseInput(), {
    ...eligibilityDeps(),
    metadataOnlyAudit: manifestMetadataOnlyAudit,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0].blocking_reason, "unstructured_export_manifest_failure");
  assert.equal(result.blockers[0].evidence.failure_stage, "export_manifest_insert");
  assert.equal(result.blockers[0].evidence.upstream_error_code, "23503");
  assert.equal(Object.hasOwn(result.blockers[0].evidence, "constraint_key"), false);
});

test("a 23514 insert failure on an unknown constraint falls back to the existing generic export_manifest_insert diagnostic", async () => {
  const repository = repositoryWithInsertError("23514", "some_future_unmapped_check");
  const result = await repository.createExportManifest(baseInput(), {
    ...eligibilityDeps(),
    metadataOnlyAudit: manifestMetadataOnlyAudit,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0].blocking_reason, "unstructured_export_manifest_failure");
  assert.equal(result.blockers[0].evidence.failure_stage, "export_manifest_insert");
  assert.equal(result.blockers[0].evidence.upstream_error_code, "23514");
  assert.equal(Object.hasOwn(result.blockers[0].evidence, "constraint_key"), false);
});

test("a 22P02 insert failure never attempts constraint mapping, even when a known constraint name is present on the error", async () => {
  const repository = repositoryWithInsertError("22P02", "export_manifests_p3_19_authority_decision_fk");
  const result = await repository.createExportManifest(baseInput(), {
    ...eligibilityDeps(),
    metadataOnlyAudit: manifestMetadataOnlyAudit,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0].blocking_reason, "unstructured_export_manifest_failure");
  assert.equal(result.blockers[0].evidence.failure_stage, "export_manifest_insert");
  assert.equal(result.blockers[0].evidence.upstream_error_code, "22P02");
  assert.equal(Object.hasOwn(result.blockers[0].evidence, "constraint_key"), false);
});

test("an unexpected database error (not 23503/22P02/23514/23505/25001) remains a system_error with no blockers", async () => {
  const repository = createPostgresExportManifestRepository({
    runInTransaction: async (callback) => callback({
      async query(sql) {
        if (/INSERT INTO kai\.export_manifests/.test(sql)) {
          const error = new Error("connection terminated unexpectedly");
          error.code = "57P01";
          throw error;
        }
        return { rows: [] };
      },
    }),
  });
  const result = await repository.createExportManifest(baseInput(), {
    ...eligibilityDeps(),
    metadataOnlyAudit: manifestMetadataOnlyAudit,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(Object.hasOwn(result, "blockers"), false);
});

test("exportManifestConstraintDiagnosticBlocker returns null for an unknown constraint name and for a non-string constraint name", () => {
  assert.equal(exportManifestConstraintDiagnosticBlocker({ upstreamErrorCode: "23503", constraintName: "not_a_real_constraint" }), null);
  assert.equal(exportManifestConstraintDiagnosticBlocker({ upstreamErrorCode: "23503", constraintName: undefined }), null);
  assert.equal(exportManifestConstraintDiagnosticBlocker({ upstreamErrorCode: "23503", constraintName: null }), null);
});

test("exportManifestConstraintDiagnosticBlocker never exposes the raw constraint name, only the mapped constraint_key", () => {
  const [blocker] = exportManifestConstraintDiagnosticBlocker({
    upstreamErrorCode: "23503",
    constraintName: "export_manifests_p3_19_authority_decision_fk",
  });
  assert.equal(blocker.evidence.constraint_key, "authority_decision_fk");
  assert.doesNotMatch(JSON.stringify(blocker), /export_manifests_p3_19_authority_decision_fk/);
});

test("the export-manifest diagnostic blocker never carries a raw error message, SQL, stack, or the raw error object", () => {
  const [blocker] = unstructuredExportManifestDiagnosticBlocker({
    failureStage: "export_manifest_insert",
    upstreamErrorCode: "23503",
  });

  assert.deepEqual(Object.keys(blocker).sort(), [
    "blocking_reason",
    "evidence",
    "message",
    "object_type",
    "required_fix",
    "severity",
    "validator_key",
  ]);
  assert.deepEqual(Object.keys(blocker.evidence).sort(), ["failure_stage", "upstream_error_code"]);
  assert.equal(typeof blocker.message, "string");
  assert.doesNotMatch(blocker.message, /INSERT|SELECT|constraint|duplicate key/i);

  const withUnsafeUpstream = unstructuredExportManifestDiagnosticBlocker({
    failureStage: "export_manifest_insert",
    upstreamErrorCode: 'duplicate key value violates unique constraint "export_manifests_pkey"',
  });
  assert.equal(Object.hasOwn(withUnsafeUpstream[0].evidence, "upstream_error_code"), false);
});

test("an input that fails the service isCreateExportManifestInput contract produces a single VAL-SYS-P0-001 blocker with failure_stage=service_input_contract, before the repository is ever called", async () => {
  const { deps, calls } = serviceDeps();
  const result = await createExportManifest({ organizationId: ORG }, deps);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.data, null);
  assert.equal(Array.isArray(result.blockers), true);
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0].validator_key, "VAL-SYS-P0-001");
  assert.equal(result.blockers[0].blocking_reason, "unstructured_export_manifest_failure");
  assert.equal(result.blockers[0].evidence.failure_stage, "service_input_contract");
  assert.equal(calls.createExportManifest, 0);
});

test("Test 5b: an eligible candidate's failure result never leaks into a passing createExportManifest service call", async () => {
  const repository = manifestRepository();
  const failingDeps = eligibilityDeps({
    evaluatePacket: async () => eligibilityPacket({ generatedContentReviewStatus: "pending" }),
  });
  const failingResult = await repository.createExportManifest(baseInput(), { ...failingDeps, metadataOnlyAudit: manifestMetadataOnlyAudit });

  const serviceDepsForFailure = {
    env: enabledEnv,
    now: "2026-09-06T10:00:00.000Z",
    repository: { async createExportManifest() { return failingResult; } },
    metadataOnlyAudit: manifestMetadataOnlyAudit,
  };
  const serviceResult = await createExportManifest(serviceInput(), serviceDepsForFailure);

  assert.equal(serviceResult.ok, false);
  assert.equal(serviceResult.error.code, "validation_blocker");
  assert.equal(serviceResult.blockers[0].validator_key, "VAL-EXP-001");
  assert.deepEqual(serviceResult.blockers[0].evidence.failed_gates, ["generated_content_review_unresolved"]);
});

// --- Route -> service composition boundary: the route
// (Backend/kai/routes/sprint2IntakeApi.js) composes the service call
// itself, so a mocked-service route test alone can't catch a route/service
// contract drift (it only records whatever shape the route happens to send).
// These tests reproduce the route's exact composition - a four-key public
// service input, plus `now` and `metadataOnlyAudit` passed through the
// dependencies object, exactly as sprint2IntakeApi.js's export-manifest
// route builds them - and drive it into the real, un-mocked
// createExportManifest service function, so this exact contract mismatch
// (previously: the route folding `now` into the public service input) is
// exercised across the real route/service boundary.

function routeComposedServiceCall({ now, capturedRepositoryInputs }) {
  const identifiers = { organizationId: ORG, exportCandidateId: CANDIDATE };
  const actorContext = gkAdmin;
  const metadataOnlyAudit = createProductionMetadataOnlyAuditForExportManifest({
    organizationId: identifiers.organizationId,
    exportCandidateId: identifiers.exportCandidateId,
    actorContext,
    now,
    insertAuditEvent: async () => ({ ok: true }),
  });
  const repository = {
    async createExportManifest(repositoryInput) {
      capturedRepositoryInputs.push(repositoryInput);
      const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({
        payload: {
          export_manifest_id: "00000000-0000-4000-8000-000000000999",
          export_candidate_id: repositoryInput.exportCandidateId,
        },
      });
      assert.equal(prepared.ok, true);
      await prepared.publish();
      return { ok: true, data: { exportManifestId: "00000000-0000-4000-8000-000000000999", replayed: false }, error: null };
    },
  };
  const input = {
    // Exactly sprint2IntakeApi.js's route-composed public service input - no
    // `now` key.
    organizationId: identifiers.organizationId,
    exportCandidateId: identifiers.exportCandidateId,
    exportReviewQueueItemId: QUEUE,
    actorContext,
  };
  const dependencies = {
    env: enabledEnv,
    // Exactly sprint2IntakeApi.js's route-composed dependencies object -
    // `now` travels here, alongside metadataOnlyAudit.
    now,
    metadataOnlyAudit,
    repository,
  };
  return createExportManifest(input, dependencies);
}

test("Route/service boundary: the route's exact four-key input plus dependencies.now composition reaches the repository, and never trips failure_stage=service_input_contract", async () => {
  const capturedRepositoryInputs = [];
  const now = "2026-09-06T10:00:00.000Z";

  const result = await routeComposedServiceCall({ now, capturedRepositoryInputs });

  assert.equal(result.ok, true);
  assert.equal(result.data.exportManifestId, "00000000-0000-4000-8000-000000000999");
  assert.notEqual(result.error?.code, "validation_blocker");
  if (result.blockers) {
    assert.equal(
      result.blockers.some((blocker) => blocker.evidence?.failure_stage === "service_input_contract"),
      false,
    );
  }

  // The valid four-key service input plus dependencies.now reaches the
  // repository, and the repository's own input receives that exact now.
  assert.equal(capturedRepositoryInputs.length, 1);
  assert.deepEqual(capturedRepositoryInputs[0], {
    organizationId: ORG,
    exportCandidateId: CANDIDATE,
    exportReviewQueueItemId: QUEUE,
    actorContext: gkAdmin,
    now,
  });
});

test("Route/service boundary: metadataOnlyAudit built from the route's own now publishes the exact same now the repository received", async () => {
  const now = "2026-09-06T11:30:00.000Z";
  const publishedEvents = [];
  const metadataOnlyAudit = createProductionMetadataOnlyAuditForExportManifest({
    organizationId: ORG,
    exportCandidateId: CANDIDATE,
    actorContext: gkAdmin,
    now,
    insertAuditEvent: async (metadata) => {
      publishedEvents.push(metadata);
      return { ok: true };
    },
  });
  const capturedRepositoryInputs = [];
  const repository = {
    async createExportManifest(repositoryInput) {
      capturedRepositoryInputs.push(repositoryInput);
      const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({
        payload: {
          export_manifest_id: "00000000-0000-4000-8000-000000000999",
          export_candidate_id: repositoryInput.exportCandidateId,
        },
      });
      assert.equal(prepared.ok, true);
      await prepared.publish();
      return { ok: true, data: { exportManifestId: "00000000-0000-4000-8000-000000000999", replayed: false }, error: null };
    },
  };

  const result = await createExportManifest(serviceInput(), {
    env: enabledEnv,
    now,
    metadataOnlyAudit,
    repository,
  });

  assert.equal(result.ok, true);
  assert.equal(capturedRepositoryInputs.length, 1);
  assert.equal(capturedRepositoryInputs[0].now, now);
  assert.equal(publishedEvents.length, 1);
  assert.equal(publishedEvents[0].created_at, now);
});
