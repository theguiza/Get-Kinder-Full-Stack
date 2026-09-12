// Governed Board Summary FINAL Markdown delivery, bound to an exact,
// existing boardReportingCandidateExportManifestId. Proves: final delivery
// is authorized solely by an exact manifest id (never
// organizationId+engagementId alone, a candidate id without its manifest, or
// a latest/newest/preferred selection); the existing Board Markdown
// serializer is reused unmodified via its additive override parameters; the
// currentness/fingerprint proof fails closed on any stale/changed candidate
// state; and the route creates no manifest, mutates no candidate, no
// members, no review, and no BR-04 authority.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { readFileSync } from "node:fs";

import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import { buildKaiError } from "../Backend/kai/errors/kaiErrors.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import {
  handleKaiSprint2JsonParserError,
  kaiSprint2MetadataJsonParser,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";
import {
  createPostgresBoardReportingCandidateExportManifestRenderModelRepository,
  __boardReportingCandidateExportManifestRenderModelRepositoryTestables,
} from "../Backend/kai/dictionary/postgresBoardReportingCandidateExportManifestRenderModelRepository.js";
import {
  serializeBoardReportingCandidateExportManifestToMarkdown,
  __boardReportingCandidateExportManifestMarkdownSerializerContract,
  __boardReportingCandidateExportManifestMarkdownSerializerTestables,
} from "../Backend/kai/services/kaiBoardReportingCandidateExportManifestMarkdownSerializer.js";
import { composeBoardReportingPacketFingerprint } from "../Backend/kai/services/kaiBoardReportingPacketFingerprintService.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000701";
const MANIFEST = "00000000-0000-4000-8000-000000000801";
const CANDIDATE_A = "00000000-0000-4000-8000-000000000901";
const CANDIDATE_B = "00000000-0000-4000-8000-000000000902";
const DRAFT_A = "00000000-0000-4000-8000-000000000b01";
const BLOCK_A1 = "00000000-0000-4000-8000-000000000c01";
const CITATION_A1 = "00000000-0000-4000-8000-000000000d01";
const CLAIM_A = "00000000-0000-4000-8000-000000000e01";
const EVIDENCE_A = "00000000-0000-4000-8000-000000000e02";
const SOURCE_A = "00000000-0000-4000-8000-000000000e03";
const SOURCE_VERSION_A = "00000000-0000-4000-8000-000000000e04";

const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });

const gkAdmin = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
});

function citation(overrides = {}) {
  return {
    generatedContentCitationId: CITATION_A1,
    claimId: CLAIM_A,
    evidenceItemId: EVIDENCE_A,
    sourceId: SOURCE_A,
    sourceVersionId: SOURCE_VERSION_A,
    supportStrength: "strong",
    claimReviewStatus: "approved",
    evidenceReviewStatus: "approved",
    currentEligible: true,
    blockerCodes: [],
    affectedDimensionKeys: [],
    affectedObjectIds: [],
    ...overrides,
  };
}

function member(overrides = {}) {
  return {
    generationRunId: "00000000-0000-4000-8000-000000000111",
    generatedContentDraftId: DRAFT_A,
    contentType: "evidence_summary",
    draftStatus: "draft",
    requestedAudience: "internal",
    reviewQueueItemId: "00000000-0000-4000-8000-000000000112",
    queueStatus: "resolved",
    reviewStatus: "resolved",
    reviewUpdatedAt: "2026-09-08T09:00:00.000Z",
    currentUseEligible: true,
    blocks: [{
      generatedContentBlockId: BLOCK_A1,
      ordinal: 1,
      text: "First member block.",
      citations: [citation()],
    }],
    ...overrides,
  };
}

function renderModel(overrides = {}) {
  return {
    renderModelContractVersion: "kai-sprint2-board-reporting-render-model-v1",
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    packetAudience: "internal",
    supportedContentTypes: ["evidence_summary", "impact_narrative"],
    members: [member()],
    ...overrides,
  };
}

function fakeTx({ manifestRow, candidateRow } = {}) {
  return {
    async query(sql, params) {
      if (/SET TRANSACTION/.test(sql)) return { rows: [] };
      if (/FROM kai\.board_reporting_candidate_export_manifests/.test(sql)) {
        if (!manifestRow) return { rows: [] };
        return params[0] === manifestRow.organization_id
          && params[1] === manifestRow.board_reporting_candidate_export_manifest_id
          ? { rows: [manifestRow] }
          : { rows: [] };
      }
      if (/FROM kai\.board_reporting_candidates/.test(sql)) {
        if (!candidateRow) return { rows: [] };
        return params[0] === candidateRow.organization_id
          && params[1] === candidateRow.board_reporting_candidate_id
          ? { rows: [candidateRow] }
          : { rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

function repositoryDeps({
  manifestRow = {
    board_reporting_candidate_export_manifest_id: MANIFEST,
    organization_id: ORG,
    board_reporting_candidate_id: CANDIDATE_A,
  },
  candidateRow = {
    board_reporting_candidate_id: CANDIDATE_A,
    organization_id: ORG,
    engagement_id: ENGAGEMENT,
    canonical_fingerprint: null,
  },
  model = renderModel(),
  calls = {},
} = {}) {
  const fingerprint = candidateRow.canonical_fingerprint
    ?? composeBoardReportingPacketFingerprint(model).fingerprint;
  const resolvedCandidateRow = { ...candidateRow, canonical_fingerprint: fingerprint };
  return {
    construct: {
      runInTransaction: async (callback) => callback(fakeTx({ manifestRow, candidateRow: resolvedCandidateRow })),
    },
    invoke: {
      composeRenderModel: async (input) => {
        calls.composeRenderModelInput = input;
        calls.composeRenderModelCalls = (calls.composeRenderModelCalls || 0) + 1;
        return { ok: true, data: model, error: null };
      },
    },
  };
}

function buildRepository(deps) {
  return createPostgresBoardReportingCandidateExportManifestRenderModelRepository(deps.construct);
}

test("exact manifest with a still-current bound candidate composes the reusable Board render model", async () => {
  const calls = {};
  const deps = repositoryDeps({ calls });
  const repository = buildRepository(deps);
  const result = await repository.composeBoardReportingCandidateExportManifestRenderModel({
    organizationId: ORG,
    boardReportingCandidateExportManifestId: MANIFEST,
    actorContext: gkAdmin,
  }, deps.invoke);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.boardReportingCandidateExportManifestId, MANIFEST);
  assert.equal(result.data.boardReportingCandidateId, CANDIDATE_A);
  assert.equal(result.data.renderModel.organizationId, ORG);
  assert.equal(result.data.renderModel.engagementId, ENGAGEMENT);
  assert.equal(calls.composeRenderModelInput.engagementId, ENGAGEMENT);
  assert.equal(calls.composeRenderModelInput.actorContext, gkAdmin);
});

test("nonexistent manifest fails closed as not_found", async () => {
  const deps = repositoryDeps({ manifestRow: null });
  const repository = buildRepository(deps);
  const result = await repository.composeBoardReportingCandidateExportManifestRenderModel({
    organizationId: ORG,
    boardReportingCandidateExportManifestId: MANIFEST,
    actorContext: gkAdmin,
  }, deps.invoke);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("wrong organization / cross-tenant manifest fails closed as not_found", async () => {
  const deps = repositoryDeps();
  const repository = buildRepository(deps);
  const result = await repository.composeBoardReportingCandidateExportManifestRenderModel({
    organizationId: OTHER_ORG,
    boardReportingCandidateExportManifestId: MANIFEST,
    actorContext: gkAdmin,
  }, deps.invoke);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("a manifest for candidate A can never render candidate B's content", async () => {
  const deps = repositoryDeps({
    manifestRow: {
      board_reporting_candidate_export_manifest_id: MANIFEST,
      organization_id: ORG,
      board_reporting_candidate_id: CANDIDATE_A,
    },
    candidateRow: {
      board_reporting_candidate_id: CANDIDATE_B,
      organization_id: ORG,
      engagement_id: ENGAGEMENT,
      canonical_fingerprint: "never-matches",
    },
  });
  const repository = buildRepository(deps);
  const result = await repository.composeBoardReportingCandidateExportManifestRenderModel({
    organizationId: ORG,
    boardReportingCandidateExportManifestId: MANIFEST,
    actorContext: gkAdmin,
  }, deps.invoke);
  // The manifest's own FK-bound candidate id (CANDIDATE_A) never matches the
  // row loaded (CANDIDATE_B) in this fake tx, proving the repository loads
  // strictly by the manifest's own candidate id, never a substituted one.
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("a superseded/changed Board candidate fails closed instead of silently rendering different content", async () => {
  const deps = repositoryDeps({
    candidateRow: {
      board_reporting_candidate_id: CANDIDATE_A,
      organization_id: ORG,
      engagement_id: ENGAGEMENT,
      canonical_fingerprint: "stale-fingerprint-sentinel",
    },
  });
  const repository = buildRepository(deps);
  const result = await repository.composeBoardReportingCandidateExportManifestRenderModel({
    organizationId: ORG,
    boardReportingCandidateExportManifestId: MANIFEST,
    actorContext: gkAdmin,
  }, deps.invoke);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("render-model composition failure (feature-disabled/authorization) propagates verbatim, never reinvented", async () => {
  const deps = repositoryDeps();
  const repository = buildRepository(deps);
  const result = await repository.composeBoardReportingCandidateExportManifestRenderModel({
    organizationId: ORG,
    boardReportingCandidateExportManifestId: MANIFEST,
    actorContext: gkAdmin,
  }, { composeRenderModel: async () => buildKaiError("authorization_denied", { data: null }) });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("repository input contract is exact-key only", () => {
  const { isComposeBoardReportingCandidateExportManifestRenderModelInput } =
    __boardReportingCandidateExportManifestRenderModelRepositoryTestables;
  assert.equal(isComposeBoardReportingCandidateExportManifestRenderModelInput({
    organizationId: ORG,
    boardReportingCandidateExportManifestId: MANIFEST,
    actorContext: gkAdmin,
  }), true);
  assert.equal(isComposeBoardReportingCandidateExportManifestRenderModelInput({
    organizationId: ORG,
    boardReportingCandidateExportManifestId: MANIFEST,
    actorContext: gkAdmin,
    engagementId: ENGAGEMENT,
  }), false);
  assert.equal(isComposeBoardReportingCandidateExportManifestRenderModelInput({
    organizationId: ORG,
    boardReportingCandidateExportManifestId: MANIFEST,
    actorContext: gkAdmin,
    boardReportingCandidateId: CANDIDATE_A,
  }), false);
});

function serviceInput(overrides = {}) {
  return { organizationId: ORG, boardReportingCandidateExportManifestId: MANIFEST, actorContext: gkAdmin, ...overrides };
}

test("service reuses the manifest track's gk_admin-only gate, tenant boundary, and feature flag without adding a new gate", async () => {
  let repositoryCalls = 0;
  const repository = {
    async composeBoardReportingCandidateExportManifestRenderModel() {
      repositoryCalls += 1;
      return { ok: true, data: { boardReportingCandidateExportManifestId: MANIFEST, boardReportingCandidateId: CANDIDATE_A, renderModel: renderModel() }, error: null };
    },
  };
  assert.equal((await serializeBoardReportingCandidateExportManifestToMarkdown(serviceInput(), { env: enabledEnv, repository })).ok, true);
  assert.equal(repositoryCalls, 1);
  assert.equal((await serializeBoardReportingCandidateExportManifestToMarkdown(serviceInput(), { env: {}, repository })).error.code, "feature_disabled");
  assert.equal((await serializeBoardReportingCandidateExportManifestToMarkdown(
    serviceInput({ actorContext: { actorType: "system", actorUserId: "svc" } }),
    { env: enabledEnv, repository },
  )).error.code, "authorization_denied");
  const reviewer = { ...gkAdmin, organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }] };
  assert.equal((await serializeBoardReportingCandidateExportManifestToMarkdown(serviceInput({ actorContext: reviewer }), { env: enabledEnv, repository })).error.code, "authorization_denied");
  assert.equal((await serializeBoardReportingCandidateExportManifestToMarkdown(serviceInput({ organizationId: OTHER_ORG }), { env: enabledEnv, repository })).error.code, "authorization_denied");
  assert.equal(repositoryCalls, 1);
});

test("service exact-keys input contract refuses candidate id, fingerprint, member, eligibility, or authority fields", () => {
  const { isSerializeBoardReportingCandidateExportManifestToMarkdownInput } =
    __boardReportingCandidateExportManifestMarkdownSerializerTestables;
  assert.equal(isSerializeBoardReportingCandidateExportManifestToMarkdownInput(serviceInput()), true);
  for (const extra of [
    { engagementId: ENGAGEMENT },
    { boardReportingCandidateId: CANDIDATE_A },
    { canonicalFingerprint: "x" },
    { members: [] },
    { finalEligibility: true },
    { effectiveAuthorityDecisionId: "x" },
  ]) {
    assert.equal(isSerializeBoardReportingCandidateExportManifestToMarkdownInput({ ...serviceInput(), ...extra }), false, JSON.stringify(extra));
  }
});

test("service reuses the existing Board Markdown serializer verbatim and correctly self-labels as FINAL, never PREVIEW", async () => {
  const repository = {
    async composeBoardReportingCandidateExportManifestRenderModel() {
      return {
        ok: true,
        data: { boardReportingCandidateExportManifestId: MANIFEST, boardReportingCandidateId: CANDIDATE_A, renderModel: renderModel() },
        error: null,
      };
    },
  };
  const result = await serializeBoardReportingCandidateExportManifestToMarkdown(serviceInput(), { env: enabledEnv, repository });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.boardReportingCandidateExportManifestId, MANIFEST);
  assert.equal(result.data.boardReportingCandidateId, CANDIDATE_A);
  assert.equal(result.data.markdownContractVersion, __boardReportingCandidateExportManifestMarkdownSerializerContract.FINAL_MARKDOWN_CONTRACT_VERSION);
  assert.equal(result.data.deliveryClass, __boardReportingCandidateExportManifestMarkdownSerializerContract.FINAL_DELIVERY_CLASS);
  assert.match(result.data.markdown, /^# Board Summary\n/);
  assert.match(result.data.markdown, /Delivery class: `FINAL_MANIFEST_BOUND`/);
  assert.doesNotMatch(result.data.markdown, /PREVIEW_READ_ONLY/);
  assert.match(result.data.markdown, new RegExp(`Generated content draft: \`${DRAFT_A}\``));

  for (const forbidden of ["rawEvidence", "evidenceBody", "sourceBody", "sourceText", "storageLocation", "signedUrl", "gs://", "s3://"]) {
    assert.equal(result.data.markdown.includes(forbidden), false, forbidden);
  }
});

test("no exports were harmed: preview delivery class/contract remain the default when no override is given", async () => {
  const { serializeBoardReportingRenderModelToMarkdown } = await import("../Backend/kai/services/kaiBoardReportingMarkdownSerializer.js");
  const markdown = serializeBoardReportingRenderModelToMarkdown(renderModel());
  assert.match(markdown, /Markdown contract: kai-sprint2-board-reporting-markdown-preview-v1/);
  assert.match(markdown, /Delivery class: `PREVIEW_READ_ONLY`/);
});

test("package sources contain no new manifest creation, authority mutation, or SQL", () => {
  const serviceSource = readFileSync("Backend/kai/services/kaiBoardReportingCandidateExportManifestMarkdownSerializer.js", "utf8");
  const repositorySource = readFileSync(
    "Backend/kai/dictionary/postgresBoardReportingCandidateExportManifestRenderModelRepository.js",
    "utf8",
  );
  for (const source of [serviceSource, repositorySource]) {
    assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i);
    assert.doesNotMatch(source, /\.createExportManifest\(|\.recordDecision\(/);
    assert.doesNotMatch(source, /ORDER BY|LIMIT\s+1/i);
  }
});

const basePath = "/api/kai/sprint2/intake";
const routePath = "/admin/organizations/:organizationId/board-reporting/export-manifests/:boardReportingCandidateExportManifestId/markdown";
const finalMarkdown = "# Board Summary\n\nMarkdown contract: kai-sprint2-board-reporting-markdown-final-v1\n\nDelivery class: `FINAL_MANIFEST_BOUND`\n";

function downloadPath(overrides = {}) {
  return `${basePath}/admin/organizations/${overrides.organizationId || ORG}`
    + `/board-reporting/export-manifests/${overrides.boardReportingCandidateExportManifestId || MANIFEST}/markdown`;
}

function createScenario(overrides = {}) {
  return {
    authenticated: true,
    actorContext: gkAdmin,
    serviceCalls: [],
    serviceResult: {
      ok: true,
      data: {
        boardReportingCandidateExportManifestId: MANIFEST,
        boardReportingCandidateId: CANDIDATE_A,
        markdownContractVersion: "kai-sprint2-board-reporting-markdown-final-v1",
        deliveryClass: "FINAL_MANIFEST_BOUND",
        markdown: finalMarkdown,
      },
      error: null,
    },
    ...overrides,
  };
}

function createApplication(getScenario) {
  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, (req, res, next) => {
    const scenario = getScenario();
    req.isAuthenticated = () => scenario.authenticated;
    if (scenario.authenticated) {
      req.user = { id: 46 };
      req.kaiSprint2ActorContext = scenario.actorContext;
    }
    return next();
  });
  app.use(basePath, requireKaiSprint2Enabled, requireKaiSprint2Authenticated, sprint2IntakeApiRouter);
  return app;
}

async function listen(app) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

async function requestDownload(server, path) {
  const { port } = server.address();
  return await new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port, path, method: "GET" }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        bodyText: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    request.end();
  });
}

function withFeatureFlagEnabled() {
  const original = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  return () => {
    if (original === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = original;
  };
}

test("Board Summary FINAL Markdown delivery route appears as exactly one authenticated GET route", () => {
  const matches = sprint2IntakeApiRouter.stack.filter((layer) => layer.route?.path === routePath && layer.route?.methods?.get);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["get"]);
});

test("authorized gk_admin request returns the exact manifest-bound FINAL Markdown as an attachment", async (t) => {
  let scenario = createScenario();
  const restoreFeatureFlag = withFeatureFlagEnabled();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async serializeBoardReportingCandidateExportManifestToMarkdown(input) {
      scenario.serviceCalls.push(input);
      return scenario.serviceResult;
    },
  });
  const app = createApplication(() => scenario);
  const server = await listen(app);
  t.after(async () => {
    restoreService();
    restoreFeatureFlag();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  const response = await requestDownload(server, downloadPath());
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "text/markdown; charset=utf-8");
  assert.equal(response.headers["content-disposition"], 'attachment; filename="kai-board-summary-export-manifest.md"');
  assert.equal(response.bodyText, finalMarkdown);
  assert.deepEqual(scenario.serviceCalls, [{
    organizationId: ORG,
    boardReportingCandidateExportManifestId: MANIFEST,
    actorContext: gkAdmin,
  }]);
});

test("upstream failures (not_found/authorization_denied/conflict_current_state_changed) propagate with no attachment, and no manifest is ever created by this route", async (t) => {
  let scenario = createScenario();
  const restoreFeatureFlag = withFeatureFlagEnabled();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async serializeBoardReportingCandidateExportManifestToMarkdown(input) {
      scenario.serviceCalls.push(input);
      return scenario.serviceResult;
    },
  });
  const app = createApplication(() => scenario);
  const server = await listen(app);
  t.after(async () => {
    restoreService();
    restoreFeatureFlag();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  for (const [code, statusCode] of [
    ["not_found", 404],
    ["authorization_denied", 403],
    ["feature_disabled", 403],
    ["conflict_current_state_changed", 409],
  ]) {
    scenario = createScenario({ serviceResult: buildKaiError(code, { data: null }) });
    const response = await requestDownload(server, downloadPath());
    assert.equal(response.statusCode, statusCode, code);
    assert.equal(JSON.parse(response.bodyText).error.code, code);
    assert.equal("content-disposition" in response.headers, false, code);
  }
});

test("authentication failure and malformed manifest identifiers do not call the FINAL Markdown service", async (t) => {
  let scenario = createScenario({ authenticated: false });
  const restoreFeatureFlag = withFeatureFlagEnabled();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async serializeBoardReportingCandidateExportManifestToMarkdown(input) {
      scenario.serviceCalls.push(input);
      return scenario.serviceResult;
    },
  });
  const app = createApplication(() => scenario);
  const server = await listen(app);
  t.after(async () => {
    restoreService();
    restoreFeatureFlag();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  const unauthorized = await requestDownload(server, downloadPath());
  assert.equal(unauthorized.statusCode, 401);
  assert.deepEqual(scenario.serviceCalls, []);

  scenario = createScenario();
  const invalid = await requestDownload(server, downloadPath({ boardReportingCandidateExportManifestId: "not-a-uuid" }));
  assert.equal(invalid.statusCode, 422);
  assert.equal(JSON.parse(invalid.bodyText).error.code, "validation_blocker");
  assert.deepEqual(scenario.serviceCalls, []);
});

test("route helper rejects malformed manifest identifiers directly", () => {
  assert.equal(intakeRouteTestables.boardReportingCandidateExportManifestIdentifiers({
    params: { organizationId: ORG, boardReportingCandidateExportManifestId: MANIFEST },
  }).boardReportingCandidateExportManifestId, MANIFEST);
  assert.equal(intakeRouteTestables.boardReportingCandidateExportManifestIdentifiers({
    params: { organizationId: ORG, boardReportingCandidateExportManifestId: "../secret" },
  }), null);
});

test("route contains no SQL, direct KAI DB access, manifest creation, or authority mutation", () => {
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const routeStart = routeSource.indexOf(
    '"/admin/organizations/:organizationId/board-reporting/export-manifests/:boardReportingCandidateExportManifestId/markdown"',
  );
  const routeEnd = routeSource.indexOf("export default router;");
  const routeSlice = routeSource.slice(routeStart, routeEnd);
  assert.match(routeSlice, /serializeBoardReportingCandidateExportManifestToMarkdown/);
  assert.doesNotMatch(routeSlice, /\b(?:SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b|\bpool\b|\bkaiDb\b|\bkaiQueries\b/i);
  assert.doesNotMatch(routeSlice, /createExportManifest|recordDecision|export_authority_granted/i);
});
