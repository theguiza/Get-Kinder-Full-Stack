// P14-06A: proves the packet-native export-review START transition -
// open/needs_gk_review -> in_progress/needs_gk_review only - for the EXACT
// existing governed 'export_review' queue row the P14-05 package already
// binds to the EXACT existing, immutable P14-03 grant-response-packet
// export candidate. Reuses the P3-09 optimistic expected_updated_at CAS/
// replay contract and the gk_admin-only export-review authority - never a
// second review authority, never a new lifecycle, never final eligibility
// evaluation, approval, funder/public readiness, export authority, final
// release, or manifest state.
//
// Like the P14-05 suite this fakes the transactional SQL layer (the P14-05
// widened schema contract itself is proven separately against a real
// synthetic local PostgreSQL) and proves what this package adds:
// exact-keys input contract, server-side candidate/queue-item/tenant/
// engagement resolution, CAS transition + stale-CAS/replay semantics, the
// gk_admin-only role boundary, tenant boundary, and that no
// approval/final-release/manifest state is ever created.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createPostgresGrantResponsePacketExportCandidateRepository } from "../Backend/kai/dictionary/postgresGrantResponsePacketExportCandidateRepository.js";
import {
  startGrantResponsePacketExportReview,
  __grantResponsePacketExportReviewServiceContract,
  __grantResponsePacketExportReviewServiceTestables,
} from "../Backend/kai/services/kaiGrantResponsePacketExportReviewService.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "14060000-0000-4000-8000-000000000001";
const OTHER_ENGAGEMENT = "14060000-0000-4000-8000-000000000002";
const CANDIDATE = "14060000-0000-4000-8000-0000000000c1";
const OTHER_CANDIDATE = "14060000-0000-4000-8000-0000000000c2";
const NONEXISTENT_CANDIDATE = "14060000-0000-4000-8000-0000000000ff";
const QUEUE_ITEM = "14060000-0000-4000-8000-0000000000a3";
const NONEXISTENT_QUEUE_ITEM = "14060000-0000-4000-8000-0000000000fe";
const EXPECTED_UPDATED_AT = "2026-09-09T11:00:00.000Z";
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

function startInput(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    grantResponsePacketExportCandidateId: CANDIDATE,
    exportReviewQueueItemId: QUEUE_ITEM,
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
    actorContext: gkAdminActorContext,
    now: NOW,
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

function validQueueRow(overrides = {}) {
  return {
    review_queue_item_id: QUEUE_ITEM,
    organization_id: ORG,
    engagement_id: ENGAGEMENT,
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
    updated_at: EXPECTED_UPDATED_AT,
    ...overrides,
  };
}

// A minimal stateful fake `tx` proving the repository's own SQL shape
// without a real database: recognizes the exact queries the repository
// issues by a distinguishing substring, and simulates the CAS UPDATE
// actually mutating the row it will next return, exactly the way a real
// transaction would.
function makeFakeTx({
  candidateExists = true,
  candidateEngagementId = ENGAGEMENT,
  initialQueueRow = validQueueRow(),
  casSucceeds = true,
} = {}) {
  let currentRow = initialQueueRow;
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
      if (sql.startsWith("UPDATE kai.review_queue_items")) {
        if (!casSucceeds || !currentRow) return { rowCount: 0, rows: [] };
        currentRow = { ...currentRow, queue_status: "in_progress" };
        return { rowCount: 1, rows: [{ review_queue_item_id: currentRow.review_queue_item_id }] };
      }
      if (sql.includes("engagement_id::text AS engagement_id, queue_type, target_object_type")) {
        return { rows: currentRow ? [currentRow] : [] };
      }
      throw new Error(`unexpected query in fake tx: ${sql}`);
    },
  };
}

// --- Service-layer proofs ---

test("P14-06A service exact-keys input contract rejects every client-supplied composition/authority field", async () => {
  const forbiddenVariants = [
    { members: ["x"] },
    { generatedContentDraftIds: ["x"] },
    { canonicalFingerprint: "a".repeat(64) },
    { memberCount: 3 },
    { packetAudience: "funder" },
    { exportManifestId: "14060000-0000-4000-8000-0000000000aa" },
    { approved: true },
    { decisionAction: "approve" },
  ];
  for (const extra of forbiddenVariants) {
    const result = await startGrantResponsePacketExportReview(startInput(extra), deps());
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
  }
});

test("P14-06A service exact-keys input contract requires exportReviewQueueItemId and expectedUpdatedAt", async () => {
  const { exportReviewQueueItemId, ...missingQueueItem } = startInput();
  const missingQueueItemResult = await startGrantResponsePacketExportReview(missingQueueItem, deps());
  assert.equal(missingQueueItemResult.ok, false);
  assert.equal(missingQueueItemResult.error.code, "validation_blocker");

  const { expectedUpdatedAt, ...missingExpectedUpdatedAt } = startInput();
  const missingExpectedResult = await startGrantResponsePacketExportReview(missingExpectedUpdatedAt, deps());
  assert.equal(missingExpectedResult.ok, false);
  assert.equal(missingExpectedResult.error.code, "validation_blocker");
});

test("P14-06A service isStartGrantResponsePacketExportReviewInput exact-keys testable rejects extra/missing keys", () => {
  const { isStartGrantResponsePacketExportReviewInput } = __grantResponsePacketExportReviewServiceTestables;
  assert.equal(isStartGrantResponsePacketExportReviewInput(startInput()), true);
  assert.equal(isStartGrantResponsePacketExportReviewInput(startInput({ extraField: "x" })), false);
  const { organizationId, ...missingOrg } = startInput();
  assert.equal(isStartGrantResponsePacketExportReviewInput(missingOrg), false);
});

test("P14-06A service reuses the gk_admin-only export-review role boundary", async () => {
  const repository = {
    async startGrantResponsePacketExportReview() {
      throw new Error("repository must not be called when authorization fails");
    },
  };
  const reviewer = await startGrantResponsePacketExportReview(
    startInput({ actorContext: gkReviewerActorContext }),
    deps({ grantResponsePacketExportCandidateRepository: repository }),
  );
  assert.equal(reviewer.ok, false);
  assert.equal(reviewer.error.code, "authorization_denied");

  const system = await startGrantResponsePacketExportReview(
    startInput({ actorContext: systemActorContext }),
    deps({ grantResponsePacketExportCandidateRepository: repository }),
  );
  assert.equal(system.ok, false);
  assert.equal(system.error.code, "authorization_denied");

  assert.deepEqual(
    [...__grantResponsePacketExportReviewServiceContract.START_GRANT_RESPONSE_PACKET_EXPORT_REVIEW_ROLES],
    ["gk_admin"],
  );
});

test("P14-06A service rejects a cross-tenant actor starting review against an organization they do not belong to", async () => {
  const repository = {
    async startGrantResponsePacketExportReview() {
      throw new Error("repository must not be called when the actor is not a member of the target organization");
    },
  };
  const result = await startGrantResponsePacketExportReview(
    startInput({ actorContext: otherOrgAdminActorContext }),
    deps({ grantResponsePacketExportCandidateRepository: repository }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("P14-06A service reaches the repository for a tenant-matched gk_admin actor", async () => {
  const repository = {
    calls: 0,
    async startGrantResponsePacketExportReview(input) {
      this.calls += 1;
      return {
        ok: true,
        data: {
          organizationId: input.organizationId,
          engagementId: input.engagementId,
          grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
          reviewQueueItemId: input.exportReviewQueueItemId,
          queueStatus: "in_progress",
          reviewStatus: "needs_gk_review",
          replayed: false,
        },
        error: null,
      };
    },
  };
  const result = await startGrantResponsePacketExportReview(startInput(), deps({ grantResponsePacketExportCandidateRepository: repository }));
  assert.equal(result.ok, true);
  assert.equal(repository.calls, 1);
});

test("P14-06A service is feature-flag gated", async () => {
  const result = await startGrantResponsePacketExportReview(startInput(), deps({ env: { KAI_SPRINT2_ENABLED: "false" } }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
});

test("P14-06A service propagates a real successful repository result end to end and carries no manifest/approval/final-release field", async () => {
  const repository = {
    async startGrantResponsePacketExportReview(input) {
      return {
        ok: true,
        data: {
          organizationId: input.organizationId,
          engagementId: input.engagementId,
          grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
          reviewQueueItemId: input.exportReviewQueueItemId,
          queueStatus: "in_progress",
          reviewStatus: "needs_gk_review",
          replayed: false,
        },
        error: null,
      };
    },
  };
  const result = await startGrantResponsePacketExportReview(startInput(), deps({ grantResponsePacketExportCandidateRepository: repository }));
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.data).sort(), [
    "engagementId",
    "grantResponsePacketExportCandidateId",
    "organizationId",
    "queueStatus",
    "replayed",
    "reviewQueueItemId",
    "reviewStatus",
  ].sort());
  assert.equal(result.data.queueStatus, "in_progress");
  assert.equal(result.data.reviewStatus, "needs_gk_review");
  for (const key of Object.keys(result.data)) {
    assert.doesNotMatch(key, /manifest|approval|finalRelease|final_release|eligib/i);
  }
});

// --- Repository-layer proofs (real production repository, fake tx) ---

test("P14-06A repository requires an exact-keys input", async () => {
  const repository = createPostgresGrantResponsePacketExportCandidateRepository({
    runInTransaction: async () => {
      throw new Error("runInTransaction must not be called for a malformed input");
    },
  });
  const result = await repository.startGrantResponsePacketExportReview(
    { ...startInput(), extraField: "x" },
    { metadataOnlyAudit: auditRecorder() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("P14-06A repository fails not_found for a nonexistent candidate", async () => {
  const repository = createPostgresGrantResponsePacketExportCandidateRepository({
    runInTransaction: async (fn) => fn(makeFakeTx({ candidateExists: false })),
  });
  const result = await repository.startGrantResponsePacketExportReview(
    startInput({ grantResponsePacketExportCandidateId: NONEXISTENT_CANDIDATE }),
    { metadataOnlyAudit: auditRecorder() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("P14-06A repository fails not_found for a candidate belonging to a different engagement (wrong engagement fails)", async () => {
  const repository = createPostgresGrantResponsePacketExportCandidateRepository({
    runInTransaction: async (fn) => fn(makeFakeTx({ candidateEngagementId: OTHER_ENGAGEMENT })),
  });
  const result = await repository.startGrantResponsePacketExportReview(startInput(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("P14-06A repository fails not_found for a nonexistent queue item (wrong queue item fails)", async () => {
  const repository = createPostgresGrantResponsePacketExportCandidateRepository({
    runInTransaction: async (fn) => fn(makeFakeTx({ initialQueueRow: null })),
  });
  const result = await repository.startGrantResponsePacketExportReview(
    startInput({ exportReviewQueueItemId: NONEXISTENT_QUEUE_ITEM }),
    { metadataOnlyAudit: auditRecorder() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("P14-06A repository fails closed when the queue item targets a different candidate (wrong candidate fails)", async () => {
  const repository = createPostgresGrantResponsePacketExportCandidateRepository({
    runInTransaction: async (fn) => fn(makeFakeTx({ initialQueueRow: validQueueRow({ target_object_id: OTHER_CANDIDATE }) })),
  });
  const result = await repository.startGrantResponsePacketExportReview(startInput(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P14-06A repository fails closed when the queue item belongs to a different engagement (cross-tenant/engagement fails)", async () => {
  const repository = createPostgresGrantResponsePacketExportCandidateRepository({
    runInTransaction: async (fn) => fn(makeFakeTx({ initialQueueRow: validQueueRow({ engagement_id: OTHER_ENGAGEMENT }) })),
  });
  const result = await repository.startGrantResponsePacketExportReview(startInput(), { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("P14-06A repository transitions open/needs_gk_review to in_progress/needs_gk_review and publishes exactly one metadata-only audit (gk_admin succeeds)", async () => {
  const audit = auditRecorder();
  const tx = makeFakeTx({});
  const repository = createPostgresGrantResponsePacketExportCandidateRepository({
    runInTransaction: async (fn) => fn(tx),
  });
  const result = await repository.startGrantResponsePacketExportReview(startInput(), { metadataOnlyAudit: audit });
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, false);
  assert.equal(result.data.reviewQueueItemId, QUEUE_ITEM);
  assert.equal(result.data.queueStatus, "in_progress");
  assert.equal(result.data.reviewStatus, "needs_gk_review");

  assert.equal(audit.calls.length, 1);
  const payload = audit.calls[0].payload;
  assert.equal(payload.attempted_operation, "grant_response_packet_export_review_started");
  assert.equal(payload.grant_response_packet_export_candidate_id, CANDIDATE);
  assert.equal(payload.engagement_id, ENGAGEMENT);
  assert.equal(payload.review_queue_item_id, QUEUE_ITEM);
  assert.equal(payload.expected_updated_at, EXPECTED_UPDATED_AT);
  assert.equal(payload.previous_queue_status, "open");
  assert.equal(payload.resulting_queue_status, "in_progress");
  assert.equal(payload.previous_review_status, "needs_gk_review");
  assert.equal(payload.resulting_review_status, "needs_gk_review");
  // Metadata-only: no content, evidence, citation, source, credential, URL,
  // or PII field is ever present on this payload.
  for (const key of Object.keys(payload)) {
    assert.doesNotMatch(key, /block|citation|evidence|source|credential|url|pii|content_body/i);
  }
});

test("P14-06A repository replays a valid already-started row without publishing a second audit", async () => {
  const audit = auditRecorder();
  const tx = makeFakeTx({
    initialQueueRow: validQueueRow({ queue_status: "in_progress" }),
    casSucceeds: false,
  });
  const repository = createPostgresGrantResponsePacketExportCandidateRepository({
    runInTransaction: async (fn) => fn(tx),
  });
  const result = await repository.startGrantResponsePacketExportReview(startInput(), { metadataOnlyAudit: audit });
  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, true);
  assert.equal(result.data.queueStatus, "in_progress");
  assert.equal(result.data.reviewStatus, "needs_gk_review");
  assert.equal(audit.calls.length, 0);
});

test("P14-06A repository fails closed with conflict_current_state_changed for a stale expectedUpdatedAt (stale CAS fails)", async () => {
  const audit = auditRecorder();
  const tx = makeFakeTx({
    initialQueueRow: validQueueRow({ queue_status: "open", updated_at: "2026-09-09T09:00:00.000Z" }),
    casSucceeds: false,
  });
  const repository = createPostgresGrantResponsePacketExportCandidateRepository({
    runInTransaction: async (fn) => fn(tx),
  });
  const result = await repository.startGrantResponsePacketExportReview(startInput(), { metadataOnlyAudit: audit });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(audit.calls.length, 0);
});

test("P14-06A repository never evaluates final eligibility, grants no approval, and creates no manifest", async () => {
  const audit = auditRecorder();
  const tx = makeFakeTx({});
  const repository = createPostgresGrantResponsePacketExportCandidateRepository({
    runInTransaction: async (fn) => fn(tx),
  });
  const result = await repository.startGrantResponsePacketExportReview(startInput(), { metadataOnlyAudit: audit });
  assert.equal(result.ok, true);
  for (const key of Object.keys(result.data)) {
    assert.doesNotMatch(key, /manifest|approval|finalRelease|final_release|eligib/i);
  }
  assert.ok(!tx.queries.some((q) => /INSERT INTO kai\.grant_response_packet_export_manifests/i.test(q.sql)));
});

// --- Route/no-SQL boundary proofs ---

test("P14-06A route contains no SQL and no direct kai.* database access", () => {
  const source = readFileSync(new URL("../Backend/kai/routes/sprint2IntakeApi.js", import.meta.url), "utf8");
  const startMarker = "/admin/organizations/:organizationId/engagements/:engagementId/grant-response-packet/export-candidates/:grantResponsePacketExportCandidateId/export-review-queue/:exportReviewQueueItemId/start";
  const startIndex = source.indexOf(startMarker);
  assert.ok(startIndex >= 0, "P14-06A export-review-queue/:exportReviewQueueItemId/start route path must be present");
  const routeStart = source.lastIndexOf("router.post(", startIndex);
  const routeEnd = source.indexOf("\n);\n", startIndex) + 4;
  const routeSource = source.slice(routeStart, routeEnd);
  assert.doesNotMatch(routeSource, /\bkai\.\w+/, "route must not reference any kai.* table directly");
  assert.doesNotMatch(routeSource, /\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/i, "route must contain no SQL");
  assert.match(routeSource, /getGrantResponsePacketExportReviewService/, "route must delegate through the service getter");
});

test("P14-06A route mounted exactly once", () => {
  const source = readFileSync(new URL("../Backend/kai/routes/sprint2IntakeApi.js", import.meta.url), "utf8");
  const path = "/admin/organizations/:organizationId/engagements/:engagementId/grant-response-packet/export-candidates/:grantResponsePacketExportCandidateId/export-review-queue/:exportReviewQueueItemId/start";
  const occurrences = source.split(path).length - 1;
  assert.equal(occurrences, 1);
});
