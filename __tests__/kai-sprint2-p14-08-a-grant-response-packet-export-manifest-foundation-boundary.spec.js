import test from "node:test";
import assert from "node:assert/strict";

import {
  GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_FINGERPRINT_CONTRACT_VERSION,
  GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_EFFECTIVE_AUTHORITY_DECISION_TYPE,
} from "../Backend/kai/dictionary/grantResponsePacketExportManifestContract.js";
import {
  createPostgresGrantResponsePacketExportManifestRepository,
  __grantResponsePacketExportManifestRepositoryTestables,
} from "../Backend/kai/dictionary/postgresGrantResponsePacketExportManifestRepository.js";

const {
  isCreateGrantResponsePacketExportManifestInput,
  isReadExportManifestByIdInput,
  isResolveExportManifestStateForCandidateInput,
  canonicalFingerprint,
} = __grantResponsePacketExportManifestRepositoryTestables;

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "14030000-0000-4000-8000-000000000001";
const OTHER_ENGAGEMENT = "14030000-0000-4000-8000-000000000002";
const CANDIDATE_A = "14030000-0000-4000-8000-000000000501";
const CANDIDATE_B = "14070000-0000-4000-8000-000000000503";
const MEMBER_CANDIDATE = "16000000-0000-4000-8000-000000000001";
const DECISION_A = "14070000-0000-4000-8000-000000000601";
const ACTOR = Object.freeze({ actorType: "human", actorUserId: "00000000-0000-4000-8000-000000000901" });
const NOW = "2026-09-09T00:00:00.000Z";

function createInput(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    grantResponsePacketExportCandidateId: CANDIDATE_A,
    actorContext: ACTOR,
    now: NOW,
    ...overrides,
  };
}

function passingEligibility(result = { finalExportEligible: true }) {
  return async () => ({ ok: true, data: result, error: null });
}

function effectivenessRepo({ ok = true, effective = true, headDecisionId = DECISION_A, error = null } = {}) {
  return {
    evaluateEffectiveness: async () => (ok
      ? { ok: true, data: { effective, reason: effective ? null : "no_decision", headDecisionId }, error: null }
      : { ok: false, data: null, error: { code: error || "system_error", status: 500 } }),
  };
}

function metadataOnlyAudit({ publishCalls } = {}) {
  return {
    prepareMetadataOnlyAudit: (args) => ({
      ok: true,
      publish: async () => {
        if (publishCalls) publishCalls.push(args.payload);
      },
    }),
  };
}

// --- exact-keys input contracts ---

test("P14-08A createExportManifest input accepts only organizationId/engagementId/grantResponsePacketExportCandidateId/actorContext/now", () => {
  assert.equal(isCreateGrantResponsePacketExportManifestInput(createInput()), true);
  assert.equal(isCreateGrantResponsePacketExportManifestInput({ ...createInput(), extra: true }), false);
  assert.equal(isCreateGrantResponsePacketExportManifestInput(createInput({ organizationId: "not-a-uuid" })), false);
  assert.equal(isCreateGrantResponsePacketExportManifestInput(createInput({ engagementId: "not-a-uuid" })), false);
  assert.equal(isCreateGrantResponsePacketExportManifestInput(createInput({ grantResponsePacketExportCandidateId: "not-a-uuid" })), false);
  assert.equal(isCreateGrantResponsePacketExportManifestInput(createInput({ actorContext: { actorType: "system" } })), false);
  assert.equal(isCreateGrantResponsePacketExportManifestInput(createInput({ now: "not-a-timestamp" })), false);
});

test("P14-08A createExportManifest input rejects client-supplied eligibility/authority/fingerprint/member/review/manifest fields", () => {
  const rejectedExtras = [
    { finalExportEligible: true },
    { effectiveHumanExportAuthority: true },
    { canonicalFingerprint: "f".repeat(64) },
    { members: [] },
    { memberCount: 1 },
    { reviewResolved: true },
    { requestedAudience: "funder" },
    { grantResponsePacketExportManifestId: "14080000-0000-4000-8000-000000000001" },
  ];
  for (const extra of rejectedExtras) {
    assert.equal(isCreateGrantResponsePacketExportManifestInput(createInput(extra)), false, JSON.stringify(extra));
  }
});

test("P14-08A read/resolve input validators are exact-keys and tenant-scoped", () => {
  assert.equal(isReadExportManifestByIdInput({ organizationId: ORG, grantResponsePacketExportManifestId: DECISION_A }), true);
  assert.equal(isReadExportManifestByIdInput({ organizationId: ORG, grantResponsePacketExportManifestId: DECISION_A, extra: 1 }), false);
  assert.equal(isReadExportManifestByIdInput({ organizationId: "bad", grantResponsePacketExportManifestId: DECISION_A }), false);

  assert.equal(isResolveExportManifestStateForCandidateInput({ organizationId: ORG, grantResponsePacketExportCandidateId: CANDIDATE_A }), true);
  assert.equal(isResolveExportManifestStateForCandidateInput({ organizationId: ORG, grantResponsePacketExportCandidateId: CANDIDATE_A, extra: 1 }), false);
});

// --- fingerprint identity is candidate-specific ---

test("P14-08A canonicalFingerprint differs by candidate and by effective decision - candidate A's manifest can never represent candidate B", () => {
  const base = { organizationId: ORG, grantResponsePacketExportCandidateId: CANDIDATE_A, effectiveAuthorityDecisionId: DECISION_A };
  const fpA = canonicalFingerprint(base);
  const fpB = canonicalFingerprint({ ...base, grantResponsePacketExportCandidateId: CANDIDATE_B });
  const fpOtherDecision = canonicalFingerprint({ ...base, effectiveAuthorityDecisionId: "14070000-0000-4000-8000-000000000602" });
  assert.match(fpA, /^[a-f0-9]{64}$/);
  assert.notEqual(fpA, fpB);
  assert.notEqual(fpA, fpOtherDecision);
  assert.equal(canonicalFingerprint(base), fpA, "same inputs converge to the same fingerprint");
});

// --- repository shape ---

test("P14-08A repository exposes exactly createExportManifest, readExportManifestById, resolveExportManifestStateForCandidate", () => {
  const repo = createPostgresGrantResponsePacketExportManifestRepository({
    runInTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
  });
  assert.deepEqual(
    Object.keys(repo).sort(),
    ["createExportManifest", "readExportManifestById", "resolveExportManifestStateForCandidate"],
  );
});

// --- createExportManifest gating ---

test("P14-08A createExportManifest rejects malformed input before any dependency is invoked", async () => {
  let called = false;
  const repo = createPostgresGrantResponsePacketExportManifestRepository({
    runInTransaction: async (fn) => { called = true; return fn({ query: async () => ({ rows: [] }) }); },
  });
  const result = await repo.createExportManifest({ ...createInput(), extra: true }, {
    metadataOnlyAudit: metadataOnlyAudit(),
    evaluateEligibility: passingEligibility(),
    authorityRepository: effectivenessRepo(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(called, false);
});

test("P14-08A createExportManifest rejects when no metadataOnlyAudit dependency is supplied", async () => {
  let eligibilityCalled = false;
  const repo = createPostgresGrantResponsePacketExportManifestRepository({
    runInTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
  });
  const result = await repo.createExportManifest(createInput(), {
    evaluateEligibility: async () => { eligibilityCalled = true; return { ok: true, data: { finalExportEligible: true }, error: null }; },
    authorityRepository: effectivenessRepo(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(eligibilityCalled, false);
});

test("P14-08A createExportManifest propagates a not_found eligibility failure (nonexistent/cross-org/cross-engagement/member candidate) and writes no manifest", async () => {
  let txRan = false;
  const repo = createPostgresGrantResponsePacketExportManifestRepository({
    runInTransaction: async (fn) => { txRan = true; return fn({ query: async () => ({ rows: [] }) }); },
  });
  const result = await repo.createExportManifest(createInput({ grantResponsePacketExportCandidateId: MEMBER_CANDIDATE }), {
    metadataOnlyAudit: metadataOnlyAudit(),
    evaluateEligibility: async () => ({ ok: false, data: null, error: { code: "not_found", status: 404 } }),
    authorityRepository: effectivenessRepo(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
  assert.equal(txRan, false);
});

test("P14-08A createExportManifest: eligibility BLOCKED (finalExportEligible false) creates no manifest", async () => {
  let txRan = false;
  const repo = createPostgresGrantResponsePacketExportManifestRepository({
    runInTransaction: async (fn) => { txRan = true; return fn({ query: async () => ({ rows: [] }) }); },
  });
  const result = await repo.createExportManifest(createInput(), {
    metadataOnlyAudit: metadataOnlyAudit(),
    evaluateEligibility: passingEligibility({ finalExportEligible: false }),
    authorityRepository: effectivenessRepo(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(txRan, false);
});

test("P14-08A createExportManifest: eligibility PASS but authority no longer effective (revoked/stale) creates no manifest", async () => {
  const repo = createPostgresGrantResponsePacketExportManifestRepository({
    runInTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
  });
  const result = await repo.createExportManifest(createInput(), {
    metadataOnlyAudit: metadataOnlyAudit(),
    evaluateEligibility: passingEligibility({ finalExportEligible: true }),
    authorityRepository: effectivenessRepo({ effective: false, headDecisionId: null }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("P14-08A createExportManifest: candidate row missing inside the transaction (stale/cross-org) fails not_found, no insert attempted", async () => {
  let insertAttempted = false;
  const repo = createPostgresGrantResponsePacketExportManifestRepository({
    runInTransaction: async (fn) => fn({
      query: async (sql) => {
        if (sql.includes("INSERT INTO kai.grant_response_packet_export_manifests")) insertAttempted = true;
        return { rows: [] };
      },
    }),
  });
  const result = await repo.createExportManifest(createInput(), {
    metadataOnlyAudit: metadataOnlyAudit(),
    evaluateEligibility: passingEligibility(),
    authorityRepository: effectivenessRepo(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
  assert.equal(insertAttempted, false);
});

test("P14-08A createExportManifest: candidate row belongs to a different engagement fails not_found (cross-tenant)", async () => {
  const repo = createPostgresGrantResponsePacketExportManifestRepository({
    runInTransaction: async (fn) => fn({
      query: async (sql) => {
        if (sql.includes("FROM kai.grant_response_packet_export_candidates")) {
          return { rows: [{ grant_response_packet_export_candidate_id: CANDIDATE_A, organization_id: ORG, canonical_fingerprint: "f".repeat(64), engagement_id: OTHER_ENGAGEMENT }] };
        }
        return { rows: [] };
      },
    }),
  });
  const result = await repo.createExportManifest(createInput(), {
    metadataOnlyAudit: metadataOnlyAudit(),
    evaluateEligibility: passingEligibility(),
    authorityRepository: effectivenessRepo(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("P14-08A createExportManifest: eligible + effective -> fresh insert succeeds, publishes exactly one metadata-only audit, and creates no artifact bytes", async () => {
  const publishCalls = [];
  const repo = createPostgresGrantResponsePacketExportManifestRepository({
    runInTransaction: async (fn) => fn({
      query: async (sql) => {
        if (sql.includes("FROM kai.grant_response_packet_export_candidates")) {
          return { rows: [{ grant_response_packet_export_candidate_id: CANDIDATE_A, organization_id: ORG, canonical_fingerprint: "f".repeat(64), engagement_id: ENGAGEMENT }] };
        }
        if (sql.startsWith("INSERT INTO kai.grant_response_packet_export_manifests")) {
          return { rows: [{ grant_response_packet_export_manifest_id: "14080000-0000-4000-8000-000000000001" }] };
        }
        return { rows: [] };
      },
    }),
  });
  const result = await repo.createExportManifest(createInput(), {
    metadataOnlyAudit: metadataOnlyAudit({ publishCalls }),
    evaluateEligibility: passingEligibility(),
    authorityRepository: effectivenessRepo(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, false);
  assert.equal(result.data.grantResponsePacketExportManifestId, "14080000-0000-4000-8000-000000000001");
  assert.equal(result.data.grantResponsePacketExportCandidateId, CANDIDATE_A);
  assert.equal(result.data.effectiveAuthorityDecisionId, DECISION_A);
  assert.equal(result.data.fingerprintContractVersion, GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_FINGERPRINT_CONTRACT_VERSION);
  assert.match(result.data.canonicalFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    Object.keys(result.data).sort(),
    ["canonicalFingerprint", "effectiveAuthorityDecisionId", "fingerprintContractVersion", "grantResponsePacketExportCandidateId", "grantResponsePacketExportManifestId", "replayed"],
  );
  assert.equal(publishCalls.length, 1);
  assert.equal(publishCalls[0].grant_response_packet_export_candidate_id, CANDIDATE_A);
});

test("P14-08A createExportManifest: replay for the same exact candidate converges to the existing row and publishes no additional audit", async () => {
  const publishCalls = [];
  const repo = createPostgresGrantResponsePacketExportManifestRepository({
    runInTransaction: async (fn) => fn({
      query: async (sql) => {
        if (sql.includes("FROM kai.grant_response_packet_export_candidates")) {
          return { rows: [{ grant_response_packet_export_candidate_id: CANDIDATE_A, organization_id: ORG, canonical_fingerprint: "f".repeat(64), engagement_id: ENGAGEMENT }] };
        }
        if (sql.startsWith("INSERT INTO kai.grant_response_packet_export_manifests")) {
          return { rows: [] }; // ON CONFLICT DO NOTHING - already exists
        }
        if (sql.startsWith("SELECT grant_response_packet_export_manifest_id")) {
          return { rows: [{ grant_response_packet_export_manifest_id: "14080000-0000-4000-8000-000000000001" }] };
        }
        return { rows: [] };
      },
    }),
  });
  const result = await repo.createExportManifest(createInput(), {
    metadataOnlyAudit: metadataOnlyAudit({ publishCalls }),
    evaluateEligibility: passingEligibility(),
    authorityRepository: effectivenessRepo(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, true);
  assert.equal(result.data.grantResponsePacketExportManifestId, "14080000-0000-4000-8000-000000000001");
  assert.equal(publishCalls.length, 0, "a replayed convergence never re-publishes an audit event");
});

test("P14-08A member exportCandidateId cannot substitute the packet candidate id - eligibility fails closed as not_found", async () => {
  const repo = createPostgresGrantResponsePacketExportManifestRepository({
    runInTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
  });
  const result = await repo.createExportManifest(createInput({ grantResponsePacketExportCandidateId: MEMBER_CANDIDATE }), {
    metadataOnlyAudit: metadataOnlyAudit(),
    evaluateEligibility: async () => ({ ok: false, data: null, error: { code: "not_found", status: 404 } }),
    authorityRepository: effectivenessRepo(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("P14-08A wrong organization is refused (input validator rejects a mismatched organizationId shape before any dependency call)", async () => {
  const repo = createPostgresGrantResponsePacketExportManifestRepository({
    runInTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
  });
  const result = await repo.createExportManifest(createInput({ organizationId: OTHER_ORG }), {
    metadataOnlyAudit: metadataOnlyAudit(),
    evaluateEligibility: async (input) => {
      assert.equal(input.organizationId, OTHER_ORG);
      return { ok: false, data: null, error: { code: "not_found", status: 404 } };
    },
    authorityRepository: effectivenessRepo(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("P14-08A GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_EFFECTIVE_AUTHORITY_DECISION_TYPE is exactly export_authority_granted - no packet_approved/packet_funder_ready/packet_finalized vocabulary", () => {
  assert.equal(GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_EFFECTIVE_AUTHORITY_DECISION_TYPE, "export_authority_granted");
});
