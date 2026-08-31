import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  getReviewCockpitFileProfileDetail,
  getReviewCockpitSensitivityProfileDetail,
  getReviewCockpitSourceCandidateDetail,
  getReviewCockpitCapabilities,
  listReviewCockpitQueue,
  submitSourceCandidateDecision,
  __reviewCockpitServiceContract,
} from "../Backend/kai/services/kaiReviewCockpitService.js";
import {
  getReviewCockpitFileProfileRecord,
  getReviewCockpitSensitivityProfileRecord,
  listReviewCockpitQueueItems,
  getReviewCockpitSourceCandidateRecord,
} from "../Backend/kai/db/kaiReviewCockpitReadModels.js";
import { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { __sourcePromotionRepositoryContract } from "../Backend/kai/dictionary/postgresSourcePromotionRepository.js";
import {
  REVIEW_COCKPIT_QUEUE_TYPES,
  encodeReviewCockpitQueueCursor,
  validateReviewCockpitQueueQuery,
  validateSourceCandidateDecisionRequest,
} from "../Backend/kai/validators/kaiReviewCockpitRequestSchemas.js";

const SERVICE_PATH = "Backend/kai/services/kaiReviewCockpitService.js";
const READ_MODEL_PATH = "Backend/kai/db/kaiReviewCockpitReadModels.js";
const ROUTE_PATH = "Backend/kai/routes/sprint2IntakeApi.js";
const UI_PATH = "frontend/kaiReviewCockpit.jsx";
const ENTRY_PATH = "frontend/entry.jsx";
const HOST_PATH = "index.js";
const TEMPLATE_PATH = "views/kai-review-cockpit.ejs";

const serviceSource = readFileSync(new URL(`../${SERVICE_PATH}`, import.meta.url), "utf8");
const readModelSource = readFileSync(new URL(`../${READ_MODEL_PATH}`, import.meta.url), "utf8");
const routeSource = readFileSync(new URL(`../${ROUTE_PATH}`, import.meta.url), "utf8");
const uiSource = readFileSync(new URL(`../${UI_PATH}`, import.meta.url), "utf8");
const entrySource = readFileSync(new URL(`../${ENTRY_PATH}`, import.meta.url), "utf8");
const hostSource = readFileSync(new URL(`../${HOST_PATH}`, import.meta.url), "utf8");
const templateSource = readFileSync(new URL(`../${TEMPLATE_PATH}`, import.meta.url), "utf8");

const ORG = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const OTHER_ORG = "b5d17c5a-c55f-43af-9b21-fe63aafe733f";
const QUEUE_ITEM = "9e426ea1-2be3-4e48-b80f-9783ddbacda1";
const OLDER_QUEUE_ITEM = "9e426ea1-2be3-4e48-b80f-9783ddbacda0";
const FILE_PROFILE = "50000000-0000-4000-8000-000000000001";
const INTAKE_FILE = "20000000-0000-4000-8000-000000000001";
const DATA_DICTIONARY = "60000000-0000-4000-8000-000000000001";
const SENSITIVITY = "80000000-0000-4000-8000-000000000001";
const CANDIDATE = "90000000-0000-4000-8000-000000000001";
const FINDING = "40000000-0000-4000-8000-000000000001";
const CREATED_AT = "2026-07-15T10:00:00.000Z";
const OLDER_CREATED_AT = "2026-07-15T09:00:00.000Z";
const UPDATED_AT = "2026-07-15T11:00:00.000Z";
const SHA = "a".repeat(64);

const SPRINT2_ONLY = { KAI_SPRINT2_ENABLED: "true" };

/**
 * Sentinels for every field class the P1-09 spec forbids from any response. They are
 * injected onto every synthetic row every read model returns, so a pass-through of a
 * raw row anywhere would surface them.
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

export function assertNoForbiddenFields(value) {
  const serialized = JSON.stringify(value);
  for (const [field, sentinel] of Object.entries(forbiddenRowSentinels)) {
    assert.equal(serialized.includes(`"${field}"`), false, `forbidden field present: ${field}`);
    assert.equal(serialized.includes(sentinel), false, `forbidden value present: ${sentinel}`);
  }
}

function humanActor(overrides = {}) {
  return {
    actorType: "human",
    actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
    kaiRoles: ["gk_operator"],
    organizationMemberships: [
      { organization_id: ORG, membership_status: "active", role_name: "gk_operator" },
    ],
    ...overrides,
  };
}

function queueRow(overrides = {}) {
  return {
    review_queue_item_id: QUEUE_ITEM,
    organization_id: ORG,
    queue_type: "source_candidate_review",
    target_object_type: "intake_source_candidate",
    target_object_id: CANDIDATE,
    priority: "medium",
    queue_status: "open",
    due_at: null,
    summary: "Review intake source-candidate stub for human classification.",
    required_action: "Human review is required.",
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    ...forbiddenRowSentinels,
    ...overrides,
  };
}

function fileProfileRecord(overrides = {}) {
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
      field_count: 3,
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
    ...overrides,
  };
}

function sourceCandidateRecord(overrides = {}) {
  return {
    sourceCandidate: {
      intake_source_candidate_id: CANDIDATE,
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
    },
    reviewQueueItem: queueRow(),
    promotionDecision: null,
    source: null,
    sourceVersion: null,
    ...overrides,
  };
}

function readDependencies(overrides = {}) {
  return {
    env: SPRINT2_ONLY,
    async listReviewCockpitQueueItems() {
      return [queueRow()];
    },
    async getReviewCockpitFileProfileRecord() {
      return fileProfileRecord();
    },
    async getReviewCockpitSensitivityProfileRecord() {
      return fileProfileRecord();
    },
    async getReviewCockpitSourceCandidateRecord() {
      return sourceCandidateRecord();
    },
    ...overrides,
  };
}

test("P1-09 read model: cockpit queue list is organization-scoped, canonically filtered, bounded, and keyset ordered on a unique tie-breaker", async () => {
  let firstPage = null;
  await listReviewCockpitQueueItems(
    ORG,
    {
      limit: 25,
      cursor: null,
      queueTypes: ["sensitivity_review", "source_candidate_review"],
      queueStatuses: ["open", "waiting_on_client"],
    },
    {
      async query(sql, params) {
        firstPage = { sql, params };
        return { rows: [] };
      },
    },
  );
  assert.match(firstPage.sql, /WHERE organization_id = \$1/);
  assert.match(firstPage.sql, /queue_type IN \(\$2, \$3\)/);
  assert.match(firstPage.sql, /queue_status IN \(\$4, \$5\)/);
  assert.match(firstPage.sql, /ORDER BY created_at DESC, review_queue_item_id DESC/);
  assert.match(firstPage.sql, /LIMIT \$6/);
  assert.doesNotMatch(firstPage.sql, /AND \(\n\s+created_at </);
  assert.deepEqual(firstPage.params, [
    ORG, "sensitivity_review", "source_candidate_review", "open", "waiting_on_client", 26,
  ]);

  let secondPage = null;
  await listReviewCockpitQueueItems(
    ORG,
    {
      limit: 2,
      cursor: { created_at: CREATED_AT, review_queue_item_id: QUEUE_ITEM },
      queueTypes: ["source_candidate_review"],
      queueStatuses: ["open"],
    },
    {
      async query(sql, params) {
        secondPage = { sql, params };
        return { rows: [] };
      },
    },
  );
  assert.match(secondPage.sql, /created_at < \$4/);
  assert.match(secondPage.sql, /created_at = \$4 AND review_queue_item_id < \$5/);
  assert.deepEqual(secondPage.params, [ORG, "source_candidate_review", "open", CREATED_AT, QUEUE_ITEM, 3]);
});

test("P1-09 read model: file-profile detail remains strict to file_profile_id", async () => {
  let fileProfileLookup = null;
  await getReviewCockpitFileProfileRecord(
    ORG,
    FILE_PROFILE,
    {
      async query(sql, params) {
        fileProfileLookup = fileProfileLookup || { sql, params };
        return { rows: [] };
      },
    },
  );

  assert.match(fileProfileLookup.sql, /FROM kai\.intake_file_profiles/);
  assert.match(fileProfileLookup.sql, /file_profile_id = \$2/);
  assert.doesNotMatch(fileProfileLookup.sql, /intake_sensitivity_profile_id = \$2/);
  assert.doesNotMatch(fileProfileLookup.sql, /p\.intake_file_id = \$2/);
  assert.deepEqual(fileProfileLookup.params, [ORG, FILE_PROFILE]);
});

test("P1-09 read model: sensitivity detail resolves organization-scoped sensitivity profile to its stored file_profile_id", async () => {
  const calls = [];
  await getReviewCockpitSensitivityProfileRecord(
    ORG,
    SENSITIVITY,
    {
      async query(sql, params) {
        calls.push({ sql, params });
        if (/FROM kai\.intake_sensitivity_profiles s/.test(sql)) {
          return {
            rows: [{
              file_profile_id: FILE_PROFILE,
              organization_id: ORG,
              intake_file_id: INTAKE_FILE,
              parser_name: "kai_local_profiling_kernel",
              parser_version: "1.0.0",
              checksum: SHA,
              profile_canonical_sha256: SHA,
              created_at: CREATED_AT,
            }],
          };
        }
        return { rows: [] };
      },
    },
  );

  assert.match(calls[0].sql, /FROM kai\.intake_sensitivity_profiles s/);
  assert.match(calls[0].sql, /JOIN kai\.intake_file_profiles p/);
  assert.match(calls[0].sql, /s\.organization_id = \$1/);
  assert.match(calls[0].sql, /s\.intake_sensitivity_profile_id = \$2/);
  assert.deepEqual(calls[0].params, [ORG, SENSITIVITY]);
  assert.deepEqual(calls[1].params, [ORG, FILE_PROFILE]);
});

test("P1-09 read models and services contain no mutation SQL and the service imports no database pool", () => {
  assert.doesNotMatch(readModelSource, /\bINSERT INTO\b|\bUPDATE\s+kai\.|\bDELETE FROM\b|\bTRUNCATE\b|\bALTER TABLE\b/i);
  assert.doesNotMatch(readModelSource, /FOR UPDATE/);
  assert.doesNotMatch(serviceSource, /\bSELECT\b|\bINSERT INTO\b|\bDELETE FROM\b/);
  assert.doesNotMatch(serviceSource, /import\s+pool\s+from/);
});

/**
 * Regression for the production review-cockpit source-candidate detail 500:
 * getReviewCockpitSourceCandidateRecord composed its reads from the P1-07/P1-08
 * write-path `getScoped*` lookups in kaiIntakeQueries.js, which take a `FOR UPDATE`
 * row lock so the P1-07/P1-08 repositories can decide replay-vs-write inside one
 * transaction. Reusing those exact queries for this display-only GET meant every
 * source-candidate detail request issued three standalone `SELECT ... FOR UPDATE`
 * statements outside of any write transaction - taking a real row lock (and
 * requiring UPDATE table privilege) purely to render a page. The static source
 * check above only ever scanned this file's own text, so it could not catch a
 * `FOR UPDATE` pulled in transitively through an import; this test instead spies on
 * every query the real read model issues (through the real kaiIntakeQueries.js
 * functions, not a stubbed reader) and asserts none of them lock a row.
 */
test("P1-09 read model: the source-candidate detail read never issues a locking (FOR UPDATE) query", async () => {
  const issuedQueries = [];
  const db = {
    async query(sql, params) {
      issuedQueries.push(sql);
      if (/FROM kai\.intake_source_candidates/.test(sql)) {
        return {
          rows: [{
            intake_source_candidate_id: CANDIDATE,
            organization_id: ORG,
            intake_file_id: INTAKE_FILE,
            file_profile_id: FILE_PROFILE,
            data_dictionary_id: DATA_DICTIONARY,
            intake_sensitivity_profile_id: SENSITIVITY,
            profile_canonical_sha256: SHA,
            proposed_source_type: "unknown",
            candidate_status: "needs_gk_review",
            created_at: CREATED_AT,
          }],
        };
      }
      if (/FROM kai\.review_queue_items/.test(sql)) {
        return {
          rows: [{
            review_queue_item_id: QUEUE_ITEM,
            organization_id: ORG,
            queue_type: "source_candidate_review",
            target_object_type: "intake_source_candidate",
            target_object_id: CANDIDATE,
            priority: "medium",
            queue_status: "open",
            review_status: "needs_gk_review",
            assigned_to: null,
            due_at: null,
            summary: "Review intake source-candidate stub for human classification.",
            required_action: "Human review is required.",
            queue_metadata: {},
            created_at: CREATED_AT,
            updated_at: UPDATED_AT,
          }],
        };
      }
      return { rows: [] };
    },
  };

  const record = await getReviewCockpitSourceCandidateRecord(ORG, CANDIDATE, db);
  assert.equal(record.sourceCandidate.intake_source_candidate_id, CANDIDATE);
  assert.equal(record.reviewQueueItem.review_status, "needs_gk_review");
  assert.equal(record.promotionDecision, null);

  assert.ok(issuedQueries.length >= 3, "expected the candidate, queue-item, and decision reads to all run");
  for (const sql of issuedQueries) {
    assert.doesNotMatch(sql, /FOR UPDATE/i);
  }
});

test("P1-09 routes call authorized services only: no SQL, no pool import, no kai.* access, no KAI DB helper call", () => {
  assert.doesNotMatch(routeSource, /import\s+pool\s+from/);
  assert.doesNotMatch(routeSource, /kaiDb\.js|kaiIntakeQueries\.js|kaiReadModels\.js|kaiReviewCockpitReadModels\.js/);
  assert.doesNotMatch(routeSource, /\bkai\.[a-z_]+\b/);
  assert.doesNotMatch(routeSource, /\bSELECT\b|\bINSERT INTO\b|\bUPDATE\b|\bDELETE FROM\b/);
  for (const path of [
    '"/admin/review-cockpit/queue"',
    '"/admin/review-cockpit/file-profiles/:fileProfileId"',
    '"/admin/review-cockpit/sensitivity-profiles/:intakeSensitivityProfileId"',
    '"/admin/review-cockpit/source-candidates/:intakeSourceCandidateId"',
    '"/admin/review-cockpit/source-candidates/:intakeSourceCandidateId/decision"',
  ]) {
    assert.ok(routeSource.includes(path), path);
  }
  assert.doesNotMatch(routeSource, /\/internal\/kai/);
});

test("P1-09 frontend dispatches review-cockpit details by queue_type plus target_object_type and fails closed", () => {
  assert.match(
    uiSource,
    /queue_type === "source_candidate_review"[\s\S]*target_object_type === "intake_source_candidate"[\s\S]*\/source-candidates\/\$\{item\.target_object_id\}/,
  );
  assert.match(
    uiSource,
    /queue_type === "sensitivity_review"[\s\S]*target_object_type === "intake_sensitivity_profile"[\s\S]*\/sensitivity-profiles\/\$\{item\.target_object_id\}/,
  );
  assert.doesNotMatch(uiSource, /item\.queue_type === "source_candidate_review"\s*\?[\s\S]*:[\s\S]*\/file-profiles\/\$\{item\.target_object_id\}/);
  assert.match(uiSource, /const route = detailRouteForQueueItem\(item\);[\s\S]*if \(!route\)[\s\S]*return;/);
});

test("P1-09 route identifiers require an explicit organization scope and a canonical lowercase object id", () => {
  const { reviewCockpitIdentifiers } = intakeRouteTestables;
  assert.deepEqual(
    reviewCockpitIdentifiers({ query: { organization_id: ORG }, params: { fileProfileId: FILE_PROFILE } }, "fileProfileId"),
    { organizationId: ORG, objectId: FILE_PROFILE },
  );
  for (const request of [
    { query: {}, params: { fileProfileId: FILE_PROFILE } },
    { query: { organization_id: "not-a-uuid" }, params: { fileProfileId: FILE_PROFILE } },
    { query: { organization_id: ORG }, params: {} },
    { query: { organization_id: ORG }, params: { fileProfileId: ORG.toUpperCase() } },
    { query: { organization_id: ORG }, params: { fileProfileId: "not-a-uuid" } },
  ]) {
    assert.equal(reviewCockpitIdentifiers(request, "fileProfileId"), null, JSON.stringify(request));
  }
});

test("P1-09 service: KAI_SPRINT2_ENABLED disabled returns feature_disabled with zero read-model calls on every endpoint", async () => {
  for (const env of [{}, { KAI_SPRINT2_ENABLED: "false" }]) {
    const calls = [];
    const dependencies = readDependencies({
      env,
      async listReviewCockpitQueueItems() { calls.push("queue"); return []; },
      async getReviewCockpitFileProfileRecord() { calls.push("file"); return null; },
      async getReviewCockpitSensitivityProfileRecord() { calls.push("sensitivity"); return null; },
      async getReviewCockpitSourceCandidateRecord() { calls.push("candidate"); return null; },
      async createSourcePromotionDecision() { calls.push("decision"); return { ok: true, data: {}, error: null }; },
    });
    const results = [
      await listReviewCockpitQueue({ organizationId: ORG, actorContext: humanActor(), selection: {} }, dependencies),
      await getReviewCockpitFileProfileDetail({ organizationId: ORG, actorContext: humanActor(), fileProfileId: FILE_PROFILE }, dependencies),
      await getReviewCockpitSensitivityProfileDetail({ organizationId: ORG, actorContext: humanActor(), intakeSensitivityProfileId: SENSITIVITY }, dependencies),
      await getReviewCockpitSourceCandidateDetail({ organizationId: ORG, actorContext: humanActor(), intakeSourceCandidateId: CANDIDATE }, dependencies),
      await submitSourceCandidateDecision({ organizationId: ORG, actorContext: humanActor(), intakeSourceCandidateId: CANDIDATE, payload: { outcome: "rejected" } }, dependencies),
    ];
    for (const result of results) {
      assert.equal(result.ok, false, JSON.stringify({ env, result }));
      assert.equal(result.error.code, "feature_disabled");
    }
    assert.deepEqual(calls, []);
  }
});

test("P1-09 service: with KAI_SPRINT2_ENABLED on, reads are available, decision controls are enabled, and the decision seam is reachable", async () => {
  const decisionCalls = [];
  const dependencies = readDependencies({
    env: SPRINT2_ONLY,
    async createSourcePromotionDecision(input) { decisionCalls.push(input); return { ok: true, data: {}, error: null }; },
  });

  const queue = await listReviewCockpitQueue({ organizationId: ORG, actorContext: humanActor(), selection: {} }, dependencies);
  assert.equal(queue.ok, true);
  const fileProfile = await getReviewCockpitFileProfileDetail({ organizationId: ORG, actorContext: humanActor(), fileProfileId: FILE_PROFILE }, dependencies);
  assert.equal(fileProfile.ok, true);
  const sensitivityProfile = await getReviewCockpitSensitivityProfileDetail({ organizationId: ORG, actorContext: humanActor(), intakeSensitivityProfileId: SENSITIVITY }, dependencies);
  assert.equal(sensitivityProfile.ok, true);
  assert.equal(sensitivityProfile.data.file_profile.file_profile_id, FILE_PROFILE);
  assert.equal(sensitivityProfile.data.sensitivity_posture.intake_sensitivity_profile_id, SENSITIVITY);
  const candidate = await getReviewCockpitSourceCandidateDetail({ organizationId: ORG, actorContext: humanActor(), intakeSourceCandidateId: CANDIDATE }, dependencies);
  assert.equal(candidate.ok, true);
  assert.equal(candidate.data.decision_controls_enabled, true);
  assert.deepEqual(
    [...candidate.data.allowed_reviewed_source_types].sort(),
    ["organization_primary_record", "organization_secondary_record", "public_record", "third_party_provided_record"],
  );

  const decision = await submitSourceCandidateDecision(
    { organizationId: ORG, actorContext: humanActor(), intakeSourceCandidateId: CANDIDATE, payload: { outcome: "rejected" } },
    dependencies,
  );
  assert.notEqual(decision.error?.code, "feature_disabled");
  assert.equal(decisionCalls.length, 1, "the decision seam must be reached rather than short-circuited");
});

test("P1-09 service: a P1-08 validation_blocker's exact_verification_phase propagates unchanged through submitSourceCandidateDecision to the route logger", async () => {
  const PHASE = __sourcePromotionRepositoryContract.SOURCE_PROMOTION_EXACT_VERIFICATION_PHASE.CANDIDATE_REVIEW_INCOMPLETE;
  const dependencies = readDependencies({
    env: SPRINT2_ONLY,
    async createSourcePromotionDecision() {
      return {
        ok: false,
        data: { exact_verification_phase: PHASE },
        error: { code: "validation_blocker", status: 422 },
      };
    },
  });

  const result = await submitSourceCandidateDecision(
    { organizationId: ORG, actorContext: humanActor(), intakeSourceCandidateId: CANDIDATE, payload: { outcome: "rejected" } },
    dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.data?.exact_verification_phase, PHASE);

  // Same behavior/blockers/status the route already sends for validation_blocker,
  // now with a non-null, sanitized exact_verification_phase reaching the logger.
  let jsonBody = null;
  const res = {
    statusCode: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { jsonBody = body; return this; },
  };
  intakeRouteTestables.sendServiceResult(res, result, 200);
  assert.equal(res.statusCode, 422);
  assert.equal(jsonBody.ok, false);
  assert.equal(jsonBody.error.code, "validation_blocker");
  assert.deepEqual(jsonBody.blockers, []);
  assert.equal(jsonBody.data.exact_verification_phase, PHASE);

  const logCalls = [];
  const originalLog = console.log;
  console.log = (...args) => logCalls.push(args);
  try {
    intakeRouteTestables.logKaiSprint2IntakeRequest(
      { method: "POST", path: "/admin/review-cockpit/source-candidates/x/decision" },
      { statusCode: res.statusCode },
      jsonBody,
    );
  } finally {
    console.log = originalLog;
  }
  assert.equal(logCalls.length, 1);
  assert.equal(logCalls[0][1].exact_verification_phase, PHASE);
  assert.equal(logCalls[0][1]["error.code"], "validation_blocker");
});

test("P1-09 service: an operation-specific source-promotion DB-constraint exact_verification_phase (source_promotion_<operation>_23514/p0001/22p02) propagates unchanged through submitSourceCandidateDecision, sendServiceResult, and the route logger with unchanged status/error.code/blockers", async () => {
  const PHASE = "source_promotion_decision_insert_23514";
  const dependencies = readDependencies({
    env: SPRINT2_ONLY,
    async createSourcePromotionDecision() {
      return {
        ok: false,
        data: { exact_verification_phase: PHASE },
        error: { code: "validation_blocker", status: 422 },
      };
    },
  });

  const result = await submitSourceCandidateDecision(
    { organizationId: ORG, actorContext: humanActor(), intakeSourceCandidateId: CANDIDATE, payload: { outcome: "rejected" } },
    dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.data?.exact_verification_phase, PHASE);

  let jsonBody = null;
  const res = {
    statusCode: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { jsonBody = body; return this; },
  };
  intakeRouteTestables.sendServiceResult(res, result, 200);
  assert.equal(res.statusCode, 422);
  assert.equal(jsonBody.ok, false);
  assert.equal(jsonBody.error.code, "validation_blocker");
  assert.deepEqual(jsonBody.blockers, []);
  assert.equal(jsonBody.data.exact_verification_phase, PHASE);

  const logCalls = [];
  const originalLog = console.log;
  console.log = (...args) => logCalls.push(args);
  try {
    intakeRouteTestables.logKaiSprint2IntakeRequest(
      { method: "POST", path: "/admin/review-cockpit/source-candidates/x/decision" },
      { statusCode: res.statusCode },
      jsonBody,
    );
  } finally {
    console.log = originalLog;
  }
  assert.equal(logCalls.length, 1);
  assert.equal(logCalls[0][1].exact_verification_phase, PHASE);
  assert.equal(logCalls[0][1]["error.code"], "validation_blocker");
});

test("P1-09 route sanitization: every whitelisted operation-specific source-promotion phase token from the repository's own stage x SQLSTATE mapping survives sendServiceResult sanitization unchanged", () => {
  const byStage = __sourcePromotionRepositoryContract.SOURCE_PROMOTION_OPERATION_PHASE_BY_STAGE_AND_SQLSTATE;
  const allTokens = Object.values(byStage).flatMap((byCode) => Object.values(byCode));
  assert.ok(allTokens.length >= 30, `expected at least 30 tokens, saw ${allTokens.length}`);
  for (const phase of allTokens) {
    let jsonBody = null;
    const res = {
      statusCode: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { jsonBody = body; return this; },
    };
    intakeRouteTestables.sendServiceResult(
      res,
      { ok: false, error: { code: "validation_blocker", status: 422 }, data: { exact_verification_phase: phase } },
      200,
    );
    assert.equal(jsonBody.data?.exact_verification_phase, phase, phase);
  }
});

test("P1-09 service: with KAI_SPRINT2_ENABLED enabled the source-candidate detail advertises the P1-08 reviewed-source-type vocabulary", async () => {
  const result = await getReviewCockpitSourceCandidateDetail(
    { organizationId: ORG, actorContext: humanActor(), intakeSourceCandidateId: CANDIDATE },
    readDependencies({ env: SPRINT2_ONLY }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.decision_controls_enabled, true);
  assert.deepEqual(
    [...result.data.allowed_reviewed_source_types].sort(),
    ["organization_primary_record", "organization_secondary_record", "public_record", "third_party_provided_record"],
  );
});

test("P1-09 service: every endpoint rejects non-human actors with zero read-model calls", async () => {
  for (const actorType of ["ai", "system", "import", "code", "generic_service"]) {
    const calls = [];
    const dependencies = readDependencies({
      env: SPRINT2_ONLY,
      async listReviewCockpitQueueItems() { calls.push("queue"); return []; },
      async getReviewCockpitFileProfileRecord() { calls.push("file"); return null; },
      async getReviewCockpitSensitivityProfileRecord() { calls.push("sensitivity"); return null; },
      async getReviewCockpitSourceCandidateRecord() { calls.push("candidate"); return null; },
      async createSourcePromotionDecision() { calls.push("decision"); return { ok: true, data: {}, error: null }; },
    });
    const actorContext = humanActor({ actorType });
    for (const result of [
      await listReviewCockpitQueue({ organizationId: ORG, actorContext, selection: {} }, dependencies),
      await getReviewCockpitFileProfileDetail({ organizationId: ORG, actorContext, fileProfileId: FILE_PROFILE }, dependencies),
      await getReviewCockpitSensitivityProfileDetail({ organizationId: ORG, actorContext, intakeSensitivityProfileId: SENSITIVITY }, dependencies),
      await getReviewCockpitSourceCandidateDetail({ organizationId: ORG, actorContext, intakeSourceCandidateId: CANDIDATE }, dependencies),
      await submitSourceCandidateDecision({ organizationId: ORG, actorContext, intakeSourceCandidateId: CANDIDATE, payload: { outcome: "rejected" } }, dependencies),
    ]) {
      assert.equal(result.ok, false, actorType);
      assert.equal(result.error.code, "authorization_denied", actorType);
    }
    assert.deepEqual(calls, []);
  }
});

test("P1-09 service (role enforcement): only a GLOBAL gk_admin/gk_operator/gk_reviewer role, plus active membership in the requested organization, is allowed", async () => {
  assert.deepEqual(
    [...__reviewCockpitServiceContract.REVIEW_COCKPIT_READ_ROLES].sort(),
    ["gk_admin", "gk_operator", "gk_reviewer"],
  );

  for (const role of ["gk_admin", "gk_operator", "gk_reviewer"]) {
    const result = await listReviewCockpitQueue(
      {
        organizationId: ORG,
        actorContext: humanActor({
          kaiRoles: [role],
          organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: role }],
        }),
        selection: {},
      },
      readDependencies(),
    );
    assert.equal(result.ok, true, role);
  }

  // An org-scoped role_name is tenant scope only: it must never substitute for the
  // required global GK capability role, even when it names gk_admin/gk_operator/
  // gk_reviewer and the membership is active.
  const scopedOnlyDenials = ["gk_admin", "gk_operator", "gk_reviewer"].map((role) =>
    humanActor({
      kaiRoles: [],
      organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: role }],
    }),
  );

  const deniedScenarios = [
    humanActor({ organizationMemberships: [] }),
    humanActor({
      kaiRoles: [],
      organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "org_viewer" }],
    }),
    humanActor({ organizationMemberships: [{ organization_id: ORG, membership_status: "revoked", role_name: "gk_operator" }] }),
    humanActor({ organizationMemberships: [{ organization_id: ORG, membership_status: "invited", role_name: "gk_operator" }] }),
    humanActor({
      kaiRoles: [],
      organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_admin" }],
    }),
    ...scopedOnlyDenials,
  ];
  for (const actorContext of deniedScenarios) {
    const calls = [];
    const result = await listReviewCockpitQueue(
      { organizationId: ORG, actorContext, selection: {} },
      readDependencies({ async listReviewCockpitQueueItems() { calls.push("queue"); return []; } }),
    );
    assert.equal(result.ok, false, JSON.stringify(actorContext));
    assert.equal(result.error.code, "authorization_denied");
    assert.deepEqual(calls, []);
  }
});

test("P1-09 service (role enforcement): a global gk_admin/gk_operator/gk_reviewer capability combines with active org-scoped membership of any read_intake-eligible role", async () => {
  for (const role of ["gk_admin", "gk_operator", "gk_reviewer"]) {
    const result = await listReviewCockpitQueue(
      {
        organizationId: ORG,
        actorContext: humanActor({
          kaiRoles: [role],
          organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_admin" }],
        }),
        selection: {},
      },
      readDependencies(),
    );
    assert.equal(result.ok, true, role);
  }

  const withoutOrgAccess = await listReviewCockpitQueue(
    {
      organizationId: ORG,
      actorContext: humanActor({ kaiRoles: ["gk_admin"], organizationMemberships: [] }),
      selection: {},
    },
    readDependencies(),
  );
  assert.equal(withoutOrgAccess.ok, false);
  assert.equal(withoutOrgAccess.error.code, "authorization_denied");

  const crossTenantMembership = await listReviewCockpitQueue(
    {
      organizationId: ORG,
      actorContext: humanActor({
        kaiRoles: ["gk_admin"],
        organizationMemberships: [{ organization_id: OTHER_ORG, membership_status: "active", role_name: "org_viewer" }],
      }),
      selection: {},
    },
    readDependencies(),
  );
  assert.equal(crossTenantMembership.ok, false);
  assert.equal(crossTenantMembership.error.code, "authorization_denied");
});

test("P1-09 service (tenant isolation): an actor with membership only in another organization is denied, and every read is scoped to the requested organization_id", async () => {
  const crossTenantCalls = [];
  const crossTenant = await listReviewCockpitQueue(
    {
      organizationId: OTHER_ORG,
      actorContext: humanActor(),
      selection: {},
    },
    readDependencies({ async listReviewCockpitQueueItems() { crossTenantCalls.push("queue"); return []; } }),
  );
  assert.equal(crossTenant.ok, false);
  assert.equal(crossTenant.error.code, "authorization_denied");
  assert.deepEqual(crossTenantCalls, []);

  const scopedCalls = [];
  await listReviewCockpitQueue(
    { organizationId: ORG, actorContext: humanActor(), selection: {} },
    readDependencies({
      async listReviewCockpitQueueItems(organizationId, selection) {
        scopedCalls.push({ organizationId, selection });
        return [queueRow()];
      },
    }),
  );
  assert.equal(scopedCalls.length, 1);
  assert.equal(scopedCalls[0].organizationId, ORG);

  // A row belonging to another organization can never be shaped into a response.
  const leakedRow = await listReviewCockpitQueue(
    { organizationId: ORG, actorContext: humanActor(), selection: {} },
    readDependencies({ async listReviewCockpitQueueItems() { return [queueRow({ organization_id: OTHER_ORG })]; } }),
  );
  assert.equal(leakedRow.ok, false);
  assert.equal(leakedRow.error.code, "system_error");

  for (const [reader, input] of [
    ["getReviewCockpitFileProfileRecord", { fileProfileId: FILE_PROFILE }],
    ["getReviewCockpitSensitivityProfileRecord", { intakeSensitivityProfileId: SENSITIVITY }],
    ["getReviewCockpitSourceCandidateRecord", { intakeSourceCandidateId: CANDIDATE }],
  ]) {
    const seen = [];
    const dependencies = readDependencies({
      [reader]: async (organizationId) => {
        seen.push(organizationId);
        return reader === "getReviewCockpitSourceCandidateRecord" ? sourceCandidateRecord() : fileProfileRecord();
      },
    });
    const detail = reader === "getReviewCockpitFileProfileRecord"
      ? await getReviewCockpitFileProfileDetail({ organizationId: ORG, actorContext: humanActor(), ...input }, dependencies)
      : reader === "getReviewCockpitSensitivityProfileRecord"
        ? await getReviewCockpitSensitivityProfileDetail({ organizationId: ORG, actorContext: humanActor(), ...input }, dependencies)
        : await getReviewCockpitSourceCandidateDetail({ organizationId: ORG, actorContext: humanActor(), ...input }, dependencies);
    assert.equal(detail.ok, true, reader);
    assert.deepEqual(seen, [ORG], reader);
  }
});

test("P1-09 DTO allowlists: no raw content, storage location, object key, signed URL, credential, prompt, internal note, or unrestricted audit metadata reaches any response", async () => {
  const dependencies = readDependencies({ env: SPRINT2_ONLY });

  const queue = await listReviewCockpitQueue({ organizationId: ORG, actorContext: humanActor(), selection: {} }, dependencies);
  assert.equal(queue.ok, true);
  assertNoForbiddenFields(queue);
  assert.deepEqual(Object.keys(queue.data.items[0]).sort(), [
    "created_at", "due_at", "organization_id", "priority", "queue_status", "queue_type",
    "required_action", "review_queue_item_id", "summary", "target_object_id",
    "target_object_type", "updated_at",
  ]);

  const fileProfile = await getReviewCockpitFileProfileDetail({ organizationId: ORG, actorContext: humanActor(), fileProfileId: FILE_PROFILE }, dependencies);
  assert.equal(fileProfile.ok, true);
  assertNoForbiddenFields(fileProfile);
  assert.deepEqual(Object.keys(fileProfile.data).sort(), [
    "allowed_use_restrictions", "data_dictionary", "file_profile", "quality_findings",
    "read_only", "sensitivity_posture",
  ]);
  assert.deepEqual(Object.keys(fileProfile.data.file_profile).sort(), [
    "checksum", "created_at", "file_profile_id", "intake_file_id", "organization_id",
    "parser_name", "parser_version", "profile_canonical_sha256",
  ]);

  const sensitivityProfile = await getReviewCockpitSensitivityProfileDetail({ organizationId: ORG, actorContext: humanActor(), intakeSensitivityProfileId: SENSITIVITY }, dependencies);
  assert.equal(sensitivityProfile.ok, true);
  assertNoForbiddenFields(sensitivityProfile);
  assert.equal(sensitivityProfile.data.file_profile.file_profile_id, FILE_PROFILE);
  assert.equal(sensitivityProfile.data.sensitivity_posture.intake_sensitivity_profile_id, SENSITIVITY);

  const candidate = await getReviewCockpitSourceCandidateDetail({ organizationId: ORG, actorContext: humanActor(), intakeSourceCandidateId: CANDIDATE }, dependencies);
  assert.equal(candidate.ok, true);
  assertNoForbiddenFields(candidate);
  assert.deepEqual(Object.keys(candidate.data.review_queue_item).sort(), [
    "organization_id", "queue_status", "queue_type", "review_queue_item_id",
    "review_status", "target_object_id", "target_object_type",
  ]);
});

test("P1-09 DTO allowlists: an unsafe quality-finding detail is refused rather than emitted", async () => {
  const record = fileProfileRecord();
  record.qualityFindings[0].finding_detail_safe = "See https://example.test/leak for the api_key";
  const result = await getReviewCockpitFileProfileDetail(
    { organizationId: ORG, actorContext: humanActor(), fileProfileId: FILE_PROFILE },
    readDependencies({ async getReviewCockpitFileProfileRecord() { return record; } }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
});

test("P1-09 file-profile review is read-only: the package exposes no file-profile mutation service, route, or state vocabulary", () => {
  assert.doesNotMatch(serviceSource, /export async function (?:update|approve|reject|resolve|set|mark|delete)[A-Za-z]*FileProfile/);
  assert.doesNotMatch(serviceSource, /file_profile_review_status|file_profile_approval|file_profile_eligibility/);
  assert.doesNotMatch(routeSource, /review-cockpit\/file-profiles\/:fileProfileId\/[a-z-]+/);
  const fileProfileRoutes = routeSource.match(/router\.[a-z]+\("\/admin\/review-cockpit\/file-profiles[^"]*"/g) || [];
  assert.deepEqual(fileProfileRoutes, [
    'router.get("/admin/review-cockpit/file-profiles/:fileProfileId"',
  ]);
  // The only mutating cockpit routes are the two human-decision routes (P1-08's
  // source-candidate promotion decision and B1A-2's Phase-5 sensitivity/allowed-use
  // decision) plus B1A-2R's review-work route, which only ensures the P1-06
  // 'sensitivity_review' work item exists - it starts no substantive review
  // authority and records no classification/consent/allowed-use/decision. None of
  // the three mutates a file profile, and no other cockpit POST exists.
  const cockpitPosts = routeSource.match(/router\.post\("\/admin\/review-cockpit[^"]*"/g) || [];
  assert.deepEqual(cockpitPosts, [
    'router.post("/admin/review-cockpit/sensitivity-profiles/:intakeSensitivityProfileId/decision"',
    'router.post("/admin/review-cockpit/sensitivity-profiles/:intakeSensitivityProfileId/review-work"',
    'router.post("/admin/review-cockpit/source-candidates/:intakeSourceCandidateId/decision"',
  ]);
});

test("P1-09 queue reads never invoke, import, or imply a promotion call", () => {
  const listBody = serviceSource.match(/export async function listReviewCockpitQueue\([\s\S]*?\n}\n/)?.[0];
  const fileBody = serviceSource.match(/export async function getReviewCockpitFileProfileDetail\([\s\S]*?\n}\n/)?.[0];
  const sensitivityBody = serviceSource.match(/export async function getReviewCockpitSensitivityProfileDetail\([\s\S]*?\n}\n/)?.[0];
  const candidateBody = serviceSource.match(/export async function getReviewCockpitSourceCandidateDetail\([\s\S]*?\n}\n/)?.[0];
  for (const body of [listBody, fileBody, sensitivityBody, candidateBody]) {
    assert.ok(body);
    assert.doesNotMatch(body, /createSourcePromotionDecision/);
  }
  // The P1-08 decision service is resolved exactly once, and invoked exactly once,
  // in the whole module - inside submitSourceCandidateDecision only.
  assert.equal(
    (serviceSource.match(/const decide = deps\.createSourcePromotionDecision \|\| createSourcePromotionDecision;/g) || []).length,
    1,
  );
  assert.equal((serviceSource.match(/await decide\(/g) || []).length, 1);
  const decisionBody = serviceSource.match(/export async function submitSourceCandidateDecision\([\s\S]*?\n}\n/)?.[0];
  assert.ok(decisionBody);
  assert.match(decisionBody, /const decide = deps\.createSourcePromotionDecision/);
});

test("P1-09 decision seam: passes the request through to P1-08 unchanged and never retries or coerces a conflict", async () => {
  const calls = [];
  const dependencies = readDependencies({
    env: SPRINT2_ONLY,
    now: () => Date.parse("2026-08-05T12:00:00.000Z"),
    async createSourcePromotionDecision(input, injected) {
      calls.push({ input, injected });
      return { ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409 } };
    },
  });

  const result = await submitSourceCandidateDecision(
    { organizationId: ORG, actorContext: humanActor(), intakeSourceCandidateId: CANDIDATE, payload: { outcome: "promoted", reviewed_source_type: "public_record" } },
    dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(result.error.status, 409);
  assert.equal(calls.length, 1, "a conflict must never trigger a second mutation attempt");
  assert.deepEqual(Object.keys(calls[0].input).sort(), [
    "actorContext", "intakeSourceCandidateId", "now", "organizationId", "outcome", "reviewedSourceType",
  ]);
  assert.equal(calls[0].input.outcome, "promoted");
  assert.equal(calls[0].input.reviewedSourceType, "public_record");
  assert.equal(calls[0].input.now, "2026-08-05T12:00:00.000Z");
});

test("P1-09 decision seam: the real/default runtime path composes a production metadataOnlyAudit dependency, not only a test double", async () => {
  const calls = [];
  const dependencies = readDependencies({
    env: SPRINT2_ONLY,
    now: () => Date.parse("2026-08-05T12:00:00.000Z"),
    async createSourcePromotionDecision(input, injected) {
      calls.push(injected);
      return { ok: true, data: {}, error: null };
    },
  });
  assert.equal("metadataOnlyAudit" in dependencies, false, "this dependency set supplies no test double");

  await submitSourceCandidateDecision(
    { organizationId: ORG, actorContext: humanActor(), intakeSourceCandidateId: CANDIDATE, payload: { outcome: "rejected" } },
    dependencies,
  );
  assert.equal(calls.length, 1, "the decision seam must be reached rather than short-circuited");
  const composedAudit = calls[0].metadataOnlyAudit;
  assert.equal(typeof composedAudit?.prepareMetadataOnlyAudit, "function");
  const prepared = composedAudit.prepareMetadataOnlyAudit({ payload: { attempted_operation: "source_promotion_decision_persisted" } });
  assert.equal(prepared.ok, true);
  assert.equal(typeof prepared.publish, "function");
});

test("P1-09 decision seam: a caller-supplied metadataOnlyAudit test double always overrides the production composition", async () => {
  const calls = [];
  const testDouble = { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => ({ ok: true }) }) };
  const dependencies = readDependencies({
    env: SPRINT2_ONLY,
    metadataOnlyAudit: testDouble,
    async createSourcePromotionDecision(input, injected) {
      calls.push(injected);
      return { ok: true, data: {}, error: null };
    },
  });

  await submitSourceCandidateDecision(
    { organizationId: ORG, actorContext: humanActor(), intakeSourceCandidateId: CANDIDATE, payload: { outcome: "rejected" } },
    dependencies,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].metadataOnlyAudit, testDouble);
});

test("P1-09 decision seam: non-promoted outcomes forward no reviewedSourceType at all", async () => {
  for (const outcome of ["needs_more_information", "rejected"]) {
    const calls = [];
    const result = await submitSourceCandidateDecision(
      { organizationId: ORG, actorContext: humanActor(), intakeSourceCandidateId: CANDIDATE, payload: { outcome } },
      readDependencies({
        env: SPRINT2_ONLY,
        async createSourcePromotionDecision(input) {
          calls.push(input);
          return { ok: false, data: null, error: { code: "not_found", status: 404 } };
        },
      }),
    );
    assert.equal(result.ok, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].outcome, outcome);
    assert.equal("reviewedSourceType" in calls[0], false, outcome);
  }
});

test("P1-09 request validators: closed query allowlist, canonical filters, bounded limit, and round-trippable cursor", () => {
  assert.deepEqual(REVIEW_COCKPIT_QUEUE_TYPES, [
    "intake_file_review", "sensitivity_review", "source_candidate_review",
  ]);

  assert.equal(validateReviewCockpitQueueQuery({ organization_id: ORG }).ok, true);
  assert.equal(validateReviewCockpitQueueQuery({ organization_id: ORG, limit: "25" }).ok, true);
  assert.equal(validateReviewCockpitQueueQuery({ organization_id: ORG, limit: "26" }).ok, false);
  assert.equal(validateReviewCockpitQueueQuery({ organization_id: ORG, limit: "0" }).ok, false);
  assert.equal(validateReviewCockpitQueueQuery({ organization_id: ORG, limit: 25 }).ok, false);
  assert.equal(validateReviewCockpitQueueQuery({ organization_id: ORG, unknown_key: "x" }).ok, false);
  assert.equal(validateReviewCockpitQueueQuery({ organization_id: ORG, queue_type: "evidence_review" }).ok, false);
  assert.equal(validateReviewCockpitQueueQuery({ organization_id: ORG, queue_status: "approved" }).ok, false);
  assert.equal(validateReviewCockpitQueueQuery({ organization_id: ORG, queue_type: ["a", "b"] }).ok, false);
  assert.equal(validateReviewCockpitQueueQuery({ organization_id: ORG, cursor: "not-base64url!" }).ok, false);

  const token = encodeReviewCockpitQueueCursor({ created_at: OLDER_CREATED_AT, review_queue_item_id: OLDER_QUEUE_ITEM });
  const decoded = validateReviewCockpitQueueQuery({ organization_id: ORG, cursor: token });
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.selection.cursor, { created_at: OLDER_CREATED_AT, review_queue_item_id: OLDER_QUEUE_ITEM });
  assert.throws(() => encodeReviewCockpitQueueCursor({ created_at: OLDER_CREATED_AT }), TypeError);
});

test("P1-09 request validators: the decision body allowlist mirrors the P1-08 outcome/reviewed-source-type rule", () => {
  assert.equal(validateSourceCandidateDecisionRequest({ outcome: "needs_more_information" }).ok, true);
  assert.equal(validateSourceCandidateDecisionRequest({ outcome: "rejected" }).ok, true);
  assert.equal(validateSourceCandidateDecisionRequest({ outcome: "promoted", reviewed_source_type: "public_record" }).ok, true);

  for (const payload of [
    null,
    {},
    { outcome: "decided" },
    { outcome: "promoted" },
    { outcome: "rejected", reviewed_source_type: "public_record" },
    { outcome: "needs_more_information", reviewed_source_type: "public_record" },
    { outcome: "rejected", extra: "x" },
    { outcome: ["rejected"] },
    { outcome: { value: "rejected" } },
    { outcome: null },
    { outcome: "promoted", reviewed_source_type: "Public Record" },
  ]) {
    const result = validateSourceCandidateDecisionRequest(payload);
    assert.equal(result.ok, false, JSON.stringify(payload));
    assert.equal(result.blockers.length, 1);
    assert.equal(result.blockers[0].severity, "blocker");
  }
});

test("P1-09 pagination determinism: a full page emits a next_cursor bound to the unique review_queue_item_id tie-breaker", async () => {
  const rows = [
    queueRow({ review_queue_item_id: QUEUE_ITEM, created_at: CREATED_AT }),
    queueRow({ review_queue_item_id: OLDER_QUEUE_ITEM, created_at: CREATED_AT }),
    queueRow({ review_queue_item_id: "9e426ea1-2be3-4e48-b80f-9783ddbacda2", created_at: OLDER_CREATED_AT }),
  ];
  const result = await listReviewCockpitQueue(
    { organizationId: ORG, actorContext: humanActor(), selection: { limit: 2 } },
    readDependencies({ async listReviewCockpitQueueItems() { return rows; } }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.items.length, 2);
  const decoded = JSON.parse(Buffer.from(result.data.pagination.next_cursor, "base64url").toString("utf8"));
  assert.deepEqual(decoded, { created_at: CREATED_AT, review_queue_item_id: OLDER_QUEUE_ITEM });

  const lastPage = await listReviewCockpitQueue(
    { organizationId: ORG, actorContext: humanActor(), selection: { limit: 25 } },
    readDependencies({ async listReviewCockpitQueueItems() { return rows; } }),
  );
  assert.equal(lastPage.data.pagination.next_cursor, null);
});

test("P1-09 introduces no evidence, locator, claim, graph, assistant-tool, generation, export, or client-facing surface", () => {
  for (const source of [serviceSource, readModelSource, uiSource]) {
    assert.doesNotMatch(source, /\b(?:evidence|locator|claim|graph_relationship|assistant_tool|generateContent|funder_export|public_export)\b/i);
  }
  assert.doesNotMatch(uiSource, /client[_-]review|clientPortal/i);
});

test("P1-09 UI hides the decision controls when the promotion flag is off and never fetches a database directly", () => {
  assert.match(uiSource, /if \(!detail\?\.decision_controls_enabled\) \{\n\s+return <p className="kai-cockpit-note">Source-decision controls are disabled\.<\/p>;/);
  assert.match(uiSource, /if \(featureEnabled !== true\) return null;/);
  assert.doesNotMatch(uiSource, /\bpg\b|\bpool\b|connectionString|process\.env/);
});

test("P1-09 host bootstrap no longer treats organizationId query text as cockpit tenant authority", () => {
  const hostRoute = hostSource.match(/app\.get\("\/gk-admin\/kai-review-cockpit"[\s\S]*?\n\}\);/)?.[0];
  assert.ok(hostRoute);
  assert.doesNotMatch(hostRoute, /req\.query\.organizationId/);
  assert.doesNotMatch(hostRoute, /organizationId:/);
  assert.doesNotMatch(templateSource, /kai-review-cockpit-props|organizationId|JSON\.parse\(document\.getElementById/);
  assert.match(templateSource, /window\.renderKaiReviewCockpit\("#kai-review-cockpit-root"\);/);
  assert.match(entrySource, /window\.renderKaiReviewCockpit = \(selector = "#kai-review-cockpit-root"\) =>/);
  assert.match(entrySource, /<KaiReviewCockpit \/>/);
  assert.doesNotMatch(entrySource, /renderKaiReviewCockpit[\s\S]*<KaiReviewCockpit \{\.\.\.props\}/);
});

test("P1-09 UI bootstraps cockpit organization context only from authorized organizations", () => {
  assert.match(uiSource, /import \{ organizationsPath \} from "\.\/kaiWebIntakeLogic\.js";/);
  assert.match(uiSource, /getJson\(organizationsPath\(\)\)/);
  assert.match(uiSource, /setLocalOrganization\(items\.length === 1 \? items\[0\]\.organization_id : ""\)/);
  assert.match(uiSource, /organizations\.some\(\(item\) => item\.organization_id === nextOrganizationId\)/);
  assert.match(uiSource, /value=\{organization\}[\s\S]{0,160}onChange=\{handleOrganizationChange\}/);
  assert.doesNotMatch(uiSource, /export default function KaiReviewCockpit\(\{ organizationId/);
  assert.doesNotMatch(uiSource, /useState\(organizationId\)/);
  assert.doesNotMatch(uiSource, /<input[^>]*value=\{organization\}/);
  assert.doesNotMatch(uiSource, /setOrganization\(event\.target\.value\.trim\(\)\)/);
  assert.doesNotMatch(uiSource, /localStorage|sessionStorage|window\.location|URLSearchParams\(window\.location/);
});

test("P1-09 UI blocks queue reads until organization bootstrap establishes an authorized tenant", () => {
  assert.match(uiSource, /const organizationUnavailable =[\s\S]*organizationsLoaded && organizations\.length === 0/);
  assert.match(uiSource, /const organizationSelectionRequired =[\s\S]*organizations\.length > 1 && !organization/);
  assert.match(uiSource, /const queueDisabled =[\s\S]*loadingOrganizations[\s\S]*organizationBootstrapError[\s\S]*organizationUnavailable[\s\S]*organizationSelectionRequired[\s\S]*!organization/);
  assert.match(uiSource, /No authorized KAI organization is available for this account\./);
  assert.match(uiSource, /Loading authorized KAI organizations\.\.\./);
  assert.match(uiSource, /Unable to load authorized KAI organizations\./);
});

test("P1-09 UI keeps candidate and organization identifiers separated during queue/detail flows", () => {
  assert.match(uiSource, /new URLSearchParams\(\{ organization_id: organization \}\)/);
  assert.match(uiSource, /\$\{COCKPIT_PATH\}\/source-candidates\/\$\{item\.target_object_id\}/);
  assert.match(uiSource, /\$\{COCKPIT_PATH\}\/sensitivity-profiles\/\$\{item\.target_object_id\}/);
  assert.match(uiSource, /\$\{route\.path\}\?organization_id=\$\{encodeURIComponent\(organization\)\}/);
  assert.match(uiSource, /const candidateId = detail\.source_candidate\.intake_source_candidate_id;/);
  assert.match(uiSource, /\$\{COCKPIT_PATH\}\/source-candidates\/\$\{candidateId\}\/decision\?organization_id=\$\{encodeURIComponent\(organization\)\}/);
  assert.match(uiSource, /\$\{COCKPIT_PATH\}\/source-candidates\/\$\{candidateId\}\?organization_id=\$\{encodeURIComponent\(organization\)\}/);
  assert.doesNotMatch(uiSource, /setOrganization\(item\.target_object_id\)/);
  assert.doesNotMatch(uiSource, /setOrganization\(candidateId\)/);
  assert.doesNotMatch(uiSource, /setOrganization\(detail\.source_candidate\.intake_source_candidate_id\)/);
});

test("P1-09 UI decision submit CTA is derived deterministically from the selected outcome and never adds a second submission path", () => {
  assert.match(
    uiSource,
    /function decisionSubmitLabel\(outcome\) \{\n\s+if \(outcome === "promoted"\) return "Promote";\n\s+if \(outcome === "rejected"\) return "Reject";\n\s+return "Record decision";\n\}/,
  );
  assert.match(uiSource, /<button type="submit" disabled=\{busy \|\| \(promotionSelected && !reviewedSourceType\)\}>\s*\n\s*\{decisionSubmitLabel\(outcome\)\}/);
  // Exactly one submit control renders inside the decision form - no second button
  // or second submission mechanism was added alongside it.
  const formBody = uiSource.match(/function SourceDecisionControls\([\s\S]*?\n}\n/)?.[0];
  assert.ok(formBody);
  assert.equal((formBody.match(/<button/g) || []).length, 1);
  assert.equal((formBody.match(/type="submit"/g) || []).length, 1);
  assert.doesNotMatch(formBody, /onClick=\{.*onSubmit/);
});

test("P1-09 UI decision payload omits reviewed_source_type for every non-promoted outcome and includes it only for promoted", () => {
  assert.match(
    uiSource,
    /onSubmit\(promotionSelected \? \{ outcome, reviewed_source_type: reviewedSourceType \} : \{ outcome \}\);/,
  );
});

test("P1-09 UI clears tenant-scoped queue and detail state when organization context changes", () => {
  assert.match(uiSource, /function clearTenantScopedState\(\) \{[\s\S]*setQueue\(null\);[\s\S]*setDetail\(null\);[\s\S]*setDetailKind\(null\);[\s\S]*setSelectedItemId\(null\);[\s\S]*setDecisionResult\(""\);[\s\S]*\}/);
  assert.match(uiSource, /setLocalOrganization\(nextOrganizationId\);[\s\S]*clearTenantScopedState\(\);/);
  assert.match(uiSource, /const activeOrganizationRef = useRef\(""\);/);
  assert.match(uiSource, /activeOrganizationRef\.current = organization;/);
  assert.match(uiSource, /if \(activeOrganizationRef\.current !== organization\) return;/);
});

// --- KAI B1A-3B ---------------------------------------------------------
//
// The B1A-3B product workflow lives exclusively in frontend/ImpactEvidenceLibrary.jsx
// and frontend/impactEvidenceLibraryLogic.js. frontend/kaiReviewCockpit.jsx (the
// admin surface asserted above) must carry no B1A-3B decision/review-work
// controls: this test proves the admin file was not touched to add them.
test("KAI B1A-3B: the admin Review Cockpit UI carries no Phase-5 sensitivity decision/review-work controls added by this package", () => {
  assert.doesNotMatch(uiSource, /reviewed_llm_processing_allowed|reviewed_public_use_allowed|reviewed_funder_use_allowed|reviewed_product_learning_allowed/);
  assert.doesNotMatch(uiSource, /\/review-work/);
  assert.doesNotMatch(uiSource, /sensitivity-profiles\/.*\/decision/);
});

function readCapabilitiesDependencies(overrides = {}) {
  return { env: SPRINT2_ONLY, ...overrides };
}

test("KAI B1A-3B getReviewCockpitCapabilities: an authorized global GK role gets true, an authenticated actor lacking that role gets false (200, not an error), and a non-human actor gets false", async () => {
  const dependencies = readCapabilitiesDependencies();

  const authorized = await getReviewCockpitCapabilities(
    { organizationId: ORG, actorContext: humanActor({ kaiRoles: ["gk_reviewer"] }) },
    dependencies,
  );
  assert.equal(authorized.ok, true);
  assert.deepEqual(authorized.data, { can_manage_sensitivity_review: true });

  const wrongRole = await getReviewCockpitCapabilities(
    { organizationId: ORG, actorContext: humanActor({ kaiRoles: [], organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_admin" }] }) },
    dependencies,
  );
  assert.equal(wrongRole.ok, true);
  assert.deepEqual(wrongRole.data, { can_manage_sensitivity_review: false });

  const nonHuman = await getReviewCockpitCapabilities(
    { organizationId: ORG, actorContext: { actorType: "system", actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b" } },
    dependencies,
  );
  assert.equal(nonHuman.ok, true);
  assert.deepEqual(nonHuman.data, { can_manage_sensitivity_review: false });
});

test("KAI B1A-3B getReviewCockpitCapabilities: never touches queue/profile/decision data, and fails closed on a disabled feature flag or invalid organization id", async () => {
  const dependencies = readCapabilitiesDependencies({ env: {} });
  const disabled = await getReviewCockpitCapabilities(
    { organizationId: ORG, actorContext: humanActor() },
    dependencies,
  );
  assert.equal(disabled.ok, false);
  assert.equal(disabled.error.code, "feature_disabled");

  const invalidOrg = await getReviewCockpitCapabilities(
    { organizationId: "not-a-uuid", actorContext: humanActor() },
    readCapabilitiesDependencies(),
  );
  assert.equal(invalidOrg.ok, false);
  assert.equal(invalidOrg.error.code, "invalid_request");

  const source = readFileSync(new URL("../Backend/kai/services/kaiReviewCockpitService.js", import.meta.url), "utf8");
  const fnBody = source.match(/export async function getReviewCockpitCapabilities\([\s\S]*?\n}\n/)?.[0];
  assert.ok(fnBody);
  assert.doesNotMatch(fnBody, /getReviewCockpitSensitivityProfileRecord|readSensitivityProfileRecord|listReviewCockpitQueueItems/);
});

test("KAI B1A-3B: the /admin/review-cockpit/capabilities route is mounted and preserves the existing router-level authentication gate (no new anonymous access)", () => {
  const routeSource = readFileSync(new URL("../Backend/kai/routes/sprint2IntakeApi.js", import.meta.url), "utf8");
  assert.match(routeSource, /router\.get\("\/admin\/review-cockpit\/capabilities", async \(req, res\) => \{/);
  // The route sits below the same router.use(requireKaiSprint2Enabled) gate as
  // every other route in this file - no per-route bypass of it is introduced.
  const capabilitiesBlock = routeSource.match(/router\.get\("\/admin\/review-cockpit\/capabilities"[\s\S]*?\n\}\);\n/)?.[0];
  assert.ok(capabilitiesBlock);
  assert.doesNotMatch(capabilitiesBlock, /ensureAdmin|skipAuth|bypassAuth/);
});
