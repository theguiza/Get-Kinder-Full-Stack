import test from "node:test";
import assert from "node:assert/strict";

import { createImpactEvaluation } from "../Backend/kai/services/kaiImpactEvaluationService.js";
import { createPostgresImpactEvaluationRepository } from "../Backend/kai/dictionary/postgresImpactEvaluationRepository.js";
import { __impactEvaluationValidatorContract } from "../Backend/kai/validators/kaiImpactEvaluationValidators.js";

/**
 * A2.3 acceptance proof: the synthetic governed case
 *   "100 target-population participants were served during the reporting
 *    period"
 * run through the ACTUAL A2 path -- the real service gates
 * (kaiImpactEvaluationService.js#createImpactEvaluation), the real
 * repository orchestration/persistence
 * (postgresImpactEvaluationRepository.js#createImpactEvaluationSnapshot,
 * unmocked), the real AI-output validators (kaiImpactEvaluationValidators.js,
 * unmocked), and the real derived-analysis module
 * (kaiImpactEvaluationInterpretation.js, unmocked). Only two seams are
 * faked, exactly as the task requires: the Postgres transaction (`tx`,
 * standing in for a real database so this file needs no live Postgres) and
 * the AI seam itself (a deterministic mock -- never a live model call).
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const OUTCOME_CONTEXT = "00000000-0000-4000-8000-000000000010";
const FRAMEWORK_VERSION = "00000000-0000-4000-8000-000000000020";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";
const CRITERION_WHAT = "00000000-0000-4000-8000-000000000301";
const CRITERION_WHO = "00000000-0000-4000-8000-000000000302";
const CRITERION_HOW_MUCH = "00000000-0000-4000-8000-000000000303";
const CRITERION_CONTRIBUTION = "00000000-0000-4000-8000-000000000304";
const INVENTED_ID = "00000000-0000-4000-8000-00000000dead";
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

function serviceInput(overrides = {}) {
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
    outcome_statement: "Target-population participants achieve the intended program outcome.",
    stakeholder_key: "target_population_participants",
    stakeholder_label: "Target-population participants",
  };
}

function frameworkRow() {
  return {
    framework_version_id: FRAMEWORK_VERSION,
    framework_code: "kai_core",
    framework_name: "KAI Core Impact Framework",
    version_label: "v1",
    framework_status: "active",
  };
}

// The Package-A criterion set (see A1.2's migration comment: what / who /
// how_much / contribution / risk / how are ordinary persisted data, never a
// schema-enforced vocabulary). This scenario uses four of the six.
function criteriaRows() {
  return [
    {
      criterion_id: CRITERION_WHAT,
      criterion_key: "what",
      criterion_label: "What changed",
      description: "What outcome or change is claimed for the stakeholder.",
      evaluation_guidance: "Assess whether the evidence demonstrates an outcome/change, not only reach.",
      display_order: 0,
    },
    {
      criterion_id: CRITERION_WHO,
      criterion_key: "who",
      criterion_label: "Who benefited",
      description: "Who experienced the change.",
      evaluation_guidance: "Assess whether the evidence identifies the stakeholder population.",
      display_order: 1,
    },
    {
      criterion_id: CRITERION_HOW_MUCH,
      criterion_key: "how_much",
      criterion_label: "How much changed",
      description: "The magnitude of the outcome/change.",
      evaluation_guidance: "Assess whether the evidence quantifies the outcome/change, not only reach.",
      display_order: 2,
    },
    {
      criterion_id: CRITERION_CONTRIBUTION,
      criterion_key: "contribution",
      criterion_label: "Organizational contribution",
      description: "The organization's contribution to the outcome/change.",
      evaluation_guidance: "Assess whether the evidence addresses the organization's causal contribution.",
      display_order: 3,
    },
  ];
}

function claimProjectionRow() {
  return {
    claim_id: CLAIM,
    claim_statement: "100 target-population participants were served during the reporting period.",
    claim_type: "finding",
    evidence_item_id: EVIDENCE,
    source_id: "00000000-0000-4000-8000-000000000401",
    source_version_id: "00000000-0000-4000-8000-000000000501",
  };
}

// The deterministic mock AI response this acceptance case runs through the
// real validators/persistence/interpretation path. classification = OUTPUT /
// REACH: WHO is strongly supported (the participants are clearly named) and
// HOW_MUCH gives a reach count (100), but WHAT (the intended outcome/change)
// and CONTRIBUTION (causal attribution) both lack any outcome-level
// evidence -- mapped onto the real, closed A1.3 assessment_state vocabulary
// as 'needs_more_information' ("PARTIAL"/"MISSING" in the task's
// framework-neutral language; A1.3 defines no PARTIAL/MISSING/STRONG state
// of its own). CONTRIBUTION cites no claim/evidence at all, proving it is
// not "supported without evidence".
function acceptanceGeneratorResults() {
  return [
    {
      criterionId: CRITERION_WHAT,
      assessmentState: "needs_more_information",
      safeExplanation:
        "Reach is demonstrated: the governed claim shows 100 target-population participants were served during the reporting period. Participant outcome or change is not demonstrated by the currently governed evidence.",
      limitationNotes: null,
      claimIds: [CLAIM],
      evidenceItemIds: [EVIDENCE],
    },
    {
      criterionId: CRITERION_WHO,
      assessmentState: "supported",
      safeExplanation: "The governed claim explicitly identifies target-population participants as the stakeholder served.",
      limitationNotes: null,
      claimIds: [CLAIM],
      evidenceItemIds: [EVIDENCE],
    },
    {
      criterionId: CRITERION_HOW_MUCH,
      assessmentState: "needs_more_information",
      safeExplanation:
        "The governed claim quantifies reach at 100 participants, but does not quantify any outcome or change magnitude.",
      limitationNotes: null,
      claimIds: [CLAIM],
      evidenceItemIds: [EVIDENCE],
    },
    {
      criterionId: CRITERION_CONTRIBUTION,
      assessmentState: "needs_more_information",
      safeExplanation: "No governed evidence addresses the organization's causal contribution to any outcome or change.",
      limitationNotes: null,
      claimIds: [],
      evidenceItemIds: [],
    },
  ];
}

function fakeMetadataOnlyAudit() {
  const publishedPayloads = [];
  return {
    publishedPayloads,
    prepareMetadataOnlyAudit({ payload }) {
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
        });
        return { rows: [{ impact_evaluation_id: id }] };
      }
      if (/INSERT INTO kai\.impact_evaluation_results/.test(text)) {
        resultCounter += 1;
        const id = `00000000-0000-4000-8000-0000000f${String(resultCounter).padStart(2, "0")}0`;
        insertedResults.push({
          impact_evaluation_result_id: id,
          organization_id: params[0],
          impact_evaluation_id: params[1],
          criterion_id: params[3],
          assessment_state: params[4],
          safe_explanation: params[5],
          limitation_notes: params[6],
        });
        return { rows: [{ impact_evaluation_result_id: id }] };
      }
      if (/INSERT INTO kai\.impact_evaluation_result_evidence_links/.test(text)) {
        insertedEvidenceLinks.push({ impact_evaluation_result_id: params[1], evidence_item_id: params[2] });
        return { rows: [] };
      }
      if (/INSERT INTO kai\.impact_evaluation_result_claim_links/.test(text)) {
        insertedClaimLinks.push({ impact_evaluation_result_id: params[1], claim_id: params[2] });
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

function harness(overrides = {}) {
  const tx = fakeTx(overrides.txOptions);
  const evaluatorCalls = [];
  const repository = createPostgresImpactEvaluationRepository({
    async runInTransaction(callback) {
      return callback(tx);
    },
    async evaluator(evaluatorTx, evalInput) {
      assert.equal(evaluatorTx, tx);
      evaluatorCalls.push(evalInput);
      if (overrides.evaluatorResult) return overrides.evaluatorResult(evalInput);
      return traceabilitySuccess(evalInput);
    },
  });
  return { repository, tx, evaluatorCalls };
}

function deps(overrides = {}) {
  const audit = overrides.audit || fakeMetadataOnlyAudit();
  return {
    env: overrides.env || enabledEnv,
    impactEvaluationRepository: overrides.repository,
    impactEvaluationGenerator: overrides.generator || (async () => ({ results: acceptanceGeneratorResults() })),
    metadataOnlyAudit: audit,
    audit,
  };
}

test("A2 ACCEPTANCE: 100-participant reach claim runs through the real service+repository+validators+interpretation path and produces OUTPUT/REACH with the required explanation, gap, and recommendation", async () => {
  const { repository, tx, evaluatorCalls } = harness();
  const result = await createImpactEvaluation(serviceInput(), deps({ repository }));

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.results.length, 4);
  assert.deepEqual(evaluatorCalls.map((call) => call.claimId), [CLAIM]);

  const byKey = Object.fromEntries(result.data.results.map((row) => [row.criterionKey, row]));

  // Using the actual persisted A1.3 assessment_state vocabulary:
  assert.equal(byKey.who.assessmentState, "supported");
  assert.equal(byKey.what.assessmentState, "needs_more_information");
  assert.equal(byKey.how_much.assessmentState, "needs_more_information");
  assert.equal(byKey.contribution.assessmentState, "needs_more_information");
  for (const row of result.data.results) {
    assert.ok(__impactEvaluationValidatorContract.ASSESSMENT_STATES.has(row.assessmentState));
  }

  // classification = OUTPUT/REACH, derived from the "what" (outcome) criterion.
  assert.deepEqual(result.data.classification, {
    classification: "OUTPUT_REACH",
    criterionKey: "what",
    assessmentState: "needs_more_information",
  });

  // "Reach is demonstrated. Participant outcome/change is not demonstrated."
  assert.match(byKey.what.safeExplanation, /Reach is demonstrated/);
  assert.match(byKey.what.safeExplanation, /outcome or change is not demonstrated/i);

  // Derived impact gap: "Outcome-change evidence is absent."
  const whatGap = result.data.gaps.find((gap) => gap.criterionKey === "what");
  assert.ok(whatGap);
  assert.equal(whatGap.gapReason, "Outcome-change evidence is absent.");

  // Recommendation: define/confirm outcome, indicator, follow-up measurement.
  const whatRecommendation = result.data.recommendations.find((rec) => rec.criterionKey === "what");
  assert.ok(whatRecommendation);
  assert.equal(whatRecommendation.advisory, true);
  assert.equal(
    whatRecommendation.recommendation,
    "Define/confirm the intended participant outcome, associate an appropriate indicator, and establish follow-up measurement.",
  );

  // Reach does not become outcome: WHO's strong support never leaks into
  // WHAT's/HOW_MUCH's state, and classification is not "OUTCOME".
  assert.notEqual(result.data.classification.classification, "OUTCOME");
  assert.notEqual(byKey.what.assessmentState, "supported");
  assert.notEqual(byKey.how_much.assessmentState, "supported");

  // Contribution is not supported without evidence: MISSING is honestly
  // recorded as needs_more_information (not "supported"), and cites nothing.
  assert.notEqual(byKey.contribution.assessmentState, "supported");
  assert.notEqual(byKey.contribution.assessmentState, "supported_with_limitation");
  assert.deepEqual(byKey.contribution.claimIds, []);
  assert.deepEqual(byKey.contribution.evidenceItemIds, []);
  assert.ok(result.data.gaps.some((gap) => gap.criterionKey === "contribution"));

  // Provenance (A1.4): cited criteria have exactly the expected evidence/claim
  // links; the uncited "contribution" criterion has none.
  assert.equal(tx.insertedEvidenceLinks.length, 3);
  assert.equal(tx.insertedClaimLinks.length, 3);
  assert.ok(tx.insertedEvidenceLinks.every((link) => link.evidence_item_id === EVIDENCE));
  assert.ok(tx.insertedClaimLinks.every((link) => link.claim_id === CLAIM));

  // Persistence actually happened (A1.3 snapshot + criterion results).
  assert.equal(tx.insertedEvaluations.length, 1);
  assert.equal(tx.insertedResults.length, 4);

  // AI cannot approve/finalize: no queue/approval table was ever touched,
  // and the closed assessment_state vocabulary has no approval/finalization
  // state for the model to have picked in the first place.
  assert.ok(!tx.sqlLog.some((sql) => /review_queue_items|claim_review|approve|finaliz/i.test(sql)));
  for (const forbidden of ["approved", "finalized", "final", "reviewed"]) {
    assert.ok(!__impactEvaluationValidatorContract.ASSESSMENT_STATES.has(forbidden));
  }

  // Evidence/claims/review/audience authority remain unchanged: no UPDATE or
  // DELETE ever ran, and no write touched kai.claims/kai.evidence_items.
  assert.ok(!tx.sqlLog.some((sql) => /UPDATE|DELETE/i.test(sql)));
  assert.ok(!tx.sqlLog.some((sql) => /INSERT INTO kai\.(claims|evidence_items)/i.test(sql)));
});

test("A2 ACCEPTANCE: cross-tenant/ineligible evidence fails closed and persists nothing", async () => {
  const { repository, tx } = harness({
    evaluatorResult: (evalInput) => ({
      ok: true,
      data: { claim: { claim_id: evalInput.claimId }, evidence: { evidence_item_id: EVIDENCE }, requestedAudience: evalInput.requestedAudience, eligible: false, blockerCodes: ["cross_tenant_or_ineligible_claim"] },
      error: null,
    }),
  });
  const result = await createImpactEvaluation(serviceInput(), deps({ repository }));
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(tx.insertedEvaluations.length, 0);
  assert.equal(tx.insertedResults.length, 0);
});

test("A2 ACCEPTANCE: model-invented claim/evidence ids fail closed and persist nothing", async () => {
  const { repository, tx } = harness();
  const invented = acceptanceGeneratorResults();
  invented[0] = { ...invented[0], claimIds: [INVENTED_ID], evidenceItemIds: [INVENTED_ID] };
  const result = await createImpactEvaluation(serviceInput(), deps({ repository, generator: async () => ({ results: invented }) }));
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(tx.insertedEvaluations.length, 0);
  assert.equal(tx.insertedResults.length, 0);
  assert.equal(tx.insertedEvidenceLinks.length, 0);
  assert.equal(tx.insertedClaimLinks.length, 0);
});

test("A2 ACCEPTANCE: contribution claimed 'supported' with zero citations is rejected -- contribution is never supported without evidence", async () => {
  const { repository, tx } = harness();
  const overclaimed = acceptanceGeneratorResults();
  const contributionIndex = overclaimed.findIndex((row) => row.criterionId === CRITERION_CONTRIBUTION);
  overclaimed[contributionIndex] = { ...overclaimed[contributionIndex], assessmentState: "supported", claimIds: [], evidenceItemIds: [] };
  const result = await createImpactEvaluation(serviceInput(), deps({ repository, generator: async () => ({ results: overclaimed }) }));
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(tx.insertedEvaluations.length, 0);
});

test("A2 ACCEPTANCE: malformed model output (missing a required key, and a partially-valid coverage gap) causes zero partial persistence", async () => {
  const { repository: repoA, tx: txA } = harness();
  const malformedShape = acceptanceGeneratorResults().map((row) => {
    const { limitationNotes, ...rest } = row;
    return rest;
  });
  const resultA = await createImpactEvaluation(serviceInput(), deps({ repository: repoA, generator: async () => ({ results: malformedShape }) }));
  assert.equal(resultA.error.code, "validation_blocker");
  assert.equal(txA.insertedEvaluations.length, 0);
  assert.equal(txA.insertedResults.length, 0);

  const { repository: repoB, tx: txB } = harness();
  const missingOneCriterion = acceptanceGeneratorResults().slice(0, 3); // drops "contribution" -- 3/4 criteria "valid"
  const resultB = await createImpactEvaluation(serviceInput(), deps({ repository: repoB, generator: async () => ({ results: missingOneCriterion }) }));
  assert.equal(resultB.error.code, "validation_blocker");
  assert.equal(txB.insertedEvaluations.length, 0);
  assert.equal(txB.insertedResults.length, 0);
  assert.equal(txB.insertedEvidenceLinks.length, 0);
  assert.equal(txB.insertedClaimLinks.length, 0);
});

test("A2 ACCEPTANCE: feature-disabled path fails closed before the repository or AI seam is ever reached", async () => {
  let repositoryCalls = 0;
  let generatorCalls = 0;
  const repository = { async createImpactEvaluationSnapshot() { repositoryCalls += 1; throw new Error("must not call"); } };
  const result = await createImpactEvaluation(serviceInput(), {
    env: {},
    impactEvaluationRepository: repository,
    impactEvaluationGenerator: async () => { generatorCalls += 1; return { results: [] }; },
    metadataOnlyAudit: fakeMetadataOnlyAudit(),
  });
  assert.equal(result.error.code, "feature_disabled");
  assert.equal(repositoryCalls, 0);
  assert.equal(generatorCalls, 0);
});

test("A2 ACCEPTANCE: KAI_SPRINT2_ENABLED=true with KAI_GENERATION_ENABLED=false still runs the real service+repository path -- Impact Evaluation is not generated-content functionality", async () => {
  const { repository } = harness();
  const result = await createImpactEvaluation(
    serviceInput(),
    deps({ repository, env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "false" } }),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.results.length, 4);
});

test("A2 ACCEPTANCE: the AI seam receives and returns only plain, JSON-serializable data -- it has no transaction/db handle and cannot approve/finalize/write", async () => {
  const { repository } = harness();
  let capturedInput = null;
  const generator = async (generatorInput) => {
    capturedInput = generatorInput;
    return { results: acceptanceGeneratorResults() };
  };
  const result = await createImpactEvaluation(serviceInput(), deps({ repository, generator }));
  assert.equal(result.ok, true);
  assert.doesNotThrow(() => JSON.stringify(capturedInput));
  assert.equal(capturedInput.query, undefined);
  assert.equal(capturedInput.tx, undefined);
  assert.equal(capturedInput.db, undefined);
  assert.ok(Array.isArray(capturedInput.criteria) && capturedInput.criteria.length === 4);
  assert.ok(Array.isArray(capturedInput.governedEvidence) && capturedInput.governedEvidence.length === 1);
});

test("A2 ACCEPTANCE: creating this evaluation leaves claim/evidence/review/audience authority unchanged -- same traceability read, same eligible flag, before and after", async () => {
  const { repository, tx } = harness();
  const before = traceabilitySuccess({ eligible: true });
  const result = await createImpactEvaluation(serviceInput(), deps({ repository }));
  assert.equal(result.ok, true);
  const after = traceabilitySuccess({ eligible: true });
  assert.deepEqual(before.data.eligible, after.data.eligible);
  assert.deepEqual(before.data.blockerCodes, after.data.blockerCodes);
  assert.ok(!tx.sqlLog.some((sql) => /UPDATE|DELETE/i.test(sql)));
  assert.ok(!tx.sqlLog.some((sql) => /INSERT INTO kai\.(claims|evidence_items|review_queue_items)/i.test(sql)));
});
