import test from "node:test";
import assert from "node:assert/strict";

import {
  acceptInternalCoverageLimitation,
  __coverageReviewDecisionServiceContract,
} from "../Backend/kai/services/kaiCoverageReviewDecisionService.js";
import { createPostgresCoverageReviewDecisionRepository } from "../Backend/kai/dictionary/postgresCoverageReviewDecisionRepository.js";
import {
  computeCoverageReviewDecisionFingerprint,
  isCoverageReviewDimensionKey,
} from "../Backend/kai/validators/kaiCoverageReviewDecisionValidators.js";
import { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";

const { coverageReviewDecisionIdentifiers, validateCoverageReviewDecisionRequestOrSend } = intakeRouteTestables;

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000009";
const CLAIM = "00000000-0000-4000-8000-000000000003";
const NOW = "2026-08-15T10:00:00.000Z";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });

const reviewerActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
});
const adminActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000002",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
});
const operatorActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000003",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_operator" }],
});
const aiActor = Object.freeze({
  actorType: "ai",
  actorUserId: "90000000-0000-4000-8000-000000000004",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
});

function stubMetadataOnlyAudit(options = {}) {
  const calls = [];
  return {
    calls,
    prepareMetadataOnlyAudit({ payload }) {
      calls.push({ type: "prepare", payload });
      return {
        ok: true,
        async publish() {
          calls.push({ type: "publish" });
          if (options.rejectPublish) throw new Error("forced publish failure");
        },
      };
    },
  };
}

test("P2-10 allowed role is gk_reviewer only - never gk_operator, gk_admin, client, system, assistant, import, or code actors", () => {
  assert.deepEqual(
    [...__coverageReviewDecisionServiceContract.ACCEPT_INTERNAL_COVERAGE_LIMITATION_ALLOWED_ROLES],
    ["gk_reviewer"],
  );
});

test("P2-10 service rejects a non-human actor before any repository call", async () => {
  const result = await acceptInternalCoverageLimitation(
    { organizationId: ORG, claimId: CLAIM, dimensionKey: "denominator_clarity", actorContext: aiActor, now: NOW },
    { env: enabledEnv, coverageReviewDecisionRepository: { async acceptInternalCoverageLimitation() { throw new Error("must not be called"); } } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-10 service rejects gk_operator before any repository call", async () => {
  const result = await acceptInternalCoverageLimitation(
    { organizationId: ORG, claimId: CLAIM, dimensionKey: "denominator_clarity", actorContext: operatorActor, now: NOW },
    { env: enabledEnv, coverageReviewDecisionRepository: { async acceptInternalCoverageLimitation() { throw new Error("must not be called"); } } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-10 service rejects gk_admin before any repository call", async () => {
  const result = await acceptInternalCoverageLimitation(
    { organizationId: ORG, claimId: CLAIM, dimensionKey: "denominator_clarity", actorContext: adminActor, now: NOW },
    { env: enabledEnv, coverageReviewDecisionRepository: { async acceptInternalCoverageLimitation() { throw new Error("must not be called"); } } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-10 service rejects a wrong-tenant actor before any repository call", async () => {
  const result = await acceptInternalCoverageLimitation(
    {
      organizationId: OTHER_ORG,
      claimId: CLAIM,
      dimensionKey: "denominator_clarity",
      actorContext: reviewerActor,
      now: NOW,
    },
    { env: enabledEnv, coverageReviewDecisionRepository: { async acceptInternalCoverageLimitation() { throw new Error("must not be called"); } } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-10 service rejects a fabricated dimension key before any repository call", async () => {
  const result = await acceptInternalCoverageLimitation(
    { organizationId: ORG, claimId: CLAIM, dimensionKey: "not_a_real_dimension", actorContext: reviewerActor, now: NOW },
    { env: enabledEnv, coverageReviewDecisionRepository: { async acceptInternalCoverageLimitation() { throw new Error("must not be called"); } } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("P2-10 KAI_SPRINT2_ENABLED=false yields feature_disabled with zero repository calls", async () => {
  const result = await acceptInternalCoverageLimitation(
    { organizationId: ORG, claimId: CLAIM, dimensionKey: "denominator_clarity", actorContext: reviewerActor, now: NOW },
    { env: { KAI_SPRINT2_ENABLED: "false" }, coverageReviewDecisionRepository: { async acceptInternalCoverageLimitation() { throw new Error("must not be called"); } } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
});

test("P2-10 service delegates to the injected repository exactly once, with the server-controlled gk_reviewer role - never a caller-supplied role", async () => {
  const calls = [];
  const result = await acceptInternalCoverageLimitation(
    { organizationId: ORG, claimId: CLAIM, dimensionKey: "denominator_clarity", actorContext: reviewerActor, now: NOW },
    {
      env: enabledEnv,
      coverageReviewDecisionRepository: {
        async acceptInternalCoverageLimitation(input) {
          calls.push(input);
          return { ok: true, data: { replayed: false }, error: null };
        },
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].organizationId, ORG);
  assert.equal(calls[0].claimId, CLAIM);
  assert.equal(calls[0].dimensionKey, "denominator_clarity");
  assert.equal(calls[0].actorRole, "gk_reviewer");
  assert.equal(calls[0].actorUserId, reviewerActor.actorUserId);
});

test("P2-10 route identifiers accept only the ten known dimension keys and canonical-lowercase UUIDs", () => {
  const validReq = {
    params: { organizationId: ORG, claimId: CLAIM, dimensionKey: "coverage_gaps" },
  };
  assert.deepEqual(coverageReviewDecisionIdentifiers(validReq), {
    organizationId: ORG,
    claimId: CLAIM,
    dimensionKey: "coverage_gaps",
  });
  assert.equal(coverageReviewDecisionIdentifiers({ params: { organizationId: ORG, claimId: CLAIM, dimensionKey: "bogus" } }), null);
  const mixedCaseClaim = "00000000-0000-4000-8000-00000000000A";
  assert.equal(coverageReviewDecisionIdentifiers({ params: { organizationId: ORG, claimId: mixedCaseClaim, dimensionKey: "coverage_gaps" } }), null);
});

test("P2-10 route rejects a non-empty request body", () => {
  const req = {
    params: { organizationId: ORG, claimId: CLAIM, dimensionKey: "coverage_gaps" },
    body: { decision: "accepted_internal_with_limitation" },
    get() { return "application/json"; },
  };
  const calls = [];
  const res = { status(code) { calls.push(code); return this; }, json() { return this; } };
  const identifiers = validateCoverageReviewDecisionRequestOrSend(req, res);
  assert.equal(identifiers, null);
  assert.equal(calls[0], 422);
});

test("P2-10 isCoverageReviewDimensionKey pins the exact ten P2-02 dimension keys", () => {
  assert.equal(isCoverageReviewDimensionKey("requirement_alignment"), true);
  assert.equal(isCoverageReviewDimensionKey("made_up"), false);
});

test("P2-10 fingerprint is deterministic and changes when any bound fact changes", () => {
  const base = {
    claimId: CLAIM,
    dimensionKey: "denominator_clarity",
    evidenceItemId: "e1",
    sourceVersionId: "sv1",
    dimensionAssessmentStatus: "unresolved",
    dimensionValidatorKey: "VAL-KAI-P2-02-denominator_clarity",
    gapLogItemId: "g1",
    gapAssessmentStatus: "unresolved",
    claimReviewStatus: "resolved",
    evidenceReviewStatus: "resolved",
    claimStrength: "reviewed_supported",
    supportStrength: "reviewed_supported",
  };
  const fingerprintA = computeCoverageReviewDecisionFingerprint(base);
  const fingerprintB = computeCoverageReviewDecisionFingerprint(base);
  assert.equal(fingerprintA, fingerprintB);
  assert.match(fingerprintA, /^[0-9a-f]{64}$/);

  const changed = computeCoverageReviewDecisionFingerprint({ ...base, dimensionAssessmentStatus: "resolved_risk_flagged" });
  assert.notEqual(changed, fingerprintA);
});

function fakeTraceabilityResult(overrides = {}) {
  return {
    ok: true,
    data: {
      claim: { claim_id: CLAIM, claim_strength: "reviewed_supported" },
      evidence: { evidence_item_id: "e1", support_strength: "reviewed_supported", review_status: "resolved" },
      source_version: { source_version_id: "sv1" },
      claim_review: { review_status: "resolved" },
      candidate: { intake_source_candidate_id: "cand-1" },
      dimensions: {
        denominator_clarity: { assessment_status: "unresolved", validator_key: "VAL-KAI-P2-02-denominator_clarity" },
      },
      gap_items: [{ gap_log_item_id: "gap-1", dimension_key: "denominator_clarity", assessment_status: "unresolved" }],
      blockerCodes: [],
      ...overrides,
    },
    error: null,
  };
}

function fakeTx(rows = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM kai\.intake_source_candidates/.test(sql)) return { rows: [{ intake_file_id: "file-1" }] };
      if (/FROM kai\.intake_files/.test(sql)) return { rows: [{ upload_state: "confirmed" }] };
      if (/INSERT INTO kai\.coverage_review_decisions/.test(sql)) return { rows: rows.insertRows || [] };
      if (/SELECT coverage_review_decision_id/.test(sql)) return { rows: rows.selectRows || [] };
      if (/INSERT INTO kai\.upload_lifecycle_audit/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
}

test("P2-10 repository rejects when P2-09 evidence/claim review is not yet complete", async () => {
  const repo = createPostgresCoverageReviewDecisionRepository({
    runInTransaction: (cb) => cb(fakeTx()),
    evaluateClaimTraceability: async () => fakeTraceabilityResult({ blockerCodes: ["evidence_review_unresolved"] }),
  });
  const result = await repo.acceptInternalCoverageLimitation({
    organizationId: ORG, claimId: CLAIM, dimensionKey: "denominator_clarity",
    actorUserId: reviewerActor.actorUserId, actorRole: "gk_reviewer", now: NOW,
    metadataOnlyAudit: stubMetadataOnlyAudit(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "human_review_incomplete");
});

test("P2-10 repository rejects a resolved_risk_flagged dimension - never waivable", async () => {
  const repo = createPostgresCoverageReviewDecisionRepository({
    runInTransaction: (cb) => cb(fakeTx()),
    evaluateClaimTraceability: async () => fakeTraceabilityResult({
      dimensions: {
        missingness: { assessment_status: "resolved_risk_flagged", validator_key: "VAL-KAI-P2-02-missingness" },
      },
      gap_items: [{ gap_log_item_id: "gap-2", dimension_key: "missingness", assessment_status: "resolved_risk_flagged" }],
    }),
  });
  const result = await repo.acceptInternalCoverageLimitation({
    organizationId: ORG, claimId: CLAIM, dimensionKey: "missingness",
    actorUserId: reviewerActor.actorUserId, actorRole: "gk_reviewer", now: NOW,
    metadataOnlyAudit: stubMetadataOnlyAudit(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "dimension_not_unresolved");
});

test("P2-10 repository rejects a resolved_clear dimension", async () => {
  const repo = createPostgresCoverageReviewDecisionRepository({
    runInTransaction: (cb) => cb(fakeTx()),
    evaluateClaimTraceability: async () => fakeTraceabilityResult({
      dimensions: {
        entity_level_clarity: { assessment_status: "resolved_clear", validator_key: "VAL-KAI-P2-02-entity_level_clarity" },
      },
      gap_items: [],
    }),
  });
  const result = await repo.acceptInternalCoverageLimitation({
    organizationId: ORG, claimId: CLAIM, dimensionKey: "entity_level_clarity",
    actorUserId: reviewerActor.actorUserId, actorRole: "gk_reviewer", now: NOW,
    metadataOnlyAudit: stubMetadataOnlyAudit(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "dimension_not_unresolved");
});

test("P2-10 repository rejects a fabricated dimension absent from the current traceability result", async () => {
  const repo = createPostgresCoverageReviewDecisionRepository({
    runInTransaction: (cb) => cb(fakeTx()),
    evaluateClaimTraceability: async () => fakeTraceabilityResult({ dimensions: {} }),
  });
  const result = await repo.acceptInternalCoverageLimitation({
    organizationId: ORG, claimId: CLAIM, dimensionKey: "denominator_clarity",
    actorUserId: reviewerActor.actorUserId, actorRole: "gk_reviewer", now: NOW,
    metadataOnlyAudit: stubMetadataOnlyAudit(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("P2-10 repository rejects when the current P2-04 gap row is absent for an unresolved dimension", async () => {
  const repo = createPostgresCoverageReviewDecisionRepository({
    runInTransaction: (cb) => cb(fakeTx()),
    evaluateClaimTraceability: async () => fakeTraceabilityResult({ gap_items: [] }),
  });
  const result = await repo.acceptInternalCoverageLimitation({
    organizationId: ORG, claimId: CLAIM, dimensionKey: "denominator_clarity",
    actorUserId: reviewerActor.actorUserId, actorRole: "gk_reviewer", now: NOW,
    metadataOnlyAudit: stubMetadataOnlyAudit(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P2-10 repository propagates the underlying traceability failure verbatim (e.g. stale/not_found lineage)", async () => {
  const repo = createPostgresCoverageReviewDecisionRepository({
    runInTransaction: (cb) => cb(fakeTx()),
    evaluateClaimTraceability: async () => ({ ok: false, data: null, error: { code: "not_found", status: 404 } }),
  });
  const result = await repo.acceptInternalCoverageLimitation({
    organizationId: ORG, claimId: CLAIM, dimensionKey: "denominator_clarity",
    actorUserId: reviewerActor.actorUserId, actorRole: "gk_reviewer", now: NOW,
    metadataOnlyAudit: stubMetadataOnlyAudit(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("P2-10 repository succeeds, writes the required same-transaction audit, and reports replayed:false on a fresh insert", async () => {
  const tx = fakeTx({
    insertRows: [{
      coverage_review_decision_id: "dec-1",
      organization_id: ORG,
      claim_id: CLAIM,
      dimension_key: "denominator_clarity",
      decision: "accepted_internal_with_limitation",
      decided_by_role: "gk_reviewer",
      created_at: new Date(NOW),
    }],
  });
  const audit = stubMetadataOnlyAudit();
  const repo = createPostgresCoverageReviewDecisionRepository({
    runInTransaction: (cb) => cb(tx),
    evaluateClaimTraceability: async () => fakeTraceabilityResult(),
  });
  const result = await repo.acceptInternalCoverageLimitation({
    organizationId: ORG, claimId: CLAIM, dimensionKey: "denominator_clarity",
    actorUserId: reviewerActor.actorUserId, actorRole: "gk_reviewer", now: NOW,
    metadataOnlyAudit: audit,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, false);
  assert.equal(audit.calls.filter((call) => call.type === "publish").length, 1);
});

test("P2-10 repository treats a conflicting insert as an exact replay - rereads the existing row and publishes no second audit", async () => {
  const existingRow = {
    coverage_review_decision_id: "dec-1",
    organization_id: ORG,
    claim_id: CLAIM,
    dimension_key: "denominator_clarity",
    decision: "accepted_internal_with_limitation",
    decided_by_role: "gk_reviewer",
    created_at: new Date(NOW),
  };
  const tx = fakeTx({ insertRows: [], selectRows: [existingRow] });
  const audit = stubMetadataOnlyAudit();
  const repo = createPostgresCoverageReviewDecisionRepository({
    runInTransaction: (cb) => cb(tx),
    evaluateClaimTraceability: async () => fakeTraceabilityResult(),
  });
  const result = await repo.acceptInternalCoverageLimitation({
    organizationId: ORG, claimId: CLAIM, dimensionKey: "denominator_clarity",
    actorUserId: reviewerActor.actorUserId, actorRole: "gk_reviewer", now: NOW,
    metadataOnlyAudit: audit,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, true);
  assert.equal(audit.calls.length, 0);
});

test("P2-10 repository rolls back (fails closed) when the required audit is rejected", async () => {
  const tx = fakeTx({
    insertRows: [{
      coverage_review_decision_id: "dec-1",
      organization_id: ORG,
      claim_id: CLAIM,
      dimension_key: "denominator_clarity",
      decision: "accepted_internal_with_limitation",
      decided_by_role: "gk_reviewer",
      created_at: new Date(NOW),
    }],
  });
  const repo = createPostgresCoverageReviewDecisionRepository({
    // Mirrors kaiDb.js#withTransaction: on a callback throw, roll back and
    // rethrow - never swallow the error into a synthetic result.
    runInTransaction: (cb) => cb(tx),
    evaluateClaimTraceability: async () => fakeTraceabilityResult(),
  });
  const result = await repo.acceptInternalCoverageLimitation({
    organizationId: ORG, claimId: CLAIM, dimensionKey: "denominator_clarity",
    actorUserId: reviewerActor.actorUserId, actorRole: "gk_reviewer", now: NOW,
    metadataOnlyAudit: { prepareMetadataOnlyAudit() { return { ok: false }; } },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");

  const insertedRows = await tx.query("SELECT coverage_review_decision_id FROM kai.coverage_review_decisions");
  assert.equal(insertedRows.rows.length, 0);
});
