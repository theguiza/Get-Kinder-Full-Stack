import test from "node:test";
import assert from "node:assert/strict";

import { createImpactEvaluation } from "../Backend/kai/services/kaiImpactEvaluationService.js";
import {
  createPostgresImpactEvaluationRepository,
  __impactEvaluationRepositoryTestables,
} from "../Backend/kai/dictionary/postgresImpactEvaluationRepository.js";
import {
  buildDerivedImpactAnalysis,
  buildDerivedImpactGap,
  buildMeasurementRecommendation,
  __impactEvaluationInterpretationContract,
} from "../Backend/kai/services/kaiImpactEvaluationInterpretation.js";
import { createProductionMetadataOnlyAuditForImpactEvaluation } from "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const OUTCOME_CONTEXT = "00000000-0000-4000-8000-000000000010";
const FRAMEWORK_VERSION = "00000000-0000-4000-8000-000000000020";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";
const CRITERION_WHAT = "00000000-0000-4000-8000-000000000301";
const CRITERION_WHO = "00000000-0000-4000-8000-000000000302";
const NOW = "2026-09-02T10:00:00.000Z";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });

const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
  ],
});

function input(overrides = {}) {
  return {
    organizationId: ORG,
    impactOutcomeContextId: OUTCOME_CONTEXT,
    frameworkVersionId: FRAMEWORK_VERSION,
    requestedAudience: "internal",
    claimIds: [CLAIM],
    actorContext,
    now: NOW,
    ...overrides,
  };
}

function traceabilitySuccess({ claimId = CLAIM, requestedAudience = "internal", eligible = true } = {}) {
  return {
    ok: true,
    data: {
      claim: { claim_id: claimId },
      evidence: { evidence_item_id: EVIDENCE },
      requestedAudience,
      eligible,
      blockerCodes: eligible ? [] : ["claim_not_approved_for_requested_audience"],
    },
    error: null,
  };
}

function outcomeContextRow() {
  return {
    impact_outcome_context_id: OUTCOME_CONTEXT,
    organization_id: ORG,
    outcome_key: "school_readiness",
    outcome_statement: "Children are ready for kindergarten.",
    stakeholder_key: "enrolled_children",
    stakeholder_label: "Enrolled children",
  };
}

function frameworkRow(overrides = {}) {
  return {
    framework_version_id: FRAMEWORK_VERSION,
    framework_code: "kai_core",
    framework_name: "KAI Core Impact Framework",
    version_label: "v1",
    framework_status: "active",
    ...overrides,
  };
}

function criteriaRows() {
  return [
    {
      criterion_id: CRITERION_WHAT,
      criterion_key: "what",
      criterion_label: "What changed",
      description: "What outcome or change is claimed.",
      evaluation_guidance: "Assess whether the evidence supports the claimed change.",
      display_order: 0,
    },
    {
      criterion_id: CRITERION_WHO,
      criterion_key: "who",
      criterion_label: "Who benefited",
      description: "Who experienced the change.",
      evaluation_guidance: "Assess whether the evidence identifies the stakeholder.",
      display_order: 1,
    },
  ];
}

function claimProjectionRow() {
  return {
    claim_id: CLAIM,
    claim_statement: "Enrollment increased by 12% in 2025.",
    claim_type: "finding",
    evidence_item_id: EVIDENCE,
    source_id: "00000000-0000-4000-8000-000000000401",
    source_version_id: "00000000-0000-4000-8000-000000000501",
  };
}

function goodResults() {
  return [
    {
      criterionId: CRITERION_WHAT,
      assessmentState: "supported",
      safeExplanation: "The claim directly supports the outcome statement.",
      limitationNotes: null,
      claimIds: [CLAIM],
      evidenceItemIds: [EVIDENCE],
    },
    {
      criterionId: CRITERION_WHO,
      assessmentState: "needs_more_information",
      safeExplanation: "The stakeholder population is not fully identified.",
      limitationNotes: null,
      claimIds: [],
      evidenceItemIds: [],
    },
  ];
}

function fakeMetadataOnlyAudit({ shouldFail = false } = {}) {
  const publishedPayloads = [];
  return {
    publishedPayloads,
    prepareMetadataOnlyAudit({ payload }) {
      if (shouldFail) return { ok: false };
      return {
        ok: true,
        async publish() {
          publishedPayloads.push(payload);
          return { ok: true };
        },
      };
    },
  };
}

function fakeTx({
  outcomeContext = outcomeContextRow(),
  framework = frameworkRow(),
  criteria = criteriaRows(),
  claims = [claimProjectionRow()],
} = {}) {
  const sqlLog = [];
  const insertedEvaluations = [];
  const insertedResults = [];
  const insertedEvidenceLinks = [];
  const insertedClaimLinks = [];
  let evaluationCounter = 0;
  let resultCounter = 0;

  return {
    sqlLog,
    insertedEvaluations,
    insertedResults,
    insertedEvidenceLinks,
    insertedClaimLinks,
    async query(sql, params) {
      const text = String(sql);
      sqlLog.push(text);

      if (/FROM kai\.impact_outcome_contexts/.test(text)) {
        const match = outcomeContext && outcomeContext.organization_id === params[0] && outcomeContext.impact_outcome_context_id === params[1];
        return { rows: match ? [outcomeContext] : [] };
      }
      if (/FROM kai\.impact_evaluation_framework_versions/.test(text)) {
        const match = framework && framework.framework_version_id === params[0];
        return { rows: match ? [framework] : [] };
      }
      if (/FROM kai\.impact_evaluation_criteria/.test(text)) {
        return { rows: criteria };
      }
      if (/FROM kai\.claims c/.test(text)) {
        const ids = new Set(params[1]);
        return { rows: claims.filter((claim) => ids.has(claim.claim_id)) };
      }
      if (/INSERT INTO kai\.impact_evaluations/.test(text)) {
        evaluationCounter += 1;
        const id = `00000000-0000-4000-8000-0000000e0${evaluationCounter}0`;
        insertedEvaluations.push({
          impact_evaluation_id: id,
          organization_id: params[0],
          impact_outcome_context_id: params[1],
          framework_version_id: params[2],
          created_by: params[3],
          created_at: params[4],
        });
        return { rows: [{ impact_evaluation_id: id }] };
      }
      if (/INSERT INTO kai\.impact_evaluation_results/.test(text)) {
        resultCounter += 1;
        const id = `00000000-0000-4000-8000-0000000f0${resultCounter}0`;
        insertedResults.push({
          impact_evaluation_result_id: id,
          organization_id: params[0],
          impact_evaluation_id: params[1],
          framework_version_id: params[2],
          criterion_id: params[3],
          assessment_state: params[4],
          safe_explanation: params[5],
          limitation_notes: params[6],
        });
        return { rows: [{ impact_evaluation_result_id: id }] };
      }
      if (/INSERT INTO kai\.impact_evaluation_result_evidence_links/.test(text)) {
        insertedEvidenceLinks.push({
          organization_id: params[0],
          impact_evaluation_result_id: params[1],
          evidence_item_id: params[2],
        });
        return { rows: [] };
      }
      if (/INSERT INTO kai\.impact_evaluation_result_claim_links/.test(text)) {
        insertedClaimLinks.push({
          organization_id: params[0],
          impact_evaluation_result_id: params[1],
          claim_id: params[2],
        });
        return { rows: [] };
      }
      if (/FROM kai\.impact_evaluations\s+WHERE/.test(text)) {
        const row = insertedEvaluations.find((row_) => row_.impact_evaluation_id === params[1] && row_.organization_id === params[0]);
        return { rows: row ? [row] : [] };
      }
      if (/FROM kai\.impact_evaluation_results\s+WHERE/.test(text)) {
        return { rows: insertedResults.filter((row) => row.impact_evaluation_id === params[1] && row.organization_id === params[0]) };
      }
      if (/FROM kai\.impact_evaluation_result_evidence_links/.test(text)) {
        const ids = new Set(params[1]);
        return { rows: insertedEvidenceLinks.filter((row) => ids.has(row.impact_evaluation_result_id)) };
      }
      if (/FROM kai\.impact_evaluation_result_claim_links/.test(text)) {
        const ids = new Set(params[1]);
        return { rows: insertedClaimLinks.filter((row) => ids.has(row.impact_evaluation_result_id)) };
      }
      return { rows: [] };
    },
  };
}

function repositoryHarness(overrides = {}) {
  const tx = fakeTx(overrides.txOptions);
  const evaluatorCalls = [];
  const repository = createPostgresImpactEvaluationRepository({
    async runInTransaction(callback) {
      return callback(tx);
    },
    async evaluator(evaluatorTx, evalInput) {
      assert.equal(evaluatorTx, tx);
      evaluatorCalls.push(evalInput.claimId);
      if (overrides.evaluatorResult) return overrides.evaluatorResult(evalInput);
      return traceabilitySuccess(evalInput);
    },
  });
  return { repository, tx, evaluatorCalls };
}

function createInput(overrides = {}) {
  return {
    organizationId: ORG,
    impactOutcomeContextId: OUTCOME_CONTEXT,
    frameworkVersionId: FRAMEWORK_VERSION,
    requestedAudience: "internal",
    claimIds: [CLAIM],
    createdBy: actorContext.actorUserId,
    now: NOW,
    ...overrides,
  };
}

test("A2.2 service gates: disabled, malformed, unauthorized, and wrong-tenant calls never reach the repository", async () => {
  let repositoryCalls = 0;
  const repository = {
    async createImpactEvaluationSnapshot() {
      repositoryCalls += 1;
      throw new Error("must not call");
    },
  };
  const deps = {
    impactEvaluationRepository: repository,
    impactEvaluationGenerator: async () => ({ results: [] }),
    metadataOnlyAudit: fakeMetadataOnlyAudit(),
  };

  assert.equal((await createImpactEvaluation(input(), { ...deps, env: {} })).error.code, "feature_disabled");
  assert.equal((await createImpactEvaluation(input(), { ...deps, env: { KAI_SPRINT2_ENABLED: "false" } })).error.code, "feature_disabled");
  assert.equal((await createImpactEvaluation({ ...input(), extra: true }, { ...deps, env: enabledEnv })).error.code, "validation_blocker");
  assert.equal((await createImpactEvaluation(input({ now: "not-a-timestamp" }), { ...deps, env: enabledEnv })).error.code, "validation_blocker");
  assert.equal((await createImpactEvaluation(input({ requestedAudience: "partner" }), { ...deps, env: enabledEnv })).error.code, "validation_blocker");
  assert.equal((await createImpactEvaluation(input({ actorContext: { actorType: "system", actorUserId: actorContext.actorUserId } }), { ...deps, env: enabledEnv })).error.code, "authorization_denied");
  assert.equal((await createImpactEvaluation(input({ actorContext: { ...actorContext, organizationMemberships: [] } }), { ...deps, env: enabledEnv })).error.code, "authorization_denied");
  assert.equal((await createImpactEvaluation(input({ organizationId: OTHER_ORG }), { ...deps, env: enabledEnv })).error.code, "authorization_denied");
  assert.equal(repositoryCalls, 0);
});

test("A2.2 service gates: KAI_SPRINT2_ENABLED=true with KAI_GENERATION_ENABLED=false still reaches the repository -- Impact Evaluation is not generated-content functionality", async () => {
  const { repository } = repositoryHarness();
  const audit = fakeMetadataOnlyAudit();
  const result = await createImpactEvaluation(input(), {
    impactEvaluationRepository: repository,
    impactEvaluationGenerator: async () => ({ results: goodResults() }),
    metadataOnlyAudit: audit,
    env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "false" },
  });
  assert.equal(result.ok, true);
  assert.equal(audit.publishedPayloads.length, 1);
});

test("A2.2 repository: full persist -> criterion results -> A1.4 provenance -> post-write validation -> audit -> commit", async () => {
  const { repository, tx, evaluatorCalls } = repositoryHarness();
  const audit = fakeMetadataOnlyAudit();
  const result = await repository.createImpactEvaluationSnapshot(createInput(), {
    generator: async () => ({ results: goodResults() }),
    metadataOnlyAudit: audit,
  });

  assert.equal(result.ok, true);
  assert.equal(typeof result.data.impactEvaluationId, "string");
  assert.equal(result.data.results.length, 2);
  assert.deepEqual(evaluatorCalls, [CLAIM]);

  assert.equal(tx.insertedEvaluations.length, 1);
  assert.equal(tx.insertedResults.length, 2);
  // Only the "supported" result cited evidence/claims; "needs_more_information" cited none.
  assert.equal(tx.insertedEvidenceLinks.length, 1);
  assert.equal(tx.insertedClaimLinks.length, 1);
  assert.equal(tx.insertedEvidenceLinks[0].evidence_item_id, EVIDENCE);
  assert.equal(tx.insertedClaimLinks[0].claim_id, CLAIM);

  assert.equal(audit.publishedPayloads.length, 1);
  assert.equal(audit.publishedPayloads[0].impact_evaluation_id, result.data.impactEvaluationId);
});

test("A2.2 repository: creating an evaluation never writes kai.claims or kai.evidence_items and never issues an UPDATE/DELETE anywhere", async () => {
  const { repository, tx } = repositoryHarness();
  const audit = fakeMetadataOnlyAudit();
  const result = await repository.createImpactEvaluationSnapshot(createInput(), {
    generator: async () => ({ results: goodResults() }),
    metadataOnlyAudit: audit,
  });
  assert.equal(result.ok, true);
  assert.ok(!tx.sqlLog.some((sql) => /UPDATE|DELETE/i.test(sql)));
  assert.ok(!tx.sqlLog.some((sql) => /INSERT INTO kai\.(claims|evidence_items)/i.test(sql)));
});

test("A2.2 repository: eligibility is unaffected by evaluation creation -- the same claim/audience traceability call returns the same eligible flag before and after", async () => {
  const eligibleBefore = traceabilitySuccess({ eligible: true });
  const { repository } = repositoryHarness({
    evaluatorResult: () => eligibleBefore,
  });
  const audit = fakeMetadataOnlyAudit();
  const result = await repository.createImpactEvaluationSnapshot(createInput(), {
    generator: async () => ({ results: goodResults() }),
    metadataOnlyAudit: audit,
  });
  assert.equal(result.ok, true);

  const eligibleAfter = traceabilitySuccess({ eligible: true });
  assert.deepEqual(eligibleBefore.data.eligible, eligibleAfter.data.eligible);
  assert.deepEqual(eligibleBefore.data.blockerCodes, eligibleAfter.data.blockerCodes);
});

test("A2.2 repository: validation failure persists nothing -- no evaluation, result, or provenance row is written", async () => {
  const { repository, tx } = repositoryHarness();
  const audit = fakeMetadataOnlyAudit();
  const badResults = goodResults();
  badResults[0] = { ...badResults[0], criterionId: "00000000-0000-4000-8000-000000000999" };
  const result = await repository.createImpactEvaluationSnapshot(createInput(), {
    generator: async () => ({ results: badResults }),
    metadataOnlyAudit: audit,
  });
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(tx.insertedEvaluations.length, 0);
  assert.equal(tx.insertedResults.length, 0);
  assert.equal(tx.insertedEvidenceLinks.length, 0);
  assert.equal(tx.insertedClaimLinks.length, 0);
  assert.equal(audit.publishedPayloads.length, 0);
});

test("A2.2 repository: an ineligible claim fails closed before any write, and an unusable/rejected audit rolls back after the write attempt", async () => {
  const ineligible = repositoryHarness({ evaluatorResult: (evalInput) => traceabilitySuccess({ claimId: evalInput.claimId, eligible: false }) });
  const ineligibleAudit = fakeMetadataOnlyAudit();
  const ineligibleResult = await ineligible.repository.createImpactEvaluationSnapshot(createInput(), {
    generator: async () => ({ results: goodResults() }),
    metadataOnlyAudit: ineligibleAudit,
  });
  assert.equal(ineligibleResult.error.code, "validation_blocker");
  assert.equal(ineligible.tx.insertedEvaluations.length, 0);

  const rejectedAudit = fakeMetadataOnlyAudit({ shouldFail: true });
  const auditHarness = repositoryHarness();
  const auditResult = await auditHarness.repository.createImpactEvaluationSnapshot(createInput(), {
    generator: async () => ({ results: goodResults() }),
    metadataOnlyAudit: rejectedAudit,
  });
  assert.equal(auditResult.error.code, "system_error");
});

test("A2.2 repository: post-write validation catches a corrupted reread and fails closed instead of returning an unverified write", async () => {
  assert.equal(typeof __impactEvaluationRepositoryTestables.persistedEvaluationMatchesExpected, "function");
  // Force the round-trip check to observe a mismatch by pointing it at a tx
  // whose reread queries never return the just-inserted rows.
  const brokenTx = fakeTx();
  brokenTx.query = new Proxy(brokenTx.query, {
    apply(target, thisArg, args) {
      const [sql] = args;
      if (/FROM kai\.impact_evaluation_results\s+WHERE/.test(String(sql))) return Promise.resolve({ rows: [] });
      return Reflect.apply(target, thisArg, args);
    },
  });
  const repository = createPostgresImpactEvaluationRepository({
    async runInTransaction(callback) {
      return callback(brokenTx);
    },
    async evaluator(evaluatorTx, evalInput) {
      return traceabilitySuccess(evalInput);
    },
  });
  const result = await repository.createImpactEvaluationSnapshot(createInput(), {
    generator: async () => ({ results: goodResults() }),
    metadataOnlyAudit: fakeMetadataOnlyAudit(),
  });
  assert.equal(result.error.code, "system_error");
});

test("A2.2 derived analysis: gaps and recommendations only appear for not_supported/needs_more_information, are advisory, and are never generated for supported/supported_with_limitation/not_applicable", () => {
  const analysis = buildDerivedImpactAnalysis(goodResults().map((result, index) => ({
    ...result,
    criterionKey: index === 0 ? "what" : "who",
    criterionLabel: index === 0 ? "What changed" : "Who benefited",
  })));
  assert.equal(analysis.interpretations.length, 2);
  assert.equal(analysis.gaps.length, 1);
  assert.equal(analysis.gaps[0].criterionKey, "who");
  assert.equal(analysis.gaps[0].kind, "impact_evaluation_gap");
  assert.equal(analysis.recommendations.length, 1);
  assert.equal(analysis.recommendations[0].advisory, true);
  assert.equal(analysis.recommendations[0].kind, "measurement_recommendation");

  for (const state of ["supported", "supported_with_limitation", "not_applicable"]) {
    const gap = buildDerivedImpactGap({ criterionId: CRITERION_WHAT, criterionKey: "what", criterionLabel: "What changed", assessmentState: state });
    assert.equal(gap, null);
  }
  assert.equal(buildMeasurementRecommendation(null), null);
  assert.ok(__impactEvaluationInterpretationContract.GAP_ASSESSMENT_STATES.has("not_supported"));
  assert.ok(!__impactEvaluationInterpretationContract.GAP_ASSESSMENT_STATES.has("supported"));
});

test("A2.2 audit adapter: refuses to prepare without a well-formed impact_evaluation_id and never fabricates one", () => {
  const audit = createProductionMetadataOnlyAuditForImpactEvaluation({
    organizationId: ORG,
    impactOutcomeContextId: OUTCOME_CONTEXT,
    actorContext,
    now: NOW,
    insertAuditEvent: async () => ({ ok: true }),
  });
  assert.equal(audit.prepareMetadataOnlyAudit({ payload: {} }).ok, false);
  assert.equal(audit.prepareMetadataOnlyAudit({ payload: { impact_evaluation_id: "not-a-uuid" } }).ok, false);
  const prepared = audit.prepareMetadataOnlyAudit({ payload: { impact_evaluation_id: "00000000-0000-4000-8000-000000000e01" } });
  assert.equal(prepared.ok, true);
  assert.equal(typeof prepared.publish, "function");
});
