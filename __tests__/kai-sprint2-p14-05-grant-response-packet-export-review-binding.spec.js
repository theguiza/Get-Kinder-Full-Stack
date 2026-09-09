// P14-05: proves the new packet-level export-review binding that lets the
// existing, immutable P14-03 grant-response-packet export candidate enter
// the one existing governed 'export_review' queue_type/lifecycle (the same
// review_queue_items contract the single-draft P3-05/P3-09/P3-13 workflow
// already uses), after the P14-05 migration widens the queue's CHECK
// contract to admit a grant_response_packet_export_candidate target
// alongside the existing generated_content_draft target unchanged.
//
// This suite fakes the transactional SQL layer (the widened schema contract
// itself is proven against a real synthetic local PostgreSQL by
// scripts/kai-sprint2-p14-05-grant-response-packet-export-review-binding-local-postgres.js,
// never reopened here) and instead proves what P14-05's application layer
// actually adds: exact-keys input contract, server-side candidate/tenant/
// engagement resolution, insert-vs-replay convergence, invalid-existing-row
// fail-closed, the gk_admin-only role boundary, tenant boundary, and that no
// approval/final-release/manifest state is ever created.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createPostgresGrantResponsePacketExportCandidateRepository } from "../Backend/kai/dictionary/postgresGrantResponsePacketExportCandidateRepository.js";
import {
  requestGrantResponsePacketExportReview,
  __grantResponsePacketExportReviewServiceContract,
  __grantResponsePacketExportReviewServiceTestables,
} from "../Backend/kai/services/kaiGrantResponsePacketExportReviewService.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "14050000-0000-4000-8000-000000000001";
const OTHER_ENGAGEMENT = "14050000-0000-4000-8000-000000000002";
const CANDIDATE = "14050000-0000-4000-8000-0000000000c1";
const NONEXISTENT_CANDIDATE = "14050000-0000-4000-8000-0000000000ff";
const QUEUE_ITEM = "14050000-0000-4000-8000-0000000000q1";
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
    grantResponsePacketExportCandidateId: CANDIDATE,
    actorContext: gkAdminActorContext,
    now: NOW,
    ...overrides,
  };
}

// A minimal fake `tx` proving the repository's own SQL shape without a real
// database: recognizes the exact queries the repository issues by a
// distinguishing substring and returns canned rows.
function makeFakeTx({ candidateExists = true, candidateEngagementId = ENGAGEMENT, existingQueueRow = null } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("FROM kai.grant_response_packet_export_candidates c")) {
        if (!candidateExists) return { rows: [] };
        return {
          rows: [{
            grant_response_packet_export_candidate_id: params[1],
            organization_id: params[0],
            engagement_id: candidateEngagementId,
          }],
        };
      }
      if (sql.includes("INSERT INTO kai.review_queue_items")) {
        if (existingQueueRow) return { rows: [] }; // ON CONFLICT DO NOTHING
        return {
          rows: [{
            review_queue_item_id: QUEUE_ITEM,
            queue_status: "open",
            review_status: "needs_gk_review",
            updated_at: NOW,
          }],
        };
      }
      if (sql.includes("SELECT review_queue_item_id::text AS review_queue_item_id, organization_id::text AS organization_id")) {
        return { rows: existingQueueRow ? [existingQueueRow] : [] };
      }
      throw new Error(`unexpected query in fake tx: ${sql}`);
    },
  };
}

function validQueueRow(overrides = {}) {
  return {
    review_queue_item_id: QUEUE_ITEM,
    organization_id: ORG,
    queue_type: "export_review",
    target_object_type: "grant_response_packet_export_candidate",
    target_object_id: CANDIDATE,
    priority: "medium",
    queue_status: "open",
    review_status: "needs_gk_review",
    summary: "Grant Response Packet export candidate requires export review.",
    required_action: "Review packet membership, funder audience, and export authority before any export.",
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

function deps(overrides = {}) {
  return {
    env: enabledEnv,
    metadataOnlyAudit: auditRecorder(),
    ...overrides,
  };
}

test("P14-05 service exact-keys input contract rejects every client-supplied composition/authority field", async () => {
  const forbiddenVariants = [
    { members: ["x"] },
    { generatedContentDraftIds: ["x"] },
    { canonicalFingerprint: "a".repeat(64) },
    { memberCount: 3 },
    { packetAudience: "funder" },
    { exportManifestId: "14050000-0000-4000-8000-0000000000aa" },
    { approved: true },
    { decisionAction: "approve" },
  ];
  for (const extra of forbiddenVariants) {
    const result = await requestGrantResponsePacketExportReview(requestInput(extra), deps());
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
  }
});

test("P14-05 service isRequestGrantResponsePacketExportReviewInput exact-keys testable rejects extra/missing keys", () => {
  const { isRequestGrantResponsePacketExportReviewInput } = __grantResponsePacketExportReviewServiceTestables;
  assert.equal(isRequestGrantResponsePacketExportReviewInput(requestInput()), true);
  assert.equal(isRequestGrantResponsePacketExportReviewInput(requestInput({ extraField: "x" })), false);
  const { organizationId, ...missingOrg } = requestInput();
  assert.equal(isRequestGrantResponsePacketExportReviewInput(missingOrg), false);
});

test("P14-05 service reuses the gk_admin-only export-candidate role boundary", async () => {
  const repository = {
    async requestGrantResponsePacketExportReview() {
      throw new Error("repository must not be called when authorization fails");
    },
  };
  const reviewer = await requestGrantResponsePacketExportReview(
    requestInput({ actorContext: gkReviewerActorContext }),
    deps({ grantResponsePacketExportCandidateRepository: repository }),
  );
  assert.equal(reviewer.ok, false);
  assert.equal(reviewer.error.code, "authorization_denied");

  const system = await requestGrantResponsePacketExportReview(
    requestInput({ actorContext: systemActorContext }),
    deps({ grantResponsePacketExportCandidateRepository: repository }),
  );
  assert.equal(system.ok, false);
  assert.equal(system.error.code, "authorization_denied");

  assert.deepEqual([...__grantResponsePacketExportReviewServiceContract.REQUEST_GRANT_RESPONSE_PACKET_EXPORT_REVIEW_ROLES], ["gk_admin"]);
});

test("P14-05 service rejects a cross-tenant actor requesting review against an organization they do not belong to", async () => {
  const repository = {
    async requestGrantResponsePacketExportReview() {
      throw new Error("repository must not be called when the actor is not a member of the target organization");
    },
  };
  const result = await requestGrantResponsePacketExportReview(
    requestInput({ actorContext: otherOrgAdminActorContext }),
    deps({ grantResponsePacketExportCandidateRepository: repository }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P14-05 service reaches the repository for a tenant-matched gk_admin actor (tenant boundary check does not itself block the legitimate path)", async () => {
  const repository = {
    calls: 0,
    async requestGrantResponsePacketExportReview(input) {
      this.calls += 1;
      return {
        ok: true,
        data: {
          organizationId: input.organizationId,
          engagementId: input.engagementId,
          grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
          reviewQueueItemId: QUEUE_ITEM,
          queueStatus: "open",
          reviewStatus: "needs_gk_review",
          replayed: false,
        },
        error: null,
      };
    },
  };
  const result = await requestGrantResponsePacketExportReview(requestInput(), deps({ grantResponsePacketExportCandidateRepository: repository }));
  assert.equal(result.ok, true);
  assert.equal(repository.calls, 1);
});

test("P14-05 service is feature-flag gated", async () => {
  const result = await requestGrantResponsePacketExportReview(requestInput(), deps({ env: { KAI_SPRINT2_ENABLED: "false" } }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
});

test("P14-05 service propagates a real successful repository result end to end", async () => {
  const repository = {
    calls: [],
    async requestGrantResponsePacketExportReview(input, dependencies) {
      this.calls.push({ input, dependencies });
      return {
        ok: true,
        data: {
          organizationId: input.organizationId,
          engagementId: input.engagementId,
          grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
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
  const result = await requestGrantResponsePacketExportReview(requestInput(), deps({ grantResponsePacketExportCandidateRepository: repository }));
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.data).sort(), [
    "engagementId",
    "grantResponsePacketExportCandidateId",
    "organizationId",
    "queueStatus",
    "replayed",
    "reviewQueueItemId",
    "reviewStatus",
    "reviewUpdatedAt",
  ].sort());
  assert.equal(result.data.reviewQueueItemId, QUEUE_ITEM);
  assert.equal(result.data.replayed, false);
  assert.equal(result.data.reviewUpdatedAt, NOW);
});

// --- Repository-layer proofs (real production repository, fake tx) ---

test("P14-05 repository fails not_found for a nonexistent candidate", async () => {
  const repository = createPostgresGrantResponsePacketExportCandidateRepository({
    runInTransaction: async (fn) => fn(makeFakeTx({ candidateExists: false })),
  });
  const result = await repository.requestGrantResponsePacketExportReview(
    requestInput({ grantResponsePacketExportCandidateId: NONEXISTENT_CANDIDATE }),
    { metadataOnlyAudit: auditRecorder() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("P14-05 repository fails not_found for a candidate belonging to a different engagement", async () => {
  const repository = createPostgresGrantResponsePacketExportCandidateRepository({
    runInTransaction: async (fn) => fn(makeFakeTx({ candidateEngagementId: OTHER_ENGAGEMENT })),
  });
  const result = await repository.requestGrantResponsePacketExportReview(requestInput(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("P14-05 repository creates a new review-queue row and publishes exactly one metadata-only audit on first request", async () => {
  const audit = auditRecorder();
  const tx = makeFakeTx({});
  const repository = createPostgresGrantResponsePacketExportCandidateRepository({
    runInTransaction: async (fn) => fn(tx),
  });
  const result = await repository.requestGrantResponsePacketExportReview(requestInput(), { metadataOnlyAudit: audit });
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, false);
  assert.equal(result.data.reviewQueueItemId, QUEUE_ITEM);
  assert.equal(result.data.queueStatus, "open");
  assert.equal(result.data.reviewStatus, "needs_gk_review");
  // Frontend contract-defect fix: the exact CAS token a caller must echo
  // back as expectedUpdatedAt on the next START call.
  assert.equal(result.data.reviewUpdatedAt, NOW);
  assert.equal(audit.calls.length, 1);
  assert.equal(audit.calls[0].payload.grant_response_packet_export_candidate_id, CANDIDATE);
  assert.equal(audit.calls[0].payload.attempted_operation, "grant_response_packet_export_review_requested");
});

test("P14-05 repository replays a valid existing review-queue row without publishing a second audit", async () => {
  const audit = auditRecorder();
  const tx = makeFakeTx({ existingQueueRow: validQueueRow({ queue_status: "in_progress" }) });
  const repository = createPostgresGrantResponsePacketExportCandidateRepository({
    runInTransaction: async (fn) => fn(tx),
  });
  const result = await repository.requestGrantResponsePacketExportReview(requestInput(), { metadataOnlyAudit: audit });
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, true);
  assert.equal(result.data.queueStatus, "in_progress");
  assert.equal(audit.calls.length, 0);
});

test("P14-05 repository fails closed if an existing row no longer matches the packet static contract", async () => {
  const tx = makeFakeTx({ existingQueueRow: validQueueRow({ summary: "tampered" }) });
  const repository = createPostgresGrantResponsePacketExportCandidateRepository({
    runInTransaction: async (fn) => fn(tx),
  });
  const result = await repository.requestGrantResponsePacketExportReview(requestInput(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P14-05 repository requires an exact-keys input", async () => {
  const repository = createPostgresGrantResponsePacketExportCandidateRepository({
    runInTransaction: async () => {
      throw new Error("runInTransaction must not be called for a malformed input");
    },
  });
  const result = await repository.requestGrantResponsePacketExportReview(
    { ...requestInput(), extraField: "x" },
    { metadataOnlyAudit: auditRecorder() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

// --- Route/no-SQL boundary proofs ---

test("P14-05 route contains no SQL and no direct kai.* database access", () => {
  const source = readFileSync(new URL("../Backend/kai/routes/sprint2IntakeApi.js", import.meta.url), "utf8");
  const startMarker = "/admin/organizations/:organizationId/engagements/:engagementId/grant-response-packet/export-candidates/:grantResponsePacketExportCandidateId/export-review-request";
  const startIndex = source.indexOf(startMarker);
  assert.ok(startIndex >= 0, "P14-05 export-review-request route path must be present");
  const routeStart = source.lastIndexOf("router.post(", startIndex);
  const routeEnd = source.indexOf("\n);\n", startIndex) + 4;
  const routeSource = source.slice(routeStart, routeEnd);
  assert.doesNotMatch(routeSource, /\bkai\.\w+/, "route must not reference any kai.* table directly");
  assert.doesNotMatch(routeSource, /\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i, "route must contain no SQL");
  assert.match(routeSource, /getGrantResponsePacketExportReviewService/, "route must delegate through the service getter");
});

test("P14-05 route mounted exactly once", () => {
  const source = readFileSync(new URL("../Backend/kai/routes/sprint2IntakeApi.js", import.meta.url), "utf8");
  const path = "/admin/organizations/:organizationId/engagements/:engagementId/grant-response-packet/export-candidates/:grantResponsePacketExportCandidateId/export-review-request";
  const occurrences = source.split(path).length - 1;
  assert.equal(occurrences, 1);
});

test("P14-05 service output never carries a manifest identity, final-release authority, or approval decision", async () => {
  const repository = {
    async requestGrantResponsePacketExportReview(input) {
      return {
        ok: true,
        data: {
          organizationId: input.organizationId,
          engagementId: input.engagementId,
          grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
          reviewQueueItemId: QUEUE_ITEM,
          queueStatus: "open",
          reviewStatus: "needs_gk_review",
          replayed: false,
        },
        error: null,
      };
    },
  };
  const result = await requestGrantResponsePacketExportReview(requestInput(), deps({ grantResponsePacketExportCandidateRepository: repository }));
  assert.equal(result.ok, true);
  for (const key of Object.keys(result.data)) {
    assert.doesNotMatch(key, /manifest|approval|finalRelease|final_release/i);
  }
});
