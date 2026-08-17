import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import express from "express";

import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import {
  handleKaiSprint2JsonParserError,
  kaiSprint2ActorMutationLimiter,
  kaiSprint2MetadataJsonParser,
  kaiSprint2OrganizationMutationLimiter,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";
import sprint2IntakeApiRouter from "../Backend/kai/routes/sprint2IntakeApi.js";
import { __testables as reviewCockpitServiceTestables } from "../Backend/kai/services/kaiReviewCockpitService.js";

/**
 * KAI P1-09 integrated synthetic P1 acceptance test.
 *
 * Exercises the whole internal path against a real Express application, mounted the
 * same way index.js mounts it (no-store -> feature gate -> metadata JSON parser ->
 * feature gate -> rate limiters -> GK authentication -> router), through the real
 * P1-09 routes and the real P1-09 service, over an entirely synthetic in-memory
 * store:
 *
 *   intake candidate -> review (queue list + both detail reads) -> decision
 *   (needs_more_information, rejected, promoted, both needs_more_information
 *   follow-ups, one terminal conflict, one identical replay) -> source /
 *   source_version result
 *
 * Every response body across the whole path is asserted to contain no raw-data
 * field of any kind.
 *
 * The injected source-promotion repository is a synthetic stand-in that returns the
 * authoritative results P1-08's already-accepted transition matrix defines. It does
 * not, and is not claimed to, prove that matrix - the accepted
 * kai-sprint2-p1-08-source-promotion.integration.spec.js and -boundary.spec.js
 * suites remain its sole proof. Its purpose here is only to let P1-09's marshaling
 * layer be exercised end to end for every outcome, including a conflict.
 */

const basePath = "/api/kai/sprint2/intake";
const cockpitPath = `${basePath}/admin/review-cockpit`;

const ORG = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const OTHER_ORG = "b5d17c5a-c55f-43af-9b21-fe63aafe733f";
const ACTOR_USER_ID = "7fe568b1-5c05-4c42-bb1f-6e20de216c7b";
const LEGACY_USER_ID = 46;
const INTAKE_FILE = "20000000-0000-4000-8000-000000000001";
const FILE_PROFILE = "50000000-0000-4000-8000-000000000001";
const DATA_DICTIONARY = "60000000-0000-4000-8000-000000000001";
const SENSITIVITY = "80000000-0000-4000-8000-000000000001";
const FINDING = "40000000-0000-4000-8000-000000000001";
const SENSITIVITY_QUEUE_ITEM = "9e426ea1-2be3-4e48-b80f-9783ddbacda0";
const REVIEWED_TYPE = "organization_primary_record";
const CREATED_AT = "2026-08-05T09:00:00.000Z";
const UPDATED_AT = "2026-08-05T09:30:00.000Z";
const SHA = "a".repeat(64);
const SOURCE_CODE = "c".repeat(64);

/**
 * Every field class the P1-09 specification forbids from any response, injected onto
 * every synthetic row the fake read models return, so a raw-row pass-through
 * anywhere on the path would surface one of these.
 */
const forbiddenRowSentinels = Object.freeze({
  storage_provider: "storage-provider-sentinel",
  storage_bucket: "storage-bucket-sentinel",
  storage_object_key: "storage-object-key-sentinel",
  storage_uri: "storage-uri-sentinel",
  signed_url: "signed-url-sentinel",
  credentials: "credentials-sentinel",
  prompt: "prompt-sentinel",
  internal_notes: "internal-notes-sentinel",
  raw_content: "raw-content-sentinel",
  raw_sample: "raw-sample-sentinel",
  sample_values: "sample-values-sentinel",
  pii: "pii-sentinel",
  profile: "profile-jsonb-sentinel",
  queue_metadata: "queue-metadata-sentinel",
  assigned_to: "assigned-to-sentinel",
  blocked_reason: "blocked-reason-sentinel",
  audit_metadata: "audit-metadata-sentinel",
  created_by: "created-by-sentinel",
});

const observedResponses = [];

function assertNoRawDataExposure(value, label) {
  const serialized = JSON.stringify(value);
  for (const [field, sentinel] of Object.entries(forbiddenRowSentinels)) {
    assert.equal(serialized.includes(`"${field}"`), false, `${label}: forbidden field ${field}`);
    assert.equal(serialized.includes(sentinel), false, `${label}: forbidden value ${sentinel}`);
  }
}

function candidateId(index) {
  return `90000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
}

function queueItemId(index) {
  return `70000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
}

function decisionId(index) {
  return `30000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
}

function sourceId(index) {
  return `10000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
}

function sourceVersionId(index) {
  return `11000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
}

function createStore() {
  const candidates = new Map();
  const reviewItems = new Map();
  const decisions = new Map();
  const sources = new Map();
  const sourceVersions = new Map();

  function seedCandidate(index) {
    const id = candidateId(index);
    candidates.set(id, {
      intake_source_candidate_id: id,
      organization_id: ORG,
      intake_file_id: INTAKE_FILE,
      file_profile_id: FILE_PROFILE,
      data_dictionary_id: DATA_DICTIONARY,
      intake_sensitivity_profile_id: SENSITIVITY,
      profile_canonical_sha256: SHA,
      proposed_source_type: "unknown",
      candidate_status: "needs_gk_review",
      created_at: CREATED_AT,
      ...forbiddenRowSentinels,
    });
    reviewItems.set(id, {
      review_queue_item_id: queueItemId(index),
      organization_id: ORG,
      queue_type: "source_candidate_review",
      target_object_type: "intake_source_candidate",
      target_object_id: id,
      priority: "medium",
      queue_status: "open",
      review_status: null,
      due_at: null,
      summary: "Review intake source-candidate stub for human classification.",
      required_action: "Human review is required.",
      created_at: CREATED_AT,
      updated_at: UPDATED_AT,
      ...forbiddenRowSentinels,
    });
    return id;
  }

  return { candidates, reviewItems, decisions, sources, sourceVersions, seedCandidate };
}

const store = createStore();

const sensitivityReviewItem = {
  review_queue_item_id: SENSITIVITY_QUEUE_ITEM,
  organization_id: ORG,
  queue_type: "sensitivity_review",
  target_object_type: "intake_sensitivity_profile",
  target_object_id: SENSITIVITY,
  priority: "medium",
  queue_status: "open",
  review_status: null,
  due_at: null,
  summary: "Review intake sensitivity profile.",
  required_action: "Human review is required.",
  created_at: "2026-08-05T08:00:00.000Z",
  updated_at: UPDATED_AT,
  ...forbiddenRowSentinels,
};

function fileProfileRecord(organizationId) {
  if (organizationId !== ORG) return null;
  return {
    fileProfile: {
      file_profile_id: FILE_PROFILE,
      organization_id: ORG,
      intake_file_id: INTAKE_FILE,
      parser_name: "kai_local_profiling_kernel",
      parser_version: "1.0.0",
      checksum: SHA,
      profile_canonical_sha256: SHA,
      created_at: CREATED_AT,
      ...forbiddenRowSentinels,
    },
    dataDictionary: {
      data_dictionary_id: DATA_DICTIONARY,
      organization_id: ORG,
      intake_file_id: INTAKE_FILE,
      file_profile_id: FILE_PROFILE,
      dictionary_status: "draft",
      profile_canonical_sha256: SHA,
      field_count: 4,
      created_at: CREATED_AT,
      ...forbiddenRowSentinels,
    },
    qualityFindings: [{
      data_quality_finding_id: FINDING,
      organization_id: ORG,
      data_dictionary_id: DATA_DICTIONARY,
      file_profile_id: FILE_PROFILE,
      profile_field_key: "field_1",
      finding_type: "missingness",
      finding_status: "open",
      finding_detail_safe: "Column has missing values in some rows.",
      created_at: CREATED_AT,
      ...forbiddenRowSentinels,
    }],
    sensitivityProfile: {
      intake_sensitivity_profile_id: SENSITIVITY,
      organization_id: ORG,
      intake_file_id: INTAKE_FILE,
      file_profile_id: FILE_PROFILE,
      data_dictionary_id: DATA_DICTIONARY,
      profile_canonical_sha256: SHA,
      pii_status: "unknown",
      minor_data_status: "unknown",
      health_housing_justice_immigration_status: "unknown",
      indigenous_governance_status: "unknown",
      staff_notes_status: "unknown",
      story_testimonial_status: "unknown",
      small_cell_risk_status: "unknown",
      financial_records_status: "unknown",
      consent_basis_status: "unknown",
      allowed_use_status: "unknown",
      llm_processing_allowed: false,
      product_learning_allowed: false,
      public_use_allowed: false,
      funder_use_allowed: false,
      human_review_required: true,
      retention_posture: "restricted_pending_review",
      created_at: CREATED_AT,
      ...forbiddenRowSentinels,
    },
  };
}

/**
 * Synthetic stand-in for the accepted P1-08 repository. It returns the authoritative
 * results P1-08's documented transition matrix defines - null -> any outcome,
 * needs_more_information -> rejected|promoted, identical replay as a zero-write
 * no-op, and conflict_current_state_changed for every other requested transition -
 * so the P1-09 layer above it can be exercised for every outcome. It proves nothing
 * about that matrix itself; P1-08's own suites do.
 */
const repositoryCallLog = [];

function createSyntheticSourcePromotionRepository() {
  return {
    async createSourcePromotionDecision(input) {
      repositoryCallLog.push({ ...input.identity, outcome: input.outcome });
      const { organizationId, intakeSourceCandidateId } = input.identity;
      if (organizationId !== ORG) return failure("not_found");

      const candidate = store.candidates.get(intakeSourceCandidateId);
      const reviewItem = store.reviewItems.get(intakeSourceCandidateId);
      if (!candidate || !reviewItem) return failure("not_found");

      const existing = store.decisions.get(intakeSourceCandidateId) || null;
      if (existing) {
        if (existing.decision_status === input.outcome) {
          if (
            input.outcome === "promoted"
            && existing.reviewed_source_type !== input.reviewedSourceType
          ) {
            return failure("conflict_current_state_changed");
          }
          return success(intakeSourceCandidateId, true);
        }
        if (existing.decision_status !== "needs_more_information") {
          return failure("conflict_current_state_changed");
        }
      }

      const index = Number(intakeSourceCandidateId.slice(-2));
      if (input.outcome === "needs_more_information") {
        reviewItem.queue_status = "waiting_on_client";
        reviewItem.required_action =
          "Obtain the missing client information before reconsidering source promotion.";
      } else {
        candidate.candidate_status = input.outcome === "promoted" ? "promoted" : "rejected";
        reviewItem.queue_status = "resolved";
        reviewItem.review_status = "resolved";
      }

      if (input.outcome === "promoted") {
        store.sources.set(intakeSourceCandidateId, {
          source_id: sourceId(index),
          organization_id: ORG,
          source_code: SOURCE_CODE,
          reviewed_source_type: input.reviewedSourceType,
          created_at: CREATED_AT,
          ...forbiddenRowSentinels,
        });
        store.sourceVersions.set(intakeSourceCandidateId, {
          source_version_id: sourceVersionId(index),
          organization_id: ORG,
          source_id: sourceId(index),
          intake_source_candidate_id: intakeSourceCandidateId,
          intake_sensitivity_profile_id: SENSITIVITY,
          profile_canonical_sha256: SHA,
          is_current: true,
          created_at: CREATED_AT,
          ...forbiddenRowSentinels,
        });
      }

      store.decisions.set(intakeSourceCandidateId, {
        intake_promotion_decision_id: existing?.intake_promotion_decision_id || decisionId(index),
        organization_id: ORG,
        intake_source_candidate_id: intakeSourceCandidateId,
        review_queue_item_id: reviewItem.review_queue_item_id,
        reviewed_source_type: input.outcome === "promoted" ? input.reviewedSourceType : null,
        decision_status: input.outcome,
        source_id: input.outcome === "promoted" ? sourceId(index) : null,
        source_version_id: input.outcome === "promoted" ? sourceVersionId(index) : null,
        created_at: CREATED_AT,
        decided_at: CREATED_AT,
        promoted_at: input.outcome === "promoted" ? input.now : null,
        ...forbiddenRowSentinels,
      });

      return success(intakeSourceCandidateId, false);
    },
  };

  function failure(code) {
    return { ok: false, data: null, error: { code, status: code === "not_found" ? 404 : 409 } };
  }

  function success(id, replayed) {
    return {
      ok: true,
      error: null,
      data: {
        promotionDecision: store.decisions.get(id),
        sourceCandidate: store.candidates.get(id),
        reviewQueueItem: store.reviewItems.get(id),
        source: store.sources.get(id) || null,
        sourceVersion: store.sourceVersions.get(id) || null,
        replayed,
      },
    };
  }
}

function cockpitDependencies({ promotionEnabled }) {
  return {
    env: {
      KAI_SPRINT2_ENABLED: "true",
      ...(promotionEnabled ? { KAI_SOURCE_PROMOTION_ENABLED: "true" } : {}),
    },
    now: () => Date.parse("2026-08-05T12:00:00.000Z"),
    sourcePromotionRepository: createSyntheticSourcePromotionRepository(),
    metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) },
    async findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId }) {
      assert.equal(legacyId, LEGACY_USER_ID);
      return {
        user_id: ACTOR_USER_ID,
        legacy_identity_source: "public.userdata",
        legacy_public_userdata_id: LEGACY_USER_ID,
        status: "active",
      };
    },
    async listKaiRolesForUser() {
      return ["gk_operator"];
    },
    async resolveEffectiveClientOrganizationMembershipsForLegacyUser() {
      return [];
    },
    async listOrganizationMembershipsForUser() {
      return [{ organization_id: ORG, membership_status: "active", role_name: "gk_operator" }];
    },
    async listReviewCockpitQueueItems(organizationId, { limit, queueTypes, queueStatuses }) {
      if (organizationId !== ORG) return [];
      const typeSet = new Set(queueTypes);
      const statusSet = new Set(queueStatuses);
      const rows = [sensitivityReviewItem, ...store.reviewItems.values()]
        .filter((row) => typeSet.has(row.queue_type) && statusSet.has(row.queue_status))
        .sort((left, right) => (
          left.created_at === right.created_at
            ? right.review_queue_item_id.localeCompare(left.review_queue_item_id)
            : right.created_at.localeCompare(left.created_at)
        ));
      return rows.slice(0, limit + 1);
    },
    async getReviewCockpitFileProfileRecord(organizationId, fileProfileId) {
      if (fileProfileId !== FILE_PROFILE) return null;
      return fileProfileRecord(organizationId);
    },
    async getReviewCockpitSourceCandidateRecord(organizationId, intakeSourceCandidateId) {
      if (organizationId !== ORG) return null;
      const sourceCandidate = store.candidates.get(intakeSourceCandidateId);
      if (!sourceCandidate) return null;
      return {
        sourceCandidate,
        reviewQueueItem: store.reviewItems.get(intakeSourceCandidateId) || null,
        promotionDecision: store.decisions.get(intakeSourceCandidateId) || null,
        source: store.sources.get(intakeSourceCandidateId) || null,
        sourceVersion: store.sourceVersions.get(intakeSourceCandidateId) || null,
      };
    },
  };
}

function createAssembledApplication() {
  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, (req, res, next) => {
    req.isAuthenticated = () => true;
    req.user = { id: LEGACY_USER_ID };
    return next();
  });
  app.use(
    basePath,
    requireKaiSprint2Enabled,
    kaiSprint2OrganizationMutationLimiter,
    kaiSprint2ActorMutationLimiter,
    requireKaiSprint2Authenticated,
    sprint2IntakeApiRouter,
  );
  return app;
}

async function listen(app) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

async function request(server, { method, path, body = null }) {
  const { port } = server.address();
  const payload = body === null ? null : Buffer.from(JSON.stringify(body), "utf8");
  return await new Promise((resolve, reject) => {
    const clientRequest = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: payload
        ? { "content-type": "application/json", "content-length": payload.length }
        : {},
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        // An unrouted method/path answers with Express's default HTML 404; that is a
        // valid observation for the read-only assertions below, so it is captured as
        // a raw string rather than forced through JSON.parse.
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = { non_json_body: raw };
        }
        observedResponses.push({ path, body: parsed });
        assertNoRawDataExposure(parsed, `${method} ${path}`);
        resolve({ statusCode: response.statusCode, body: parsed });
      });
    });
    clientRequest.on("error", reject);
    if (payload) clientRequest.write(payload);
    clientRequest.end();
  });
}

function queuePath(query = "") {
  return `${cockpitPath}/queue?organization_id=${ORG}${query ? `&${query}` : ""}`;
}

function decisionPath(id) {
  return `${cockpitPath}/source-candidates/${id}/decision?organization_id=${ORG}`;
}

function candidateDetailPath(id, organizationId = ORG) {
  return `${cockpitPath}/source-candidates/${id}?organization_id=${organizationId}`;
}

test("P1-09 integrated synthetic P1 acceptance: intake candidate -> review -> all three decisions -> source/source_version result", async (t) => {
  const previousFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const restoreDependencies = reviewCockpitServiceTestables.setReviewCockpitDependenciesForTest(
    cockpitDependencies({ promotionEnabled: true }),
  );
  const server = await listen(createAssembledApplication());

  t.after(async () => {
    restoreDependencies();
    if (previousFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = previousFlag;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  const promotedCandidate = store.seedCandidate(1);
  const rejectedCandidate = store.seedCandidate(2);
  const followUpRejectedCandidate = store.seedCandidate(3);
  const followUpPromotedCandidate = store.seedCandidate(4);

  await t.test("review: the cockpit queue lists both canonical review queue types, deterministically ordered", async () => {
    const result = await request(server, { method: "GET", path: queuePath() });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.ok, true);
    const ordering = result.body.data.items.map((item) => [item.created_at, item.review_queue_item_id]);
    const expectedOrdering = [...ordering].sort((left, right) => (
      left[0] === right[0] ? right[1].localeCompare(left[1]) : right[0].localeCompare(left[0])
    ));
    assert.deepEqual(ordering, expectedOrdering);
    assert.ok(result.body.data.items.some((item) => item.queue_type === "sensitivity_review"));
    assert.ok(result.body.data.items.some((item) => item.queue_type === "source_candidate_review"));
    assert.deepEqual(result.body.data.filters.queue_types, [
      "intake_file_review", "sensitivity_review", "source_candidate_review",
    ]);
  });

  await t.test("review: canonical queue_type and queue_status filters narrow the list", async () => {
    const filtered = await request(server, {
      method: "GET",
      path: queuePath("queue_type=sensitivity_review&queue_status=open"),
    });
    assert.equal(filtered.statusCode, 200);
    assert.equal(filtered.body.data.items.length, 1);
    assert.equal(filtered.body.data.items[0].queue_type, "sensitivity_review");

    const rejected = await request(server, { method: "GET", path: queuePath("queue_type=evidence_review") });
    assert.equal(rejected.statusCode, 400);
    assert.equal(rejected.body.error.code, "invalid_request");
  });

  await t.test("review: the read-only file-profile detail exposes only safe posture and restrictions", async () => {
    const result = await request(server, {
      method: "GET",
      path: `${cockpitPath}/file-profiles/${FILE_PROFILE}?organization_id=${ORG}`,
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.data.read_only, true);
    assert.equal(result.body.data.file_profile.profile_canonical_sha256, SHA);
    assert.equal(result.body.data.data_dictionary.field_count, 4);
    assert.equal(result.body.data.quality_findings.length, 1);
    assert.equal(result.body.data.allowed_use_restrictions.human_review_required, true);
    assert.equal(result.body.data.allowed_use_restrictions.public_use_allowed, false);
    assert.equal(result.body.data.allowed_use_restrictions.retention_posture, "restricted_pending_review");

    // Read-only: there is no mutation verb on the file-profile detail path.
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const attempt = await request(server, {
        method,
        path: `${cockpitPath}/file-profiles/${FILE_PROFILE}?organization_id=${ORG}`,
        body: method === "POST" || method === "PUT" || method === "PATCH" ? {} : null,
      });
      assert.equal(attempt.statusCode, 404, method);
    }
  });

  await t.test("review: the source-candidate detail shows pre-decision lineage, checksum, and queue state", async () => {
    const result = await request(server, { method: "GET", path: candidateDetailPath(promotedCandidate) });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.data.source_candidate.candidate_status, "needs_gk_review");
    assert.equal(result.body.data.source_candidate.profile_canonical_sha256, SHA);
    assert.equal(result.body.data.review_queue_item.queue_status, "open");
    assert.equal(result.body.data.promotion_decision, null);
    assert.equal(result.body.data.source, null);
    assert.equal(result.body.data.source_version, null);
    assert.equal(result.body.data.decision_controls_enabled, true);
  });

  await t.test("decision: promoted creates the source and current source_version result", async () => {
    const result = await request(server, {
      method: "POST",
      path: decisionPath(promotedCandidate),
      body: { outcome: "promoted", reviewed_source_type: REVIEWED_TYPE },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.data.promotion_decision.decision_status, "promoted");
    assert.equal(result.body.data.source_candidate.candidate_status, "promoted");
    assert.equal(result.body.data.review_queue_item.queue_status, "resolved");
    assert.equal(result.body.data.source.reviewed_source_type, REVIEWED_TYPE);
    assert.equal(result.body.data.source_version.is_current, true);
    assert.equal(result.body.data.replayed, false);

    const detail = await request(server, { method: "GET", path: candidateDetailPath(promotedCandidate) });
    assert.equal(detail.body.data.promotion_decision.decision_status, "promoted");
    assert.equal(detail.body.data.source_version.is_current, true);
  });

  await t.test("decision: rejected records the outcome and creates no source or source_version", async () => {
    const result = await request(server, {
      method: "POST",
      path: decisionPath(rejectedCandidate),
      body: { outcome: "rejected" },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.data.promotion_decision.decision_status, "rejected");
    assert.equal(result.body.data.promotion_decision.reviewed_source_type, null);
    assert.equal(result.body.data.source_candidate.candidate_status, "rejected");
    assert.equal(result.body.data.source, null);
    assert.equal(result.body.data.source_version, null);
  });

  await t.test("decision: needs_more_information -> rejected follow-up transition", async () => {
    const first = await request(server, {
      method: "POST",
      path: decisionPath(followUpRejectedCandidate),
      body: { outcome: "needs_more_information" },
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.data.promotion_decision.decision_status, "needs_more_information");
    assert.equal(first.body.data.source_candidate.candidate_status, "needs_gk_review");
    assert.equal(first.body.data.review_queue_item.queue_status, "waiting_on_client");

    const second = await request(server, {
      method: "POST",
      path: decisionPath(followUpRejectedCandidate),
      body: { outcome: "rejected" },
    });
    assert.equal(second.statusCode, 200);
    assert.equal(second.body.data.promotion_decision.decision_status, "rejected");
    assert.equal(second.body.data.source_candidate.candidate_status, "rejected");
    assert.equal(second.body.data.source, null);
  });

  await t.test("decision: needs_more_information -> promoted follow-up transition", async () => {
    const first = await request(server, {
      method: "POST",
      path: decisionPath(followUpPromotedCandidate),
      body: { outcome: "needs_more_information" },
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.data.promotion_decision.decision_status, "needs_more_information");

    const second = await request(server, {
      method: "POST",
      path: decisionPath(followUpPromotedCandidate),
      body: { outcome: "promoted", reviewed_source_type: REVIEWED_TYPE },
    });
    assert.equal(second.statusCode, 200);
    assert.equal(second.body.data.promotion_decision.decision_status, "promoted");
    assert.equal(second.body.data.source.reviewed_source_type, REVIEWED_TYPE);
    assert.equal(second.body.data.source_version.is_current, true);
  });

  await t.test("decision: an identical replay of a terminal outcome is a safe no-op result", async () => {
    const result = await request(server, {
      method: "POST",
      path: decisionPath(promotedCandidate),
      body: { outcome: "promoted", reviewed_source_type: REVIEWED_TYPE },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.data.replayed, true);
    assert.equal(result.body.data.promotion_decision.decision_status, "promoted");
  });

  await t.test("decision: a stale/terminal conflict is surfaced as a clean typed 409 and triggers no second mutation attempt", async () => {
    const before = repositoryCallLog.length;
    const result = await request(server, {
      method: "POST",
      path: decisionPath(rejectedCandidate),
      body: { outcome: "promoted", reviewed_source_type: REVIEWED_TYPE },
    });
    assert.equal(result.statusCode, 409);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.error.code, "conflict_current_state_changed");
    assert.equal(repositoryCallLog.length - before, 1, "conflict must not be retried");

    const detail = await request(server, { method: "GET", path: candidateDetailPath(rejectedCandidate) });
    assert.equal(detail.body.data.promotion_decision.decision_status, "rejected");
    assert.equal(detail.body.data.source, null);
  });

  await t.test("decision: a malformed decision body is rejected before any repository call", async () => {
    const before = repositoryCallLog.length;
    for (const body of [
      { outcome: "decided" },
      { outcome: "promoted" },
      { outcome: "rejected", reviewed_source_type: REVIEWED_TYPE },
      { outcome: "rejected", note: "internal note" },
    ]) {
      const result = await request(server, { method: "POST", path: decisionPath(promotedCandidate), body });
      assert.equal(result.statusCode, 422, JSON.stringify(body));
      assert.equal(result.body.error.code, "validation_blocker");
    }
    assert.equal(repositoryCallLog.length, before);
  });

  await t.test("tenant isolation: another organization's scope yields no candidate and no decision", async () => {
    const detail = await request(server, {
      method: "GET",
      path: candidateDetailPath(promotedCandidate, OTHER_ORG),
    });
    assert.equal(detail.statusCode, 403);
    assert.equal(detail.body.error.code, "authorization_denied");
  });

  await t.test("no raw-data field appeared in any response across the whole acceptance path", () => {
    assert.ok(observedResponses.length >= 20, `expected a full traversal, saw ${observedResponses.length}`);
    for (const observed of observedResponses) {
      assertNoRawDataExposure(observed.body, observed.path);
    }
  });
});

test("P1-09 integrated: with KAI_SOURCE_PROMOTION_ENABLED off, reads stay available and the decision route returns a clean feature_disabled", async (t) => {
  const previousFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const restoreDependencies = reviewCockpitServiceTestables.setReviewCockpitDependenciesForTest(
    cockpitDependencies({ promotionEnabled: false }),
  );
  const server = await listen(createAssembledApplication());

  t.after(async () => {
    restoreDependencies();
    if (previousFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = previousFlag;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  const candidate = store.seedCandidate(9);

  const queue = await request(server, { method: "GET", path: queuePath() });
  assert.equal(queue.statusCode, 200);

  const fileProfile = await request(server, {
    method: "GET",
    path: `${cockpitPath}/file-profiles/${FILE_PROFILE}?organization_id=${ORG}`,
  });
  assert.equal(fileProfile.statusCode, 200);

  const detail = await request(server, { method: "GET", path: candidateDetailPath(candidate) });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.body.data.decision_controls_enabled, false);
  assert.deepEqual(detail.body.data.allowed_reviewed_source_types, []);

  const before = repositoryCallLog.length;
  const decision = await request(server, {
    method: "POST",
    path: decisionPath(candidate),
    body: { outcome: "rejected" },
  });
  assert.equal(decision.statusCode, 403);
  assert.equal(decision.body.ok, false);
  assert.equal(decision.body.error.code, "feature_disabled");
  assert.equal(repositoryCallLog.length, before);
});

test("P1-09 integrated: with KAI_SPRINT2_ENABLED off, every cockpit route is feature-gated before authentication", async (t) => {
  const previousFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "false";
  const server = await listen(createAssembledApplication());

  t.after(async () => {
    if (previousFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = previousFlag;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  for (const [method, path, body] of [
    ["GET", queuePath(), null],
    ["GET", `${cockpitPath}/file-profiles/${FILE_PROFILE}?organization_id=${ORG}`, null],
    ["GET", candidateDetailPath(candidateId(1)), null],
    ["POST", decisionPath(candidateId(1)), { outcome: "rejected" }],
  ]) {
    const result = await request(server, { method, path, body });
    assert.equal(result.statusCode, 403, `${method} ${path}`);
    assert.equal(result.body.error.code, "feature_disabled", `${method} ${path}`);
  }
});
