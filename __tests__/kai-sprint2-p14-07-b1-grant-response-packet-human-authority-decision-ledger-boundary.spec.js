import test from "node:test";
import assert from "node:assert/strict";

import {
  GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_TYPES,
  GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_ACTIONS,
  GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_ROLE_BY_TYPE,
  isGrantResponsePacketHumanAuthorityDecisionType,
  isGrantResponsePacketHumanAuthorityDecisionAction,
  roleRequiredForGrantResponsePacketHumanAuthorityDecisionType,
} from "../Backend/kai/dictionary/grantResponsePacketHumanAuthorityDecisionContract.js";
import {
  createPostgresGrantResponsePacketHumanAuthorityDecisionRepository,
  __grantResponsePacketHumanAuthorityDecisionRepositoryTestables,
} from "../Backend/kai/dictionary/postgresGrantResponsePacketHumanAuthorityDecisionRepository.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const ENGAGEMENT = "14030000-0000-4000-8000-000000000001";
const CANDIDATE = "14030000-0000-4000-8000-000000000501";
const ACTOR = Object.freeze({ actorType: "human", actorUserId: "00000000-0000-4000-8000-000000000901" });

function recordInput(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    grantResponsePacketExportCandidateId: CANDIDATE,
    decisionType: "export_authority_granted",
    decisionAction: "grant",
    actorContext: ACTOR,
    decidedByRole: "gk_admin",
    now: "2026-09-09T00:00:00.000Z",
    ...overrides,
  };
}

function effectivenessInput(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    grantResponsePacketExportCandidateId: CANDIDATE,
    decisionType: "export_authority_granted",
    actorContext: ACTOR,
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

test("P14-07B1 exact decision-type vocabulary is only export_authority_granted", () => {
  assert.deepEqual([...GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_TYPES], ["export_authority_granted"]);
});

test("P14-07B1 exact decision-action vocabulary is grant/revoke", () => {
  assert.deepEqual([...GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_ACTIONS].sort(), ["grant", "revoke"]);
});

test("P14-07B1 export_authority_granted is decided by gk_admin only - no packet_approved/packet_funder_ready/packet_finalized vocabulary", () => {
  assert.deepEqual(GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_ROLE_BY_TYPE, { export_authority_granted: "gk_admin" });
  assert.equal(roleRequiredForGrantResponsePacketHumanAuthorityDecisionType("export_authority_granted"), "gk_admin");
  assert.equal(roleRequiredForGrantResponsePacketHumanAuthorityDecisionType("packet_approved"), null);
});

test("P14-07B1 isGrantResponsePacketHumanAuthorityDecisionType/Action reject unknown values", () => {
  assert.equal(isGrantResponsePacketHumanAuthorityDecisionType("export_authority_granted"), true);
  assert.equal(isGrantResponsePacketHumanAuthorityDecisionType("packet_funder_ready"), false);
  assert.equal(isGrantResponsePacketHumanAuthorityDecisionAction("grant"), true);
  assert.equal(isGrantResponsePacketHumanAuthorityDecisionAction("approve"), false);
});

// --- repository input validation ---

test("P14-07B1 record-decision input validator rejects unknown keys, malformed ids, unknown decision types/actions, and assistant/system actors", () => {
  const { isRecordGrantResponsePacketHumanAuthorityDecisionInput } = __grantResponsePacketHumanAuthorityDecisionRepositoryTestables;
  assert.equal(isRecordGrantResponsePacketHumanAuthorityDecisionInput(recordInput()), true);
  assert.equal(isRecordGrantResponsePacketHumanAuthorityDecisionInput({ ...recordInput(), extra: true }), false);
  assert.equal(isRecordGrantResponsePacketHumanAuthorityDecisionInput(recordInput({ organizationId: "not-a-uuid" })), false);
  assert.equal(isRecordGrantResponsePacketHumanAuthorityDecisionInput(recordInput({ grantResponsePacketExportCandidateId: "not-a-uuid" })), false);
  assert.equal(isRecordGrantResponsePacketHumanAuthorityDecisionInput(recordInput({ decisionType: "packet_approved" })), false);
  assert.equal(isRecordGrantResponsePacketHumanAuthorityDecisionInput(recordInput({ decisionAction: "approve" })), false);
  assert.equal(isRecordGrantResponsePacketHumanAuthorityDecisionInput(recordInput({ actorContext: { actorType: "system" } })), false);
  assert.equal(isRecordGrantResponsePacketHumanAuthorityDecisionInput(recordInput({ decidedByRole: "" })), false);
  assert.equal(isRecordGrantResponsePacketHumanAuthorityDecisionInput(recordInput({ now: "not-a-timestamp" })), false);
  // No fingerprint, member list, requestedAudience, or manifest identity is ever accepted.
  assert.equal(isRecordGrantResponsePacketHumanAuthorityDecisionInput(recordInput({ canonicalFingerprint: "x".repeat(64) })), false);
  assert.equal(isRecordGrantResponsePacketHumanAuthorityDecisionInput(recordInput({ requestedAudience: "funder" })), false);
});

test("P14-07B1 evaluate-effectiveness input validator rejects unknown keys and unknown decision types", () => {
  const { isEvaluateGrantResponsePacketHumanAuthorityEffectivenessInput } = __grantResponsePacketHumanAuthorityDecisionRepositoryTestables;
  assert.equal(isEvaluateGrantResponsePacketHumanAuthorityEffectivenessInput(effectivenessInput()), true);
  assert.equal(isEvaluateGrantResponsePacketHumanAuthorityEffectivenessInput({ ...effectivenessInput(), extra: true }), false);
  assert.equal(isEvaluateGrantResponsePacketHumanAuthorityEffectivenessInput(effectivenessInput({ decisionType: "packet_approved" })), false);
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
test("P14-07B1 isCanonicalDecidedByRole only accepts the exact canonical role required for the decisionType", () => {
  const { isCanonicalDecidedByRole } = __grantResponsePacketHumanAuthorityDecisionRepositoryTestables;
  assert.equal(isCanonicalDecidedByRole("gk_admin", "export_authority_granted"), true);
  assert.equal(isCanonicalDecidedByRole("client_reviewer", "export_authority_granted"), false);
  assert.equal(isCanonicalDecidedByRole("gk_reviewer", "export_authority_granted"), false);
  assert.equal(isCanonicalDecidedByRole("gk_admin", "packet_approved"), false);
});

// --- pure transaction-scoped effectiveness evaluator ---

test("P14-07B1 effectiveness: no decision -> ineffective", async () => {
  const { evaluateGrantResponsePacketHumanAuthorityEffectivenessInTransaction } = __grantResponsePacketHumanAuthorityDecisionRepositoryTestables;
  const tx = fakeTx([[]]);
  const result = await evaluateGrantResponsePacketHumanAuthorityEffectivenessInTransaction(tx, {
    organizationId: ORG,
    grantResponsePacketExportCandidateId: CANDIDATE,
    decisionType: "export_authority_granted",
    candidate: { canonical_fingerprint: "f".repeat(64) },
    currentFingerprint: "f".repeat(64),
  });
  assert.deepEqual(result, { effective: false, reason: "no_decision", headDecisionId: null });
});

test("P14-07B1 effectiveness: ambiguous lineage (more than one head row) -> ineffective", async () => {
  const { evaluateGrantResponsePacketHumanAuthorityEffectivenessInTransaction } = __grantResponsePacketHumanAuthorityDecisionRepositoryTestables;
  const tx = fakeTx([[
    { decision_id: "a", decision_action: "grant" },
    { decision_id: "b", decision_action: "grant" },
  ]]);
  const result = await evaluateGrantResponsePacketHumanAuthorityEffectivenessInTransaction(tx, {
    organizationId: ORG,
    grantResponsePacketExportCandidateId: CANDIDATE,
    decisionType: "export_authority_granted",
    candidate: { canonical_fingerprint: "f".repeat(64) },
    currentFingerprint: "f".repeat(64),
  });
  assert.deepEqual(result, { effective: false, reason: "lineage_ambiguous", headDecisionId: null });
});

test("P14-07B1 effectiveness: revoke head -> ineffective", async () => {
  const { evaluateGrantResponsePacketHumanAuthorityEffectivenessInTransaction } = __grantResponsePacketHumanAuthorityDecisionRepositoryTestables;
  const tx = fakeTx([[{ decision_id: "d1", decision_action: "revoke" }]]);
  const result = await evaluateGrantResponsePacketHumanAuthorityEffectivenessInTransaction(tx, {
    organizationId: ORG,
    grantResponsePacketExportCandidateId: CANDIDATE,
    decisionType: "export_authority_granted",
    candidate: { canonical_fingerprint: "f".repeat(64) },
    currentFingerprint: "f".repeat(64),
  });
  assert.deepEqual(result, { effective: false, reason: "head_is_revoke", headDecisionId: "d1" });
});

test("P14-07B1 effectiveness: grant head but stale/superseded fingerprint -> ineffective (fails closed, no mutation of the grant row)", async () => {
  const { evaluateGrantResponsePacketHumanAuthorityEffectivenessInTransaction } = __grantResponsePacketHumanAuthorityDecisionRepositoryTestables;
  const tx = fakeTx([[{ decision_id: "d1", decision_action: "grant" }]]);
  const result = await evaluateGrantResponsePacketHumanAuthorityEffectivenessInTransaction(tx, {
    organizationId: ORG,
    grantResponsePacketExportCandidateId: CANDIDATE,
    decisionType: "export_authority_granted",
    candidate: { canonical_fingerprint: "f".repeat(64) },
    currentFingerprint: "g".repeat(64),
  });
  assert.deepEqual(result, { effective: false, reason: "packet_candidate_superseded", headDecisionId: "d1" });
});

test("P14-07B1 effectiveness: grant head and current fingerprint match -> effective", async () => {
  const { evaluateGrantResponsePacketHumanAuthorityEffectivenessInTransaction } = __grantResponsePacketHumanAuthorityDecisionRepositoryTestables;
  const tx = fakeTx([[{ decision_id: "d1", decision_action: "grant" }]]);
  const result = await evaluateGrantResponsePacketHumanAuthorityEffectivenessInTransaction(tx, {
    organizationId: ORG,
    grantResponsePacketExportCandidateId: CANDIDATE,
    decisionType: "export_authority_granted",
    candidate: { canonical_fingerprint: "f".repeat(64) },
    currentFingerprint: "f".repeat(64),
  });
  assert.deepEqual(result, { effective: true, reason: null, headDecisionId: "d1" });
});

// --- repository shape ---

test("P14-07B1 repository exposes exactly recordDecision and evaluateEffectiveness - no eligibility, manifest, or route method", () => {
  const repo = createPostgresGrantResponsePacketHumanAuthorityDecisionRepository({
    runInTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
  });
  assert.deepEqual(Object.keys(repo).sort(), ["evaluateEffectiveness", "recordDecision"]);
});

test("P14-07B1 recordDecision rejects when no metadataOnlyAudit dependency is supplied", async () => {
  const repo = createPostgresGrantResponsePacketHumanAuthorityDecisionRepository({
    runInTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
  });
  const result = await repo.recordDecision(recordInput(), {});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("P14-07B1 recordDecision rejects a decidedByRole that is not the exact canonical role for the decisionType before ever composing the render model", async () => {
  let composeRenderModelCalled = false;
  const repo = createPostgresGrantResponsePacketHumanAuthorityDecisionRepository({
    runInTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
  });
  const result = await repo.recordDecision(
    recordInput({ decidedByRole: "client_reviewer" }),
    {
      metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) },
      composeRenderModel: async () => {
        composeRenderModelCalled = true;
        return { ok: true, data: {} };
      },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(composeRenderModelCalled, false);
});
