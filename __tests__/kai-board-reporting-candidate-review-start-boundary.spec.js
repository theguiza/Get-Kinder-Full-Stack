import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createPostgresBoardReportingCandidateRepository } from "../Backend/kai/dictionary/postgresBoardReportingCandidateRepository.js";
import {
  startBoardReportingCandidateReview,
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
const MISSING_QUEUE_ITEM = "15030000-0000-4000-8000-000000000498";
const NOW = "2026-09-12T13:00:00.000Z";
const EXPECTED_UPDATED_AT = "2026-09-12T12:00:00.000Z";
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

function startInput(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    boardReportingCandidateId: CANDIDATE,
    reviewQueueItemId: QUEUE_ITEM,
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
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

function requestQueueRow(overrides = {}) {
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
    updated_at: EXPECTED_UPDATED_AT,
    ...overrides,
  };
}

function isSelectQueueRowById(sql) {
  return sql.includes("FROM kai.review_queue_items") && sql.includes("AND review_queue_item_id = $2::uuid");
}

function isUpdateQueueRow(sql) {
  return sql.includes("UPDATE kai.review_queue_items");
}

function isSelectAuditMatch(sql) {
  return sql.includes("FROM kai.audit_events");
}

/**
 * Fake transaction driving startBoardReportingCandidateReview through its
 * exact query shapes: candidate lookup, queue-row-by-id lookup(s), the
 * optimistic-concurrency UPDATE, and (on non-fresh outcomes) the audit-match
 * SELECT used to distinguish a legitimate replay from a stale-token
 * conflict.
 */
function makeFakeTx({
  candidateRow = validCandidateRow(),
  preUpdateQueueRow = requestQueueRow(),
  updateSucceeds = true,
  postUpdateQueueRow = requestQueueRow({ queue_status: "in_progress", updated_at: NOW }),
  matchingAudit = false,
} = {}) {
  let queueLookupCount = 0;
  return {
    async query(sql, params) {
      if (sql.includes("FROM kai.board_reporting_candidates")) {
        if (!candidateRow) return { rows: [] };
        return { rows: [candidateRow] };
      }
      if (isUpdateQueueRow(sql)) {
        if (!updateSucceeds) return { rowCount: 0, rows: [] };
        return {
          rowCount: 1,
          rows: [{
            review_queue_item_id: params[3],
            queue_status: "in_progress",
            review_status: "needs_gk_review",
            updated_at: NOW,
          }],
        };
      }
      if (isSelectAuditMatch(sql)) {
        return { rows: matchingAudit ? [{ metadata: matchingAudit }] : [] };
      }
      if (isSelectQueueRowById(sql)) {
        queueLookupCount += 1;
        if (queueLookupCount === 1 || updateSucceeds) {
          return { rows: preUpdateQueueRow ? [preUpdateQueueRow] : [] };
        }
        return { rows: postUpdateQueueRow ? [postUpdateQueueRow] : [] };
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

test("BR-03B service exact-keys input contract rejects unknown, release, final, or manifest fields", async () => {
  for (const extra of [
    { canonicalFingerprint: FINGERPRINT },
    { queueStatus: "in_progress" },
    { reviewStatus: "needs_gk_review" },
    { finalReleaseAuthorityEffective: true },
    { finalExportEligible: true },
    { exportManifestId: "15030000-0000-4000-8000-000000000501" },
  ]) {
    const result = await startBoardReportingCandidateReview(startInput(extra), deps());
    assert.equal(result.ok, false, JSON.stringify(extra));
    assert.equal(result.error.code, "validation_blocker");
  }
});

test("BR-03B service requires expectedUpdatedAt as a canonical UTC timestamp", async () => {
  const missing = { ...startInput() };
  delete missing.expectedUpdatedAt;
  const missingResult = await startBoardReportingCandidateReview(missing, deps());
  assert.equal(missingResult.error.code, "validation_blocker");

  const malformed = await startBoardReportingCandidateReview(
    startInput({ expectedUpdatedAt: "not-a-timestamp" }),
    deps(),
  );
  assert.equal(malformed.error.code, "validation_blocker");
});

test("BR-03B service reuses the gk_admin-only candidate/review role boundary", async () => {
  const repository = {
    async startBoardReportingCandidateReview() {
      throw new Error("repository must not be called when authorization fails");
    },
  };
  const reviewer = await startBoardReportingCandidateReview(
    startInput({ actorContext: gkReviewerActorContext }),
    deps({ boardReportingCandidateRepository: repository }),
  );
  assert.equal(reviewer.error.code, "authorization_denied");

  const crossTenant = await startBoardReportingCandidateReview(
    startInput({ actorContext: otherOrgAdminActorContext }),
    deps({ boardReportingCandidateRepository: repository }),
  );
  assert.equal(crossTenant.error.code, "authorization_denied");
  assert.deepEqual([...__boardReportingCandidateServiceContract.BOARD_REPORTING_CANDIDATE_ALLOWED_ROLES], ["gk_admin"]);
});

test("BR-03B service propagates safe START state only", async () => {
  const repository = {
    async startBoardReportingCandidateReview(input) {
      return {
        ok: true,
        data: {
          organizationId: input.organizationId,
          engagementId: input.engagementId,
          boardReportingCandidateId: input.boardReportingCandidateId,
          canonicalFingerprint: FINGERPRINT,
          reviewQueueItemId: QUEUE_ITEM,
          queueStatus: "in_progress",
          reviewStatus: "needs_gk_review",
          reviewUpdatedAt: NOW,
          replayed: false,
        },
        error: null,
      };
    },
  };
  const result = await startBoardReportingCandidateReview(
    startInput(),
    deps({ boardReportingCandidateRepository: repository }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.queueStatus, "in_progress");
  assert.equal(result.data.reviewStatus, "needs_gk_review");
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

test("BR-03B repository fails not_found for missing candidate or missing review queue item", async () => {
  const missingCandidate = createPostgresBoardReportingCandidateRepository({
    runInTransaction: async (fn) => fn(makeFakeTx({ candidateRow: null })),
  });
  const missingCandidateResult = await missingCandidate.startBoardReportingCandidateReview(
    startInput({ boardReportingCandidateId: MISSING_CANDIDATE }),
    { metadataOnlyAudit: auditRecorder() },
  );
  assert.equal(missingCandidateResult.error.code, "not_found");

  const missingQueueItem = createPostgresBoardReportingCandidateRepository({
    runInTransaction: async (fn) => fn(makeFakeTx({ preUpdateQueueRow: null })),
  });
  const missingQueueResult = await missingQueueItem.startBoardReportingCandidateReview(
    startInput({ reviewQueueItemId: MISSING_QUEUE_ITEM }),
    { metadataOnlyAudit: auditRecorder() },
  );
  assert.equal(missingQueueResult.error.code, "not_found");
});

test("BR-03B repository fails closed for wrong engagement or wrong candidate binding on the review queue row", async () => {
  const wrongEngagement = createPostgresBoardReportingCandidateRepository({
    runInTransaction: async (fn) => fn(makeFakeTx({
      preUpdateQueueRow: requestQueueRow({ engagement_id: OTHER_ENGAGEMENT }),
    })),
  });
  const wrongEngagementResult = await wrongEngagement.startBoardReportingCandidateReview(
    startInput(),
    { metadataOnlyAudit: auditRecorder() },
  );
  assert.equal(wrongEngagementResult.error.code, "conflict_current_state_changed");

  const wrongCandidate = createPostgresBoardReportingCandidateRepository({
    runInTransaction: async (fn) => fn(makeFakeTx({
      preUpdateQueueRow: requestQueueRow({ target_object_id: MISSING_CANDIDATE }),
    })),
  });
  const wrongCandidateResult = await wrongCandidate.startBoardReportingCandidateReview(
    startInput(),
    { metadataOnlyAudit: auditRecorder() },
  );
  assert.equal(wrongCandidateResult.error.code, "conflict_current_state_changed");
});

test("BR-03B repository transitions REQUEST -> START and publishes exactly one metadata-only start audit", async () => {
  const audit = auditRecorder();
  const repository = createPostgresBoardReportingCandidateRepository({
    runInTransaction: async (fn) => fn(makeFakeTx()),
  });
  const result = await repository.startBoardReportingCandidateReview(startInput(), { metadataOnlyAudit: audit });
  assert.equal(result.ok, true);
  assert.equal(result.data.queueStatus, "in_progress");
  assert.equal(result.data.reviewStatus, "needs_gk_review");
  assert.equal(result.data.replayed, false);
  assert.equal(audit.calls.length, 1);
  assert.equal(audit.calls[0].payload.attempted_operation, "board_reporting_candidate_review_started");
  assert.equal(audit.calls[0].payload.board_reporting_candidate_id, CANDIDATE);
  assert.equal(audit.calls[0].payload.review_queue_item_id, QUEUE_ITEM);
  assert.equal(audit.calls[0].payload.canonical_fingerprint, FINGERPRINT);
  assert.equal(audit.calls[0].payload.previous_queue_status, "open");
  assert.equal(audit.calls[0].payload.resulting_queue_status, "in_progress");
  assert.equal(audit.calls[0].payload.previous_review_status, "needs_gk_review");
  assert.equal(audit.calls[0].payload.resulting_review_status, "needs_gk_review");
  assert.equal(audit.calls[0].payload.expected_updated_at, EXPECTED_UPDATED_AT);
});

test("BR-03B repository replays an identical START only when a matching prior start audit is found, and fails closed on a stale concurrency token", async () => {
  const replayRepo = createPostgresBoardReportingCandidateRepository({
    runInTransaction: async (fn) => fn(makeFakeTx({
      updateSucceeds: false,
      matchingAudit: {
        previous_queue_status: "open",
        resulting_queue_status: "in_progress",
        previous_review_status: "needs_gk_review",
        resulting_review_status: "needs_gk_review",
        expected_updated_at: EXPECTED_UPDATED_AT,
      },
    })),
  });
  const audit = auditRecorder();
  const replay = await replayRepo.startBoardReportingCandidateReview(startInput(), { metadataOnlyAudit: audit });
  assert.equal(replay.ok, true);
  assert.equal(replay.data.replayed, true);
  assert.equal(audit.calls.length, 0);

  const staleTokenRepo = createPostgresBoardReportingCandidateRepository({
    runInTransaction: async (fn) => fn(makeFakeTx({ updateSucceeds: false, matchingAudit: false })),
  });
  const staleTokenResult = await staleTokenRepo.startBoardReportingCandidateReview(
    startInput({ expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }),
    { metadataOnlyAudit: auditRecorder() },
  );
  assert.equal(staleTokenResult.error.code, "conflict_current_state_changed");
});

test("BR-03B repository fails closed if the immutable candidate is no longer in the BR-02 created/internal contract", async () => {
  for (const candidateRow of [
    validCandidateRow({ candidate_status: "resolved" }),
    validCandidateRow({ packet_audience: "funder" }),
    validCandidateRow({ fingerprint_contract_version: "other" }),
  ]) {
    const repository = createPostgresBoardReportingCandidateRepository({
      runInTransaction: async (fn) => fn(makeFakeTx({ candidateRow })),
    });
    const result = await repository.startBoardReportingCandidateReview(startInput(), { metadataOnlyAudit: auditRecorder() });
    assert.equal(result.error.code, "conflict_current_state_changed");
  }
});

test("BR-03B route contains no SQL and no direct kai.* database access", () => {
  const source = readFileSync(new URL("../Backend/kai/routes/sprint2IntakeApi.js", import.meta.url), "utf8");
  const path = "/admin/organizations/:organizationId/engagements/:engagementId/board-reporting/candidates/:boardReportingCandidateId/review-queue/:reviewQueueItemId/start";
  const startIndex = source.indexOf(path);
  assert.ok(startIndex >= 0, "BR-03B start route path must be present");
  const routeStart = source.lastIndexOf("router.post(", startIndex);
  const routeEnd = source.indexOf("\n);\n", startIndex) + 4;
  const routeSource = source.slice(routeStart, routeEnd);
  assert.doesNotMatch(routeSource, /\bkai\.\w+/, "route must not reference any kai.* table directly");
  assert.doesNotMatch(routeSource, /\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i, "route must contain no SQL");
});

test("BR-03B testable input predicate accepts only the start-review input shape", () => {
  const { isStartBoardReportingCandidateReviewInput } = __boardReportingCandidateServiceTestables;
  assert.equal(isStartBoardReportingCandidateReviewInput(startInput()), true);
  assert.equal(isStartBoardReportingCandidateReviewInput(startInput({ extraField: "x" })), false);
  const missingConcurrency = { ...startInput() };
  delete missingConcurrency.expectedUpdatedAt;
  assert.equal(isStartBoardReportingCandidateReviewInput(missingConcurrency), false);
});
