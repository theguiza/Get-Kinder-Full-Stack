import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import {
  createAnnualReportSectionDraft,
  __generatedContentReviewPacketServiceTestables,
  __generatedContentServiceContract,
} from "../Backend/kai/services/kaiGeneratedContentService.js";
import { __testables as generatedDraftLibraryTestables } from "../Backend/kai/services/kaiGeneratedDraftLibraryService.js";
import { EXPORT_CANDIDATE_CONTENT_TYPES } from "../Backend/kai/dictionary/exportCandidateContract.js";
import {
  __generatedContentRepositoryContract,
  __generatedContentRepositoryTestables,
  fingerprintAnnualReportSectionRequest,
  fingerprintEvidenceSummaryRequest,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import { generatedDraftContentTypeLabel } from "../frontend/impactEvidenceLibraryLogic.js";
import {
  __annualReportSectionDraftGeneratorContract,
  createProductionAnnualReportSectionDraftGenerator,
} from "../Backend/kai/services/kaiAnnualReportSectionDraftGenerator.js";
import { createAttachKaiSprint2ActorContext } from "../Backend/kai/middleware/kaiSprint2Authentication.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000601";
const OTHER_ENGAGEMENT = "00000000-0000-4000-8000-000000000602";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";
const SOURCE = "00000000-0000-4000-8000-000000000301";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000401";
const NOW = "2026-08-06T10:00:00.000Z";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
const routePath = "/admin/organizations/:organizationId/generated-content-drafts/annual-report-section";

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
    idempotencyKey: "p13-ext3-annual-report-section-key",
    actorContext: adminActorContext,
    now: NOW,
    ...overrides,
  };
}

function requestBody(overrides = {}) {
  return {
    engagement_id: ENGAGEMENT,
    claim_ids: [CLAIM],
    idempotency_key: "p13-ext3-annual-report-section-route-key",
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

async function invokeAnnualReportSectionRoute(body, { actorContext = adminActorContext } = {}) {
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

test("P13-EXT-3 canonical annual_report_section registration is generic only", () => {
  assert.equal(__generatedContentServiceContract.ALLOWED_GENERATED_CONTENT_TYPES.has("annual_report_section"), true);
  assert.equal(__generatedContentRepositoryContract.ALLOWED_GENERATED_CONTENT_TYPES.has("annual_report_section"), true);
  assert.equal(EXPORT_CANDIDATE_CONTENT_TYPES.includes("annual_report_section"), true);
  assert.equal(__generatedContentRepositoryContract.PACKET_MEMBER_CONTENT_TYPES.has("annual_report_section"), false);
});

test("P13-EXT-3 route is mounted as an authenticated annual_report_section draft-generation POST", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === routePath && layer.route?.methods?.post);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["post"]);
});

test("P13-EXT-3 HTTP route accepts exactly four body fields, admits internal/funder/public, rejects unknown audience and extra fields, and passes audience through", async (t) => {
  const calls = [];
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async createAnnualReportSectionDraft(routeInput, dependencies) {
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
          blocks: [{ ordinal: 1, text: "A claim-backed annual report section.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }],
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
    const result = await invokeAnnualReportSectionRoute(requestBody({ requested_audience: audience }));
    assert.equal(result.statusCode, 201);
    assert.equal(result.body.data.requestedAudience, audience);
  }

  const missingAudience = requestBody();
  delete missingAudience.requested_audience;
  assert.equal((await invokeAnnualReportSectionRoute(missingAudience)).statusCode, 422);
  assert.equal((await invokeAnnualReportSectionRoute(requestBody({ requested_audience: "unknown" }))).statusCode, 422);
  assert.equal((await invokeAnnualReportSectionRoute(requestBody({ fiscal_year: "2026" }))).statusCode, 422);
  assert.deepEqual(calls.map((call) => call.input.requestedAudience), ["internal", "funder", "public"]);
  assert.equal(calls[0].input.engagementId, ENGAGEMENT);
  assert.deepEqual(calls[0].input.claimIds, [CLAIM]);
  assert.equal(typeof calls[0].dependencies.draftGenerator, "function");
  assert.equal(typeof calls[0].dependencies.metadataOnlyAudit?.prepareMetadataOnlyAudit, "function");
});

test("P13-EXT-3 route source delegates only and contains no direct persistence behavior", () => {
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const start = routeSource.indexOf('router.post(\n  "/admin/organizations/:organizationId/generated-content-drafts/annual-report-section"');
  assert.ok(start >= 0);
  const end = routeSource.indexOf('router.get(\n  "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/review-packet"', start);
  assert.ok(end > start);
  const section = routeSource.slice(start, end);
  assert.match(section, /createAnnualReportSectionDraft/);
  assert.doesNotMatch(section, /\bkai\./);
  assert.doesNotMatch(section, /\b(?:pool|db)\.query\s*\(/);
  assert.doesNotMatch(section.replace(/"[^"]*"/g, '""'), /\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i);
});

test("P13-EXT-3 service gates malformed/RBAC/tenant failures and delegates all authorized audiences to repository.createAnnualReportSectionDraft", async () => {
  let repositoryCalls = 0;
  const repository = {
    async createAnnualReportSectionDraft(repoInput) {
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
          blocks: [{ ordinal: 1, text: "A claim-backed statement.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }],
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

  assert.equal((await createAnnualReportSectionDraft({ ...input(), extra: true }, deps)).error.code, "validation_blocker");
  assert.equal((await createAnnualReportSectionDraft(input({ requestedAudience: "unknown" }), deps)).error.code, "validation_blocker");
  assert.equal((await createAnnualReportSectionDraft(input({ actorContext: clientActorContext }), deps)).error.code, "authorization_denied");
  assert.equal((await createAnnualReportSectionDraft(input({ organizationId: OTHER_ORG }), deps)).error.code, "authorization_denied");
  assert.equal((await createAnnualReportSectionDraft(input({ engagementId: OTHER_ENGAGEMENT }), deps)).error.code, "tenant_boundary_violation");

  for (const requestedAudience of ["internal", "funder", "public"]) {
    const result = await createAnnualReportSectionDraft(input({ requestedAudience }), deps);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.requestedAudience, requestedAudience);
  }
  assert.equal(repositoryCalls, 3);
});

test("P13-EXT-3 repository generator-input contract and fingerprint include content type, audience, engagement, and claims", () => {
  const baseClaim = {
    claimId: CLAIM,
    claimStatement: "A claim.",
    claimType: "finding",
    evidenceItemId: EVIDENCE,
    sourceId: SOURCE,
    sourceVersionId: SOURCE_VERSION,
    limitationCodes: [],
  };
  for (const requestedAudience of ["internal", "funder", "public"]) {
    assert.equal(__generatedContentRepositoryTestables.validateGeneratorInput({
      contentType: "annual_report_section",
      requestedAudience,
      claims: [baseClaim],
    }), true);
  }
  // grant_response_paragraph was implemented by P13-EXT-5 (see
  // kai-sprint2-p13-ext5-grant-response-paragraph-boundary.spec.js), so it
  // is no longer usable here as an unrecognized-contentType negative proof.
  // grant_response_packet (the distinct Grant Response Packet
  // composite-export object_type, never a generated-content contentType)
  // replaces it as a genuinely still-unrecognized value.
  assert.equal(__generatedContentRepositoryTestables.validateGeneratorInput({
    contentType: "grant_response_packet",
    requestedAudience: "internal",
    claims: [baseClaim],
  }), false);

  const fingerprint = fingerprintAnnualReportSectionRequest({
    requestedAudience: "internal",
    engagementId: ENGAGEMENT,
    claimIds: [CLAIM],
  });
  assert.notEqual(fingerprint, fingerprintEvidenceSummaryRequest({
    requestedAudience: "internal",
    engagementId: ENGAGEMENT,
    claimIds: [CLAIM],
  }));
  assert.notEqual(fingerprint, fingerprintAnnualReportSectionRequest({
    requestedAudience: "funder",
    engagementId: ENGAGEMENT,
    claimIds: [CLAIM],
  }));
  assert.notEqual(fingerprint, fingerprintAnnualReportSectionRequest({
    requestedAudience: "internal",
    engagementId: OTHER_ENGAGEMENT,
    claimIds: [CLAIM],
  }));
  assert.equal(fingerprint, fingerprintAnnualReportSectionRequest({
    requestedAudience: "internal",
    engagementId: ENGAGEMENT,
    claimIds: [CLAIM],
  }));
});

test("P13-EXT-3 production generator uses the shared block/citation result contract for internal/funder/public", async () => {
  for (const requestedAudience of ["internal", "funder", "public"]) {
    const calls = [];
    const generator = createProductionAnnualReportSectionDraftGenerator({
      async createMessage(payload) {
        calls.push(payload);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              blocks: [{
                text: "The annual report section is supported by governed evidence.",
                citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE, ignored: "drop" }],
                ignored: "drop",
              }],
            }),
          }],
        };
      },
    });

    const result = await generator({
      contentType: "annual_report_section",
      requestedAudience,
      claims: [{
        claimId: CLAIM,
        claimStatement: "The annual report section is supported by governed evidence.",
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
        text: "The annual report section is supported by governed evidence.",
        citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
      }],
    });
    assert.equal(__generatedContentRepositoryTestables.validateGeneratorResult(result), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, __annualReportSectionDraftGeneratorContract.MODEL);
    assert.equal(JSON.stringify(calls[0]).includes("fiscal_year"), false);
    assert.equal(JSON.stringify(calls[0]).includes("publication_date"), false);
  }
});

test("P13-EXT-3 Generated Drafts, review lifecycle, generic export-review, and frontend label admit annual_report_section", () => {
  const packet = {
    generationRunId: "00000000-0000-4000-8000-000000000501",
    generatedContentDraftId: "00000000-0000-4000-8000-000000000502",
    contentType: "annual_report_section",
    draftStatus: "draft",
    requestedAudience: "public",
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
      text: "Narrative text.",
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
        approvedAudiences: ["public"],
      }],
    }],
  };
  assert.equal(__generatedContentReviewPacketServiceTestables.isGeneratedDraftReviewPacketDto(packet), true);
  assert.equal(generatedDraftLibraryTestables.responseDraftSummary({
    generated_content_draft_id: "00000000-0000-4000-8000-000000000502",
    organization_id: ORG,
    content_type: "annual_report_section",
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
  }, ORG, true)?.contentType, "annual_report_section");
  assert.equal(EXPORT_CANDIDATE_CONTENT_TYPES.includes("annual_report_section"), true);
  assert.equal(generatedDraftContentTypeLabel("annual_report_section", "public"), "Annual Report Section · public");
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
  "data_gap_memo", "case_for_support", "board_update",
];
const TARGET_CONTENT_TYPES = [...PREDECESSOR_CONTENT_TYPES, "annual_report_section"];
// Source files embed this CHECK definition as a SQL string literal, so quotes
// around each token are doubled ('' ... '') in the raw source text.
const PREDECESSOR_DEF = `CHECK ((content_type = ANY (ARRAY[${PREDECESSOR_CONTENT_TYPES.map((t) => `''${t}''::text`).join(", ")}])))`;
const TARGET_DEF = `CHECK ((content_type = ANY (ARRAY[${TARGET_CONTENT_TYPES.map((t) => `''${t}''::text`).join(", ")}])))`;

const FORWARD_MIGRATION_PATH = "migrations/kai_sprint2_p13_ext3_annual_report_section_content_type_evolution.sql";
const ROLLBACK_MIGRATION_PATH = "migrations/kai_sprint2_p13_ext3_annual_report_section_content_type_evolution.rollback.sql";
const EXPORT_FORWARD_MIGRATION_PATH = "migrations/kai_sprint2_p13_ext3_annual_report_section_export_candidate_content_type_evolution.sql";
const EXPORT_ROLLBACK_MIGRATION_PATH = "migrations/kai_sprint2_p13_ext3_annual_report_section_export_candidate_content_type_evolution.rollback.sql";
const VERIFIER_PATH = "scripts/kai-sprint2-p13-ext3-annual-report-section-content-type-evolution-verifier.sql";
const FAILURE_CHECKS_PATH = "scripts/kai-sprint2-p13-ext3-annual-report-section-content-type-evolution-failure-checks.sql";
const SMOKE_SEED_PATH = "scripts/kai-sprint2-p13-ext3-annual-report-section-content-type-evolution-smoke-seed.sql";
const SMOKE_VERIFIER_PATH = "scripts/kai-sprint2-p13-ext3-annual-report-section-content-type-evolution-smoke-verifier.sql";
const RUNBOOK_PATH = "scripts/kai-sprint2-p13-ext3-annual-report-section-content-type-evolution-runbook.md";
const PATCH_NOTES_PATH = "scripts/kai-sprint2-p13-ext3-annual-report-section-content-type-evolution-patch-notes.md";

test("P13-EXT-3 migration package: predecessor and target content-type vocabularies are exact", () => {
  const forward = readFileSync(FORWARD_MIGRATION_PATH, "utf8");
  const exportForward = readFileSync(EXPORT_FORWARD_MIGRATION_PATH, "utf8");
  assert.equal(PREDECESSOR_CONTENT_TYPES.length, 6);
  assert.equal(TARGET_CONTENT_TYPES.length, 7);
  assert.ok(forward.includes(PREDECESSOR_DEF), "forward migration must reference the exact six-type predecessor definition");
  assert.ok(forward.includes(TARGET_DEF), "forward migration must reference the exact seven-type target definition");
  assert.ok(exportForward.includes(PREDECESSOR_DEF), "export-candidate forward migration must reference the exact six-type predecessor definition");
  assert.ok(exportForward.includes(TARGET_DEF), "export-candidate forward migration must reference the exact seven-type target definition");
});

test("P13-EXT-3 migration package: forward migrations recognize predecessor/target and fail closed on an unrecognized definition", () => {
  const forward = readFileSync(FORWARD_MIGRATION_PATH, "utf8");
  const exportForward = readFileSync(EXPORT_FORWARD_MIGRATION_PATH, "utf8");
  assert.match(forward, /runs_def <> predecessor_def AND runs_def <> target_def/);
  assert.match(forward, /drafts_def <> predecessor_def AND drafts_def <> target_def/);
  assert.match(forward, /RAISE EXCEPTION[^;]*refusing to widen a constraint shape this migration does not recognize/s);
  assert.match(exportForward, /candidate_def <> predecessor_def\s*\n\s*AND candidate_def <> target_def/);
  assert.match(exportForward, /RAISE EXCEPTION\s*\n\s*'export_candidates_p3_16_content_type_check has an unexpected definition/);
});

test("P13-EXT-3 migration package: rollback migrations recognize only predecessor/target and refuse narrowing when annual_report_section rows exist", () => {
  const rollback = readFileSync(ROLLBACK_MIGRATION_PATH, "utf8");
  const exportRollback = readFileSync(EXPORT_ROLLBACK_MIGRATION_PATH, "utf8");

  assert.match(rollback, /WHERE content_type = 'annual_report_section'/);
  assert.match(rollback, /RAISE EXCEPTION 'P13-EXT-3 rollback refused: kai\.generation_runs holds annual_report_section rows/);
  assert.match(rollback, /RAISE EXCEPTION 'P13-EXT-3 rollback refused: kai\.generated_content_drafts holds annual_report_section rows/);
  assert.match(rollback, new RegExp(PREDECESSOR_CONTENT_TYPES.map((t) => `'${t}'`).join(", ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(exportRollback, /IF actual_def = predecessor_def THEN\s*\n\s*RETURN;/);
  assert.match(exportRollback, /IF actual_def <> target_def THEN/);
  assert.match(exportRollback, /WHERE content_type = 'annual_report_section'/);
  assert.match(exportRollback, /RAISE EXCEPTION\s*\n\s*'P13-EXT-3 rollback refused: annual_report_section export candidates exist'/);
});

test("P13-EXT-3 migration package: grant_response_paragraph and funder_outcome_table are never admitted, and no other future type appears", () => {
  const files = [FORWARD_MIGRATION_PATH, ROLLBACK_MIGRATION_PATH, EXPORT_FORWARD_MIGRATION_PATH, EXPORT_ROLLBACK_MIGRATION_PATH, VERIFIER_PATH, FAILURE_CHECKS_PATH, SMOKE_VERIFIER_PATH];
  for (const path of files) {
    const source = readFileSync(path, "utf8");
    assert.equal(source.includes("grant_response_paragraph"), path === FAILURE_CHECKS_PATH, `${path} must not admit grant_response_paragraph (only the failure-checks negative-proof file may mention it)`);
    assert.equal(source.includes("funder_outcome_table"), path === FAILURE_CHECKS_PATH, `${path} must not admit funder_outcome_table (only the failure-checks negative-proof file may mention it)`);

    // content_type literals in these files are always cast with ::text
    // (e.g. ''annual_report_section''::text or 'annual_report_section'::text),
    // which distinguishes them from unrelated quoted strings like check-name
    // labels ('predecessor_types_still_admitted_alongside_annual_report_section').
    const castContentTypeTokens = [...source.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
    const knownNegativeProofTokens = new Set(["grant_response_paragraph", "funder_outcome_table"]);
    for (const token of castContentTypeTokens) {
      if (knownNegativeProofTokens.has(token)) continue;
      assert.ok(
        TARGET_CONTENT_TYPES.includes(token),
        `${path} references an unrecognized content-type token cast to ::text: ${token}`,
      );
    }
  }
});

test("P13-EXT-3 migration package: verifier, failure-checks, and smoke-verifier SQL are strictly read-only", () => {
  assertSqlHasNoMutation(readFileSync(VERIFIER_PATH, "utf8"), VERIFIER_PATH);
  assertSqlHasNoMutation(readFileSync(FAILURE_CHECKS_PATH, "utf8"), FAILURE_CHECKS_PATH);
  assertSqlHasNoMutation(readFileSync(SMOKE_VERIFIER_PATH, "utf8"), SMOKE_VERIFIER_PATH);
});

test("P13-EXT-3 migration package: smoke seed is explicitly synthetic and source-only, and required artifacts all exist", () => {
  const seed = readFileSync(SMOKE_SEED_PATH, "utf8");
  assert.match(seed, /NOT YET RUN/);
  assert.match(seed, /[Ss]ynthetic data only/);
  assert.match(seed, /never be run against a real client database|never against a real client database/);
  assert.doesNotMatch(seed, /grant_response_paragraph|funder_outcome_table/);

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

test("P13-EXT-3 boundary proof: packet/composite memberships and unrelated extension types stay unchanged", () => {
  const repositorySource = readFileSync("Backend/kai/dictionary/postgresGeneratedContentRepository.js", "utf8");
  assert.match(repositorySource, /const PACKET_MEMBER_CONTENT_TYPES = new Set\(\[CONTENT_TYPE, IMPACT_NARRATIVE_CONTENT_TYPE\]\)/);
  assert.match(repositorySource, /const BOARD_REPORTING_PACKET_MEMBER_CONTENT_TYPES = new Set\(\[CONTENT_TYPE, IMPACT_NARRATIVE_CONTENT_TYPE\]\)/);
  // grant_response_paragraph was a documented Phase-13 gap AT THE TIME this
  // P13-EXT-3 package closed (see the "Phase-13 gaps remaining" note in the
  // living ExecPlan's P13-EXT-3 closure entry). It was subsequently
  // implemented by the P13-EXT-5 package
  // (kai-sprint2-p13-ext5-grant-response-paragraph-boundary.spec.js), so the
  // two assertions that used to prove its absence here (the
  // GRANT_RESPONSE_PARAGRAPH_CONTENT_TYPE const-declaration check and the
  // ALLOWED_GENERATED_CONTENT_TYPES.has("grant_response_paragraph") check
  // below) are deliberately removed rather than left to bit-rot into a
  // false negative - mirroring exactly how this same test previously
  // removed its own stale funder_outcome_table assertions when P13-EXT-4
  // landed (see immediately below).
  // funder_outcome_table was a documented Phase-13 gap AT THE TIME this
  // P13-EXT-3 package closed (see the "Phase-13 gaps remaining" note in the
  // living ExecPlan's P13-EXT-3 closure entry). It was subsequently
  // implemented by the P13-EXT-4 package
  // (kai-sprint2-p13-ext4-funder-outcome-table-boundary.spec.js), so the two
  // assertions that used to prove its absence here are deliberately removed
  // rather than left to bit-rot into a false negative; grant_response_paragraph
  // remains a genuine, still-unimplemented off-limits type and is still
  // proven absent above and below.
  assert.equal(__generatedContentRepositoryContract.PACKET_MEMBER_CONTENT_TYPES.has("annual_report_section"), false);
  assert.equal(__generatedContentRepositoryContract.PACKET_MEMBER_CONTENT_TYPES.has("grant_response_paragraph"), false);
});
