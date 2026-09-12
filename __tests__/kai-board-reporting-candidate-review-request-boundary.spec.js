import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createPostgresBoardReportingCandidateRepository } from "../Backend/kai/dictionary/postgresBoardReportingCandidateRepository.js";
import {
  requestBoardReportingCandidateReview,
  __boardReportingCandidateServiceContract,
  __boardReportingCandidateServiceTestables,
} from "../Backend/kai/services/kaiBoardReportingCandidateService.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "15030000-0000-4000-8000-000000000101";
const OTHER_ENGAGEMENT = "15030000-0000-4000-8000-000000000102";
const CANDIDATE = "15030000-0000-4000-8000-000000000301";
const MISSING_CANDIDATE = "15030000-0000-4000-8000-000000000399";
const QUEUE_ITEM = "15030000-0000-4000-8000-000000000401";
const NOW = "2026-09-12T12:00:00.000Z";
const FINGERPRINT = "b".repeat(64);

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

function requestInput(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    boardReportingCandidateId: CANDIDATE,
    actorContext: gkAdminActorContext,
    now: NOW,
    ...overrides,
  };
}

function validCandidateRow(overrides = {}) {
  return {
    board_reporting_candidate_id: CANDIDATE,
    organization_id: ORG,
    engagement_id: ENGAGEMENT,
    canonical_fingerprint: FINGERPRINT,
    fingerprint_contract_version: "kai-sprint2-br-02-board-reporting-candidate-fingerprint-v1",
    packet_audience: "internal",
    candidate_status: "created",
    ...overrides,
  };
}

function validQueueRow(overrides = {}) {
  return {
    review_queue_item_id: QUEUE_ITEM,
    organization_id: ORG,
    engagement_id: ENGAGEMENT,
    queue_type: "board_reporting_candidate_review",
    target_object_type: "board_reporting_candidate",
    target_object_id: CANDIDATE,
    priority: "medium",
    queue_status: "open",
    review_status: "needs_gk_review",
    summary: "Board Reporting candidate requires review.",
    required_action: "Review internal Board packet membership and current-use support before release work.",
    blocked_reason: null,
    assigned_to: null,
    due_at: null,
    queue_metadata: {},
    created_by: null,
    created_by_type: "system",
    updated_at: NOW,
    ...overrides,
  };
}

function makeFakeTx({ candidateRow = validCandidateRow(), existingQueueRow = null } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("FROM kai.board_reporting_candidates")) {
        if (!candidateRow) return { rows: [] };
        return { rows: [{ ...candidateRow, board_reporting_candidate_id: params[2], organization_id: params[0] }] };
      }
      if (sql.includes("INSERT INTO kai.review_queue_items")) {
        if (existingQueueRow) return { rows: [] };
        return { rows: [{ review_queue_item_id: QUEUE_ITEM, queue_status: "open", review_status: "needs_gk_review", updated_at: NOW }] };
      }
      if (sql.includes("SELECT review_queue_item_id::text AS review_queue_item_id")) {
        return { rows: existingQueueRow ? [existingQueueRow] : [] };
      }
      throw new Error(`unexpected query in fake tx: ${sql}`);
    },
  };
}

function deps(overrides = {}) {
  return {
    env: enabledEnv,
    metadataOnlyAudit: auditRecorder(),
    ...overrides,
  };
}

test("BR-03A service exact-keys input contract rejects client-supplied composition, review transition, release, final, or manifest fields", async () => {
  for (const extra of [
    { canonicalFingerprint: FINGERPRINT },
    { memberGeneratedContentDraftIds: [] },
    { queueStatus: "open" },
    { reviewStatus: "needs_gk_review" },
    { finalReleaseAuthorityEffective: true },
    { finalExportEligible: true },
    { exportManifestId: "15030000-0000-4000-8000-000000000501" },
  ]) {
    const result = await requestBoardReportingCandidateReview(requestInput(extra), deps());
    assert.equal(result.ok, false, JSON.stringify(extra));
    assert.equal(result.error.code, "validation_blocker");
  }
});

test("BR-03A service reuses the gk_admin-only candidate/review role boundary", async () => {
  const repository = {
    async requestBoardReportingCandidateReview() {
      throw new Error("repository must not be called when authorization fails");
    },
  };
  const reviewer = await requestBoardReportingCandidateReview(
    requestInput({ actorContext: gkReviewerActorContext }),
    deps({ boardReportingCandidateRepository: repository }),
  );
  assert.equal(reviewer.error.code, "authorization_denied");

  const crossTenant = await requestBoardReportingCandidateReview(
    requestInput({ actorContext: otherOrgAdminActorContext }),
    deps({ boardReportingCandidateRepository: repository }),
  );
  assert.equal(crossTenant.error.code, "authorization_denied");
  assert.deepEqual([...__boardReportingCandidateServiceContract.BOARD_REPORTING_CANDIDATE_ALLOWED_ROLES], ["gk_admin"]);
});

test("BR-03A service propagates safe request state only", async () => {
  const repository = {
    async requestBoardReportingCandidateReview(input) {
      return {
        ok: true,
        data: {
          organizationId: input.organizationId,
          engagementId: input.engagementId,
          boardReportingCandidateId: input.boardReportingCandidateId,
          canonicalFingerprint: FINGERPRINT,
          reviewQueueItemId: QUEUE_ITEM,
          queueStatus: "open",
          reviewStatus: "needs_gk_review",
          reviewUpdatedAt: NOW,
          replayed: false,
        },
        error: null,
      };
    },
  };
  const result = await requestBoardReportingCandidateReview(
    requestInput(),
    deps({ boardReportingCandidateRepository: repository }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.data).sort(), [
    "boardReportingCandidateId",
    "canonicalFingerprint",
    "engagementId",
    "organizationId",
    "queueStatus",
    "replayed",
    "reviewQueueItemId",
    "reviewStatus",
    "reviewUpdatedAt",
  ].sort());
  for (const key of Object.keys(result.data)) {
    assert.doesNotMatch(key, /manifest|final|authority|release/i);
  }
});

test("BR-03A repository fails not_found for missing or wrong-engagement candidate", async () => {
  const missing = createPostgresBoardReportingCandidateRepository({
    runInTransaction: async (fn) => fn(makeFakeTx({ candidateRow: null })),
  });
  const missingResult = await missing.requestBoardReportingCandidateReview(
    requestInput({ boardReportingCandidateId: MISSING_CANDIDATE }),
    { metadataOnlyAudit: auditRecorder() },
  );
  assert.equal(missingResult.error.code, "not_found");

  const wrongEngagement = createPostgresBoardReportingCandidateRepository({
    runInTransaction: async (fn) => fn(makeFakeTx({ candidateRow: null })),
  });
  const wrongResult = await wrongEngagement.requestBoardReportingCandidateReview(
    requestInput({ engagementId: OTHER_ENGAGEMENT }),
    { metadataOnlyAudit: auditRecorder() },
  );
  assert.equal(wrongResult.error.code, "not_found");
});

test("BR-03A repository creates a Board review request and publishes metadata-only audit on first request", async () => {
  const audit = auditRecorder();
  const tx = makeFakeTx();
  const repository = createPostgresBoardReportingCandidateRepository({ runInTransaction: async (fn) => fn(tx) });
  const result = await repository.requestBoardReportingCandidateReview(requestInput(), { metadataOnlyAudit: audit });
  assert.equal(result.ok, true);
  assert.equal(result.data.boardReportingCandidateId, CANDIDATE);
  assert.equal(result.data.canonicalFingerprint, FINGERPRINT);
  assert.equal(result.data.queueStatus, "open");
  assert.equal(result.data.reviewStatus, "needs_gk_review");
  assert.equal(result.data.reviewQueueItemId, QUEUE_ITEM);
  assert.equal(audit.calls.length, 1);
  assert.equal(audit.calls[0].payload.attempted_operation, "board_reporting_candidate_review_requested");
  assert.equal(audit.calls[0].payload.board_reporting_candidate_id, CANDIDATE);
  assert.equal(audit.calls[0].payload.review_queue_item_id, QUEUE_ITEM);
  assert.equal(audit.calls[0].payload.canonical_fingerprint, FINGERPRINT);
});

test("BR-03A repository replays the identical open review request and rejects conflicting existing state", async () => {
  const replayRepo = createPostgresBoardReportingCandidateRepository({
    runInTransaction: async (fn) => fn(makeFakeTx({ existingQueueRow: validQueueRow() })),
  });
  const audit = auditRecorder();
  const replay = await replayRepo.requestBoardReportingCandidateReview(requestInput(), { metadataOnlyAudit: audit });
  assert.equal(replay.ok, true);
  assert.equal(replay.data.replayed, true);
  assert.equal(audit.calls.length, 0);

  const conflictRepo = createPostgresBoardReportingCandidateRepository({
    runInTransaction: async (fn) => fn(makeFakeTx({ existingQueueRow: validQueueRow({ queue_status: "in_progress" }) })),
  });
  const conflict = await conflictRepo.requestBoardReportingCandidateReview(requestInput(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(conflict.error.code, "conflict_current_state_changed");
});

test("BR-03A repository fails closed if the immutable candidate is no longer in the BR-02 created/internal contract", async () => {
  for (const candidateRow of [
    validCandidateRow({ candidate_status: "resolved" }),
    validCandidateRow({ packet_audience: "funder" }),
    validCandidateRow({ fingerprint_contract_version: "other" }),
  ]) {
    const repository = createPostgresBoardReportingCandidateRepository({
      runInTransaction: async (fn) => fn(makeFakeTx({ candidateRow })),
    });
    const result = await repository.requestBoardReportingCandidateReview(requestInput(), { metadataOnlyAudit: auditRecorder() });
    assert.equal(result.error.code, "conflict_current_state_changed");
  }
});

test("BR-03A route contains no SQL and no direct kai.* database access", () => {
  const source = readFileSync(new URL("../Backend/kai/routes/sprint2IntakeApi.js", import.meta.url), "utf8");
  const path = "/admin/organizations/:organizationId/engagements/:engagementId/board-reporting/candidates/:boardReportingCandidateId/review-request";
  const startIndex = source.indexOf(path);
  assert.ok(startIndex >= 0, "BR-03A route path must be present");
  const routeStart = source.lastIndexOf("router.post(", startIndex);
  const routeEnd = source.indexOf("\n);\n", startIndex) + 4;
  const routeSource = source.slice(routeStart, routeEnd);
  assert.doesNotMatch(routeSource, /\bkai\.\w+/, "route must not reference any kai.* table directly");
  assert.doesNotMatch(routeSource, /\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i, "route must contain no SQL");
});

test("BR-03A testable input predicate accepts only the request-review input shape", () => {
  const { isRequestBoardReportingCandidateReviewInput } = __boardReportingCandidateServiceTestables;
  assert.equal(isRequestBoardReportingCandidateReviewInput(requestInput()), true);
  assert.equal(isRequestBoardReportingCandidateReviewInput(requestInput({ extraField: "x" })), false);
});
