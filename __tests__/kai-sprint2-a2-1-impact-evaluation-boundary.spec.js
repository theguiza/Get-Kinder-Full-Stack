import test from "node:test";
import assert from "node:assert/strict";

import { evaluateImpactOutcomeContext } from "../Backend/kai/services/kaiImpactEvaluationService.js";
import {
  createPostgresImpactEvaluationRepository,
  __impactEvaluationRepositoryTestables,
} from "../Backend/kai/dictionary/postgresImpactEvaluationRepository.js";
import {
  validateImpactEvaluationResults,
  __impactEvaluationValidatorContract,
} from "../Backend/kai/validators/kaiImpactEvaluationValidators.js";
import { __impactEvaluationGeneratorContract } from "../Backend/kai/services/kaiImpactEvaluationGenerator.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const OUTCOME_CONTEXT = "00000000-0000-4000-8000-000000000010";
const FRAMEWORK_VERSION = "00000000-0000-4000-8000-000000000020";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";
const CRITERION_WHAT = "00000000-0000-4000-8000-000000000301";
const CRITERION_WHO = "00000000-0000-4000-8000-000000000302";
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

function fakeTx({ outcomeContext = outcomeContextRow(), framework = frameworkRow(), criteria = criteriaRows(), claims = [claimProjectionRow()] } = {}) {
  const sqlLog = [];
  return {
    sqlLog,
    async query(sql, params) {
      sqlLog.push(String(sql));
      if (/FROM kai\.impact_outcome_contexts/.test(sql)) {
        const match = outcomeContext && outcomeContext.organization_id === params[0] && outcomeContext.impact_outcome_context_id === params[1];
        return { rows: match ? [outcomeContext] : [] };
      }
      if (/FROM kai\.impact_evaluation_framework_versions/.test(sql)) {
        const match = framework && framework.framework_version_id === params[0];
        return { rows: match ? [framework] : [] };
      }
      if (/FROM kai\.impact_evaluation_criteria/.test(sql)) {
        return { rows: criteria };
      }
      if (/FROM kai\.claims c/.test(sql)) {
        const ids = new Set(params[1]);
        return { rows: claims.filter((claim) => ids.has(claim.claim_id)) };
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

test("A2.1 service gates: disabled, malformed, unauthorized, and wrong-tenant calls never reach the repository", async () => {
  let repositoryCalls = 0;
  const repository = {
    async evaluateImpactOutcomeContext() {
      repositoryCalls += 1;
      throw new Error("must not call");
    },
  };
  const deps = { impactEvaluationRepository: repository, impactEvaluationGenerator: async () => ({ results: [] }) };

  assert.equal((await evaluateImpactOutcomeContext(input(), { ...deps, env: {} })).error.code, "feature_disabled");
  assert.equal((await evaluateImpactOutcomeContext(input(), { ...deps, env: { KAI_SPRINT2_ENABLED: "false" } })).error.code, "feature_disabled");
  assert.equal((await evaluateImpactOutcomeContext({ ...input(), extra: true }, { ...deps, env: enabledEnv })).error.code, "validation_blocker");
  assert.equal((await evaluateImpactOutcomeContext(input({ requestedAudience: "partner" }), { ...deps, env: enabledEnv })).error.code, "validation_blocker");
  assert.equal((await evaluateImpactOutcomeContext(input({ claimIds: [CLAIM, CLAIM] }), { ...deps, env: enabledEnv })).error.code, "validation_blocker");
  assert.equal((await evaluateImpactOutcomeContext(input({ actorContext: { actorType: "system", actorUserId: actorContext.actorUserId } }), { ...deps, env: enabledEnv })).error.code, "authorization_denied");
  assert.equal((await evaluateImpactOutcomeContext(input({ actorContext: { ...actorContext, organizationMemberships: [] } }), { ...deps, env: enabledEnv })).error.code, "authorization_denied");
  assert.equal((await evaluateImpactOutcomeContext(input({ organizationId: OTHER_ORG }), { ...deps, env: enabledEnv })).error.code, "authorization_denied");
  assert.equal(repositoryCalls, 0);
});

test("A2.1 service gates: KAI_SPRINT2_ENABLED=true with KAI_GENERATION_ENABLED=false still reaches the repository -- Impact Evaluation is not generated-content functionality", async () => {
  const { repository, evaluatorCalls } = repositoryHarness();
  const result = await evaluateImpactOutcomeContext(input(), {
    impactEvaluationRepository: repository,
    impactEvaluationGenerator: async () => ({ results: goodResults() }),
    env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "false" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(evaluatorCalls, [CLAIM]);
});

test("A2.1 repository: reads A1.1/A1.2 persisted data, revalidates eligibility, and returns validated criterion results with no DB write", async () => {
  const { repository, tx, evaluatorCalls } = repositoryHarness();
  const result = await repository.evaluateImpactOutcomeContext(
    {
      organizationId: ORG,
      impactOutcomeContextId: OUTCOME_CONTEXT,
      frameworkVersionId: FRAMEWORK_VERSION,
      requestedAudience: "internal",
      claimIds: [CLAIM],
    },
    { generator: async () => ({ results: goodResults() }) },
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.results.length, 2);
  assert.deepEqual(evaluatorCalls, [CLAIM]);
  assert.ok(!tx.sqlLog.some((sql) => /INSERT|UPDATE|DELETE/i.test(sql)));
});

test("A2.1 repository: unknown outcome context or retired/unknown framework version fail closed", async () => {
  const missingOutcome = repositoryHarness({ txOptions: { outcomeContext: null } });
  const missingResult = await missingOutcome.repository.evaluateImpactOutcomeContext(
    { organizationId: ORG, impactOutcomeContextId: OUTCOME_CONTEXT, frameworkVersionId: FRAMEWORK_VERSION, requestedAudience: "internal", claimIds: [CLAIM] },
    { generator: async () => ({ results: goodResults() }) },
  );
  assert.equal(missingResult.error.code, "not_found");

  const retiredFramework = repositoryHarness({ txOptions: { framework: frameworkRow({ framework_status: "retired" }) } });
  const retiredResult = await retiredFramework.repository.evaluateImpactOutcomeContext(
    { organizationId: ORG, impactOutcomeContextId: OUTCOME_CONTEXT, frameworkVersionId: FRAMEWORK_VERSION, requestedAudience: "internal", claimIds: [CLAIM] },
    { generator: async () => ({ results: goodResults() }) },
  );
  assert.equal(retiredResult.error.code, "validation_blocker");
});

test("A2.1 repository: an ineligible or cross-tenant claim id fails the whole evaluation closed", async () => {
  const { repository } = repositoryHarness({
    evaluatorResult: (evalInput) => traceabilitySuccess({ claimId: evalInput.claimId, eligible: false }),
  });
  const result = await repository.evaluateImpactOutcomeContext(
    { organizationId: ORG, impactOutcomeContextId: OUTCOME_CONTEXT, frameworkVersionId: FRAMEWORK_VERSION, requestedAudience: "internal", claimIds: [CLAIM] },
    { generator: async () => ({ results: goodResults() }) },
  );
  assert.equal(result.error.code, "validation_blocker");
});

test("A2.1 repository: AI output referencing an unknown criterion id or an unsupplied claim/evidence id is rejected", async () => {
  const { repository: repoUnknownCriterion } = repositoryHarness();
  const unknownCriterionResults = goodResults();
  unknownCriterionResults[0] = { ...unknownCriterionResults[0], criterionId: "00000000-0000-4000-8000-000000000999" };
  const unknownCriterionResult = await repoUnknownCriterion.evaluateImpactOutcomeContext(
    { organizationId: ORG, impactOutcomeContextId: OUTCOME_CONTEXT, frameworkVersionId: FRAMEWORK_VERSION, requestedAudience: "internal", claimIds: [CLAIM] },
    { generator: async () => ({ results: unknownCriterionResults }) },
  );
  assert.equal(unknownCriterionResult.error.code, "validation_blocker");

  const { repository: repoUnknownClaim } = repositoryHarness();
  const unknownClaimResults = goodResults();
  unknownClaimResults[0] = { ...unknownClaimResults[0], claimIds: ["00000000-0000-4000-8000-000000000999"] };
  const unknownClaimResult = await repoUnknownClaim.evaluateImpactOutcomeContext(
    { organizationId: ORG, impactOutcomeContextId: OUTCOME_CONTEXT, frameworkVersionId: FRAMEWORK_VERSION, requestedAudience: "internal", claimIds: [CLAIM] },
    { generator: async () => ({ results: unknownClaimResults }) },
  );
  assert.equal(unknownClaimResult.error.code, "validation_blocker");
});

test("A2.1 repository: an unknown/malformed generator payload never reaches result validation", async () => {
  const { repository } = repositoryHarness();
  const result = await repository.evaluateImpactOutcomeContext(
    { organizationId: ORG, impactOutcomeContextId: OUTCOME_CONTEXT, frameworkVersionId: FRAMEWORK_VERSION, requestedAudience: "internal", claimIds: [CLAIM] },
    { generator: async () => ({ notResults: [] }) },
  );
  assert.equal(result.error.code, "validation_blocker");
});

test("A2.1 validators: VAL-IEV-001 through VAL-IEV-005 enforce criterion coverage, state vocabulary, explanation/limitation pairing, citation authorization, and substantive coverage", () => {
  const criteria = [{ criterionId: CRITERION_WHAT }, { criterionId: CRITERION_WHO }];
  const governedEvidence = [{ claimId: CLAIM, evidenceItemId: EVIDENCE }];

  assert.equal(validateImpactEvaluationResults({ criteria, governedEvidence, results: goodResults() }).ok, true);

  const missingCriterion = validateImpactEvaluationResults({ criteria, governedEvidence, results: [goodResults()[0]] });
  assert.deepEqual(missingCriterion.blockers.map((b) => b.validator_key), ["VAL-IEV-001"]);

  const badState = goodResults();
  badState[0] = { ...badState[0], assessmentState: "definitely_true" };
  assert.ok(validateImpactEvaluationResults({ criteria, governedEvidence, results: badState }).blockers.some((b) => b.validator_key === "VAL-IEV-002"));

  const badPairing = goodResults();
  badPairing[0] = { ...badPairing[0], assessmentState: "supported_with_limitation", limitationNotes: null };
  assert.ok(validateImpactEvaluationResults({ criteria, governedEvidence, results: badPairing }).blockers.some((b) => b.validator_key === "VAL-IEV-003"));

  const unauthorizedCitation = goodResults();
  unauthorizedCitation[0] = { ...unauthorizedCitation[0], claimIds: ["00000000-0000-4000-8000-000000000999"] };
  assert.ok(validateImpactEvaluationResults({ criteria, governedEvidence, results: unauthorizedCitation }).blockers.some((b) => b.validator_key === "VAL-IEV-004"));

  const missingCitation = goodResults();
  missingCitation[0] = { ...missingCitation[0], claimIds: [], evidenceItemIds: [] };
  assert.ok(validateImpactEvaluationResults({ criteria, governedEvidence, results: missingCitation }).blockers.some((b) => b.validator_key === "VAL-IEV-005"));
});

test("A2.1 generator contract exposes a pinned model and repository/validator testables expose their closed vocabularies", () => {
  assert.equal(typeof __impactEvaluationGeneratorContract.MODEL, "string");
  assert.ok(__impactEvaluationRepositoryTestables.FRAMEWORK_USABLE_STATUSES.has("active"));
  assert.ok(!__impactEvaluationRepositoryTestables.FRAMEWORK_USABLE_STATUSES.has("retired"));
  assert.ok(__impactEvaluationValidatorContract.ASSESSMENT_STATES.has("supported_with_limitation"));
});
