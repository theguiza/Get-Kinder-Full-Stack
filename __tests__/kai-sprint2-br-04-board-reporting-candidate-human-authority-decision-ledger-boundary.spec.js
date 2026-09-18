import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_TYPES,
  BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_ACTIONS,
  BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_ROLE_BY_TYPE,
  isBoardReportingCandidateHumanAuthorityDecisionType,
  isBoardReportingCandidateHumanAuthorityDecisionAction,
  roleRequiredForBoardReportingCandidateHumanAuthorityDecisionType,
} from "../Backend/kai/dictionary/boardReportingCandidateHumanAuthorityDecisionContract.js";
import {
  createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository,
  __boardReportingCandidateHumanAuthorityDecisionRepositoryTestables,
} from "../Backend/kai/dictionary/postgresBoardReportingCandidateHumanAuthorityDecisionRepository.js";
import { BOARD_REPORTING_CANDIDATE_REVIEW_QUEUE_STATIC_CONTRACT } from "../Backend/kai/dictionary/boardReportingCandidateContract.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const ENGAGEMENT = "04000000-0000-4000-8000-000000000001";
const CANDIDATE = "04000000-0000-4000-8000-000000000501";
const REVIEW_QUEUE_ITEM = "04000000-0000-4000-8000-000000000601";
const ACTOR = Object.freeze({ actorType: "human", actorUserId: "00000000-0000-4000-8000-000000000901" });

function recordInput(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    boardReportingCandidateId: CANDIDATE,
    reviewQueueItemId: REVIEW_QUEUE_ITEM,
    decisionType: "export_authority_granted",
    decisionAction: "grant",
    actorContext: ACTOR,
    decidedByRole: "gk_admin",
    now: "2026-09-12T00:00:00.000Z",
    ...overrides,
  };
}

function effectivenessInput(overrides = {}) {
  return {
    organizationId: ORG,
    boardReportingCandidateId: CANDIDATE,
    decisionType: "export_authority_granted",
    ...overrides,
  };
}

function fakeTx(rowsByCall) {
  let call = 0;
  return {
    async query() {
      const rows = rowsByCall[call] ?? [];
      call += 1;
      return { rows };
    },
  };
}

// --- contract vocabulary ---

test("BR-04 exact decision-type vocabulary is only export_authority_granted", () => {
  assert.deepEqual([...BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_TYPES], ["export_authority_granted"]);
});

test("BR-04 exact decision-action vocabulary is grant/revoke", () => {
  assert.deepEqual([...BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_ACTIONS].sort(), ["grant", "revoke"]);
});

test("BR-04 export_authority_granted is decided by gk_admin only - no board_approved/board_release/board_finalized vocabulary", () => {
  assert.deepEqual(BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_ROLE_BY_TYPE, { export_authority_granted: "gk_admin" });
  assert.equal(roleRequiredForBoardReportingCandidateHumanAuthorityDecisionType("export_authority_granted"), "gk_admin");
  assert.equal(roleRequiredForBoardReportingCandidateHumanAuthorityDecisionType("board_approved"), null);
});

test("BR-04 isBoardReportingCandidateHumanAuthorityDecisionType/Action reject unknown values", () => {
  assert.equal(isBoardReportingCandidateHumanAuthorityDecisionType("export_authority_granted"), true);
  assert.equal(isBoardReportingCandidateHumanAuthorityDecisionType("board_funder_ready"), false);
  assert.equal(isBoardReportingCandidateHumanAuthorityDecisionAction("grant"), true);
  assert.equal(isBoardReportingCandidateHumanAuthorityDecisionAction("approve"), false);
});

// --- repository input validation ---

test("BR-04 record-decision input validator rejects unknown keys, malformed ids, unknown decision types/actions, and assistant/system actors", () => {
  const { isRecordBoardReportingCandidateHumanAuthorityDecisionInput } = __boardReportingCandidateHumanAuthorityDecisionRepositoryTestables;
  assert.equal(isRecordBoardReportingCandidateHumanAuthorityDecisionInput(recordInput()), true);
  assert.equal(isRecordBoardReportingCandidateHumanAuthorityDecisionInput({ ...recordInput(), extra: true }), false);
  assert.equal(isRecordBoardReportingCandidateHumanAuthorityDecisionInput(recordInput({ organizationId: "not-a-uuid" })), false);
  assert.equal(isRecordBoardReportingCandidateHumanAuthorityDecisionInput(recordInput({ engagementId: "not-a-uuid" })), false);
  assert.equal(isRecordBoardReportingCandidateHumanAuthorityDecisionInput(recordInput({ boardReportingCandidateId: "not-a-uuid" })), false);
  assert.equal(isRecordBoardReportingCandidateHumanAuthorityDecisionInput(recordInput({ reviewQueueItemId: "not-a-uuid" })), false);
  assert.equal(isRecordBoardReportingCandidateHumanAuthorityDecisionInput(recordInput({ decisionType: "board_approved" })), false);
  assert.equal(isRecordBoardReportingCandidateHumanAuthorityDecisionInput(recordInput({ decisionAction: "approve" })), false);
  assert.equal(isRecordBoardReportingCandidateHumanAuthorityDecisionInput(recordInput({ actorContext: { actorType: "system" } })), false);
  assert.equal(isRecordBoardReportingCandidateHumanAuthorityDecisionInput(recordInput({ decidedByRole: "" })), false);
  assert.equal(isRecordBoardReportingCandidateHumanAuthorityDecisionInput(recordInput({ now: "not-a-timestamp" })), false);
  // No fingerprint, member list, or requestedAudience is ever accepted -
  // a Board Reporting candidate's audience is always exactly "internal".
  assert.equal(isRecordBoardReportingCandidateHumanAuthorityDecisionInput(recordInput({ canonicalFingerprint: "f".repeat(64) })), false);
  assert.equal(isRecordBoardReportingCandidateHumanAuthorityDecisionInput(recordInput({ requestedAudience: "internal" })), false);
});

test("BR-04 evaluate-effectiveness input validator rejects unknown keys and unknown decision types", () => {
  const { isEvaluateEffectivenessInput } = __boardReportingCandidateHumanAuthorityDecisionRepositoryTestables;
  assert.equal(isEvaluateEffectivenessInput(effectivenessInput()), true);
  assert.equal(isEvaluateEffectivenessInput({ ...effectivenessInput(), extra: true }), false);
  assert.equal(isEvaluateEffectivenessInput(effectivenessInput({ decisionType: "board_approved" })), false);
});

// --- decided-by-role canonicality ---
//
// decidedByRole is no longer derived here from actorContext.organizationMemberships
// (that re-derivation, independent of how validateActorCanPerformOperation actually
// authorized the actor, is exactly the defect this repair closes - see
// resolveAuthorizedHumanRole in kaiAuthorizedRoleAttribution.js, which the
// service layer now uses before ever calling this repository). This repository
// only ever validates that the role it was handed is the exact canonical role
// required for the decisionType.
test("BR-04 isCanonicalDecidedByRole only accepts the exact canonical role required for the decisionType", () => {
  const { isCanonicalDecidedByRole } = __boardReportingCandidateHumanAuthorityDecisionRepositoryTestables;
  assert.equal(isCanonicalDecidedByRole("gk_admin", "export_authority_granted"), true);
  assert.equal(isCanonicalDecidedByRole("client_reviewer", "export_authority_granted"), false);
  assert.equal(isCanonicalDecidedByRole("gk_reviewer", "export_authority_granted"), false);
  assert.equal(isCanonicalDecidedByRole("gk_admin", "board_approved"), false);
});

// --- pure transaction-scoped effectiveness evaluator ---

test("BR-04 effectiveness: no decision -> ineffective", async () => {
  const { evaluateBoardReportingCandidateHumanAuthorityEffectivenessInTransaction } = __boardReportingCandidateHumanAuthorityDecisionRepositoryTestables;
  const result = await evaluateBoardReportingCandidateHumanAuthorityEffectivenessInTransaction(fakeTx([[]]), {
    organizationId: ORG,
    boardReportingCandidateId: CANDIDATE,
    decisionType: "export_authority_granted",
  });
  assert.deepEqual(result, { effective: false, reason: "no_decision", headDecisionId: null });
});

test("BR-04 effectiveness: ambiguous lineage (more than one head row) -> ineffective", async () => {
  const { evaluateBoardReportingCandidateHumanAuthorityEffectivenessInTransaction } = __boardReportingCandidateHumanAuthorityDecisionRepositoryTestables;
  const tx = fakeTx([[
    { decision_id: "a", decision_action: "grant" },
    { decision_id: "b", decision_action: "grant" },
  ]]);
  const result = await evaluateBoardReportingCandidateHumanAuthorityEffectivenessInTransaction(tx, {
    organizationId: ORG,
    boardReportingCandidateId: CANDIDATE,
    decisionType: "export_authority_granted",
  });
  assert.deepEqual(result, { effective: false, reason: "lineage_ambiguous", headDecisionId: null });
});

test("BR-04 effectiveness: revoke head -> ineffective", async () => {
  const { evaluateBoardReportingCandidateHumanAuthorityEffectivenessInTransaction } = __boardReportingCandidateHumanAuthorityDecisionRepositoryTestables;
  const tx = fakeTx([[{ decision_id: "d1", decision_action: "revoke" }]]);
  const result = await evaluateBoardReportingCandidateHumanAuthorityEffectivenessInTransaction(tx, {
    organizationId: ORG,
    boardReportingCandidateId: CANDIDATE,
    decisionType: "export_authority_granted",
  });
  assert.deepEqual(result, { effective: false, reason: "head_is_revoke", headDecisionId: "d1" });
});

test("BR-04 effectiveness: grant head -> effective (Board Reporting candidates are immutable - no separate currentness/fingerprint-drift evaluator exists or is invented here)", async () => {
  const { evaluateBoardReportingCandidateHumanAuthorityEffectivenessInTransaction } = __boardReportingCandidateHumanAuthorityDecisionRepositoryTestables;
  const tx = fakeTx([[{ decision_id: "d1", decision_action: "grant" }]]);
  const result = await evaluateBoardReportingCandidateHumanAuthorityEffectivenessInTransaction(tx, {
    organizationId: ORG,
    boardReportingCandidateId: CANDIDATE,
    decisionType: "export_authority_granted",
  });
  assert.deepEqual(result, { effective: true, reason: null, headDecisionId: "d1" });
});

// --- repository shape ---

test("BR-04 repository exposes exactly recordDecision and evaluateEffectiveness - no eligibility, manifest, or route method", () => {
  const repo = createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository({
    runInTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
  });
  assert.deepEqual(Object.keys(repo).sort(), ["evaluateEffectiveness", "recordDecision"]);
});

test("BR-04 recordDecision rejects when no metadataOnlyAudit dependency is supplied", async () => {
  const repo = createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository({
    runInTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
  });
  const result = await repo.recordDecision(recordInput(), {});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("BR-04 recordDecision rejects a decidedByRole that is not the exact canonical role for the decisionType before ever opening the transaction", async () => {
  let transactionOpened = false;
  const repo = createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository({
    runInTransaction: async (fn) => {
      transactionOpened = true;
      return fn({ query: async () => ({ rows: [] }) });
    },
  });
  const result = await repo.recordDecision(
    recordInput({ decidedByRole: "client_reviewer" }),
    { metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(transactionOpened, false);
});

// --- scope-boundary self-checks ---

test("BR-04 repository source contains no route wiring, no direct mutation of board_reporting_candidates/board_reporting_candidate_members/review_queue_items, and creates no finalGate/manifest/export-eligible state", () => {
  const source = readFileSync(
    new URL("../Backend/kai/dictionary/postgresBoardReportingCandidateHumanAuthorityDecisionRepository.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /express|router|req\.|res\./);
  assert.doesNotMatch(source, /finalGate\s*[:=]|exportEligible\s*[:=]|manifest\s*[:=]/i);
  assert.doesNotMatch(source, /UPDATE\s+kai\.board_reporting_candidates/i);
  assert.doesNotMatch(source, /UPDATE\s+kai\.board_reporting_candidate_members/i);
  assert.doesNotMatch(source, /UPDATE\s+kai\.review_queue_items/i);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+kai\.(board_reporting_candidates|board_reporting_candidate_members|review_queue_items)/i);
  assert.doesNotMatch(source, /INSERT INTO kai\.(board_reporting_candidates|board_reporting_candidate_members|review_queue_items)/i);
});

test("BR-04 contract source declares no grant/revoke route, service, or UI wiring", () => {
  const source = readFileSync(
    new URL("../Backend/kai/dictionary/boardReportingCandidateHumanAuthorityDecisionContract.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /express|router|req\.|res\./);
});

test("BR-04 review-queue static contract used for the resolved-review binding check is the same BR-03B contract - no second queue_type/target_object_type vocabulary", () => {
  assert.equal(BOARD_REPORTING_CANDIDATE_REVIEW_QUEUE_STATIC_CONTRACT.queueType, "board_reporting_candidate_review");
  assert.equal(BOARD_REPORTING_CANDIDATE_REVIEW_QUEUE_STATIC_CONTRACT.targetObjectType, "board_reporting_candidate");
});
