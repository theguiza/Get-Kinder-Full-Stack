// BR-04: Board Reporting candidate governed human final-release authority
// application - service + repository + HTTP route wiring around the new
// postgresBoardReportingCandidateHumanAuthorityDecisionRepository.js. Proves
// gk_admin can grant/revoke the exact candidate only once its bound
// board_reporting_candidate_review queue item is resolved (BR-03B
// COMPLETE), unauthorized/assistant/system/cross-tenant actors and an
// unresolved/missing/mis-bound review queue row all fail closed, P3-17/
// P14-07B1-style replay/supersession semantics are preserved, a failed
// grant produces no successful-authority audit row, and
// board_reporting_candidates/board_reporting_candidate_members/
// review_queue_items are never mutated by this code path (verified by
// asserting no UPDATE/DELETE statement is ever issued against them). No
// database access - the repository is faked at the service level and a
// fake in-memory transaction is used at the repository level; the
// route-level test additionally proves HTTP wiring (feature flags,
// authentication, exact request/response shape).

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { readFileSync } from "node:fs";

import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import {
  handleKaiSprint2JsonParserError,
  kaiSprint2ActorMutationLimiter,
  kaiSprint2MetadataJsonParser,
  kaiSprint2OrganizationMutationLimiter,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";
import {
  recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision,
  __boardReportingCandidateHumanFinalReleaseAuthorityServiceContract,
  __boardReportingCandidateHumanFinalReleaseAuthorityServiceTestables,
} from "../Backend/kai/services/kaiBoardReportingCandidateHumanFinalReleaseAuthorityService.js";
import {
  createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository,
} from "../Backend/kai/dictionary/postgresBoardReportingCandidateHumanAuthorityDecisionRepository.js";
import { BOARD_REPORTING_CANDIDATE_REVIEW_QUEUE_STATIC_CONTRACT } from "../Backend/kai/dictionary/boardReportingCandidateContract.js";

const basePath = "/api/kai/sprint2/intake";
const routePath = "/admin/organizations/:organizationId/engagements/:engagementId/board-reporting/candidates/:boardReportingCandidateId/final-release-authority";
const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "04000000-0000-4000-8000-000000000001";
const OTHER_ENGAGEMENT = "04000000-0000-4000-8000-000000000099";
const CANDIDATE = "04000000-0000-4000-8000-000000000501";
const OTHER_CANDIDATE = "04000000-0000-4000-8000-000000000599";
const REVIEW_QUEUE_ITEM = "04000000-0000-4000-8000-000000000601";
const ACTOR = "90000000-0000-4000-8000-000000000001";
const NOW = "2026-09-12T10:00:00.000Z";

const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });

const gkAdminActorContext = Object.freeze({
  actorType: "human",
  actorUserId: ACTOR,
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

function authorityInput(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    boardReportingCandidateId: CANDIDATE,
    reviewQueueItemId: REVIEW_QUEUE_ITEM,
    decisionAction: "grant",
    actorContext: gkAdminActorContext,
    now: NOW,
    ...overrides,
  };
}

function auditRecorder() {
  const calls = [];
  return {
    calls,
    prepareMetadataOnlyAudit({ payload } = {}) {
      calls.push(payload);
      return { ok: true, async publish() {} };
    },
  };
}

// ---------------------------------------------------------------------------
// Repository-level fixtures
// ---------------------------------------------------------------------------

function candidateRow(overrides = {}) {
  return {
    board_reporting_candidate_id: CANDIDATE,
    organization_id: ORG,
    engagement_id: ENGAGEMENT,
    canonical_fingerprint: "f".repeat(64),
    fingerprint_contract_version: "kai-sprint2-br-02-board-reporting-candidate-fingerprint-v1",
    packet_audience: "internal",
    candidate_status: "created",
    ...overrides,
  };
}

function queueRow({ queueStatus, reviewStatus, ...overrides } = {}) {
  const contract = BOARD_REPORTING_CANDIDATE_REVIEW_QUEUE_STATIC_CONTRACT;
  return {
    review_queue_item_id: REVIEW_QUEUE_ITEM,
    organization_id: ORG,
    engagement_id: ENGAGEMENT,
    queue_type: contract.queueType,
    target_object_type: contract.targetObjectType,
    target_object_id: CANDIDATE,
    priority: contract.priority,
    queue_status: queueStatus,
    review_status: reviewStatus,
    summary: contract.summary,
    required_action: contract.requiredAction,
    blocked_reason: null,
    assigned_to: null,
    due_at: null,
    queue_metadata: {},
    created_by: null,
    created_by_type: contract.createdByType,
    updated_at: NOW,
    ...overrides,
  };
}

function resolvedQueueRow(overrides = {}) {
  return queueRow({ queueStatus: "resolved", reviewStatus: "resolved", ...overrides });
}

function openQueueRow(overrides = {}) {
  return queueRow({ queueStatus: "open", reviewStatus: "needs_gk_review", ...overrides });
}

function inProgressQueueRow(overrides = {}) {
  return queueRow({ queueStatus: "in_progress", reviewStatus: "needs_gk_review", ...overrides });
}

function fakeTx(rowsByQueryIndex, queries = []) {
  let call = 0;
  return {
    async query(sql, params) {
      queries.push({ sql, params });
      const rows = rowsByQueryIndex[call] ?? [];
      call += 1;
      return { rows };
    },
  };
}

function repositoryInput(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    boardReportingCandidateId: CANDIDATE,
    reviewQueueItemId: REVIEW_QUEUE_ITEM,
    decisionType: "export_authority_granted",
    decisionAction: "grant",
    actorContext: gkAdminActorContext,
    now: NOW,
    ...overrides,
  };
}

function assertNeverMutatesGuardedTables(queries) {
  for (const { sql } of queries) {
    assert.doesNotMatch(sql, /UPDATE\s+kai\.board_reporting_candidates/i);
    assert.doesNotMatch(sql, /UPDATE\s+kai\.board_reporting_candidate_members/i);
    assert.doesNotMatch(sql, /UPDATE\s+kai\.review_queue_items/i);
    assert.doesNotMatch(sql, /DELETE\s+FROM\s+kai\.board_reporting_candidates/i);
    assert.doesNotMatch(sql, /DELETE\s+FROM\s+kai\.board_reporting_candidate_members/i);
    assert.doesNotMatch(sql, /DELETE\s+FROM\s+kai\.review_queue_items/i);
    assert.doesNotMatch(sql, /INSERT INTO kai\.board_reporting_candidates/i);
    assert.doesNotMatch(sql, /INSERT INTO kai\.board_reporting_candidate_members/i);
    assert.doesNotMatch(sql, /INSERT INTO kai\.review_queue_items/i);
  }
}

// --- repository: resolved-review precondition ---

test("BR-04 recordDecision succeeds once the bound review queue item is resolved (BR-03B COMPLETE)", async () => {
  const queries = [];
  const tx = fakeTx([
    [candidateRow()],
    [resolvedQueueRow()],
    [],
    [],
    [{ decision_id: "00000000-0000-4000-8000-000000000901", decision_action: "grant" }],
  ], queries);
  const repo = createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository({ runInTransaction: async (fn) => fn(tx) });

  const result = await repo.recordDecision(repositoryInput(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.ok, true);
  assert.equal(result.data.effective, true);
  assert.equal(result.data.replayed, false);
  assert.equal("finalGate" in result.data, false);
  assert.equal("manifest" in result.data, false);
  assert.equal(queries.some((query) => /INSERT INTO kai\.board_reporting_candidate_human_authority_decisions/.test(query.sql)), true);
  assertNeverMutatesGuardedTables(queries);
});

test("BR-04 recordDecision fails closed when the bound review queue item is still open (REQUEST, never started)", async () => {
  const queries = [];
  const tx = fakeTx([[candidateRow()], [openQueueRow()]], queries);
  const repo = createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository({ runInTransaction: async (fn) => fn(tx) });

  const result = await repo.recordDecision(repositoryInput(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(queries.some((query) => /INSERT INTO kai\.board_reporting_candidate_human_authority_decisions/.test(query.sql)), false);
  assertNeverMutatesGuardedTables(queries);
});

test("BR-04 recordDecision fails closed when the bound review queue item is only in_progress (START, not yet COMPLETE)", async () => {
  const queries = [];
  const tx = fakeTx([[candidateRow()], [inProgressQueueRow()]], queries);
  const repo = createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository({ runInTransaction: async (fn) => fn(tx) });

  const result = await repo.recordDecision(repositoryInput(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(queries.some((query) => /INSERT INTO kai\.board_reporting_candidate_human_authority_decisions/.test(query.sql)), false);
});

test("BR-04 recordDecision fails closed (not_found) when no review queue row exists for the supplied reviewQueueItemId", async () => {
  const queries = [];
  const tx = fakeTx([[candidateRow()], []], queries);
  const repo = createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository({ runInTransaction: async (fn) => fn(tx) });

  const result = await repo.recordDecision(repositoryInput(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("BR-04 recordDecision fails closed when the resolved queue row is bound to a different organization/engagement/candidate", async () => {
  for (const mismatch of [
    { organization_id: OTHER_ORG },
    { engagement_id: OTHER_ENGAGEMENT },
    { target_object_id: OTHER_CANDIDATE },
  ]) {
    const queries = [];
    const tx = fakeTx([[candidateRow()], [resolvedQueueRow(mismatch)]], queries);
    const repo = createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository({ runInTransaction: async (fn) => fn(tx) });
    const result = await repo.recordDecision(repositoryInput(), { metadataOnlyAudit: auditRecorder() });
    assert.equal(result.ok, false, JSON.stringify(mismatch));
    assert.equal(result.error.code, "conflict_current_state_changed", JSON.stringify(mismatch));
  }
});

test("BR-04 recordDecision fails closed (not_found) when the candidate itself does not exist for this organization/engagement", async () => {
  const queries = [];
  const tx = fakeTx([[]], queries);
  const repo = createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository({ runInTransaction: async (fn) => fn(tx) });
  const result = await repo.recordDecision(repositoryInput(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("BR-04 duplicate same-action authority decision follows existing no-op replay behavior - no new row, no audit", async () => {
  const queries = [];
  const tx = fakeTx([
    [candidateRow()],
    [resolvedQueueRow()],
    [{ decision_id: "00000000-0000-4000-8000-000000000901", decision_action: "grant" }],
    [{ decision_id: "00000000-0000-4000-8000-000000000901", decision_action: "grant" }],
  ], queries);
  const repo = createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository({ runInTransaction: async (fn) => fn(tx) });
  const audit = auditRecorder();

  const result = await repo.recordDecision(repositoryInput(), { metadataOnlyAudit: audit });
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, true);
  assert.equal(result.data.decisionId, "00000000-0000-4000-8000-000000000901");
  assert.equal(queries.some((query) => /INSERT INTO kai\.board_reporting_candidate_human_authority_decisions/.test(query.sql)), false);
  assert.equal(audit.calls.length, 0);
});

test("BR-04 revocation/supersession makes earlier final-release authority ineffective", async () => {
  const queries = [];
  const tx = fakeTx([
    [candidateRow()],
    [resolvedQueueRow()],
    [{ decision_id: "00000000-0000-4000-8000-000000000901", decision_action: "grant" }],
    [],
    [{ decision_id: "00000000-0000-4000-8000-000000000902", decision_action: "revoke" }],
  ], queries);
  const repo = createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository({ runInTransaction: async (fn) => fn(tx) });

  const revoked = await repo.recordDecision(repositoryInput({ decisionAction: "revoke" }), { metadataOnlyAudit: auditRecorder() });
  assert.equal(revoked.ok, true);
  assert.equal(revoked.data.decisionAction, "revoke");
  assert.equal(revoked.data.supersedesDecisionId, "00000000-0000-4000-8000-000000000901");
  assert.equal(revoked.data.effective, false);
  assert.equal(revoked.data.effectivenessReason, "head_is_revoke");
});

test("BR-04 a root revoke (no existing grant) fails closed before any insert", async () => {
  const queries = [];
  const tx = fakeTx([[candidateRow()], [resolvedQueueRow()], []], queries);
  const repo = createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository({ runInTransaction: async (fn) => fn(tx) });
  const result = await repo.recordDecision(repositoryInput({ decisionAction: "revoke" }), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(queries.some((query) => /INSERT INTO kai\.board_reporting_candidate_human_authority_decisions/.test(query.sql)), false);
});

test("BR-04 metadata-only audit is called only with safe scalar fields - no candidate/member/review content", async () => {
  const queries = [];
  const tx = fakeTx([
    [candidateRow()],
    [resolvedQueueRow()],
    [],
    [],
    [{ decision_id: "00000000-0000-4000-8000-000000000901", decision_action: "grant" }],
  ], queries);
  const repo = createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository({ runInTransaction: async (fn) => fn(tx) });
  const audit = auditRecorder();
  await repo.recordDecision(repositoryInput(), { metadataOnlyAudit: audit });

  assert.equal(audit.calls.length, 1);
  const payload = audit.calls[0];
  for (const key of Object.keys(payload)) {
    assert.doesNotMatch(key, /content|citation|evidence|text|snapshot|members/i);
  }
  assert.equal(payload.board_reporting_candidate_id, CANDIDATE);
  assert.equal(payload.review_queue_item_id, REVIEW_QUEUE_ITEM);
  assert.equal(payload.decision_action, "grant");
});

// --- service ---

test("BR-04 final-release authority service pins the export_authority_granted/gk_admin contract", () => {
  assert.equal(__boardReportingCandidateHumanFinalReleaseAuthorityServiceContract.FINAL_RELEASE_AUTHORITY_DECISION_TYPE, "export_authority_granted");
  assert.equal(
    __boardReportingCandidateHumanFinalReleaseAuthorityServiceContract.RECORD_BOARD_REPORTING_CANDIDATE_HUMAN_FINAL_RELEASE_AUTHORITY_OPERATION,
    "record_board_reporting_candidate_human_final_release_authority_decision",
  );
  assert.deepEqual(
    [...__boardReportingCandidateHumanFinalReleaseAuthorityServiceContract.RECORD_BOARD_REPORTING_CANDIDATE_HUMAN_FINAL_RELEASE_AUTHORITY_ROLES],
    ["gk_admin"],
  );
});

test("input contract accepts only organizationId + engagementId + boardReportingCandidateId + reviewQueueItemId + decisionAction + actorContext + now", () => {
  const { isRecordBoardReportingCandidateHumanFinalReleaseAuthorityInput } = __boardReportingCandidateHumanFinalReleaseAuthorityServiceTestables;
  assert.equal(isRecordBoardReportingCandidateHumanFinalReleaseAuthorityInput(authorityInput()), true);
  for (const extraKey of ["requestedAudience", "canonicalFingerprint", "members", "memberCount", "effective", "manifestId"]) {
    assert.equal(
      isRecordBoardReportingCandidateHumanFinalReleaseAuthorityInput({ ...authorityInput(), [extraKey]: "x" }),
      false,
      `${extraKey} must be rejected`,
    );
  }
  assert.equal(isRecordBoardReportingCandidateHumanFinalReleaseAuthorityInput(authorityInput({ decisionAction: "approve" })), false);
});

test("gk_admin can grant the exact candidate once its review is resolved", async () => {
  const repository = {
    calls: [],
    async recordDecision(input) {
      this.calls.push(input);
      return {
        ok: true,
        data: {
          decisionId: "00000000-0000-4000-8000-000000000901",
          boardReportingCandidateId: input.boardReportingCandidateId,
          decisionType: "export_authority_granted",
          decisionAction: "grant",
          supersedesDecisionId: null,
          decidedByRole: "gk_admin",
          effective: true,
          effectivenessReason: null,
          headDecisionId: "00000000-0000-4000-8000-000000000901",
          replayed: false,
        },
        error: null,
      };
    },
  };
  const audit = auditRecorder();
  const result = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(authorityInput(), {
    env: enabledEnv,
    boardReportingCandidateHumanAuthorityDecisionRepository: repository,
    metadataOnlyAudit: audit,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.boardReportingCandidateId, CANDIDATE);
  assert.equal(result.data.decisionAction, "grant");
  assert.equal(result.data.effective, true);
  assert.equal(result.data.replayed, false);
  assert.equal("finalGate" in result.data, false);
  assert.equal("manifest" in result.data, false);
  assert.equal(repository.calls.length, 1);
  assert.equal(repository.calls[0].decisionType, "export_authority_granted");
  assert.equal(repository.calls[0].reviewQueueItemId, REVIEW_QUEUE_ITEM);
});

test("gk_admin can revoke the exact candidate", async () => {
  const repository = {
    async recordDecision(input) {
      return {
        ok: true,
        data: {
          decisionId: "00000000-0000-4000-8000-000000000902",
          boardReportingCandidateId: input.boardReportingCandidateId,
          decisionType: "export_authority_granted",
          decisionAction: "revoke",
          supersedesDecisionId: "00000000-0000-4000-8000-000000000901",
          decidedByRole: "gk_admin",
          effective: false,
          effectivenessReason: "head_is_revoke",
          headDecisionId: "00000000-0000-4000-8000-000000000902",
          replayed: false,
        },
        error: null,
      };
    },
  };
  const result = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(authorityInput({ decisionAction: "revoke" }), {
    env: enabledEnv,
    boardReportingCandidateHumanAuthorityDecisionRepository: repository,
    metadataOnlyAudit: auditRecorder(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.decisionAction, "revoke");
  assert.equal(result.data.effective, false);
  assert.equal(result.data.effectivenessReason, "head_is_revoke");
});

test("unauthorized human (gk_reviewer), assistant/system actor, and cross-tenant actor all fail closed before any repository call", async () => {
  let repositoryCalls = 0;
  const repository = { async recordDecision() { repositoryCalls += 1; return { ok: true, data: {}, error: null }; } };
  const deps = { env: enabledEnv, boardReportingCandidateHumanAuthorityDecisionRepository: repository, metadataOnlyAudit: auditRecorder() };

  const reviewerResult = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
    authorityInput({ actorContext: gkReviewerActorContext }), deps,
  );
  assert.equal(reviewerResult.ok, false);
  assert.equal(reviewerResult.error.code, "authorization_denied");

  const systemResult = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
    authorityInput({ actorContext: { actorType: "system", actorUserId: ACTOR } }), deps,
  );
  assert.equal(systemResult.ok, false);
  assert.equal(systemResult.error.code, "authorization_denied");

  const tenantResult = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
    authorityInput({ organizationId: OTHER_ORG }), deps,
  );
  assert.equal(tenantResult.ok, false);
  assert.equal(tenantResult.error.code, "authorization_denied");

  assert.equal(repositoryCalls, 0);
});

test("a failed grant attempt (repository rejects) produces no successful-authority audit row and the service surfaces the failure verbatim", async () => {
  const repository = {
    async recordDecision() {
      return { ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409 } };
    },
  };
  const audit = auditRecorder();
  const result = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(authorityInput(), {
    env: enabledEnv,
    boardReportingCandidateHumanAuthorityDecisionRepository: repository,
    metadataOnlyAudit: audit,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(audit.calls.length, 0);
});

test("same-action replay converges: a repeated grant reports replayed:true and creates no new row", async () => {
  const repository = {
    calls: 0,
    async recordDecision(input) {
      this.calls += 1;
      return {
        ok: true,
        data: {
          decisionId: "00000000-0000-4000-8000-000000000901",
          boardReportingCandidateId: input.boardReportingCandidateId,
          decisionType: "export_authority_granted",
          decisionAction: "grant",
          supersedesDecisionId: null,
          decidedByRole: "gk_admin",
          effective: true,
          effectivenessReason: null,
          headDecisionId: "00000000-0000-4000-8000-000000000901",
          replayed: true,
        },
        error: null,
      };
    },
  };
  const result = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(authorityInput(), {
    env: enabledEnv,
    boardReportingCandidateHumanAuthorityDecisionRepository: repository,
    metadataOnlyAudit: auditRecorder(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, true);
  assert.equal(repository.calls, 1);
});

test("the service is metadata-only: it never returns or references a manifest/bytes identity", async () => {
  const repository = {
    async recordDecision(input) {
      return {
        ok: true,
        data: {
          decisionId: "00000000-0000-4000-8000-000000000901",
          boardReportingCandidateId: input.boardReportingCandidateId,
          decisionType: "export_authority_granted",
          decisionAction: "grant",
          supersedesDecisionId: null,
          decidedByRole: "gk_admin",
          effective: true,
          effectivenessReason: null,
          headDecisionId: "00000000-0000-4000-8000-000000000901",
          replayed: false,
        },
        error: null,
      };
    },
  };
  const result = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(authorityInput(), {
    env: enabledEnv,
    boardReportingCandidateHumanAuthorityDecisionRepository: repository,
    metadataOnlyAudit: auditRecorder(),
  });
  for (const key of Object.keys(result.data)) {
    assert.doesNotMatch(key, /manifest|bytes|artifact/i);
  }
});

// --- route ---

test("BR-04 route delegates successfully and preserves service-only API composition", async (t) => {
  let scenario = { authenticated: true, actorContext: gkAdminActorContext, serviceCalls: [], dependencyCalls: [] };
  const restoreFeatureFlag = (() => {
    const original = process.env.KAI_SPRINT2_ENABLED;
    process.env.KAI_SPRINT2_ENABLED = "true";
    return () => {
      if (original === undefined) delete process.env.KAI_SPRINT2_ENABLED;
      else process.env.KAI_SPRINT2_ENABLED = original;
    };
  })();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(input, dependencies) {
      scenario.serviceCalls.push(input);
      scenario.dependencyCalls.push(dependencies);
      return {
        ok: true,
        data: {
          boardReportingCandidateId: input.boardReportingCandidateId,
          decisionType: "export_authority_granted",
          decisionAction: input.decisionAction,
          effective: true,
          effectivenessReason: null,
          replayed: false,
        },
        error: null,
      };
    },
  });
  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, (req, res, next) => {
    req.isAuthenticated = () => scenario.authenticated;
    if (scenario.authenticated) {
      req.user = { id: 46 };
      req.kaiSprint2ActorContext = scenario.actorContext;
    }
    next();
  });
  app.use(
    basePath,
    requireKaiSprint2Enabled,
    kaiSprint2OrganizationMutationLimiter,
    kaiSprint2ActorMutationLimiter,
    requireKaiSprint2Authenticated,
    sprint2IntakeApiRouter,
  );
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1");
    listener.once("listening", () => resolve(listener));
    listener.once("error", reject);
  });
  t.after(async () => {
    restoreService();
    restoreFeatureFlag();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  async function requestJson(path, body) {
    const { port } = server.address();
    const serialized = JSON.stringify(body);
    return await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(serialized) },
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({
          statusCode: response.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        }));
      });
      request.on("error", reject);
      request.write(serialized);
      request.end();
    });
  }

  const path = `${basePath}/admin/organizations/${ORG}/engagements/${ENGAGEMENT}/board-reporting/candidates/${CANDIDATE}/final-release-authority`;
  const before = Date.now();
  const response = await requestJson(path, { review_queue_item_id: REVIEW_QUEUE_ITEM, decision_action: "grant" });
  const after = Date.now();
  assert.equal(response.statusCode, 201);
  assert.equal(scenario.serviceCalls.length, 1);
  assert.deepEqual(scenario.serviceCalls[0], {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    boardReportingCandidateId: CANDIDATE,
    reviewQueueItemId: REVIEW_QUEUE_ITEM,
    decisionAction: "grant",
    actorContext: gkAdminActorContext,
    now: scenario.serviceCalls[0].now,
  });
  assert.equal(typeof scenario.dependencyCalls[0].metadataOnlyAudit?.prepareMetadataOnlyAudit, "function");
  assert.equal(response.body.data.effective, true);
  assert.equal("requestedAudience" in scenario.serviceCalls[0], false);
  const nowMs = new Date(scenario.serviceCalls[0].now).getTime();
  assert.ok(nowMs >= before && nowMs <= after);

  // requested_audience is refused outright (a Board Reporting candidate's
  // audience is always exactly "internal") - never silently ignored.
  scenario = { authenticated: true, actorContext: gkAdminActorContext, serviceCalls: [], dependencyCalls: [] };
  const withAudience = await requestJson(path, {
    review_queue_item_id: REVIEW_QUEUE_ITEM,
    decision_action: "grant",
    requested_audience: "internal",
  });
  assert.equal(withAudience.statusCode, 422);
  assert.equal(withAudience.body.error.code, "validation_blocker");
  assert.deepEqual(scenario.serviceCalls, []);

  // A missing review_queue_item_id is refused at the request-schema layer.
  scenario = { authenticated: true, actorContext: gkAdminActorContext, serviceCalls: [], dependencyCalls: [] };
  const missingReviewQueueItem = await requestJson(path, { decision_action: "grant" });
  assert.equal(missingReviewQueueItem.statusCode, 422);
  assert.equal(missingReviewQueueItem.body.error.code, "validation_blocker");
  assert.deepEqual(scenario.serviceCalls, []);

  scenario = { authenticated: false, actorContext: gkAdminActorContext, serviceCalls: [], dependencyCalls: [] };
  const unauthorized = await requestJson(path, { review_queue_item_id: REVIEW_QUEUE_ITEM, decision_action: "grant" });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.body.error.code, "unauthorized");
  assert.deepEqual(scenario.serviceCalls, []);
});

test("BR-04 route and service sources do not wire finalGate, VAL-EXP-001, artifact, manifest, or finalization behavior, and contain no raw SQL", () => {
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const serviceSource = readFileSync("Backend/kai/services/kaiBoardReportingCandidateHumanFinalReleaseAuthorityService.js", "utf8");
  const routeStart = routeSource.indexOf(
    '"/admin/organizations/:organizationId/engagements/:engagementId/board-reporting/candidates/:boardReportingCandidateId/final-release-authority"',
  );
  assert.notEqual(routeStart, -1);
  const routeEnd = routeSource.indexOf("function boardReportingCandidateReviewQueueIdentifier", routeStart);
  assert.notEqual(routeEnd, -1);
  const routeSlice = routeSource.slice(routeStart, routeEnd);

  assert.match(routeSlice, /service\.recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision/);
  assert.doesNotMatch(routeSlice, /\b(?:SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b|\bpool\b|\bkaiDb\b|\brepository\b|\bkai\.(?!js\b)/i);
  for (const source of [routeSlice, serviceSource]) {
    assert.doesNotMatch(source, /finalGate\s*:\s*true|final_gate\s*=\s*true|export_manifests|export_artifacts|createWriteStream|writeFileSync|writeFile|finalizeExport|finalization_status/i);
  }
});

test("BR-04 route is mounted exactly once", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === routePath && layer.route?.methods?.post);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["post"]);
});
