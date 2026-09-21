// PHASE 14 CONDITIONAL CLIENT-REVIEW CONFORMANCE
//
// Proves the REAL review/governance workflow correctly implements
// conditional client involvement, distinct from (and not to be confused
// with) the dormant P3-17 `client_reviewed` human-authority decision type
// already resolved in the immediately preceding Phase-14 semantic-authority
// package.
//
// The authoritative "client knowledge/confirmation is required" state is
// the P2-04/P2-11 `client_followup` review-queue workflow:
//   - a fresh client_followup queue row (`queue_type='client_followup'`,
//     `queue_status='waiting_on_client'`) makes the linked claim's
//     `client_followup_unresolved` blocker fire in
//     evaluateClaimTraceabilityInTransaction
//     (Backend/kai/dictionary/postgresClaimTraceabilityRepository.js) - this
//     is only ever created when a real, persisted coverage gap requires it
//     (P2-04 `generateClaimGapFollowups`), never universally.
//   - `client_followup_unresolved` makes that claim's `eligible=false`,
//     which makes the citation's `currentEligible=false`, which makes the
//     generated-content packet's `currentUseEligible` false
//     (Backend/kai/dictionary/postgresGeneratedContentRepository.js -
//     `currentUseEligible: [...evaluatedByClaim.values()].every((e) =>
//     e.eligible === true)`), which VAL-EXP-001
//     (kaiExportManifestEligibilityValidators.js) fails closed on as
//     `current_use_ineligible`.
//   - only an org-scoped `client_reviewer` actor may resolve it
//     (kaiClientFollowupCompletionService.js /
//     postgresClientFollowupCompletionRepository.js#completeClientFollowup),
//     and GK review (postgresHumanReviewRepository.js) is structurally
//     incapable of touching a `client_followup` queue row - its
//     compare-and-set queries hardcode `queue_type='evidence_review'`/
//     `'claim_review'` only.
//   - resolving it never touches `kai.human_authority_decisions` or
//     `export_authority_granted` - it is a workflow disposition on
//     `kai.review_queue_items` only.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  __claimTraceabilityRepositoryContract,
} from "../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js";
import { __humanReviewRepositoryContract } from "../Backend/kai/dictionary/postgresHumanReviewRepository.js";
import {
  evaluateFinalExportEligibility,
} from "../Backend/kai/services/kaiFinalExportEligibilityGateService.js";
import { completeClientFollowup } from "../Backend/kai/services/kaiClientFollowupCompletionService.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const DRAFT = "00000000-0000-4000-8000-000000000301";
const CANDIDATE = "00000000-0000-4000-8000-000000000401";
const QUEUE = "00000000-0000-4000-8000-000000000303";

const enabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_GENERATION_ENABLED: "true",
  KAI_PUBLIC_EXPORT_ENABLED: "true",
});

const adminActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});

function gateInput(overrides = {}) {
  return {
    organizationId: ORG,
    exportCandidateId: CANDIDATE,
    exportReviewQueueItemId: QUEUE,
    actorContext: adminActorContext,
    ...overrides,
  };
}

function candidateRow(overrides = {}) {
  return {
    export_candidate_id: CANDIDATE,
    organization_id: ORG,
    generated_content_draft_id: DRAFT,
    requested_audience: "internal",
    ...overrides,
  };
}

function packet(overrides = {}) {
  return {
    generatedContentDraftId: DRAFT,
    requestedExportAudience: "internal",
    draftStatus: "draft",
    generatedContentReviewQueueStatus: "resolved",
    generatedContentReviewStatus: "resolved",
    exportReviewQueueStatus: "resolved",
    exportReviewStatus: "resolved",
    currentUseEligible: true,
    ...overrides,
  };
}

function gateDependencies({ currentUseEligible, effective }) {
  return {
    env: enabledEnv,
    runInTransaction: async (callback) => callback({ async query() { return { rows: [] }; } }),
    loadCandidate: async () => candidateRow(),
    evaluatePacket: async () => ({ ok: true, data: packet({ currentUseEligible }), error: null }),
    evaluator: async () => ({ ok: true, data: {}, error: null }),
    humanAuthorityDecisionRepository: {
      evaluateEffectiveness: async () => ({
        ok: true,
        data: {
          effective,
          reason: effective ? null : "no_decision",
          headDecisionId: effective ? "decision-1" : null,
        },
        error: null,
      }),
    },
  };
}

test("REQUIREMENT A/B: client_followup_unresolved is the real, existing, authoritative client-required blocker - real evaluator source declares it, gated only on a persisted waiting_on_client/unresolved queue row, never fired for every claim", () => {
  assert.ok(__claimTraceabilityRepositoryContract.BLOCKER_ORDER.includes("client_followup_unresolved"));

  const source = readFileSync(
    new URL("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js", import.meta.url),
    "utf8",
  );
  // The blocker fires only when a real followup queue row exists in this
  // unresolved shape - `followupQueueRows` is read from persisted
  // kai.client_followup_items/review_queue_items rows (readFollowupQueueRows),
  // never derived from audience, content type, or any other request-time
  // input. No client_followup queue row for a claim means no iteration, so
  // no blocker - this is what makes client review conditional, not universal.
  assert.match(
    source,
    /for \(const row of followupQueueRows\) \{\s*if \(unresolvedReviewStatus\(row\.review_status\) \|\| row\.queue_status === "waiting_on_client"\) \{\s*addOrderedBlocker\(blockers, "client_followup_unresolved"\);/,
  );
});

test("REQUIREMENT B: GK review (postgresHumanReviewRepository.js) is structurally incapable of resolving a client_followup queue row - its compare-and-set queries hardcode queue_type to evidence_review/claim_review only", () => {
  assert.equal(__humanReviewRepositoryContract.EVIDENCE_REVIEW_QUEUE_TYPE, "evidence_review");
  assert.equal(__humanReviewRepositoryContract.CLAIM_REVIEW_QUEUE_TYPE, "claim_review");

  const source = readFileSync(
    new URL("../Backend/kai/dictionary/postgresHumanReviewRepository.js", import.meta.url),
    "utf8",
  );
  // Every queueType value this file ever passes into its own compare-and-set
  // query is one of the two constants above - never a caller-suppliable
  // value, and never "client_followup".
  const queueTypeUsages = [...source.matchAll(/queueType:\s*([A-Z_]+)/g)].map((match) => match[1]);
  assert.ok(queueTypeUsages.length > 0);
  assert.ok(queueTypeUsages.every((name) => name === "EVIDENCE_REVIEW_QUEUE_TYPE" || name === "CLAIM_REVIEW_QUEUE_TYPE"));
  assert.doesNotMatch(source, /client_followup/);
});

test("REQUIREMENT B: currentUseEligible=false from an unresolved client-required blocker fails VAL-EXP-001 closed as current_use_ineligible, even with effective export_authority_granted", async () => {
  const result = await evaluateFinalExportEligibility(
    gateInput(),
    gateDependencies({ currentUseEligible: false, effective: true }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.finalExportEligible, false);
  assert.equal(result.data.effectiveHumanExportAuthority, true);
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("current_use_ineligible"));
});

test("REQUIREMENT D / NO FALSE NEGATIVE: once currentUseEligible is true (the client-required blocker has been resolved through the real workflow), final export is not held back merely because the dormant client_reviewed authority decision was never written", async () => {
  const result = await evaluateFinalExportEligibility(
    gateInput(),
    gateDependencies({ currentUseEligible: true, effective: true }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.finalExportEligible, true);
});

test("REQUIREMENT C/E: resolving currentUseEligible (client-required work) does not itself satisfy export_authority_granted - final release authority remains separate and still required", async () => {
  const result = await evaluateFinalExportEligibility(
    gateInput(),
    gateDependencies({ currentUseEligible: true, effective: false }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.finalExportEligible, false);
  assert.equal(result.data.effectiveHumanExportAuthority, false);
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("affirmative_human_export_authority_absent"));
});

test("REQUIREMENT C: the client-followup completion service/repository never reference the P3-17 human-authority decision ledger or export_authority_granted - client resolution cannot grant final-release authority by construction", () => {
  const serviceSource = readFileSync(
    new URL("../Backend/kai/services/kaiClientFollowupCompletionService.js", import.meta.url),
    "utf8",
  );
  const repositorySource = readFileSync(
    new URL("../Backend/kai/dictionary/postgresClientFollowupCompletionRepository.js", import.meta.url),
    "utf8",
  );
  for (const source of [serviceSource, repositorySource]) {
    assert.doesNotMatch(source, /human_authority_decisions/);
    assert.doesNotMatch(source, /export_authority_granted/);
    assert.doesNotMatch(source, /humanAuthorityDecisionContract/);
    assert.doesNotMatch(source, /postgresHumanAuthorityDecisionRepository/);
  }
});

test("REQUIREMENT C (route boundary): only client_reviewer may resolve a client_followup workflow, and the operation only writes a fixed disposition, never a free-text client answer", async () => {
  let repositoryCalls = 0;
  const repository = {
    async completeClientFollowup() {
      repositoryCalls += 1;
      return {
        ok: true,
        data: {
          client_followup_item_id: "cf-1",
          gap_log_item_id: "gap-1",
          dimension_key: "consent_scope",
          review_queue_item_id: "rq-1",
          queue_status: "resolved",
          review_status: "resolved",
          disposition: "no_additional_client_information",
          replayed: false,
        },
        error: null,
      };
    },
  };
  const gkActor = Object.freeze({
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000002",
    organizationMemberships: [
      { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
    ],
  });
  const clientReviewerActor = Object.freeze({
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000003",
    organizationMemberships: [
      { organization_id: ORG, membership_status: "active", role_name: "client_reviewer" },
    ],
  });
  const now = new Date().toISOString();
  const input = {
    organizationId: ORG,
    claimId: "00000000-0000-4000-8000-000000000101",
    clientFollowupItemId: "00000000-0000-4000-8000-000000000601",
    expectedUpdatedAt: now,
    now,
  };

  const deniedResult = await completeClientFollowup(
    { ...input, actorContext: gkActor },
    { env: enabledEnv, clientFollowupCompletionRepository: repository },
  );
  assert.equal(deniedResult.ok, false);
  assert.equal(deniedResult.error.code, "authorization_denied");
  assert.equal(repositoryCalls, 0);

  const allowedResult = await completeClientFollowup(
    { ...input, actorContext: clientReviewerActor },
    { env: enabledEnv, clientFollowupCompletionRepository: repository },
  );
  assert.equal(allowedResult.ok, true);
  assert.equal(allowedResult.data.disposition, "no_additional_client_information");
  assert.equal(repositoryCalls, 1);

  // No answer/free-text/raw client-content field exists on the input contract.
  const rejectedExtraField = await completeClientFollowup(
    { ...input, actorContext: clientReviewerActor, answer: "some client text" },
    { env: enabledEnv, clientFollowupCompletionRepository: repository },
  );
  assert.equal(rejectedExtraField.ok, false);
  assert.equal(rejectedExtraField.error.code, "validation_blocker");
  assert.equal(repositoryCalls, 1);
});
