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
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
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

// --- decided-by-role derivation ---

test("P14-07B1 deriveDecidedByRole requires an active gk_admin membership in the exact organization", () => {
  const { deriveDecidedByRole } = __grantResponsePacketHumanAuthorityDecisionRepositoryTestables;
  const gkAdminActor = {
    ...ACTOR,
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
  };
  assert.equal(deriveDecidedByRole(gkAdminActor, ORG, "export_authority_granted"), "gk_admin");

  const wrongOrgActor = {
    ...ACTOR,
    organizationMemberships: [{ organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_admin" }],
  };
  assert.equal(deriveDecidedByRole(wrongOrgActor, ORG, "export_authority_granted"), null);

  const inactiveActor = {
    ...ACTOR,
    organizationMemberships: [{ organization_id: ORG, membership_status: "revoked", role_name: "gk_admin" }],
  };
  assert.equal(deriveDecidedByRole(inactiveActor, ORG, "export_authority_granted"), null);

  const wrongRoleActor = {
    ...ACTOR,
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_reviewer" }],
  };
  assert.equal(deriveDecidedByRole(wrongRoleActor, ORG, "export_authority_granted"), null);

  assert.equal(deriveDecidedByRole(gkAdminActor, ORG, "packet_approved"), null);
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

test("P14-07B1 recordDecision rejects an actor without an active gk_admin membership before ever composing the render model", async () => {
  let composeRenderModelCalled = false;
  const repo = createPostgresGrantResponsePacketHumanAuthorityDecisionRepository({
    runInTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
  });
  const result = await repo.recordDecision(
    recordInput({ actorContext: { ...ACTOR, organizationMemberships: [] } }),
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
