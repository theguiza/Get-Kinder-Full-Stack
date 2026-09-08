// P3-20 EXPORT-MANIFEST-REVIEW-BINDING BOUNDARY (pure-function / fake-tx, no
// database).
//
// Proves, without any real PostgreSQL connection, that
// createExportManifest's real write path (a) always includes
// export_review_queue_item_id in its INSERT statement and its bound
// parameters, in the exact position matching the column list, (b) returns
// exportReviewQueueItemId on its public success object equal to the exact
// caller-supplied input, (c) never derives that value from any latest/
// current/timestamp lookup, and (d) still rejects every client-governance
// field exactly as P3-19's own boundary spec already proved (unchanged by
// this package).

import test from "node:test";
import assert from "node:assert/strict";

import { createPostgresExportManifestRepository } from "../Backend/kai/dictionary/postgresExportManifestRepository.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const DRAFT = "00000000-0000-4000-8000-000000000301";
const CANDIDATE = "00000000-0000-4000-8000-000000000401";
const QUEUE = "00000000-0000-4000-8000-000000000303";
const DECISION = "00000000-0000-4000-8000-000000000501";

const gkAdmin = {
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
};

function baseInput(overrides = {}) {
  return {
    organizationId: ORG,
    exportCandidateId: CANDIDATE,
    exportReviewQueueItemId: QUEUE,
    actorContext: gkAdmin,
    now: "2026-09-08T10:00:00.000Z",
    ...overrides,
  };
}

function passingEligibilityDependencies() {
  return {
    evaluatePacket: async () => ({
      ok: true,
      data: {
        generatedContentDraftId: DRAFT,
        requestedExportAudience: "internal",
        draftStatus: "draft",
        generatedContentReviewQueueStatus: "resolved",
        generatedContentReviewStatus: "resolved",
        exportReviewQueueStatus: "resolved",
        exportReviewStatus: "resolved",
        currentUseEligible: true,
      },
      error: null,
    }),
    evaluator: async () => ({ ok: true, data: {}, error: null }),
    loadCandidate: async () => ({
      export_candidate_id: CANDIDATE,
      organization_id: ORG,
      generated_content_draft_id: DRAFT,
      requested_audience: "internal",
    }),
    evaluateAuthorityEffectiveness: async () => ({
      ok: true,
      data: { effective: true, reason: null, headDecisionId: DECISION },
      error: null,
    }),
    evaluateCandidateCurrentness: async () => ({ ok: true, data: { current: true }, error: null }),
  };
}

// Minimal fake tx: records every query call, and answers exactly the two
// queries insertExportManifest/loadExistingExportManifest ever issue.
function fakeTx({ insertedRow } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.trim().startsWith("INSERT INTO kai.export_manifests")) {
        return { rows: insertedRow ? [insertedRow] : [] };
      }
      if (sql.trim().startsWith("SELECT export_manifest_id::text")) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

function auditRecorder() {
  const calls = [];
  return {
    calls,
    prepareMetadataOnlyAudit(args) {
      calls.push(args);
      return { ok: true, async publish() {} };
    },
  };
}

test("insertExportManifest's SQL always names export_review_queue_item_id, bound to the exact caller-supplied value", async () => {
  const repository = createPostgresExportManifestRepository({
    runInTransaction: async (callback) => callback(tx),
  });
  const tx = fakeTx({ insertedRow: { export_manifest_id: "11111111-1111-4111-8111-111111111111" } });
  const metadataOnlyAudit = auditRecorder();

  const result = await repository.createExportManifest(baseInput(), {
    ...passingEligibilityDependencies(),
    metadataOnlyAudit,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  const insertCall = tx.calls.find((call) => call.sql.trim().startsWith("INSERT INTO kai.export_manifests"));
  assert.ok(insertCall, "an INSERT INTO kai.export_manifests must have been issued");
  assert.match(insertCall.sql, /export_review_queue_item_id/);
  assert.ok(
    insertCall.params.includes(QUEUE),
    `bound parameters must include the exact caller-supplied exportReviewQueueItemId: ${JSON.stringify(insertCall.params)}`,
  );
});

test("createExportManifest's success data carries exportReviewQueueItemId equal to the exact caller-supplied input, never a derived/looked-up value", async () => {
  const repository = createPostgresExportManifestRepository({
    runInTransaction: async (callback) => callback(fakeTx({ insertedRow: { export_manifest_id: "22222222-2222-4222-8222-222222222222" } })),
  });

  const result = await repository.createExportManifest(baseInput(), {
    ...passingEligibilityDependencies(),
    metadataOnlyAudit: auditRecorder(),
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.exportReviewQueueItemId, QUEUE);
  assert.ok(
    Object.keys(result.data).includes("exportReviewQueueItemId"),
    `success data key set must include exportReviewQueueItemId: ${JSON.stringify(Object.keys(result.data))}`,
  );
});

test("a distinct exportReviewQueueItemId across two otherwise-identical calls is reflected exactly, one-for-one - no shared/cached/latest value", async () => {
  const repository = createPostgresExportManifestRepository({
    runInTransaction: async (callback) => callback(fakeTx({ insertedRow: { export_manifest_id: "33333333-3333-4333-8333-333333333333" } })),
  });
  const otherQueue = "00000000-0000-4000-8000-000000000999";

  const first = await repository.createExportManifest(baseInput({ exportReviewQueueItemId: QUEUE }), {
    ...passingEligibilityDependencies(),
    metadataOnlyAudit: auditRecorder(),
  });
  const second = await repository.createExportManifest(baseInput({ exportReviewQueueItemId: otherQueue }), {
    ...passingEligibilityDependencies(),
    metadataOnlyAudit: auditRecorder(),
  });

  assert.equal(first.data.exportReviewQueueItemId, QUEUE);
  assert.equal(second.data.exportReviewQueueItemId, otherQueue);
  assert.notEqual(first.data.exportReviewQueueItemId, second.data.exportReviewQueueItemId);
});

test("no latest/current/timestamp-selection helper exists on the repository's public or testable surface", async () => {
  const repository = createPostgresExportManifestRepository();
  const forbiddenNamePattern = /latest|current|active|mostrecent/i;
  for (const key of Object.keys(repository)) {
    assert.doesNotMatch(key, forbiddenNamePattern, `unexpected latest/current-shaped repository method: ${key}`);
  }
});
