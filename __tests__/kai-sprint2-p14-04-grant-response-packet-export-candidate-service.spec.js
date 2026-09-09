// P14-04: proves the new service wrapper around the existing, accepted
// P14-03 packet-candidate repository. This suite fakes the repository
// itself (P14-03's own fingerprint/convergence/member-snapshot behavior is
// already proven against a real database by
// kai-sprint2-p14-03-grant-response-packet-export-candidate-foundation.integration.spec.js,
// which this suite never reopens) and focuses on what P14-04 actually adds:
// the exact-keys input contract, the gk_admin-only role gate, the tenant
// check, feature-flag gating, propagation of a downstream not_found (a
// fabricated/nonexistent engagement), pass-through of replay convergence /
// changed-state-new-candidate, and the safe-metadata-only output shape.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createGrantResponsePacketExportCandidate,
  __grantResponsePacketExportCandidateServiceContract,
  __grantResponsePacketExportCandidateServiceTestables,
} from "../Backend/kai/services/kaiGrantResponsePacketExportCandidateService.js";
import { createPostgresGrantResponsePacketExportCandidateRepository } from "../Backend/kai/dictionary/postgresGrantResponsePacketExportCandidateRepository.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "14040000-0000-4000-8000-000000000001";
const FABRICATED_ENGAGEMENT = "14040000-0000-4000-8000-0000000000ff";
const NOW = "2026-09-09T12:00:00.000Z";

const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });

const gkAdminActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});
const gkReviewerActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000002",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
  ],
});
const otherOrgAdminActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000003",
  organizationMemberships: [
    { organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});
const systemActorContext = Object.freeze({ actorType: "system", actorUserId: "kai-assistant" });

function auditRecorder() {
  return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
}

function candidateInput(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    actorContext: gkAdminActorContext,
    now: NOW,
    ...overrides,
  };
}

// A fake of the P14-03 repository: converges to the same candidate for the
// same (organizationId, engagementId, seed), mints a new one when the seed
// changes, and reports not_found for the fabricated engagement - modeling
// exactly what the real composeGrantResponsePacketRenderModel/
// getGrantResponsePacket path would report for a nonexistent engagement.
function makeFakeRepository() {
  const byKey = new Map();
  const calls = [];
  return {
    calls,
    async createGrantResponsePacketExportCandidate(input, dependencies) {
      calls.push({ input, dependencies });
      if (input.engagementId === FABRICATED_ENGAGEMENT) {
        return { ok: false, data: null, error: { code: "not_found", status: 404 } };
      }
      const seed = dependencies?.renderModelDependencies?.seed || "default";
      const key = `${input.organizationId}:${input.engagementId}:${seed}`;
      const fingerprint = seed.padEnd(64, "0").slice(0, 64);
      if (byKey.has(key)) {
        const existing = byKey.get(key);
        return {
          ok: true,
          data: { ...existing, replayed: true },
          error: null,
        };
      }
      const candidateId = `14040000-0000-4000-8000-${String(byKey.size + 1).padStart(12, "0")}`;
      const identityId = "14040000-0000-4000-8000-000000000900";
      const data = {
        grantResponsePacketExportCandidateId: candidateId,
        grantResponsePacketExportIdentityId: identityId,
        organizationId: input.organizationId,
        engagementId: input.engagementId,
        fingerprintContractVersion: "kai-sprint2-p14-03-grant-response-packet-export-candidate-fingerprint-v1",
        canonicalFingerprint: fingerprint,
        memberGeneratedContentDraftIds: ["14040000-0000-4000-8000-0000000000d1", "14040000-0000-4000-8000-0000000000d2"],
        replayed: false,
      };
      byKey.set(key, data);
      return { ok: true, data, error: null };
    },
  };
}

function deps(overrides = {}) {
  return {
    env: enabledEnv,
    grantResponsePacketExportCandidateRepository: makeFakeRepository(),
    metadataOnlyAudit: auditRecorder(),
    ...overrides,
  };
}

test("P14-04 export-candidate creation is restricted to gk_admin, matching P3-16's export-candidate role boundary", () => {
  assert.deepEqual(
    [...__grantResponsePacketExportCandidateServiceContract.CREATE_GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_ROLES],
    ["gk_admin"],
  );
});

test("feature-disabled environment is refused before any repository call", async () => {
  const repository = makeFakeRepository();
  const result = await createGrantResponsePacketExportCandidate(candidateInput(), {
    env: {},
    grantResponsePacketExportCandidateRepository: repository,
    metadataOnlyAudit: auditRecorder(),
  });
  assert.equal(result.error.code, "feature_disabled");
  assert.equal(repository.calls.length, 0);
});

test("exact-keys input contract rejects any client-supplied candidate composition", () => {
  const { isCreateGrantResponsePacketExportCandidateInput } = __grantResponsePacketExportCandidateServiceTestables;
  assert.equal(isCreateGrantResponsePacketExportCandidateInput(candidateInput()), true);
  for (const extra of [
    { packetAudience: "funder" },
    { grantResponsePacketExportIdentityId: "14040000-0000-4000-8000-000000000900" },
    { grantResponsePacketExportCandidateId: "14040000-0000-4000-8000-000000000901" },
    { memberIds: ["14040000-0000-4000-8000-0000000000d1"] },
    { generatedContentDraftIds: ["14040000-0000-4000-8000-0000000000d1"] },
    { memberOrder: [0, 1] },
    { exportCandidateIds: ["14040000-0000-4000-8000-000000000902"] },
    { exportManifestIds: ["14040000-0000-4000-8000-000000000903"] },
    { canonicalFingerprint: "a".repeat(64) },
    { memberCount: 2 },
    { blocks: [{ text: "x" }] },
    { citations: [{ claimId: "x" }] },
    { limitations: ["small_sample_size"] },
  ]) {
    assert.equal(
      isCreateGrantResponsePacketExportCandidateInput({ ...candidateInput(), ...extra }),
      false,
      JSON.stringify(extra),
    );
  }
});

test("service rejects the same malformed input at the public entrypoint with validation_blocker", async () => {
  const result = await createGrantResponsePacketExportCandidate(
    { ...candidateInput(), canonicalFingerprint: "a".repeat(64) },
    deps(),
  );
  assert.equal(result.error.code, "validation_blocker");
});

test("a system/assistant actor can never satisfy the mapped-human actor requirement", async () => {
  const result = await createGrantResponsePacketExportCandidate(
    candidateInput({ actorContext: systemActorContext }),
    deps(),
  );
  assert.equal(result.error.code, "authorization_denied");
});

test("gk_reviewer (unauthorized role for this gate) is rejected before any repository call", async () => {
  const repository = makeFakeRepository();
  const result = await createGrantResponsePacketExportCandidate(
    candidateInput({ actorContext: gkReviewerActorContext }),
    deps({ grantResponsePacketExportCandidateRepository: repository }),
  );
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(repository.calls.length, 0);
});

test("an actor mapped only to a different organization (tenant mismatch) is rejected before any repository call", async () => {
  const repository = makeFakeRepository();
  const result = await createGrantResponsePacketExportCandidate(
    candidateInput({ actorContext: otherOrgAdminActorContext }),
    deps({ grantResponsePacketExportCandidateRepository: repository }),
  );
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(repository.calls.length, 0);
});

test("gk_admin is accepted and actorContext reaches the repository exactly as the route derived it", async () => {
  const repository = makeFakeRepository();
  const result = await createGrantResponsePacketExportCandidate(candidateInput(), deps({
    grantResponsePacketExportCandidateRepository: repository,
  }));
  assert.equal(result.ok, true);
  assert.equal(repository.calls.length, 1);
  assert.deepEqual(repository.calls[0].input.actorContext, gkAdminActorContext);
});

test("a fabricated/nonexistent engagement is propagated as not_found, unchanged", async () => {
  const repository = makeFakeRepository();
  const result = await createGrantResponsePacketExportCandidate(
    candidateInput({ engagementId: FABRICATED_ENGAGEMENT }),
    deps({ grantResponsePacketExportCandidateRepository: repository }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("identical semantic state returns the same candidate (replay convergence) through the service", async () => {
  const repository = makeFakeRepository();
  const renderModelDependencies = { seed: "same-state" };
  const first = await createGrantResponsePacketExportCandidate(candidateInput(), deps({
    grantResponsePacketExportCandidateRepository: repository,
    renderModelDependencies,
  }));
  const second = await createGrantResponsePacketExportCandidate(candidateInput(), deps({
    grantResponsePacketExportCandidateRepository: repository,
    renderModelDependencies,
  }));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.data.replayed, false);
  assert.equal(second.data.replayed, true);
  assert.equal(second.data.grantResponsePacketExportCandidateId, first.data.grantResponsePacketExportCandidateId);
  assert.equal(second.data.canonicalFingerprint, first.data.canonicalFingerprint);
});

test("changed semantic state returns a different candidate through the service", async () => {
  const repository = makeFakeRepository();
  const first = await createGrantResponsePacketExportCandidate(candidateInput(), deps({
    grantResponsePacketExportCandidateRepository: repository,
    renderModelDependencies: { seed: "state-a" },
  }));
  const second = await createGrantResponsePacketExportCandidate(candidateInput(), deps({
    grantResponsePacketExportCandidateRepository: repository,
    renderModelDependencies: { seed: "state-b" },
  }));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(second.data.grantResponsePacketExportCandidateId, first.data.grantResponsePacketExportCandidateId);
  assert.notEqual(second.data.canonicalFingerprint, first.data.canonicalFingerprint);
});

test("the service returns only safe candidate metadata - never the raw member list/order", async () => {
  const repository = makeFakeRepository();
  const result = await createGrantResponsePacketExportCandidate(candidateInput(), deps({
    grantResponsePacketExportCandidateRepository: repository,
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.data).sort(), [
    "canonicalFingerprint",
    "engagementId",
    "fingerprintContractVersion",
    "grantResponsePacketExportCandidateId",
    "grantResponsePacketExportIdentityId",
    "memberCount",
    "organizationId",
    "replayed",
  ]);
  assert.equal(result.data.memberCount, 2);
  assert.equal(result.data.memberGeneratedContentDraftIds, undefined);
  assert.equal(result.data.members, undefined);
  assert.equal(result.data.blocks, undefined);
});

// ---------------------------------------------------------------------------
// P14-04 closure repair: a Grant Response Packet with zero eligible members
// must not create or reuse an export candidate. These tests exercise the
// REAL production repository (createPostgresGrantResponsePacketExportCandidateRepository)
// and the real fingerprint service - only composeRenderModel is faked, to
// stand in for an authoritative getGrantResponsePacket/render-model result -
// so this proves actual service/repository control flow, not an inference
// from memberCount. A `runInTransaction` that throws proves no durable
// candidate/member-snapshot write, and a `metadataOnlyAudit` spy proves no
// candidate-created audit is ever prepared.
// ---------------------------------------------------------------------------

function authoritativeRenderModel(overrides = {}) {
  return {
    ok: true,
    data: {
      renderModelContractVersion: "kai-sprint2-grant-response-packet-render-model-v1",
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      packetAudience: "funder",
      members: [],
      ...overrides,
    },
    error: null,
  };
}

function realRepositoryRefusingTransactions() {
  let transactionCalls = 0;
  const repository = createPostgresGrantResponsePacketExportCandidateRepository({
    runInTransaction: async () => {
      transactionCalls += 1;
      throw new Error("runInTransaction must not be called for this authoritative packet state");
    },
  });
  return { repository, transactionCalls: () => transactionCalls };
}

function auditSpy() {
  let prepareCalls = 0;
  return {
    calls: () => prepareCalls,
    prepareMetadataOnlyAudit() {
      prepareCalls += 1;
      return { ok: true, async publish() {} };
    },
  };
}

test("a Grant Response Packet with zero eligible members fails closed, never reaches a transaction, and publishes no audit", async () => {
  const { repository, transactionCalls } = realRepositoryRefusingTransactions();
  const audit = auditSpy();
  const result = await createGrantResponsePacketExportCandidate(candidateInput(), deps({
    grantResponsePacketExportCandidateRepository: repository,
    composeRenderModel: async () => authoritativeRenderModel({ members: [] }),
    metadataOnlyAudit: audit,
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(transactionCalls(), 0);
  assert.equal(audit.calls(), 0);
});

test("NOT_APPLICABLE_EXISTING_CONTRACT: an unsupported authoritative render-model state (e.g. render-model composition failure) propagates its existing system_error unchanged and creates no candidate", async () => {
  const { repository, transactionCalls } = realRepositoryRefusingTransactions();
  const audit = auditSpy();
  const result = await createGrantResponsePacketExportCandidate(candidateInput(), deps({
    grantResponsePacketExportCandidateRepository: repository,
    composeRenderModel: async () => ({ ok: false, data: null, error: { code: "system_error", status: 500 } }),
    metadataOnlyAudit: audit,
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(transactionCalls(), 0);
  assert.equal(audit.calls(), 0);
});
