import test from "node:test";
import assert from "node:assert/strict";

import {
  completeClientFollowup,
  __clientFollowupCompletionServiceContract,
} from "../Backend/kai/services/kaiClientFollowupCompletionService.js";
import { createPostgresClientFollowupCompletionRepository } from "../Backend/kai/dictionary/postgresClientFollowupCompletionRepository.js";
import { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { validateCompleteClientFollowupRequest } from "../Backend/kai/validators/kaiSprint2RequestSchemas.js";

const { clientFollowupCompletionIdentifiers, validateClientFollowupCompletionRequestOrSend } = intakeRouteTestables;

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000009";
const CLAIM = "00000000-0000-4000-8000-000000000003";
const FOLLOWUP = "00000000-0000-4000-8000-000000000005";
const NOW = "2026-08-15T10:00:00.000Z";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });

const clientReviewerActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_reviewer" }],
});
const gkReviewerActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000002",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
});
const clientAdminActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000003",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_admin" }],
});
const clientContributorActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000004",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_contributor" }],
});
const aiActor = Object.freeze({
  actorType: "ai",
  actorUserId: "90000000-0000-4000-8000-000000000005",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_reviewer" }],
});

function stubMetadataOnlyAudit(options = {}) {
  const calls = [];
  return {
    calls,
    prepareMetadataOnlyAudit({ payload }) {
      calls.push({ type: "prepare", payload });
      return {
        ok: true,
        async publish() {
          calls.push({ type: "publish" });
          if (options.rejectPublish) throw new Error("forced publish failure");
        },
      };
    },
  };
}

test("P2-11 allowed role is client_reviewer only - never gk_reviewer, client_admin, client_contributor, system, assistant, import, or code actors", () => {
  assert.deepEqual(
    [...__clientFollowupCompletionServiceContract.COMPLETE_CLIENT_FOLLOWUP_ALLOWED_ROLES],
    ["client_reviewer"],
  );
});

test("P2-11 service rejects a non-human actor before any repository call", async () => {
  const result = await completeClientFollowup(
    { organizationId: ORG, claimId: CLAIM, clientFollowupItemId: FOLLOWUP, expectedUpdatedAt: NOW, actorContext: aiActor, now: NOW },
    { env: enabledEnv, clientFollowupCompletionRepository: { async completeClientFollowup() { throw new Error("must not be called"); } } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-11 service rejects gk_reviewer before any repository call - a GK role is never a client-reviewer", async () => {
  const result = await completeClientFollowup(
    { organizationId: ORG, claimId: CLAIM, clientFollowupItemId: FOLLOWUP, expectedUpdatedAt: NOW, actorContext: gkReviewerActor, now: NOW },
    { env: enabledEnv, clientFollowupCompletionRepository: { async completeClientFollowup() { throw new Error("must not be called"); } } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-11 service rejects client_admin before any repository call - only client_reviewer is authorized, never broadened by analogy", async () => {
  const result = await completeClientFollowup(
    { organizationId: ORG, claimId: CLAIM, clientFollowupItemId: FOLLOWUP, expectedUpdatedAt: NOW, actorContext: clientAdminActor, now: NOW },
    { env: enabledEnv, clientFollowupCompletionRepository: { async completeClientFollowup() { throw new Error("must not be called"); } } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-11 service rejects client_contributor before any repository call", async () => {
  const result = await completeClientFollowup(
    { organizationId: ORG, claimId: CLAIM, clientFollowupItemId: FOLLOWUP, expectedUpdatedAt: NOW, actorContext: clientContributorActor, now: NOW },
    { env: enabledEnv, clientFollowupCompletionRepository: { async completeClientFollowup() { throw new Error("must not be called"); } } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-11 service rejects a wrong-tenant actor before any repository call", async () => {
  const result = await completeClientFollowup(
    { organizationId: OTHER_ORG, claimId: CLAIM, clientFollowupItemId: FOLLOWUP, expectedUpdatedAt: NOW, actorContext: clientReviewerActor, now: NOW },
    { env: enabledEnv, clientFollowupCompletionRepository: { async completeClientFollowup() { throw new Error("must not be called"); } } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P2-11 KAI_SPRINT2_ENABLED=false yields feature_disabled with zero repository calls", async () => {
  const result = await completeClientFollowup(
    { organizationId: ORG, claimId: CLAIM, clientFollowupItemId: FOLLOWUP, expectedUpdatedAt: NOW, actorContext: clientReviewerActor, now: NOW },
    { env: { KAI_SPRINT2_ENABLED: "false" }, clientFollowupCompletionRepository: { async completeClientFollowup() { throw new Error("must not be called"); } } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
});

test("P2-11 service delegates to the injected repository exactly once, with the server-controlled client_reviewer role - never a caller-supplied role, and carries no answer/free-text field", async () => {
  const calls = [];
  const result = await completeClientFollowup(
    { organizationId: ORG, claimId: CLAIM, clientFollowupItemId: FOLLOWUP, expectedUpdatedAt: NOW, actorContext: clientReviewerActor, now: NOW },
    {
      env: enabledEnv,
      clientFollowupCompletionRepository: {
        async completeClientFollowup(input) {
          calls.push(input);
          return { ok: true, data: { replayed: false }, error: null };
        },
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].organizationId, ORG);
  assert.equal(calls[0].claimId, CLAIM);
  assert.equal(calls[0].clientFollowupItemId, FOLLOWUP);
  assert.equal(calls[0].actorRole, "client_reviewer");
  assert.equal(calls[0].actorUserId, clientReviewerActor.actorUserId);
  assert.deepEqual(
    Object.keys(calls[0]).sort(),
    ["actorRole", "actorUserId", "claimId", "clientFollowupItemId", "expectedUpdatedAt", "metadataOnlyAudit", "now", "organizationId"],
  );
});

test("P2-11 route identifiers accept only canonical-lowercase UUIDs", () => {
  const validReq = { params: { organizationId: ORG, claimId: CLAIM, clientFollowupItemId: FOLLOWUP } };
  assert.deepEqual(clientFollowupCompletionIdentifiers(validReq), {
    organizationId: ORG,
    claimId: CLAIM,
    clientFollowupItemId: FOLLOWUP,
  });
  const mixedCase = "00000000-0000-4000-8000-00000000000A";
  assert.equal(clientFollowupCompletionIdentifiers({ params: { organizationId: ORG, claimId: CLAIM, clientFollowupItemId: mixedCase } }), null);
  assert.equal(clientFollowupCompletionIdentifiers({ params: { organizationId: ORG, claimId: CLAIM } }), null);
});

test("P2-11 route rejects a request body carrying any field beyond expected_updated_at (no answer/free-text field is ever accepted)", () => {
  const req = {
    params: { organizationId: ORG, claimId: CLAIM, clientFollowupItemId: FOLLOWUP },
    body: { expected_updated_at: NOW, answer: "the denominator is total enrolled students" },
    get() { return "application/json"; },
  };
  const calls = [];
  const res = { status(code) { calls.push(code); return this; }, json() { return this; } };
  const identifiers = validateClientFollowupCompletionRequestOrSend(req, res);
  assert.equal(identifiers, null);
  assert.equal(calls[0], 422);
});

test("P2-11 validateCompleteClientFollowupRequest requires exactly expected_updated_at and nothing else", () => {
  assert.equal(validateCompleteClientFollowupRequest({ expected_updated_at: NOW }).ok, true);
  assert.equal(validateCompleteClientFollowupRequest({}).ok, false);
  assert.equal(validateCompleteClientFollowupRequest({ expected_updated_at: NOW, answer: "x" }).ok, false);
  assert.equal(validateCompleteClientFollowupRequest({ expected_updated_at: "not-a-date" }).ok, false);
});

function fakeTx(overrides = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM kai\.client_followup_items/.test(sql)) {
        return { rows: overrides.followupRows !== undefined ? overrides.followupRows : [{
          client_followup_item_id: FOLLOWUP,
          organization_id: ORG,
          claim_id: CLAIM,
          gap_log_item_id: "gap-1",
          dimension_key: "denominator_clarity",
        }] };
      }
      if (/FROM kai\.gap_log_items/.test(sql)) {
        return { rows: overrides.gapRows !== undefined ? overrides.gapRows : [{
          gap_log_item_id: "gap-1",
          organization_id: ORG,
          claim_id: CLAIM,
          evidence_item_id: "evidence-1",
          dimension_key: "denominator_clarity",
        }] };
      }
      if (/FROM kai\.evidence_items/.test(sql)) {
        return { rows: overrides.evidenceRows !== undefined ? overrides.evidenceRows : [{
          evidence_item_id: "evidence-1",
          organization_id: ORG,
          source_locator_id: "locator-1",
          source_id: "source-1",
          source_version_id: "sv-1",
        }] };
      }
      if (/FROM kai\.source_locators/.test(sql)) {
        return { rows: [{ source_locator_id: "locator-1", organization_id: ORG, source_version_id: "sv-1" }] };
      }
      if (/FROM kai\.sources/.test(sql)) {
        return { rows: [{ source_id: "source-1", organization_id: ORG }] };
      }
      if (/FROM kai\.source_versions/.test(sql)) {
        return { rows: [{ source_version_id: "sv-1", organization_id: ORG, intake_source_candidate_id: "cand-1" }] };
      }
      if (/FROM kai\.intake_source_candidates/.test(sql)) {
        return { rows: [{ intake_source_candidate_id: "cand-1", organization_id: ORG, intake_file_id: "file-1" }] };
      }
      if (/FROM kai\.intake_files/.test(sql)) {
        return { rows: overrides.intakeFileRows !== undefined ? overrides.intakeFileRows : [{ upload_state: "confirmed" }] };
      }
      if (/UPDATE kai\.review_queue_items/.test(sql)) {
        return { rows: overrides.updateRows !== undefined ? overrides.updateRows : [{
          review_queue_item_id: "rq-1",
          organization_id: ORG,
          queue_type: "client_followup",
          target_object_type: "client_followup_item",
          target_object_id: FOLLOWUP,
          queue_status: "resolved",
          review_status: "resolved",
          updated_at: new Date(NOW),
        }] };
      }
      if (/FROM kai\.review_queue_items/.test(sql)) {
        return { rows: overrides.rereadRows !== undefined ? overrides.rereadRows : [] };
      }
      if (/INSERT INTO kai\.upload_lifecycle_audit/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
}

test("P2-11 repository returns not_found when the client_followup_item is absent for this organization/claim", async () => {
  const repo = createPostgresClientFollowupCompletionRepository({ runInTransaction: (cb) => cb(fakeTx({ followupRows: [] })) });
  const result = await repo.completeClientFollowup({
    organizationId: ORG, claimId: CLAIM, clientFollowupItemId: FOLLOWUP, expectedUpdatedAt: NOW,
    actorUserId: clientReviewerActor.actorUserId, actorRole: "client_reviewer", now: NOW,
    metadataOnlyAudit: stubMetadataOnlyAudit(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("P2-11 repository returns conflict_current_state_changed when the linked gap row's claim/dimension no longer matches", async () => {
  const repo = createPostgresClientFollowupCompletionRepository({
    runInTransaction: (cb) => cb(fakeTx({ gapRows: [{ gap_log_item_id: "gap-1", organization_id: ORG, claim_id: CLAIM, evidence_item_id: "evidence-1", dimension_key: "time_period_clarity" }] })),
  });
  const result = await repo.completeClientFollowup({
    organizationId: ORG, claimId: CLAIM, clientFollowupItemId: FOLLOWUP, expectedUpdatedAt: NOW,
    actorUserId: clientReviewerActor.actorUserId, actorRole: "client_reviewer", now: NOW,
    metadataOnlyAudit: stubMetadataOnlyAudit(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P2-11 repository succeeds, writes the required same-transaction audit, and reports replayed:false on a fresh compare-and-set", async () => {
  const audit = stubMetadataOnlyAudit();
  const repo = createPostgresClientFollowupCompletionRepository({ runInTransaction: (cb) => cb(fakeTx()) });
  const result = await repo.completeClientFollowup({
    organizationId: ORG, claimId: CLAIM, clientFollowupItemId: FOLLOWUP, expectedUpdatedAt: NOW,
    actorUserId: clientReviewerActor.actorUserId, actorRole: "client_reviewer", now: NOW,
    metadataOnlyAudit: audit,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, false);
  assert.equal(result.data.queue_status, "resolved");
  assert.equal(result.data.review_status, "resolved");
  assert.equal(result.data.disposition, "no_additional_client_information");
  assert.equal(audit.calls.filter((call) => call.type === "publish").length, 1);
});

test("P2-11 repository treats a no-op compare-and-set against an already-resolved row as an exact replay - rereads and publishes no second audit", async () => {
  const audit = stubMetadataOnlyAudit();
  const repo = createPostgresClientFollowupCompletionRepository({
    runInTransaction: (cb) => cb(fakeTx({
      updateRows: [],
      rereadRows: [{
        review_queue_item_id: "rq-1", organization_id: ORG, queue_type: "client_followup",
        target_object_type: "client_followup_item", target_object_id: FOLLOWUP,
        queue_status: "resolved", review_status: "resolved", updated_at: new Date(NOW),
      }],
    })),
  });
  const result = await repo.completeClientFollowup({
    organizationId: ORG, claimId: CLAIM, clientFollowupItemId: FOLLOWUP, expectedUpdatedAt: NOW,
    actorUserId: clientReviewerActor.actorUserId, actorRole: "client_reviewer", now: NOW,
    metadataOnlyAudit: audit,
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, true);
  assert.equal(audit.calls.length, 0);
});

test("P2-11 repository fails closed (conflict_current_state_changed) on a stale expected_updated_at against a still-fresh, unresolved row", async () => {
  const repo = createPostgresClientFollowupCompletionRepository({
    runInTransaction: (cb) => cb(fakeTx({
      updateRows: [],
      rereadRows: [{
        review_queue_item_id: "rq-1", organization_id: ORG, queue_type: "client_followup",
        target_object_type: "client_followup_item", target_object_id: FOLLOWUP,
        queue_status: "waiting_on_client", review_status: "proposed", updated_at: new Date(NOW),
      }],
    })),
  });
  const result = await repo.completeClientFollowup({
    organizationId: ORG, claimId: CLAIM, clientFollowupItemId: FOLLOWUP, expectedUpdatedAt: NOW,
    actorUserId: clientReviewerActor.actorUserId, actorRole: "client_reviewer", now: NOW,
    metadataOnlyAudit: stubMetadataOnlyAudit(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P2-11 repository rolls back (fails closed) when the required audit is rejected - zero orphaned mutation", async () => {
  const tx = fakeTx();
  const repo = createPostgresClientFollowupCompletionRepository({ runInTransaction: (cb) => cb(tx) });
  const result = await repo.completeClientFollowup({
    organizationId: ORG, claimId: CLAIM, clientFollowupItemId: FOLLOWUP, expectedUpdatedAt: NOW,
    actorUserId: clientReviewerActor.actorUserId, actorRole: "client_reviewer", now: NOW,
    metadataOnlyAudit: { prepareMetadataOnlyAudit() { return { ok: false }; } },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});
