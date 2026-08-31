import test from "node:test";
import assert from "node:assert/strict";

import {
  EVIDENCE_REVIEW_DECISION_OUTCOMES,
  CLAIM_REVIEW_DECISION_OUTCOMES,
  CLAIM_REVIEW_APPROVED_AUDIENCE_VALUES,
  evidenceReviewStatusForOutcome,
  claimReviewStatusForOutcome,
  supportStrengthForOutcome,
  claimStrengthForOutcome,
  evidenceReviewLimitationNotesRequired,
  claimReviewLimitationNotesRequired,
  claimReviewApprovedAudiencesRequired,
} from "../Backend/kai/dictionary/humanReviewDecisionContract.js";
import {
  validateCompleteEvidenceReviewRequest,
  validateCompleteClaimReviewRequest,
} from "../Backend/kai/validators/kaiSprint2RequestSchemas.js";
import { __humanReviewRepositoryTestables } from "../Backend/kai/dictionary/postgresHumanReviewRepository.js";
import { __humanReviewDecisionRepositoryTestables } from "../Backend/kai/dictionary/postgresHumanReviewDecisionRepository.js";

const NOW = "2026-08-06T10:00:00.000Z";

test("P2-12 contract: evidence-review outcome projections", () => {
  assert.equal(evidenceReviewStatusForOutcome("supported"), "reviewed");
  assert.equal(evidenceReviewStatusForOutcome("supported_with_limitation"), "reviewed");
  assert.equal(evidenceReviewStatusForOutcome("not_supported"), "reviewed");
  assert.equal(evidenceReviewStatusForOutcome("needs_more_information"), "needs_gk_review");

  assert.equal(supportStrengthForOutcome("supported"), "reviewed_supported");
  assert.equal(supportStrengthForOutcome("supported_with_limitation"), "reviewed_supported");
  assert.equal(supportStrengthForOutcome("not_supported"), "reviewed_not_supported");
  assert.equal(supportStrengthForOutcome("needs_more_information"), "unassessed");
});

test("P2-12 contract: claim-review outcome projections", () => {
  assert.equal(claimReviewStatusForOutcome("approved"), "reviewed");
  assert.equal(claimReviewStatusForOutcome("approved_with_limitation"), "reviewed");
  assert.equal(claimReviewStatusForOutcome("rejected"), "reviewed");
  assert.equal(claimReviewStatusForOutcome("needs_more_information"), "needs_gk_review");

  assert.equal(claimStrengthForOutcome("approved"), "reviewed_supported");
  assert.equal(claimStrengthForOutcome("approved_with_limitation"), "reviewed_supported");
  assert.equal(claimStrengthForOutcome("rejected"), "reviewed_not_supported");
  assert.equal(claimStrengthForOutcome("needs_more_information"), "unassessed");
});

test("P2-12 contract: limitation-notes/approved-audiences requiredness vocabulary", () => {
  assert.equal(evidenceReviewLimitationNotesRequired("supported_with_limitation"), true);
  assert.equal(evidenceReviewLimitationNotesRequired("supported"), false);
  assert.equal(claimReviewLimitationNotesRequired("approved_with_limitation"), true);
  assert.equal(claimReviewLimitationNotesRequired("approved"), false);
  assert.equal(claimReviewApprovedAudiencesRequired("approved"), true);
  assert.equal(claimReviewApprovedAudiencesRequired("approved_with_limitation"), true);
  assert.equal(claimReviewApprovedAudiencesRequired("rejected"), false);
  assert.equal(claimReviewApprovedAudiencesRequired("needs_more_information"), false);
});

test("P2-12 contract: outcome vocabularies are exactly four members each, frozen", () => {
  assert.deepEqual([...EVIDENCE_REVIEW_DECISION_OUTCOMES].sort(), ["needs_more_information", "not_supported", "supported", "supported_with_limitation"]);
  assert.deepEqual([...CLAIM_REVIEW_DECISION_OUTCOMES].sort(), ["approved", "approved_with_limitation", "needs_more_information", "rejected"]);
  assert.deepEqual([...CLAIM_REVIEW_APPROVED_AUDIENCE_VALUES].sort(), ["funder", "internal", "public"]);
  assert.ok(Object.isFrozen(EVIDENCE_REVIEW_DECISION_OUTCOMES));
  assert.ok(Object.isFrozen(CLAIM_REVIEW_DECISION_OUTCOMES));
});

test("P2-12 validators: unknown request fields are rejected on both endpoints", () => {
  const evidence = validateCompleteEvidenceReviewRequest({ expected_updated_at: NOW, decision: "supported", unexpected: true });
  assert.equal(evidence.ok, false);
  assert.equal(evidence.blockers[0].blocking_reason, "unknown_field");

  const claim = validateCompleteClaimReviewRequest({ expected_updated_at: NOW, decision: "approved", approved_audiences: ["internal"], unexpected: true });
  assert.equal(claim.ok, false);
  assert.equal(claim.blockers[0].blocking_reason, "unknown_field");
});

test("P2-12 validators: a malformed expected_updated_at is rejected on both endpoints", () => {
  const evidence = validateCompleteEvidenceReviewRequest({ expected_updated_at: "not-a-timestamp", decision: "supported" });
  assert.equal(evidence.ok, false);
  assert.equal(evidence.blockers[0].blocking_reason, "invalid_expected_updated_at");

  const claim = validateCompleteClaimReviewRequest({ expected_updated_at: "not-a-timestamp", decision: "rejected" });
  assert.equal(claim.ok, false);
  assert.equal(claim.blockers[0].blocking_reason, "invalid_expected_updated_at");
});

test("P2-12 validators: an invalid decision value is rejected on both endpoints", () => {
  const evidence = validateCompleteEvidenceReviewRequest({ expected_updated_at: NOW, decision: "made_up_outcome" });
  assert.equal(evidence.ok, false);
  assert.equal(evidence.blockers[0].blocking_reason, "invalid_decision");

  const claim = validateCompleteClaimReviewRequest({ expected_updated_at: NOW, decision: "made_up_outcome" });
  assert.equal(claim.ok, false);
  assert.equal(claim.blockers[0].blocking_reason, "invalid_decision");
});

test("P2-12 repository decision-lineage input validation: isInsertEvidenceReviewDecisionInput/isInsertClaimReviewDecisionInput fail closed on malformed input", () => {
  const { isInsertEvidenceReviewDecisionInput, isInsertClaimReviewDecisionInput } = __humanReviewDecisionRepositoryTestables;
  assert.equal(isInsertEvidenceReviewDecisionInput({}), false);
  assert.equal(isInsertEvidenceReviewDecisionInput({
    organizationId: "00000000-0000-4000-8000-000000000001",
    evidenceItemId: "00000000-0000-4000-8000-000000000002",
    reviewQueueItemId: "00000000-0000-4000-8000-000000000003",
    decisionOutcome: "supported",
    limitationNotes: null,
    decidedBy: "00000000-0000-4000-8000-000000000004",
    decidedByRole: "gk_reviewer",
    targetUpdatedAt: NOW,
    supersedesDecisionId: null,
  }), true);
  assert.equal(isInsertClaimReviewDecisionInput({}), false);
});

test("P2-12 repository isReplayOfDecision: requires matching outcome, matching target_updated_at, and the projected queue state", () => {
  const { isReplayOfDecision } = __humanReviewRepositoryTestables;
  const head = { decision_outcome: "supported", target_updated_at: new Date(NOW) };
  assert.equal(isReplayOfDecision({
    currentHead: head, decisionOutcome: "supported", expectedUpdatedAt: NOW,
    existingQueueRow: { queue_status: "resolved", review_status: "resolved" }, isTerminal: true,
  }), true);
  assert.equal(isReplayOfDecision({
    currentHead: head, decisionOutcome: "not_supported", expectedUpdatedAt: NOW,
    existingQueueRow: { queue_status: "resolved", review_status: "resolved" }, isTerminal: true,
  }), false);
  assert.equal(isReplayOfDecision({
    currentHead: null, decisionOutcome: "supported", expectedUpdatedAt: NOW,
    existingQueueRow: { queue_status: "resolved", review_status: "resolved" }, isTerminal: true,
  }), false);
  assert.equal(isReplayOfDecision({
    currentHead: head, decisionOutcome: "supported", expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
    existingQueueRow: { queue_status: "resolved", review_status: "resolved" }, isTerminal: true,
  }), false);
});
