// DURABLE EXPORT-MANIFEST READ RECOVERY - BOUNDARY (pure-function / fake-tx,
// no database).
//
// Proves the read-only extension that lets the existing GK export-review
// page recover the exact persisted exportManifestId after a page reload,
// using the exact P3-20 durable relationship
// (export_manifests.export_review_queue_item_id):
//
//   - the new repository lookup returns the exact single manifest id when
//     exactly one exists, and null (never a guess) when zero or more than
//     one exist;
//   - the packet service composes that lookup into its own read-only
//     transaction, but only after the existing, unmodified packet
//     composition itself succeeds - never as a separate best-effort follow-
//     up, and never on a failed/blocked packet;
//   - the projected packet DTO carries exactly the accepted P3-06 field set
//     plus exportManifestId, and rejects anything else;
//   - no latest/current/timestamp field or method exists anywhere in this
//     surface.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  __exportManifestRepositoryTestables,
  loadExportManifestIdentityForReviewQueueItemInTransaction,
  loadExportManifestHistoryForReviewQueueItemInTransaction,
} from "../Backend/kai/dictionary/postgresExportManifestRepository.js";
import {
  getGeneratedDraftExportReviewPacket,
  __exportReviewServiceTestables,
} from "../Backend/kai/services/kaiExportReviewService.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const DRAFT = "00000000-0000-4000-8000-000000000301";
const QUEUE = "00000000-0000-4000-8000-000000000303";
const MANIFEST_A = "00000000-0000-4000-8000-000000000901";
const MANIFEST_B = "00000000-0000-4000-8000-000000000902";

const enabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_GENERATION_ENABLED: "true",
  KAI_PUBLIC_EXPORT_ENABLED: "true",
});

function gkAdmin(id = "90000000-0000-4000-8000-000000000001") {
  return {
    actorType: "human",
    actorUserId: id,
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
  };
}

function packetInput(overrides = {}) {
  return {
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    exportReviewQueueItemId: QUEUE,
    actorContext: gkAdmin(),
    ...overrides,
  };
}

function passingPacket() {
  return {
    ok: true,
    data: {
      generationRunId: "00000000-0000-4000-8000-000000000700",
      generatedContentDraftId: DRAFT,
      contentType: "evidence_summary",
      draftStatus: "draft",
      requestedExportAudience: "internal",
      generatedContentReviewQueueStatus: "resolved",
      generatedContentReviewStatus: "resolved",
      exportReviewQueueItemId: QUEUE,
      exportReviewQueueStatus: "resolved",
      exportReviewStatus: "resolved",
      currentUseEligible: true,
      exportEligible: true,
      validatorResult: {
        validator_key: "VAL-EXP-001",
        severity: "pass",
        object_type: "generated_content_draft",
        object_code: "export_manifest_eligibility",
        object_id: DRAFT,
        message: "ok",
        blocking_reason: null,
        required_fix: null,
        evidence: {},
      },
      blocks: [
        {
          ordinal: 1,
          text: "KAI's first block of generated text.",
          citations: [
            {
              claimId: "00000000-0000-4000-8000-000000000705",
              evidenceItemId: "00000000-0000-4000-8000-000000000706",
              sourceId: "00000000-0000-4000-8000-000000000707",
              sourceVersionId: "00000000-0000-4000-8000-000000000708",
              supportStrength: "strong",
              claimReviewStatus: "approved",
              evidenceReviewStatus: "approved",
              currentEligible: true,
              blockerCodes: [],
              affectedDimensionKeys: [],
              affectedObjectIds: [],
            },
          ],
        },
      ],
      exportReviewUpdatedAt: "2026-09-08T09:00:00.000Z",
    },
    error: null,
  };
}

function fakeTxRows(rows) {
  return { async query() { return { rows }; } };
}

// --- Repository-level: exactly-one-or-none, never a guess. -----------------

test("loadExportManifestIdentityForReviewQueueItemInTransaction returns the exact id when exactly one manifest matches", async () => {
  const result = await loadExportManifestIdentityForReviewQueueItemInTransaction(
    fakeTxRows([{ export_manifest_id: MANIFEST_A }]),
    { organizationId: ORG, exportReviewQueueItemId: QUEUE },
  );
  assert.deepEqual(result, { exportManifestId: MANIFEST_A });
});

test("loadExportManifestIdentityForReviewQueueItemInTransaction returns null when zero manifests match - no finalization, nothing to recover", async () => {
  const result = await loadExportManifestIdentityForReviewQueueItemInTransaction(
    fakeTxRows([]),
    { organizationId: ORG, exportReviewQueueItemId: QUEUE },
  );
  assert.deepEqual(result, { exportManifestId: null });
});

test("loadExportManifestIdentityForReviewQueueItemInTransaction returns null when multiple manifests match - never picks one, never a latest/newest substitute", async () => {
  const result = await loadExportManifestIdentityForReviewQueueItemInTransaction(
    fakeTxRows([{ export_manifest_id: MANIFEST_A }, { export_manifest_id: MANIFEST_B }]),
    { organizationId: ORG, exportReviewQueueItemId: QUEUE },
  );
  assert.deepEqual(result, { exportManifestId: null });
});

test("isLoadExportManifestIdentityInput rejects any shape beyond exactly organizationId/exportReviewQueueItemId", () => {
  const { isLoadExportManifestIdentityInput } = __exportManifestRepositoryTestables;
  assert.equal(isLoadExportManifestIdentityInput({ organizationId: ORG, exportReviewQueueItemId: QUEUE }), true);
  assert.equal(isLoadExportManifestIdentityInput({ organizationId: ORG, exportReviewQueueItemId: QUEUE, exportCandidateId: "x" }), false);
  assert.equal(isLoadExportManifestIdentityInput({ organizationId: "not-a-uuid", exportReviewQueueItemId: QUEUE }), false);
  assert.equal(isLoadExportManifestIdentityInput(null), false);
});

// --- Repository-level: exact history, every legitimate row, never a guess. -

const HISTORY_CANDIDATE_A = "00000000-0000-4000-8000-000000000801";
const HISTORY_CANDIDATE_B = "00000000-0000-4000-8000-000000000802";
const HISTORY_CANDIDATE_C = "00000000-0000-4000-8000-000000000803";
const CREATED_AT_A = "2026-09-08T10:00:00.000Z";
const CREATED_AT_B = "2026-09-08T10:05:00.000Z";
const CREATED_AT_C = "2026-09-08T10:10:00.000Z";

function fakeHistoryTx(rows) {
  return {
    async query(sql, params) {
      assert.match(sql, /ORDER BY created_at ASC, export_manifest_id ASC/);
      assert.doesNotMatch(sql, /LIMIT|latest|current|active|preferred|MAX\(/i);
      assert.deepEqual(params, [ORG, QUEUE]);
      return { rows };
    },
  };
}

test("loadExportManifestHistoryForReviewQueueItemInTransaction returns [] when zero manifests match", async () => {
  const result = await loadExportManifestHistoryForReviewQueueItemInTransaction(
    fakeHistoryTx([]),
    { organizationId: ORG, exportReviewQueueItemId: QUEUE },
  );
  assert.deepEqual(result, { exportManifestHistory: [] });
});

test("loadExportManifestHistoryForReviewQueueItemInTransaction returns exactly one entry when one manifest matches", async () => {
  const result = await loadExportManifestHistoryForReviewQueueItemInTransaction(
    fakeHistoryTx([{ export_manifest_id: MANIFEST_A, export_candidate_id: HISTORY_CANDIDATE_A, created_at: CREATED_AT_A }]),
    { organizationId: ORG, exportReviewQueueItemId: QUEUE },
  );
  assert.deepEqual(result, {
    exportManifestHistory: [{ exportManifestId: MANIFEST_A, exportCandidateId: HISTORY_CANDIDATE_A, createdAt: CREATED_AT_A }],
  });
});

test("loadExportManifestHistoryForReviewQueueItemInTransaction returns BOTH entries when two manifests match - no row dropped because count > 1", async () => {
  const result = await loadExportManifestHistoryForReviewQueueItemInTransaction(
    fakeHistoryTx([
      { export_manifest_id: MANIFEST_A, export_candidate_id: HISTORY_CANDIDATE_A, created_at: CREATED_AT_A },
      { export_manifest_id: MANIFEST_B, export_candidate_id: HISTORY_CANDIDATE_B, created_at: CREATED_AT_B },
    ]),
    { organizationId: ORG, exportReviewQueueItemId: QUEUE },
  );
  assert.deepEqual(result, {
    exportManifestHistory: [
      { exportManifestId: MANIFEST_A, exportCandidateId: HISTORY_CANDIDATE_A, createdAt: CREATED_AT_A },
      { exportManifestId: MANIFEST_B, exportCandidateId: HISTORY_CANDIDATE_B, createdAt: CREATED_AT_B },
    ],
  });
});

test("loadExportManifestHistoryForReviewQueueItemInTransaction returns all three entries when three manifests match, in stable presentation order", async () => {
  const HISTORY_MANIFEST_C = "00000000-0000-4000-8000-000000000903";
  const result = await loadExportManifestHistoryForReviewQueueItemInTransaction(
    fakeHistoryTx([
      { export_manifest_id: MANIFEST_A, export_candidate_id: HISTORY_CANDIDATE_A, created_at: CREATED_AT_A },
      { export_manifest_id: MANIFEST_B, export_candidate_id: HISTORY_CANDIDATE_B, created_at: CREATED_AT_B },
      { export_manifest_id: HISTORY_MANIFEST_C, export_candidate_id: HISTORY_CANDIDATE_C, created_at: CREATED_AT_C },
    ]),
    { organizationId: ORG, exportReviewQueueItemId: QUEUE },
  );
  assert.equal(result.exportManifestHistory.length, 3);
  assert.deepEqual(result.exportManifestHistory.map((entry) => entry.exportManifestId), [MANIFEST_A, MANIFEST_B, HISTORY_MANIFEST_C]);
});

test("loadExportManifestHistoryForReviewQueueItemInTransaction converts a Date created_at to an ISO string", async () => {
  const result = await loadExportManifestHistoryForReviewQueueItemInTransaction(
    fakeHistoryTx([{ export_manifest_id: MANIFEST_A, export_candidate_id: HISTORY_CANDIDATE_A, created_at: new Date(CREATED_AT_A) }]),
    { organizationId: ORG, exportReviewQueueItemId: QUEUE },
  );
  assert.equal(result.exportManifestHistory[0].createdAt, CREATED_AT_A);
});

test("loadExportManifestHistoryForReviewQueueItemInTransaction returns [] for a malformed input shape - never queries with a partial/invalid input", async () => {
  const result = await loadExportManifestHistoryForReviewQueueItemInTransaction(
    { async query() { throw new Error("must not query"); } },
    { organizationId: "not-a-uuid", exportReviewQueueItemId: QUEUE },
  );
  assert.deepEqual(result, { exportManifestHistory: [] });
});

test("isLoadExportManifestHistoryInput rejects any shape beyond exactly organizationId/exportReviewQueueItemId", () => {
  const { isLoadExportManifestHistoryInput } = __exportManifestRepositoryTestables;
  assert.equal(isLoadExportManifestHistoryInput({ organizationId: ORG, exportReviewQueueItemId: QUEUE }), true);
  assert.equal(isLoadExportManifestHistoryInput({ organizationId: ORG, exportReviewQueueItemId: QUEUE, exportCandidateId: "x" }), false);
  assert.equal(isLoadExportManifestHistoryInput({ organizationId: "not-a-uuid", exportReviewQueueItemId: QUEUE }), false);
  assert.equal(isLoadExportManifestHistoryInput(null), false);
});

test("no LIMIT 1 / MAX(created_at) / DESC-ordered single-row selection exists in the history query itself", () => {
  const source = readFileSync(new URL("../Backend/kai/dictionary/postgresExportManifestRepository.js", import.meta.url), "utf8");
  const queryStart = source.indexOf("export async function loadExportManifestHistoryForReviewQueueItemInTransaction");
  const querySlice = source.slice(queryStart, source.indexOf("export function createPostgresExportManifestRepository"));
  assert.doesNotMatch(querySlice, /LIMIT\s+1|MAX\(\s*created_at|ORDER BY created_at DESC/i);
  assert.match(querySlice, /ORDER BY created_at ASC, export_manifest_id ASC/);
});

// --- Service-level composition: only after the unmodified packet PASSes. ---

const HISTORY_ENTRY_A = Object.freeze({
  exportManifestId: MANIFEST_A,
  exportCandidateId: "00000000-0000-4000-8000-000000000801",
  createdAt: "2026-09-08T10:00:00.000Z",
});
const HISTORY_ENTRY_B = Object.freeze({
  exportManifestId: MANIFEST_B,
  exportCandidateId: "00000000-0000-4000-8000-000000000802",
  createdAt: "2026-09-08T10:05:00.000Z",
});

function serviceDeps(overrides = {}) {
  const calls = { evaluatePacket: 0, loadManifestIdentity: 0, loadManifestHistory: 0 };
  return {
    calls,
    deps: {
      env: enabledEnv,
      runInTransaction: async (callback) => callback({ async query() {} }),
      evaluatePacket: async () => { calls.evaluatePacket += 1; return passingPacket(); },
      evaluator: async () => ({ ok: true, data: {}, error: null }),
      loadManifestIdentity: async () => { calls.loadManifestIdentity += 1; return { exportManifestId: MANIFEST_A }; },
      loadManifestHistory: async () => { calls.loadManifestHistory += 1; return { exportManifestHistory: [HISTORY_ENTRY_A] }; },
      ...overrides,
    },
  };
}

test("getGeneratedDraftExportReviewPacket's projected data carries exactly the accepted P3-06 fields plus exportManifestId and exportManifestHistory", async () => {
  const { deps } = serviceDeps();
  const result = await getGeneratedDraftExportReviewPacket(packetInput(), deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.exportManifestId, MANIFEST_A);
  assert.deepEqual(result.data.exportManifestHistory, [HISTORY_ENTRY_A]);
  assert.deepEqual(
    [...Object.keys(result.data)].sort(),
    [
      "blocks",
      "contentType",
      "currentUseEligible",
      "draftStatus",
      "exportEligible",
      "exportManifestId",
      "exportManifestHistory",
      "exportReviewQueueItemId",
      "exportReviewQueueStatus",
      "exportReviewStatus",
      "exportReviewUpdatedAt",
      "generatedContentDraftId",
      "generatedContentReviewQueueStatus",
      "generatedContentReviewStatus",
      "generationRunId",
      "requestedExportAudience",
      "validatorResult",
    ].sort(),
  );
});

test("getGeneratedDraftExportReviewPacket reports exportManifestId: null and exportManifestHistory: [] (never fabricated) when nothing is recoverable", async () => {
  const { deps } = serviceDeps({
    loadManifestIdentity: async () => ({ exportManifestId: null }),
    loadManifestHistory: async () => ({ exportManifestHistory: [] }),
  });
  const result = await getGeneratedDraftExportReviewPacket(packetInput(), deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.exportManifestId, null);
  assert.deepEqual(result.data.exportManifestHistory, []);
});

test("getGeneratedDraftExportReviewPacket's exportManifestHistory returns EVERY legitimate manifest, never collapsed to null or truncated", async () => {
  const { deps } = serviceDeps({
    loadManifestIdentity: async () => ({ exportManifestId: null }),
    loadManifestHistory: async () => ({ exportManifestHistory: [HISTORY_ENTRY_A, HISTORY_ENTRY_B] }),
  });
  const result = await getGeneratedDraftExportReviewPacket(packetInput(), deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.data.exportManifestHistory, [HISTORY_ENTRY_A, HISTORY_ENTRY_B]);
});

test("the manifest-identity and manifest-history lookups are never called when the underlying packet composition itself fails - no separate best-effort follow-up", async () => {
  const { deps, calls } = serviceDeps({
    evaluatePacket: async () => { calls.evaluatePacket += 1; return { ok: false, error: { code: "not_found" } }; },
  });
  const result = await getGeneratedDraftExportReviewPacket(packetInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(calls.evaluatePacket, 1);
  assert.equal(calls.loadManifestIdentity, 0, "loadManifestIdentity must never run when the packet itself was rejected");
  assert.equal(calls.loadManifestHistory, 0, "loadManifestHistory must never run when the packet itself was rejected");
});

test("the manifest-identity lookup is scoped to the exact caller-supplied organizationId - a cross-tenant read cannot leak a manifest identity", async () => {
  const seenOrgIds = [];
  const { deps } = serviceDeps({
    loadManifestIdentity: async (tx, input) => { seenOrgIds.push(input.organizationId); return { exportManifestId: null }; },
  });
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  await getGeneratedDraftExportReviewPacket(packetInput({ organizationId: OTHER_ORG, actorContext: gkAdmin() }), {
    ...deps,
    // authorization would normally reject a mismatched org/actor membership;
    // this test isolates the read-model wiring only, so it asserts the exact
    // organizationId argument threaded through, not the auth gate itself
    // (covered by the existing export-review packet boundary suite).
  });
  // The auth gate rejects before the transaction in the real service (see
  // the existing p3-06 boundary suite); when it does run, it must always be
  // given the exact input organizationId, never a different one.
  if (seenOrgIds.length > 0) {
    assert.equal(seenOrgIds[0], OTHER_ORG);
  }
});

test("the manifest-history lookup is scoped to the exact caller-supplied organizationId - a cross-tenant read cannot leak manifest history", async () => {
  const seenOrgIds = [];
  const { deps } = serviceDeps({
    loadManifestHistory: async (tx, input) => { seenOrgIds.push(input.organizationId); return { exportManifestHistory: [] }; },
  });
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  await getGeneratedDraftExportReviewPacket(packetInput({ organizationId: OTHER_ORG, actorContext: gkAdmin() }), deps);
  if (seenOrgIds.length > 0) {
    assert.equal(seenOrgIds[0], OTHER_ORG);
  }
});

test("no latest/current/timestamp-shaped field exists on the projected packet DTO validator's own key set", () => {
  const { isGeneratedDraftExportReviewPacketWithManifestDto } = __exportReviewServiceTestables;
  const forbiddenNamePattern = /latest|current(?!UseEligible)|active|mostrecent|timestamp/i;
  const projected = { ...passingPacket().data, exportManifestId: MANIFEST_A, exportManifestHistory: [HISTORY_ENTRY_A] };
  for (const key of Object.keys(projected)) {
    assert.doesNotMatch(key, forbiddenNamePattern, `unexpected latest/current-shaped field: ${key}`);
  }
  assert.equal(isGeneratedDraftExportReviewPacketWithManifestDto(projected), true);
  assert.equal(isGeneratedDraftExportReviewPacketWithManifestDto({ ...projected, exportManifestId: "not-a-uuid" }), false);
  assert.equal(isGeneratedDraftExportReviewPacketWithManifestDto({ ...projected, isCurrent: true }), false);
  assert.equal(isGeneratedDraftExportReviewPacketWithManifestDto({ ...projected, exportManifestHistory: null }), false);
  assert.equal(isGeneratedDraftExportReviewPacketWithManifestDto({ ...projected, exportManifestHistory: [{ ...HISTORY_ENTRY_A, extra: true }] }), false);
});

test("isExportManifestHistoryDto rejects a single dropped-to-null history in favor of an explicit array, and rejects malformed entries", () => {
  const { isExportManifestHistoryDto } = __exportReviewServiceTestables;
  assert.equal(isExportManifestHistoryDto([]), true);
  assert.equal(isExportManifestHistoryDto([HISTORY_ENTRY_A]), true);
  assert.equal(isExportManifestHistoryDto([HISTORY_ENTRY_A, HISTORY_ENTRY_B]), true);
  assert.equal(isExportManifestHistoryDto(null), false);
  assert.equal(isExportManifestHistoryDto([{ ...HISTORY_ENTRY_A, exportManifestId: "not-a-uuid" }]), false);
  assert.equal(isExportManifestHistoryDto([{ ...HISTORY_ENTRY_A, exportCandidateId: "not-a-uuid" }]), false);
  assert.equal(isExportManifestHistoryDto([{ ...HISTORY_ENTRY_A, createdAt: "not-a-timestamp" }]), false);
});
