import test from "node:test";
import assert from "node:assert/strict";

import {
  __generatedContentRepositoryTestables,
  __generatedContentRepositoryContract,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import { GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES } from "../Backend/kai/dictionary/generatedContentReviewQueueContract.js";

const { validateExistingState } = __generatedContentRepositoryTestables;
const { DRAFT_STATUS, REVIEW_STATUS } = __generatedContentRepositoryContract;

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000009";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000501";
const OTHER_ENGAGEMENT = "00000000-0000-4000-8000-000000000502";
const RUN_ID = "10000000-0000-4000-8000-000000000001";
const DRAFT_ID = "10000000-0000-4000-8000-000000000002";
const OTHER_DRAFT_ID = "10000000-0000-4000-8000-000000000003";
const BLOCK_ID = "10000000-0000-4000-8000-000000000004";
const CITATION_ID = "10000000-0000-4000-8000-000000000005";
const CLAIM_ID = "10000000-0000-4000-8000-000000000006";
const EVIDENCE_ID = "10000000-0000-4000-8000-000000000007";
const QUEUE_ID = "10000000-0000-4000-8000-000000000008";
const REQUEST_FINGERPRINT = "a".repeat(64);
const CONTENT_TYPE = "evidence_summary";
const REQUESTED_AUDIENCE = "funder";

function baseState({ queueStatus, reviewStatus } = { queueStatus: "open", reviewStatus: "needs_gk_review" }) {
  return {
    run: {
      generation_run_id: RUN_ID,
      organization_id: ORG,
      engagement_id: ENGAGEMENT,
      request_fingerprint: REQUEST_FINGERPRINT,
      content_type: CONTENT_TYPE,
      requested_audience: REQUESTED_AUDIENCE,
      created_by_type: "system",
    },
    drafts: [{
      generated_content_draft_id: DRAFT_ID,
      generation_run_id: RUN_ID,
      organization_id: ORG,
      content_type: CONTENT_TYPE,
      requested_audience: REQUESTED_AUDIENCE,
      draft_status: DRAFT_STATUS,
      review_status: REVIEW_STATUS,
      created_by_type: "system",
    }],
    blocks: [{ generated_content_block_id: BLOCK_ID, generated_content_draft_id: DRAFT_ID, organization_id: ORG, ordinal: 1, text: "x" }],
    citations: [{
      generated_content_citation_id: CITATION_ID,
      generated_content_block_id: BLOCK_ID,
      organization_id: ORG,
      claim_id: CLAIM_ID,
      evidence_item_id: EVIDENCE_ID,
    }],
    queues: [{
      review_queue_item_id: QUEUE_ID,
      organization_id: ORG,
      queue_type: "generated_content_review",
      target_object_type: "generated_content_draft",
      target_object_id: DRAFT_ID,
      priority: "medium",
      queue_status: queueStatus,
      review_status: reviewStatus,
      assigned_to: null,
      due_at: null,
      summary: "Generated draft requires human review.",
      required_action:
        "Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.",
      created_by_type: "system",
    }],
  };
}

function validate(state) {
  return validateExistingState(state, REQUEST_FINGERPRINT, REQUESTED_AUDIENCE, CONTENT_TYPE, ENGAGEMENT);
}

test("P14-13 exact-replay lifecycle: fresh/open queue state is a valid replay", () => {
  assert.equal(validate(baseState({ queueStatus: "open", reviewStatus: "needs_gk_review" })), true);
});

test("P14-13 exact-replay lifecycle: in_progress/needs_gk_review (review started) is a valid replay", () => {
  // This is the exact defect: before the repair, validateExistingState's
  // queue check defaulted to allowedLifecycleProfiles=[profile[0]] (open
  // only), so a legitimately-started review made every subsequent identical
  // generation request fail here and surface as 409
  // conflict_current_state_changed.
  assert.equal(validate(baseState({ queueStatus: "in_progress", reviewStatus: "needs_gk_review" })), true);
});

test("P14-13 exact-replay lifecycle: resolved/resolved (review completed) is a valid replay", () => {
  assert.equal(validate(baseState({ queueStatus: "resolved", reviewStatus: "resolved" })), true);
});

test("P14-13 negative: an impossible queue/review status pairing still fails closed", () => {
  assert.equal(validate(baseState({ queueStatus: "resolved", reviewStatus: "needs_gk_review" })), false);
  assert.equal(validate(baseState({ queueStatus: "open", reviewStatus: "resolved" })), false);
  assert.equal(validate(baseState({ queueStatus: "blocked", reviewStatus: "needs_gk_review" })), false);
});

test("P14-13 negative: same key + different request fingerprint is duplicate_conflict, not a silent replay", () => {
  const state = baseState();
  const result = validateExistingState(state, "b".repeat(64), REQUESTED_AUDIENCE, CONTENT_TYPE, ENGAGEMENT);
  assert.equal(result, "duplicate_conflict");
});

test("P14-13 negative: wrong requested audience on the same key fails closed", () => {
  const state = baseState();
  assert.equal(validateExistingState(state, REQUEST_FINGERPRINT, "internal", CONTENT_TYPE, ENGAGEMENT), false);
});

test("P14-13 negative: wrong engagement on the same key fails closed", () => {
  const state = baseState();
  assert.equal(validateExistingState(state, REQUEST_FINGERPRINT, REQUESTED_AUDIENCE, CONTENT_TYPE, OTHER_ENGAGEMENT), false);
});

test("P14-13 negative: a queue row belonging to a different organization fails closed", () => {
  const state = baseState();
  state.queues[0].organization_id = OTHER_ORG;
  assert.equal(validate(state), false);
});

test("P14-13 negative: a queue row targeting a different draft fails closed", () => {
  const state = baseState();
  state.queues[0].target_object_id = OTHER_DRAFT_ID;
  assert.equal(validate(state), false);
});

test("P14-13 negative: more than one queue row for the draft fails closed", () => {
  const state = baseState();
  state.queues.push({ ...state.queues[0], review_queue_item_id: "10000000-0000-4000-8000-000000000010" });
  assert.equal(validate(state), false);
});

test("P14-13 canonical lifecycle profiles are exactly open/needs_gk_review, in_progress/needs_gk_review, resolved/resolved", () => {
  assert.deepEqual(
    GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES.map((profile) => `${profile.queueStatus}/${profile.reviewStatus}`),
    ["open/needs_gk_review", "in_progress/needs_gk_review", "resolved/resolved"],
  );
});
