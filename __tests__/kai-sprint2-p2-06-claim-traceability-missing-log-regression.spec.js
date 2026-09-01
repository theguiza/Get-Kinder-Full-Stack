import test from "node:test";
import assert from "node:assert/strict";

import { getClaimTraceabilitySummaryTool } from "../Backend/kai/services/kaiAssistantClaimTraceabilityTool.js";

// Regression for a proven production discrepancy: /impact-library reported
// get_claim_traceability_summary as ok:false / error.code:system_error /
// error.status:500 with no corresponding CLAIM_TRACEABILITY_RESULT_ERROR log.
//
// Root cause: commit 643e995 added `evidence_review_decision` and
// `claim_review_decision` (plus `candidate.intake_sensitivity_profile_id`) to
// postgresClaimTraceabilityRepository.js's success() DTO, but never updated
// kaiAssistantClaimTraceabilityTool.js's validateSuccessDto() allowlists.
// kaiClaimTraceabilityService.js only logs CLAIM_TRACEABILITY_RESULT_ERROR on
// its own `if (!result.ok)` branch - a repository/service SUCCESS that the
// tool's stricter shape validator then rejects (hasExactKeys failing on the
// two extra keys) falls through to the tool's `if (!validateServiceResult(result))
// return systemError();` at no point logging that message, even though the
// repository (and the service call into it) was genuinely reached.
//
// This test injects the exact current shape the real repository's success()
// returns (see postgresClaimTraceabilityRepository.js), through the same
// claimTraceabilityRepository DI seam the P2-07 integration suite uses, so it
// exercises the real service module (not a stub of it) end to end.
const ORG = "00000000-0000-4000-8000-000000000001";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
});
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_ASSISTANT_TOOLS_ENABLED: "true" });

function realShapedRepositorySuccessDto() {
  return {
    claim: {
      claim_id: CLAIM,
      claim_type: "finding",
      claim_status: "proposed",
      claim_review_status: "needs_gk_review",
      claim_strength: "unassessed",
      audience_gates: {
        internal_only: true,
        public_use_allowed: false,
        funder_use_allowed: false,
        export_ready: false,
      },
    },
    evidence: {
      evidence_item_id: "00000000-0000-4000-8000-000000000201",
      evidence_review_status: "needs_gk_review",
      support_strength: "unassessed",
      review_queue_item_id: "00000000-0000-4000-8000-000000000301",
      review_queue_status: "open",
      review_status: "needs_gk_review",
      updated_at: "2026-08-22T20:00:00.000Z",
      sensitivity_level: "unknown",
    },
    locator: { source_locator_id: "00000000-0000-4000-8000-000000000401" },
    source: { source_id: "00000000-0000-4000-8000-000000000501", source_code: "annual_report" },
    source_version: { source_version_id: "00000000-0000-4000-8000-000000000601", is_current: true },
    claim_review: {
      review_queue_item_id: "00000000-0000-4000-8000-000000000701",
      queue_status: "open",
      review_status: "needs_gk_review",
      updated_at: "2026-08-22T20:00:00.000Z",
    },
    // KAI A1C-1 fields the repository has emitted since 643e995.
    evidence_review_decision: {
      decision_id: "00000000-0000-4000-8000-000000000811",
      decision_outcome: "needs_more_information",
    },
    claim_review_decision: null,
    candidate: {
      intake_source_candidate_id: "00000000-0000-4000-8000-000000000801",
      intake_sensitivity_profile_id: "00000000-0000-4000-8000-000000000802",
    },
    promotion_decision: { intake_promotion_decision_id: "00000000-0000-4000-8000-000000000901" },
    dimensions: {
      missingness: {
        assessment_status: "unresolved",
        validator_key: "VAL-KAI-P2-02-missingness",
        internal_limitation_accepted: false,
        blocks_requested_audience: true,
      },
    },
    gap_items: [],
    client_followup_workflows: [],
    potential_conflict_groups: [],
    requestedAudience: "internal",
    eligible: false,
    blockerCodes: ["claim_not_approved_for_requested_audience"],
    affectedDimensionKeys: ["missingness"],
    affectedObjectIds: [],
    truncated: false,
  };
}

test("get_claim_traceability_summary: a real-shaped repository success (post-643e995) is reached, never triggers CLAIM_TRACEABILITY_RESULT_ERROR, and is accepted (not downgraded to system_error/500)", async (t) => {
  let repositoryCallCount = 0;
  const repository = {
    async getClaimTraceabilitySummary(input) {
      repositoryCallCount += 1;
      assert.equal(input.organizationId, ORG);
      assert.equal(input.claimId, CLAIM);
      assert.equal(input.requestedAudience, "internal");
      return { ok: true, data: realShapedRepositorySuccessDto(), error: null };
    },
  };

  const loggedMessages = [];
  t.mock.method(console, "error", (...args) => {
    loggedMessages.push(args);
  });

  const result = await getClaimTraceabilitySummaryTool(
    {
      toolName: "get_claim_traceability_summary",
      arguments: { organizationId: ORG, claimId: CLAIM, requestedAudience: "internal" },
      actorContext,
    },
    {
      env: enabledEnv,
      claimTraceabilityServiceDependencies: {
        env: { KAI_SPRINT2_ENABLED: "true" },
        claimTraceabilityRepository: repository,
      },
    },
  );

  // TOOL_VERIFIED: the repository (and therefore getClaimTraceabilitySummary)
  // was genuinely reached.
  assert.equal(repositoryCallCount, 1);

  // CLAIM_TRACEABILITY_RESULT_ERROR only ever fires on the service's
  // `if (!result.ok)` branch. A repository success must never log it.
  assert.equal(
    loggedMessages.some((args) => args[0] === "CLAIM_TRACEABILITY_RESULT_ERROR"),
    false,
  );

  // With the drifted validateSuccessDto allowlist (pre-fix), this real
  // repository success shape was rejected by hasExactKeys() and downgraded to
  // buildKaiError("system_error") - producing the exact observed
  // ok:false / error.code:system_error / error.status:500 with no matching
  // log. The fix keeps the tool's allowlist in sync with the repository DTO,
  // so a genuine success now reaches the model as ok:true.
  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.equal(result.data.claim.claim_id, CLAIM);
  assert.deepEqual(result.data.evidence_review_decision, {
    decision_id: "00000000-0000-4000-8000-000000000811",
    decision_outcome: "needs_more_information",
  });
  assert.equal(result.data.claim_review_decision, null);
  assert.equal(result.data.candidate.intake_sensitivity_profile_id, "00000000-0000-4000-8000-000000000802");
});
