import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import {
  createGrantResponseParagraphDraft,
  __generatedContentReviewPacketServiceTestables,
  __generatedContentServiceContract,
} from "../Backend/kai/services/kaiGeneratedContentService.js";
import { __testables as generatedDraftLibraryTestables } from "../Backend/kai/services/kaiGeneratedDraftLibraryService.js";
import { EXPORT_CANDIDATE_CONTENT_TYPES } from "../Backend/kai/dictionary/exportCandidateContract.js";
import {
  __generatedContentRepositoryContract,
  __generatedContentRepositoryTestables,
  fingerprintGrantResponseParagraphRequest,
  fingerprintEvidenceSummaryRequest,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import { generatedDraftContentTypeLabel } from "../frontend/impactEvidenceLibraryLogic.js";
import {
  __grantResponseParagraphDraftGeneratorContract,
  createProductionGrantResponseParagraphDraftGenerator,
} from "../Backend/kai/services/kaiGrantResponseParagraphDraftGenerator.js";
import { createAttachKaiSprint2ActorContext } from "../Backend/kai/middleware/kaiSprint2Authentication.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000601";
const OTHER_ENGAGEMENT = "00000000-0000-4000-8000-000000000602";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";
const SOURCE = "00000000-0000-4000-8000-000000000301";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000401";
const NOW = "2026-09-18T10:00:00.000Z";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
const routePath = "/admin/organizations/:organizationId/generated-content-drafts/grant-response-paragraph";

const adminActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});

const clientActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000003",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "client" },
  ],
});

function input(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    requestedAudience: "internal",
    claimIds: [CLAIM],
    idempotencyKey: "p13-ext5-grant-response-paragraph-key",
    actorContext: adminActorContext,
    now: NOW,
    ...overrides,
  };
}

function requestBody(overrides = {}) {
  return {
    engagement_id: ENGAGEMENT,
    claim_ids: [CLAIM],
    idempotency_key: "p13-ext5-grant-response-paragraph-route-key",
    requested_audience: "internal",
    ...overrides,
  };
}

async function stubGetEngagementForOrganization({ organizationId, engagementId }) {
  if (organizationId === ORG && engagementId === ENGAGEMENT) {
    return { engagement_id: ENGAGEMENT, organization_id: ORG };
  }
  return null;
}

function createResponse() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(field, value) {
      this.headers[field] = value;
      return this;
    },
    json(body) {
      this.body = body;
      return body;
    },
  };
}

async function invokeGrantResponseParagraphRoute(body, { actorContext = adminActorContext } = {}) {
  const routeLayer = sprint2IntakeApiRouter.stack
    .find((layer) => layer.route?.path === routePath && layer.route?.methods?.post);
  assert.ok(routeLayer);
  const req = {
    params: { organizationId: ORG },
    query: {},
    body,
    headers: { "content-type": "application/json" },
  };
  const res = createResponse();
  const restoreActorContextMiddleware = intakeRouteTestables.setActorContextMiddlewareForTest(
    createAttachKaiSprint2ActorContext({
      resolveActorContext: async () => ({ ok: true, actorContext }),
    }),
  );
  try {
    let index = 0;
    const next = async (error) => {
      if (error) throw error;
      const layer = routeLayer.route.stack[index++];
      if (!layer) return;
      await layer.handle(req, res, next);
    };
    await next();
    return res;
  } finally {
    restoreActorContextMiddleware();
  }
}

test("P13-EXT-5 canonical grant_response_paragraph registration is generic only", () => {
  assert.equal(__generatedContentServiceContract.ALLOWED_GENERATED_CONTENT_TYPES.has("grant_response_paragraph"), true);
  assert.equal(__generatedContentRepositoryContract.ALLOWED_GENERATED_CONTENT_TYPES.has("grant_response_paragraph"), true);
  assert.equal(EXPORT_CANDIDATE_CONTENT_TYPES.includes("grant_response_paragraph"), true);
  assert.equal(__generatedContentRepositoryContract.PACKET_MEMBER_CONTENT_TYPES.has("grant_response_paragraph"), false);
});

test("P13-EXT-5 route is mounted as an authenticated grant_response_paragraph draft-generation POST", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === routePath && layer.route?.methods?.post);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["post"]);
});

test("P13-EXT-5 HTTP route accepts exactly four body fields, admits internal/funder/public, rejects unknown audience and extra fields, and passes audience through", async (t) => {
  const calls = [];
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async createGrantResponseParagraphDraft(routeInput, dependencies) {
      calls.push({ input: routeInput, dependencies });
      return {
        ok: true,
        data: {
          generationRunId: "00000000-0000-4000-8000-000000000801",
          generatedContentDraftId: "00000000-0000-4000-8000-000000000802",
          requestedAudience: routeInput.requestedAudience,
          draftStatus: "draft",
          reviewStatus: "needs_gk_review",
          reviewQueueItemId: "00000000-0000-4000-8000-000000000803",
          blocks: [{ ordinal: 1, text: "A claim-backed grant response paragraph.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }],
          replayed: false,
        },
        error: null,
      };
    },
  });
  const originalSprint2 = process.env.KAI_SPRINT2_ENABLED;
  const originalGeneration = process.env.KAI_GENERATION_ENABLED;
  t.after(() => {
    restoreService();
    if (originalSprint2 === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalSprint2;
    if (originalGeneration === undefined) delete process.env.KAI_GENERATION_ENABLED;
    else process.env.KAI_GENERATION_ENABLED = originalGeneration;
  });
  process.env.KAI_SPRINT2_ENABLED = "true";
  process.env.KAI_GENERATION_ENABLED = "true";

  for (const audience of ["internal", "funder", "public"]) {
    const result = await invokeGrantResponseParagraphRoute(requestBody({ requested_audience: audience }));
    assert.equal(result.statusCode, 201);
    assert.equal(result.body.data.requestedAudience, audience);
  }

  assert.equal((await invokeGrantResponseParagraphRoute(requestBody({ requested_audience: "unknown" }))).statusCode, 422);
  const missingAudience = requestBody();
  delete missingAudience.requested_audience;
  assert.equal((await invokeGrantResponseParagraphRoute(missingAudience)).statusCode, 422);
  assert.equal((await invokeGrantResponseParagraphRoute(requestBody({ funder_name: "Example Foundation" }))).statusCode, 422);
  assert.deepEqual(calls.map((call) => call.input.requestedAudience), ["internal", "funder", "public"]);
  assert.equal(calls[0].input.engagementId, ENGAGEMENT);
  assert.deepEqual(calls[0].input.claimIds, [CLAIM]);
  assert.equal(typeof calls[0].dependencies.draftGenerator, "function");
  assert.equal(typeof calls[0].dependencies.metadataOnlyAudit?.prepareMetadataOnlyAudit, "function");
});

test("P13-EXT-5 route source delegates only and contains no direct persistence behavior", () => {
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const start = routeSource.indexOf('router.post(\n  "/admin/organizations/:organizationId/generated-content-drafts/grant-response-paragraph"');
  assert.ok(start >= 0);
  const end = routeSource.indexOf('router.get(\n  "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/review-packet"', start);
  assert.ok(end > start);
  const section = routeSource.slice(start, end);
  assert.match(section, /createGrantResponseParagraphDraft/);
  assert.doesNotMatch(section, /\bkai\./);
  assert.doesNotMatch(section, /\b(?:pool|db)\.query\s*\(/);
  assert.doesNotMatch(section.replace(/"[^"]*"/g, '""'), /\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i);
});

test("P13-EXT-5 service gates malformed/RBAC/tenant/audience failures and delegates every requestedAudience value to repository.createGrantResponseParagraphDraft", async () => {
  let repositoryCalls = 0;
  const repository = {
    async createGrantResponseParagraphDraft(repoInput) {
      repositoryCalls += 1;
      return {
        ok: true,
        data: {
          generationRunId: "00000000-0000-4000-8000-000000000801",
          generatedContentDraftId: "00000000-0000-4000-8000-000000000802",
          requestedAudience: repoInput.requestedAudience,
          draftStatus: "draft",
          reviewStatus: "needs_gk_review",
          reviewQueueItemId: "00000000-0000-4000-8000-000000000803",
          blocks: [{ ordinal: 1, text: "A claim-backed paragraph.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }],
          replayed: false,
        },
        error: null,
      };
    },
  };
  const deps = {
    env: enabledEnv,
    generatedContentRepository: repository,
    getEngagementForOrganization: stubGetEngagementForOrganization,
    metadataOnlyAudit: {},
  };

  assert.equal((await createGrantResponseParagraphDraft({ ...input(), extra: true }, deps)).error.code, "validation_blocker");
  assert.equal((await createGrantResponseParagraphDraft(input({ requestedAudience: "unknown" }), deps)).error.code, "validation_blocker");
  assert.equal((await createGrantResponseParagraphDraft(input({ actorContext: clientActorContext }), deps)).error.code, "authorization_denied");
  assert.equal((await createGrantResponseParagraphDraft(input({ organizationId: OTHER_ORG }), deps)).error.code, "authorization_denied");
  assert.equal((await createGrantResponseParagraphDraft(input({ engagementId: OTHER_ENGAGEMENT }), deps)).error.code, "tenant_boundary_violation");

  for (const requestedAudience of ["internal", "funder", "public"]) {
    const result = await createGrantResponseParagraphDraft(input({ requestedAudience }), deps);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.requestedAudience, requestedAudience);
  }
  assert.equal(repositoryCalls, 3);
});

test("P13-EXT-5 repository generator-input contract and fingerprint include content type, audience, engagement, and claims", () => {
  const baseClaim = {
    claimId: CLAIM,
    claimStatement: "A claim.",
    claimType: "finding",
    evidenceItemId: EVIDENCE,
    sourceId: SOURCE,
    sourceVersionId: SOURCE_VERSION,
    limitationCodes: [],
  };
  assert.equal(__generatedContentRepositoryTestables.validateGeneratorInput({
    contentType: "grant_response_paragraph",
    requestedAudience: "internal",
    claims: [baseClaim],
  }), true);
  // grant_response_packet is a real, distinct object_type belonging to the
  // separate Grant Response Packet composite-export domain (see
  // postgresGeneratedContentRepository.js's evaluateGrantResponsePacket,
  // which uses this exact literal as `object_type`, never as a generated-
  // content `contentType`) - it remains a genuinely unrecognized
  // contentType here despite the name resembling grant_response_paragraph.
  assert.equal(__generatedContentRepositoryTestables.validateGeneratorInput({
    contentType: "grant_response_packet",
    requestedAudience: "internal",
    claims: [baseClaim],
  }), false);

  const fingerprint = fingerprintGrantResponseParagraphRequest({
    requestedAudience: "internal",
    engagementId: ENGAGEMENT,
    claimIds: [CLAIM],
  });
  assert.notEqual(fingerprint, fingerprintEvidenceSummaryRequest({
    requestedAudience: "internal",
    engagementId: ENGAGEMENT,
    claimIds: [CLAIM],
  }));
  assert.notEqual(fingerprint, fingerprintGrantResponseParagraphRequest({
    requestedAudience: "internal",
    engagementId: OTHER_ENGAGEMENT,
    claimIds: [CLAIM],
  }));
  assert.equal(fingerprint, fingerprintGrantResponseParagraphRequest({
    requestedAudience: "internal",
    engagementId: ENGAGEMENT,
    claimIds: [CLAIM],
  }));
});

test("P13-EXT-5 production generator uses the shared block/citation result contract and supports internal/funder/public", async () => {
  const calls = [];
  const generator = createProductionGrantResponseParagraphDraftGenerator({
    async createMessage(payload) {
      calls.push(payload);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            blocks: [{
              text: "The grant response paragraph is supported by governed evidence.",
              citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE, ignored: "drop" }],
              ignored: "drop",
            }],
          }),
        }],
      };
    },
  });

  const result = await generator({
    contentType: "grant_response_paragraph",
    requestedAudience: "internal",
    claims: [{
      claimId: CLAIM,
      claimStatement: "The grant response paragraph is supported by governed evidence.",
      claimType: "finding",
      evidenceItemId: EVIDENCE,
      sourceId: SOURCE,
      sourceVersionId: SOURCE_VERSION,
      limitationCodes: [],
    }],
  });

  assert.deepEqual(result, {
    blocks: [{
      ordinal: 1,
      text: "The grant response paragraph is supported by governed evidence.",
      citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    }],
  });
  assert.equal(__generatedContentRepositoryTestables.validateGeneratorResult(result), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, __grantResponseParagraphDraftGeneratorContract.MODEL);
  assert.deepEqual(Object.keys(__grantResponseParagraphDraftGeneratorContract.GRANT_RESPONSE_PARAGRAPH_OUTPUT_SCHEMA.properties), ["blocks"]);

  // Unlike funder_outcome_table (P13-EXT-4, funder-only), grant_response_paragraph
  // reuses the full unrestricted shared {internal, funder, public} shape -
  // all three audiences reach the provider call.
  for (const requestedAudience of ["internal", "funder", "public"]) {
    const audienceCalls = [];
    const audienceGenerator = createProductionGrantResponseParagraphDraftGenerator({
      async createMessage(payload) {
        audienceCalls.push(payload);
        return {
          content: [{ type: "text", text: JSON.stringify({ blocks: [{ text: "A paragraph.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }] }) }],
        };
      },
    });
    const audienceResult = await audienceGenerator({
      contentType: "grant_response_paragraph",
      requestedAudience,
      claims: [{
        claimId: CLAIM,
        claimStatement: "A claim.",
        claimType: "finding",
        evidenceItemId: EVIDENCE,
        sourceId: SOURCE,
        sourceVersionId: SOURCE_VERSION,
        limitationCodes: [],
      }],
    });
    assert.equal(audienceCalls.length, 1);
    assert.equal(__generatedContentRepositoryTestables.validateGeneratorResult(audienceResult), true);
  }

  // "unknown" is rejected before any provider call.
  const rejectedCalls = [];
  const rejectingGenerator = createProductionGrantResponseParagraphDraftGenerator({
    async createMessage(payload) {
      rejectedCalls.push(payload);
      throw new Error("must not be called");
    },
  });
  const rejected = await rejectingGenerator({
    contentType: "grant_response_paragraph",
    requestedAudience: "unknown",
    claims: [{
      claimId: CLAIM,
      claimStatement: "Unused.",
      claimType: "finding",
      evidenceItemId: EVIDENCE,
      sourceId: SOURCE,
      sourceVersionId: SOURCE_VERSION,
      limitationCodes: [],
    }],
  });
  assert.deepEqual(rejected, { blocks: [] });
  assert.equal(rejectedCalls.length, 0);
  assert.equal(__generatedContentRepositoryTestables.validateGeneratorResult(rejected), false);
});

test("P13-EXT-5 Generated Drafts, review lifecycle, generic export-review, and frontend label admit grant_response_paragraph", () => {
  const packet = {
    generationRunId: "00000000-0000-4000-8000-000000000501",
    generatedContentDraftId: "00000000-0000-4000-8000-000000000502",
    contentType: "grant_response_paragraph",
    draftStatus: "draft",
    requestedAudience: "internal",
    reviewQueueItemId: "00000000-0000-4000-8000-000000000503",
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt: NOW,
    currentUseEligible: true,
    exportReviewQueueItemId: null,
    exportReviewQueueStatus: null,
    exportReviewStatus: null,
    blocks: [{
      ordinal: 1,
      text: "A claim-backed grant response paragraph.",
      citations: [{
        claimId: CLAIM,
        evidenceItemId: EVIDENCE,
        sourceId: SOURCE,
        sourceCode: null,
        sourceVersionId: SOURCE_VERSION,
        supportStrength: "unassessed",
        claimReviewStatus: "needs_gk_review",
        evidenceReviewStatus: "needs_gk_review",
        currentEligible: true,
        blockerCodes: [],
        affectedDimensionKeys: [],
        affectedObjectIds: [],
        approvedAudiences: ["internal"],
      }],
    }],
  };
  assert.equal(__generatedContentReviewPacketServiceTestables.isGeneratedDraftReviewPacketDto(packet), true);
  // grant_response_paragraph's own generation-time contract is unrestricted
  // (internal/funder/public, exactly like evidence_summary and
  // annual_report_section), and the Generated Drafts library visibility rule
  // (kaiGeneratedDraftLibraryReadModels.js's WHERE predicate and
  // responseDraftSummary's isAudienceCompatible()) was repaired to match
  // each content type's own real contract instead of defaulting every type
  // but funder_outcome_table to "internal" - so both "internal" and "funder"
  // grant_response_paragraph rows are library-visible.
  assert.equal(generatedDraftLibraryTestables.responseDraftSummary({
    generated_content_draft_id: "00000000-0000-4000-8000-000000000502",
    organization_id: ORG,
    content_type: "grant_response_paragraph",
    requested_audience: "internal",
    draft_status: "draft",
    review_queue_item_id: "00000000-0000-4000-8000-000000000503",
    queue_status: "open",
    review_status: "needs_gk_review",
    created_at: NOW,
    export_review_queue_item_id: null,
    export_review_organization_id: null,
    export_review_queue_type: null,
    export_review_target_object_type: null,
    export_review_target_object_id: null,
    export_review_priority: null,
    export_review_queue_status: null,
    export_review_status: null,
    export_review_blocked_reason: null,
    export_review_assigned_to: null,
    export_review_due_at: null,
    export_review_summary: null,
    export_review_required_action: null,
    export_review_queue_metadata: null,
    export_review_created_by: null,
    export_review_created_by_type: null,
  }, ORG, true)?.contentType, "grant_response_paragraph");
  // A funder-audience grant_response_paragraph row is correctly admitted:
  // grant_response_paragraph's real contract allows funder (and public), so
  // this must not be forced to the old "internal-only default" rejection.
  assert.equal(generatedDraftLibraryTestables.responseDraftSummary({
    generated_content_draft_id: "00000000-0000-4000-8000-000000000502",
    organization_id: ORG,
    content_type: "grant_response_paragraph",
    requested_audience: "funder",
    draft_status: "draft",
    review_queue_item_id: "00000000-0000-4000-8000-000000000503",
    queue_status: "open",
    review_status: "needs_gk_review",
    created_at: NOW,
    export_review_queue_item_id: null,
    export_review_organization_id: null,
    export_review_queue_type: null,
    export_review_target_object_type: null,
    export_review_target_object_id: null,
    export_review_priority: null,
    export_review_queue_status: null,
    export_review_status: null,
    export_review_blocked_reason: null,
    export_review_assigned_to: null,
    export_review_due_at: null,
    export_review_summary: null,
    export_review_required_action: null,
    export_review_queue_metadata: null,
    export_review_created_by: null,
    export_review_created_by_type: null,
  }, ORG, true)?.contentType, "grant_response_paragraph");
  assert.equal(EXPORT_CANDIDATE_CONTENT_TYPES.includes("grant_response_paragraph"), true);
  assert.equal(generatedDraftContentTypeLabel("grant_response_paragraph", "internal"), "Grant Response Paragraph · Internal");
});

test("P13-EXT-5 boundary proof: packet/composite memberships and off-limits content types stay unchanged", () => {
  const repositorySource = readFileSync("Backend/kai/dictionary/postgresGeneratedContentRepository.js", "utf8");
  assert.match(repositorySource, /const PACKET_MEMBER_CONTENT_TYPES = new Set\(\[CONTENT_TYPE, IMPACT_NARRATIVE_CONTENT_TYPE\]\)/);
  assert.match(repositorySource, /const BOARD_REPORTING_PACKET_MEMBER_CONTENT_TYPES = new Set\(\[CONTENT_TYPE, IMPACT_NARRATIVE_CONTENT_TYPE\]\)/);
  assert.equal(__generatedContentRepositoryContract.PACKET_MEMBER_CONTENT_TYPES.has("grant_response_paragraph"), false);

  // Despite the name resembling "Grant Response Packet", grant_response_paragraph
  // is NOT added to createGeneratedContentDraft's internal-only-types array
  // either (that array only ever narrows to "internal" - grant_response_paragraph
  // is not narrowed at all, exactly like annual_report_section).
  const internalOnlyArrayMatch = repositorySource.match(/\[IMPACT_NARRATIVE_CONTENT_TYPE, READINESS_ASSESSMENT_CONTENT_TYPE, DATA_GAP_MEMO_CONTENT_TYPE, BOARD_UPDATE_CONTENT_TYPE\]\.includes\(contentType\)/);
  assert.ok(internalOnlyArrayMatch, "internal-only-types array must remain exactly the four pre-existing internal-only types");
});

test("P13-EXT-5 no migration/database surfaces were added by this application-only package", () => {
  const repositorySource = readFileSync("Backend/kai/dictionary/postgresGeneratedContentRepository.js", "utf8");
  assert.doesNotMatch(repositorySource, /migrations\/.*grant_response_paragraph/);
});

function stripSqlStringLiterals(sql) {
  return sql.replace(/'(?:[^']|'')*'/g, "");
}

function assertSqlHasNoMutation(sql, label) {
  const stripped = stripSqlStringLiterals(sql);
  const match = stripped.match(/\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE|EXECUTE|CALL)\b/gi);
  assert.equal(match, null, `${label} contains a mutating/dynamic-SQL keyword outside string literals: ${JSON.stringify(match)}`);
}

const PREDECESSOR_CONTENT_TYPES = [
  "evidence_summary", "impact_narrative", "readiness_assessment",
  "data_gap_memo", "case_for_support", "board_update", "annual_report_section",
  "funder_outcome_table",
];
const TARGET_CONTENT_TYPES = [...PREDECESSOR_CONTENT_TYPES, "grant_response_paragraph"];
const PREDECESSOR_DEF = `CHECK ((content_type = ANY (ARRAY[${PREDECESSOR_CONTENT_TYPES.map((t) => `''${t}''::text`).join(", ")}])))`;
const TARGET_DEF = `CHECK ((content_type = ANY (ARRAY[${TARGET_CONTENT_TYPES.map((t) => `''${t}''::text`).join(", ")}])))`;

const FORWARD_MIGRATION_PATH = "migrations/kai_sprint2_p13_ext5_grant_response_paragraph_content_type_evolution.sql";
const ROLLBACK_MIGRATION_PATH = "migrations/kai_sprint2_p13_ext5_grant_response_paragraph_content_type_evolution.rollback.sql";
const EXPORT_FORWARD_MIGRATION_PATH = "migrations/kai_sprint2_p13_ext5_grant_response_paragraph_export_candidate_content_type_evolution.sql";
const EXPORT_ROLLBACK_MIGRATION_PATH = "migrations/kai_sprint2_p13_ext5_grant_response_paragraph_export_candidate_content_type_evolution.rollback.sql";
const VERIFIER_PATH = "scripts/kai-sprint2-p13-ext5-grant-response-paragraph-content-type-evolution-verifier.sql";
const FAILURE_CHECKS_PATH = "scripts/kai-sprint2-p13-ext5-grant-response-paragraph-content-type-evolution-failure-checks.sql";
const SMOKE_SEED_PATH = "scripts/kai-sprint2-p13-ext5-grant-response-paragraph-content-type-evolution-smoke-seed.sql";
const SMOKE_VERIFIER_PATH = "scripts/kai-sprint2-p13-ext5-grant-response-paragraph-content-type-evolution-smoke-verifier.sql";
const RUNBOOK_PATH = "scripts/kai-sprint2-p13-ext5-grant-response-paragraph-content-type-evolution-runbook.md";
const PATCH_NOTES_PATH = "scripts/kai-sprint2-p13-ext5-grant-response-paragraph-content-type-evolution-patch-notes.md";

test("P13-EXT-5 migration package: predecessor and target content-type vocabularies are exact", () => {
  const forward = readFileSync(FORWARD_MIGRATION_PATH, "utf8");
  const exportForward = readFileSync(EXPORT_FORWARD_MIGRATION_PATH, "utf8");
  assert.equal(PREDECESSOR_CONTENT_TYPES.length, 8);
  assert.equal(TARGET_CONTENT_TYPES.length, 9);
  assert.ok(forward.includes(PREDECESSOR_DEF), "forward migration must reference the exact eight-type predecessor definition");
  assert.ok(forward.includes(TARGET_DEF), "forward migration must reference the exact nine-type target definition");
  assert.ok(exportForward.includes(PREDECESSOR_DEF), "export-candidate forward migration must reference the exact eight-type predecessor definition");
  assert.ok(exportForward.includes(TARGET_DEF), "export-candidate forward migration must reference the exact nine-type target definition");
});

test("P13-EXT-5 migration package: forward migrations recognize predecessor/target and fail closed on an unrecognized definition", () => {
  const forward = readFileSync(FORWARD_MIGRATION_PATH, "utf8");
  const exportForward = readFileSync(EXPORT_FORWARD_MIGRATION_PATH, "utf8");
  assert.match(forward, /runs_def <> predecessor_def AND runs_def <> target_def/);
  assert.match(forward, /drafts_def <> predecessor_def AND drafts_def <> target_def/);
  assert.match(forward, /RAISE EXCEPTION[^;]*refusing to widen a constraint shape this migration does not recognize/s);
  assert.match(exportForward, /candidate_def <> predecessor_def\s*\n\s*AND candidate_def <> target_def/);
  assert.match(exportForward, /RAISE EXCEPTION\s*\n\s*'export_candidates_p3_16_content_type_check has an unexpected definition/);
});

test("P13-EXT-5 migration package: rollback migrations recognize only predecessor/target and refuse narrowing when grant_response_paragraph rows exist", () => {
  const rollback = readFileSync(ROLLBACK_MIGRATION_PATH, "utf8");
  const exportRollback = readFileSync(EXPORT_ROLLBACK_MIGRATION_PATH, "utf8");

  assert.match(rollback, /WHERE content_type = 'grant_response_paragraph'/);
  assert.match(rollback, /RAISE EXCEPTION 'P13-EXT-5 rollback refused: kai\.generation_runs holds grant_response_paragraph rows/);
  assert.match(rollback, /RAISE EXCEPTION 'P13-EXT-5 rollback refused: kai\.generated_content_drafts holds grant_response_paragraph rows/);
  assert.match(rollback, new RegExp(PREDECESSOR_CONTENT_TYPES.map((t) => `'${t}'`).join(", ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(exportRollback, /IF actual_def = predecessor_def THEN\s*\n\s*RETURN;/);
  assert.match(exportRollback, /IF actual_def <> target_def THEN/);
  assert.match(exportRollback, /WHERE content_type = 'grant_response_paragraph'/);
  assert.match(exportRollback, /RAISE EXCEPTION\s*\n\s*'P13-EXT-5 rollback refused: grant_response_paragraph export candidates exist'/);
});

test("P13-EXT-5 migration package: no unrecognized content-type token appears outside the failure-checks negative proof", () => {
  const files = [FORWARD_MIGRATION_PATH, ROLLBACK_MIGRATION_PATH, EXPORT_FORWARD_MIGRATION_PATH, EXPORT_ROLLBACK_MIGRATION_PATH, VERIFIER_PATH, FAILURE_CHECKS_PATH, SMOKE_VERIFIER_PATH];
  for (const path of files) {
    const source = readFileSync(path, "utf8");
    assert.equal(source.includes("grant_response_packet"), path === FAILURE_CHECKS_PATH, `${path} must not admit grant_response_packet (only the failure-checks negative-proof file may mention it)`);

    // content_type literals in these files are always cast with ::text
    // (e.g. ''grant_response_paragraph''::text or
    // 'grant_response_paragraph'::text), which distinguishes them from
    // unrelated quoted strings like check-name labels
    // ('predecessor_types_still_admitted_alongside_grant_response_paragraph').
    const castContentTypeTokens = [...source.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
    const knownNegativeProofTokens = new Set(["grant_response_packet"]);
    for (const token of castContentTypeTokens) {
      if (knownNegativeProofTokens.has(token)) continue;
      assert.ok(
        TARGET_CONTENT_TYPES.includes(token),
        `${path} references an unrecognized content-type token cast to ::text: ${token}`,
      );
    }
  }
});

test("P13-EXT-5 migration package: verifier, failure-checks, and smoke-verifier SQL are strictly read-only", () => {
  assertSqlHasNoMutation(readFileSync(VERIFIER_PATH, "utf8"), VERIFIER_PATH);
  assertSqlHasNoMutation(readFileSync(FAILURE_CHECKS_PATH, "utf8"), FAILURE_CHECKS_PATH);
  assertSqlHasNoMutation(readFileSync(SMOKE_VERIFIER_PATH, "utf8"), SMOKE_VERIFIER_PATH);
});

test("P13-EXT-5 migration package: smoke seed is explicitly synthetic and source-only, and required artifacts all exist", () => {
  const seed = readFileSync(SMOKE_SEED_PATH, "utf8");
  assert.match(seed, /NOT YET RUN/);
  assert.match(seed, /[Ss]ynthetic data only/);
  assert.match(seed, /never be run against a real client database|never against a real client database/);
  assert.doesNotMatch(seed, /grant_response_packet/);

  const runbook = readFileSync(RUNBOOK_PATH, "utf8");
  assert.match(runbook, /None of these steps were executed\s+against a live database/);

  const patchNotes = readFileSync(PATCH_NOTES_PATH, "utf8");
  assert.match(patchNotes, /No SQL in this package[\s\S]*was executed against any PostgreSQL\s+instance/);

  for (const path of [
    FORWARD_MIGRATION_PATH, ROLLBACK_MIGRATION_PATH,
    EXPORT_FORWARD_MIGRATION_PATH, EXPORT_ROLLBACK_MIGRATION_PATH,
    VERIFIER_PATH, FAILURE_CHECKS_PATH, SMOKE_SEED_PATH, SMOKE_VERIFIER_PATH,
    RUNBOOK_PATH, PATCH_NOTES_PATH,
  ]) {
    assert.doesNotThrow(() => readFileSync(path, "utf8"), `${path} must exist`);
  }
});
