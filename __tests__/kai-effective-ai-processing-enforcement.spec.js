import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  sensitivityEffectiveAiProcessingProhibition,
  sensitivityEffectiveAllowedUseProhibition,
} from "../Backend/kai/dictionary/sensitivityAllowedUseDecisionContract.js";
import {
  readEffectiveAiProcessingProhibitionsForClaims,
  readEffectiveAllowedUseProhibition,
  readEffectiveAllowedUseProhibitionsForClaims,
} from "../Backend/kai/dictionary/postgresEffectiveAllowedUseResolver.js";
import {
  EFFECTIVE_AI_PROCESSING_VALIDATOR_KEY,
  EFFECTIVE_ALLOWED_USE_VALIDATOR_KEY,
  validateEffectiveAllowedUsePermitsOperation,
} from "../Backend/kai/validators/kaiEffectiveAllowedUseValidators.js";
import { createPostgresGeneratedContentRepository } from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import { createPostgresImpactEvaluationRepository } from "../Backend/kai/dictionary/postgresImpactEvaluationRepository.js";

/**
 * VAL-KAI-B1A-02-004: a file's effective AI-processing permission (the
 * current human sensitivity decision's reviewed_llm_processing_allowed, after
 * the unchanged effective allowed use) gates every seam that sends claim
 * content to the model provider - generated-content drafting (every content
 * type, one shared boundary) and impact evaluation - and nothing else. Pure
 * precedence, blocker shape, resolver reads, the real repositories with a
 * model spy, and the wiring. The assembled PostgreSQL/browser proof is case
 * 7-8 and 8b of kai-source-to-impact-workflow-browser-acceptance.integration.spec.js.
 */

const ORG = "0e000000-0000-4000-8000-0000000000b1";
const ENGAGEMENT = "1e000000-0000-4000-8000-0000000000b1";
const PROFILE_PERMITTED = "8e000000-0000-4000-8000-0000000000b1";
const PROFILE_RESTRICTED = "8e000000-0000-4000-8000-0000000000b2";
const CLAIM_PERMITTED = "ce000000-0000-4000-8000-0000000000b1";
const CLAIM_RESTRICTED = "ce000000-0000-4000-8000-0000000000b2";
const NOW = "2026-10-19T12:00:00.000Z";

const reviewed = (allowedUse, llm) => ({
  decision_outcome: "reviewed",
  reviewed_allowed_use_status: allowedUse,
  reviewed_llm_processing_allowed: llm,
});
const NEEDS_MORE_INFORMATION = Object.freeze({
  decision_outcome: "needs_more_information",
  reviewed_allowed_use_status: null,
  reviewed_llm_processing_allowed: null,
});

test("precedence: only a stored reviewed AI permission or no human decision lets content reach the model; allowed-use prohibitions keep their own reason", () => {
  const cases = [
    // No human decision: the CHECK-pinned machine columns state nothing (Operating Model 7.1/8.2).
    [{ profileAllowedUseStatus: "unknown", currentHead: null }, null],
    // A reviewed decision is the authoritative human AI fact.
    [{ profileAllowedUseStatus: "unknown", currentHead: reviewed("allowed", true) }, null],
    [{ profileAllowedUseStatus: "unknown", currentHead: reviewed("allowed", false) }, "reviewed_llm_processing_not_allowed"],
    // 'unknown' can never carry the permission (VAL-KAI-B1A-02-001), and is never coerced into it.
    [{ profileAllowedUseStatus: "unknown", currentHead: reviewed("unknown", false) }, "reviewed_llm_processing_not_allowed"],
    // A reopened review states no permission and lifts no earlier prohibition.
    [{ profileAllowedUseStatus: "unknown", currentHead: NEEDS_MORE_INFORMATION }, "sensitivity_ai_processing_unresolved"],
    // The existing allowed-use prohibitions are applied first, unchanged.
    [{ profileAllowedUseStatus: "unknown", currentHead: reviewed("not_allowed", false) }, "reviewed_allowed_use_not_allowed"],
    [{ profileAllowedUseStatus: "not_allowed", currentHead: reviewed("allowed", true) }, "intake_allowed_use_not_allowed"],
    // No human decision never lifts an independently established restriction.
    [{ profileAllowedUseStatus: "not_allowed", currentHead: null }, "intake_allowed_use_not_allowed"],
    [{ profileAllowedUseStatus: "unknown", currentHead: null, lineageAmbiguous: true }, "sensitivity_decision_lineage_ambiguous"],
    [{ profileAllowedUseStatus: "unknown", currentHead: reviewed("allowed", true), lineageAmbiguous: true }, "sensitivity_decision_lineage_ambiguous"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(sensitivityEffectiveAiProcessingProhibition(input), expected, JSON.stringify(input));
  }
  // An AI-only restriction never becomes a general content-processing prohibition.
  for (const head of [reviewed("allowed", false), reviewed("unknown", false), NEEDS_MORE_INFORMATION]) {
    assert.equal(sensitivityEffectiveAllowedUseProhibition({ profileAllowedUseStatus: "unknown", currentHead: head }), null);
  }
});

test("blocker: an AI prohibition is a structured VAL-KAI-B1A-02-004 validation blocker; allowed-use reasons keep VAL-KAI-B1A-02-003", () => {
  for (const basis of ["reviewed_llm_processing_not_allowed", "sensitivity_ai_processing_unresolved"]) {
    const refused = validateEffectiveAllowedUsePermitsOperation(basis, { operation: "create_evidence_summary_draft", objectType: "claim", objectId: CLAIM_RESTRICTED });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, "validation_blocker");
    assert.deepEqual(
      [refused.blockers[0].validator_key, refused.blockers[0].blocking_reason, refused.blockers[0].object_id, refused.blockers[0].evidence],
      [EFFECTIVE_AI_PROCESSING_VALIDATOR_KEY, "ai_processing_not_permitted", CLAIM_RESTRICTED, { basis, bypass_allowed: false }],
    );
  }
  const notAllowed = validateEffectiveAllowedUsePermitsOperation("reviewed_allowed_use_not_allowed", { operation: "x", objectType: "claim" });
  assert.deepEqual([notAllowed.blockers[0].validator_key, notAllowed.blockers[0].blocking_reason], [EFFECTIVE_ALLOWED_USE_VALIDATOR_KEY, "allowed_use_not_allowed"]);
});

/**
 * One fake transaction answering the shared resolver (claim lineage, P1-05
 * profiles, decision heads) and the generation/impact-evaluation reads. Every
 * write is recorded; the real database rolls the reservation back on refusal.
 */
function fakeTx({ heads = [], claimIds = [CLAIM_PERMITTED, CLAIM_RESTRICTED] } = {}) {
  const writes = [];
  const reads = [];
  const profileOf = { [CLAIM_PERMITTED]: PROFILE_PERMITTED, [CLAIM_RESTRICTED]: PROFILE_RESTRICTED };
  return {
    writes,
    reads,
    async query(sql, params) {
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) {
        writes.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
        if (sql.includes("INTO kai.generation_runs")) return { rows: [{ generation_run_id: "9e000000-0000-4000-8000-0000000000b1" }] };
        return { rows: [] };
      }
      reads.push(sql);
      if (sql.includes("JOIN kai.claim_evidence_links")) {
        return { rows: params[1].map((claimId) => ({ claim_id: claimId, intake_sensitivity_profile_id: profileOf[claimId] })) };
      }
      if (sql.includes("FROM kai.intake_sensitivity_review_decisions")) return { rows: heads };
      if (sql.includes("FROM kai.intake_sensitivity_profiles")) {
        return { rows: params[1].map((id) => ({ intake_sensitivity_profile_id: id, allowed_use_status: "unknown" })) };
      }
      if (sql.includes("FROM kai.claims c")) {
        return {
          rows: claimIds.filter((id) => params[1].includes(id)).map((claimId, index) => ({
            claim_id: claimId,
            claim_statement: `Synthetic statement ${index + 1}.`,
            claim_type: "finding",
            evidence_item_id: `ee000000-0000-4000-8000-0000000000b${index + 1}`,
            internal_only: true,
            funder_use_allowed: false,
            public_use_allowed: false,
            source_id: "5e000000-0000-4000-8000-0000000000b1",
            source_version_id: "6e000000-0000-4000-8000-0000000000b1",
            intake_file_id: "2e000000-0000-4000-8000-0000000000b1",
            upload_state: "confirmed",
          })),
        };
      }
      if (sql.includes("FROM kai.impact_outcome_contexts")) {
        return { rows: [{ impact_outcome_context_id: params[1], organization_id: ORG, outcome_key: "k", outcome_statement: "s", stakeholder_key: "k", stakeholder_label: "l" }] };
      }
      if (sql.includes("FROM kai.impact_evaluation_framework_versions")) {
        return { rows: [{ framework_version_id: params[0], framework_code: "kai_core", version_label: "v1", framework_status: "active" }] };
      }
      if (sql.includes("FROM kai.impact_evaluation_criteria")) {
        return { rows: [{ criterion_id: "a1000000-0000-4000-8000-0000000000b1", criterion_key: "what", criterion_label: "What", description: "d", evaluation_guidance: "g", display_order: 0 }] };
      }
      return { rows: [] };
    },
  };
}

const evidenceIdOf = (claimId) => (claimId === CLAIM_PERMITTED ? "ee000000-0000-4000-8000-0000000000b1" : "ee000000-0000-4000-8000-0000000000b2");
function traceability(claimId, requestedAudience) {
  return {
    ok: true,
    data: {
      requestedAudience,
      claim: { claim_id: claimId, claim_strength: "unassessed" },
      evidence: { evidence_item_id: evidenceIdOf(claimId) },
      eligible: true,
      blockerCodes: [],
    },
  };
}

function generationHarness(heads) {
  const tx = fakeTx({ heads });
  const evaluatorCalls = [];
  const modelCalls = [];
  const audits = [];
  const repository = createPostgresGeneratedContentRepository({
    runInTransaction: (callback) => callback(tx),
    evaluator: async (_tx, { claimId, requestedAudience }) => {
      evaluatorCalls.push(claimId);
      return traceability(claimId, requestedAudience);
    },
  });
  const dependencies = {
    // The model spy records the request and returns an unusable result, so a
    // permitted request ends in the existing generator-result rollback.
    draftGenerator: async (generatorInput) => {
      modelCalls.push(generatorInput.claims.map((claim) => claim.claimId));
      return { blocks: [] };
    },
    metadataOnlyAudit: { prepareMetadataOnlyAudit: () => { audits.push("prepared"); return { ok: true, publish: async () => {} }; } },
  };
  const input = (claimIds, idempotencyKey) => ({
    organizationId: ORG, engagementId: ENGAGEMENT, requestedAudience: "internal", claimIds, idempotencyKey, actorContext: { actorType: "human" }, now: NOW,
  });
  return { tx, repository, dependencies, input, evaluatorCalls, modelCalls, audits };
}

const headsFor = (restrictedHead, permittedHead = reviewed("allowed", true)) => [
  { intake_sensitivity_profile_id: PROFILE_PERMITTED, ...permittedHead },
  ...(restrictedHead ? [{ intake_sensitivity_profile_id: PROFILE_RESTRICTED, ...restrictedHead }] : []),
];

test("generation (evidence summary and impact narrative): an AI-prohibited claim, alone or mixed with a permitted claim, never reaches traceability or the model and is refused with a structured blocker", async () => {
  for (const [label, restrictedHead, basis] of [
    ["explicit reviewed AI prohibition", reviewed("allowed", false), "reviewed_llm_processing_not_allowed"],
    ["reviewed 'unknown' (AI permission not established)", reviewed("unknown", false), "reviewed_llm_processing_not_allowed"],
    ["reopened review", NEEDS_MORE_INFORMATION, "sensitivity_ai_processing_unresolved"],
  ]) {
    for (const method of ["createEvidenceSummaryDraft", "createImpactNarrativeDraft"]) {
      for (const claimIds of [[CLAIM_RESTRICTED], [CLAIM_PERMITTED, CLAIM_RESTRICTED]]) {
        const harness = generationHarness(headsFor(restrictedHead));
        const result = await harness.repository[method](harness.input(claimIds, `ai-${method}-${claimIds.length}`), harness.dependencies);
        const context = `${label} / ${method} / ${claimIds.length} claim(s)`;
        assert.equal(result.ok, false, context);
        assert.deepEqual([result.error.code, result.error.status], ["validation_blocker", 422], context);
        assert.deepEqual(
          [result.blockers[0].validator_key, result.blockers[0].blocking_reason, result.blockers[0].object_id, result.blockers[0].evidence.basis],
          [EFFECTIVE_AI_PROCESSING_VALIDATOR_KEY, "ai_processing_not_permitted", CLAIM_RESTRICTED, basis], context,
        );
        assert.deepEqual(harness.modelCalls, [], `${context}: model calls`);
        assert.deepEqual(harness.evaluatorCalls, [], `${context}: P2-06 not reached`);
        assert.deepEqual(harness.tx.writes, ["INSERT INTO kai.generation_runs"], `${context}: only the reservation the refusal rolls back`);
        assert.deepEqual(harness.audits, [], `${context}: no success audit prepared`);
      }
    }
  }
});

test("generation: a stored reviewed AI permission, or no human decision at all, reaches the model without any new approval; an existing not_allowed still refuses first", async () => {
  for (const [label, restrictedHead] of [["reviewed AI permission", reviewed("allowed", true)], ["no human decision", null]]) {
    const harness = generationHarness(headsFor(restrictedHead));
    const result = await harness.repository.createEvidenceSummaryDraft(harness.input([CLAIM_PERMITTED, CLAIM_RESTRICTED], "ai-permitted-1"), harness.dependencies);
    assert.deepEqual(harness.modelCalls, [[CLAIM_PERMITTED, CLAIM_RESTRICTED]], label);
    assert.deepEqual(harness.evaluatorCalls, [CLAIM_PERMITTED, CLAIM_RESTRICTED], label);
    // The spy's unusable result ends in the existing generator-result refusal.
    assert.equal(result.blockers[0].blocking_reason, "generator_result_blocks_empty", label);
  }
  const harness = generationHarness(headsFor(reviewed("not_allowed", false)));
  const result = await harness.repository.createImpactNarrativeDraft(harness.input([CLAIM_PERMITTED, CLAIM_RESTRICTED], "ai-not-allowed-1"), harness.dependencies);
  assert.deepEqual([result.blockers[0].validator_key, result.blockers[0].blocking_reason, result.blockers[0].evidence.basis],
    [EFFECTIVE_ALLOWED_USE_VALIDATOR_KEY, "allowed_use_not_allowed", "reviewed_allowed_use_not_allowed"]);
  assert.deepEqual(harness.modelCalls, []);
});

test("impact evaluation (read and persist paths): an AI-prohibited claim never reaches the model; a permitted one does", async () => {
  const run = async (method, heads, claimIds) => {
    const tx = fakeTx({ heads });
    const modelCalls = [];
    const repository = createPostgresImpactEvaluationRepository({
      runInTransaction: (callback) => callback(tx),
      evaluator: async (_tx, { claimId, requestedAudience }) => traceability(claimId, requestedAudience),
    });
    const input = {
      organizationId: ORG,
      impactOutcomeContextId: "7e000000-0000-4000-8000-0000000000b1",
      frameworkVersionId: "7f000000-0000-4000-8000-0000000000b1",
      requestedAudience: "internal",
      claimIds,
      ...(method === "createImpactEvaluationSnapshot" ? { createdBy: "0a000000-0000-4000-8000-0000000000b1", now: NOW } : {}),
    };
    const result = await repository[method](input, {
      generator: async (generatorInput) => { modelCalls.push(generatorInput.governedEvidence.map((claim) => claim.claimId)); return { results: "unusable" }; },
      metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) },
    });
    return { result, modelCalls, writes: tx.writes };
  };
  for (const method of ["evaluateImpactOutcomeContext", "createImpactEvaluationSnapshot"]) {
    // The same heads generation refuses: explicit, historical reviewed 'unknown', and unresolved.
    for (const [label, restrictedHead, basis] of [
      ["explicit", reviewed("allowed", false), "reviewed_llm_processing_not_allowed"],
      ["historical reviewed unknown", reviewed("unknown", false), "reviewed_llm_processing_not_allowed"],
      ["needs more information", NEEDS_MORE_INFORMATION, "sensitivity_ai_processing_unresolved"],
    ]) {
      const refused = await run(method, headsFor(restrictedHead), [CLAIM_PERMITTED, CLAIM_RESTRICTED]);
      assert.deepEqual([refused.result.error.code, refused.result.blockers[0].validator_key, refused.result.blockers[0].object_id, refused.result.blockers[0].evidence.basis],
        ["validation_blocker", EFFECTIVE_AI_PROCESSING_VALIDATOR_KEY, CLAIM_RESTRICTED, basis], `${method} / ${label}`);
      assert.deepEqual(refused.modelCalls, [], `${method} / ${label}`);
      assert.deepEqual(refused.writes, [], `${method} / ${label}`);
    }
    const permitted = await run(method, headsFor(reviewed("allowed", true)), [CLAIM_PERMITTED, CLAIM_RESTRICTED]);
    assert.deepEqual(permitted.modelCalls, [[CLAIM_PERMITTED, CLAIM_RESTRICTED]], method);
  }
});

test("non-AI processing: the same AI-restricted file stays permitted for every allowed-use seam (P1-07..P2-06 read only the allowed-use form)", async () => {
  const heads = headsFor(reviewed("allowed", false));
  assert.equal(await readEffectiveAllowedUseProhibition(fakeTx({ heads }), { organizationId: ORG, intakeSensitivityProfileId: PROFILE_RESTRICTED }), null);
  const allowedUse = await readEffectiveAllowedUseProhibitionsForClaims(fakeTx({ heads }), { organizationId: ORG, claimIds: [CLAIM_RESTRICTED] });
  assert.equal(allowedUse.get(CLAIM_RESTRICTED), null);
  const aiTx = fakeTx({ heads });
  const ai = await readEffectiveAiProcessingProhibitionsForClaims(aiTx, { organizationId: ORG, claimIds: [CLAIM_PERMITTED, CLAIM_RESTRICTED] });
  assert.deepEqual([...ai.entries()], [[CLAIM_PERMITTED, null], [CLAIM_RESTRICTED, "reviewed_llm_processing_not_allowed"]]);
  // The head read is the same tenant-scoped "no successor" read, now carrying the AI fact.
  const headRead = aiTx.reads.find((sql) => sql.includes("FROM kai.intake_sensitivity_review_decisions"));
  assert.match(headRead, /d\.reviewed_llm_processing_allowed/);
  assert.match(headRead, /NOT EXISTS[\s\S]*supersedes_decision_id = d\.decision_id/);
});

test("wiring: both model seams read the AI form before the generator; no other seam reads it", () => {
  const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const generation = source("Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  const check = generation.indexOf("readEffectiveAiProcessingProhibitionsForClaims(tx");
  assert.ok(check > 0 && check < generation.indexOf("const traceabilityResults = [];"));
  assert.ok(check < generation.indexOf("await dependencies.draftGenerator(generatorInput)"));
  assert.equal(generation.split("dependencies.draftGenerator(").length - 1, 1, "one generation boundary for every content type");
  const impact = source("Backend/kai/dictionary/postgresImpactEvaluationRepository.js");
  const refusals = impact.split("await refuseAiProcessingProhibitedClaims(tx").length - 1;
  assert.equal(refusals, 2);
  let from = 0;
  for (let index = 0; index < refusals; index += 1) {
    const refusal = impact.indexOf("await refuseAiProcessingProhibitedClaims(tx", from);
    assert.ok(refusal < impact.indexOf("await dependencies.generator(generatorInput)", refusal), "before the model call");
    from = refusal + 1;
  }
  for (const path of [
    "Backend/kai/dictionary/postgresSourceCandidateRepository.js",
    "Backend/kai/dictionary/postgresSourcePromotionRepository.js",
    "Backend/kai/dictionary/postgresEvidenceLineageRepository.js",
    "Backend/kai/dictionary/postgresClaimProposalRepository.js",
    "Backend/kai/dictionary/postgresEvidenceCoverageAssessmentRepository.js",
    "Backend/kai/dictionary/postgresOrganizationEvidenceGapCurrentStateRepository.js",
  ]) {
    assert.equal(source(path).includes("readEffectiveAiProcessing"), false, path);
  }
});
