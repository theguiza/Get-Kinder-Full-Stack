import test from "node:test";
import assert from "node:assert/strict";

import {
  createBoardReportingCandidate,
  readBoardReportingCandidate,
  __boardReportingCandidateServiceTestables,
} from "../Backend/kai/services/kaiBoardReportingCandidateService.js";
import {
  __boardReportingCandidateRepositoryTestables,
} from "../Backend/kai/dictionary/postgresBoardReportingCandidateRepository.js";
import {
  createProductionMetadataOnlyAuditForBoardReportingCandidate,
} from "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js";
import { sanitizeAuditMetadataForStorage } from "../Backend/kai/db/kaiAuditQueries.js";
import {
  __grantResponsePacketExportCandidateServiceTestables,
} from "../Backend/kai/services/kaiGrantResponsePacketExportCandidateService.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "15020000-0000-4000-8000-000000000001";
const CANDIDATE_ID = "15020000-0000-4000-8000-000000000301";
const NOW = "2026-09-12T12:00:00.000Z";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });

const gkAdminActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});
const otherOrgAdminActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000002",
  organizationMemberships: [
    { organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});

function createInput(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    idempotencyKey: "br-02-boundary-key",
    actorContext: gkAdminActorContext,
    now: NOW,
    ...overrides,
  };
}

test("BR-02 create input accepts only repository-authoritative candidate facts", () => {
  const { isCreateBoardReportingCandidateInput } = __boardReportingCandidateServiceTestables;
  assert.equal(isCreateBoardReportingCandidateInput(createInput()), true);
  for (const extra of [
    { memberIds: ["15020000-0000-4000-8000-000000000201"] },
    { generatedContentDraftIds: ["15020000-0000-4000-8000-000000000201"] },
    { canonicalFingerprint: "a".repeat(64) },
    { packetAudience: "internal" },
    { boardReportingCandidateId: CANDIDATE_ID },
    { members: [] },
    { blocks: [{ text: "raw generated text" }] },
  ]) {
    assert.equal(isCreateBoardReportingCandidateInput({ ...createInput(), ...extra }), false, JSON.stringify(extra));
  }
});

test("BR-02 repository input contract also rejects fake client member/fingerprint authority", () => {
  const { isCreateBoardReportingCandidateInput } = __boardReportingCandidateRepositoryTestables;
  assert.equal(isCreateBoardReportingCandidateInput(createInput()), true);
  assert.equal(isCreateBoardReportingCandidateInput({ ...createInput(), generatedContentDraftIds: [] }), false);
  assert.equal(isCreateBoardReportingCandidateInput({ ...createInput(), canonicalFingerprint: "a".repeat(64) }), false);
});

test("BR-02 service blocks cross-tenant actors before repository access", async () => {
  const repository = {
    calls: 0,
    async createBoardReportingCandidate() {
      this.calls += 1;
      return { ok: true, data: {}, error: null };
    },
  };
  const result = await createBoardReportingCandidate(createInput({ actorContext: otherOrgAdminActorContext }), {
    env: enabledEnv,
    boardReportingCandidateRepository: repository,
    metadataOnlyAudit: { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } },
  });
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(repository.calls, 0);
});

test("BR-02 service returns safe candidate metadata and read returns persisted members", async () => {
  const repository = {
    async createBoardReportingCandidate() {
      return {
        ok: true,
        data: {
          organizationId: ORG,
          engagementId: ENGAGEMENT,
          boardReportingCandidateId: CANDIDATE_ID,
          packetAudience: "internal",
          fingerprintContractVersion: "kai-sprint2-br-02-board-reporting-candidate-fingerprint-v1",
          canonicalFingerprint: "b".repeat(64),
          memberGeneratedContentDraftIds: [
            "15020000-0000-4000-8000-000000000201",
            "15020000-0000-4000-8000-000000000202",
          ],
          replayed: false,
        },
      };
    },
    async readBoardReportingCandidate() {
      return {
        ok: true,
        data: {
          boardReportingCandidateId: CANDIDATE_ID,
          organizationId: ORG,
          engagementId: ENGAGEMENT,
          packetAudience: "internal",
          members: [
            { generatedContentDraftId: "15020000-0000-4000-8000-000000000201", ordinal: 0 },
          ],
        },
      };
    },
  };
  const created = await createBoardReportingCandidate(createInput(), {
    env: enabledEnv,
    boardReportingCandidateRepository: repository,
    metadataOnlyAudit: { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } },
  });
  assert.equal(created.ok, true);
  assert.equal(created.data.packetAudience, "internal");
  assert.equal(created.data.memberCount, 2);
  assert.equal(created.data.memberGeneratedContentDraftIds, undefined);

  const read = await readBoardReportingCandidate({
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    boardReportingCandidateId: CANDIDATE_ID,
    actorContext: gkAdminActorContext,
  }, { env: enabledEnv, boardReportingCandidateRepository: repository });
  assert.equal(read.ok, true);
  assert.deepEqual(read.data.members.map((member) => member.generatedContentDraftId), [
    "15020000-0000-4000-8000-000000000201",
  ]);
});

test("BR-02 audit adapter persists only safe scalar metadata", async () => {
  const captured = [];
  const audit = createProductionMetadataOnlyAuditForBoardReportingCandidate({
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    actorContext: gkAdminActorContext,
    now: NOW,
    insertAuditEvent: async (metadata) => {
      captured.push(metadata);
      return { ok: true };
    },
  });
  const prepared = audit.prepareMetadataOnlyAudit({
    payload: {
      board_reporting_candidate_id: CANDIDATE_ID,
      engagement_id: ENGAGEMENT,
      canonical_fingerprint: "c".repeat(64),
      member_count: 2,
      members: [{ text: "must not persist" }],
      signed_url: "https://example.test/?X-Goog-Signature=secret",
    },
  });
  assert.equal(prepared.ok, true);
  await prepared.publish();
  assert.equal(captured[0].board_reporting_candidate_id, CANDIDATE_ID);
  assert.equal(captured[0].canonical_fingerprint, "c".repeat(64));
  assert.equal(captured[0].members, undefined);
  assert.equal(captured[0].signed_url, undefined);
  const sanitized = sanitizeAuditMetadataForStorage(captured[0]);
  assert.equal(sanitized.board_reporting_candidate_id, CANDIDATE_ID);
  assert.equal(sanitized.canonical_fingerprint, "c".repeat(64));
});

test("Grant candidate input behavior remains unchanged by BR-02", () => {
  const { isCreateGrantResponsePacketExportCandidateInput } = __grantResponsePacketExportCandidateServiceTestables;
  assert.equal(isCreateGrantResponsePacketExportCandidateInput({
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    actorContext: gkAdminActorContext,
    now: NOW,
  }), true);
  assert.equal(isCreateGrantResponsePacketExportCandidateInput({
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    actorContext: gkAdminActorContext,
    now: NOW,
    boardReportingCandidateId: CANDIDATE_ID,
  }), false);
});
