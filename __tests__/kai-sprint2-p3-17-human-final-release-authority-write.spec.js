import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { readFileSync } from "node:fs";

import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import { KAI_ERROR_STATUS } from "../Backend/kai/errors/kaiErrors.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import {
  handleKaiSprint2JsonParserError,
  kaiSprint2ActorMutationLimiter,
  kaiSprint2MetadataJsonParser,
  kaiSprint2OrganizationMutationLimiter,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";
import {
  recordHumanFinalReleaseAuthorityDecision,
  __humanAuthorityDecisionServiceContract,
  __humanAuthorityDecisionServiceTestables,
} from "../Backend/kai/services/kaiHumanAuthorityDecisionService.js";
import {
  createPostgresHumanAuthorityDecisionRepository,
  __humanAuthorityDecisionRepositoryTestables,
} from "../Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js";

const basePath = "/api/kai/sprint2/intake";
const routePath = "/admin/organizations/:organizationId/export-candidates/:exportCandidateId/final-release-authority";
const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const CANDIDATE = "00000000-0000-4000-8000-000000000701";
const DRAFT = "00000000-0000-4000-8000-000000000702";
const ACTOR = "90000000-0000-4000-8000-000000000001";
const NOW = "2026-09-06T10:00:00.000Z";
const enabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_GENERATION_ENABLED: "true",
  KAI_PUBLIC_EXPORT_ENABLED: "true",
});
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
    exportCandidateId: CANDIDATE,
    requestedAudience: "internal",
    decisionAction: "grant",
    actorContext: gkAdminActorContext,
    now: NOW,
    ...overrides,
  };
}

function auditRecorder() {
  return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
}

function candidateRow(audience = "internal") {
  return {
    export_candidate_id: CANDIDATE,
    organization_id: ORG,
    generated_content_draft_id: DRAFT,
    requested_audience: audience,
  };
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

test("P3-17 final-release authority service pins existing export_authority_granted/gk_admin semantics", () => {
  assert.equal(__humanAuthorityDecisionServiceContract.FINAL_RELEASE_AUTHORITY_DECISION_TYPE, "export_authority_granted");
  assert.equal(__humanAuthorityDecisionServiceContract.FINAL_RELEASE_AUTHORITY_OPERATION, "record_human_final_release_authority_decision");
  assert.deepEqual([...__humanAuthorityDecisionServiceContract.FINAL_RELEASE_AUTHORITY_ROLES], ["gk_admin"]);
});

test("P3-17 final-release authority repository validator and role canonicality enforce exact human contract", () => {
  const { isRecordDecisionInput, isCanonicalDecidedByRole } = __humanAuthorityDecisionRepositoryTestables;
  const input = {
    organizationId: ORG,
    exportCandidateId: CANDIDATE,
    decisionType: "export_authority_granted",
    decisionAction: "grant",
    requestedAudience: "internal",
    actorContext: gkAdminActorContext,
    decidedByRole: "gk_admin",
    now: NOW,
  };

  assert.equal(isRecordDecisionInput(input), true);
  assert.equal(isRecordDecisionInput({ ...input, extra: true }), false);
  assert.equal(isRecordDecisionInput({ ...input, decisionType: "final_gate" }), false);
  assert.equal(isRecordDecisionInput({ ...input, decisionAction: "approve" }), false);
  assert.equal(isRecordDecisionInput({ ...input, actorContext: { actorType: "system", actorUserId: ACTOR } }), false);
  assert.equal(isRecordDecisionInput({ ...input, decidedByRole: "" }), false);
  // decidedByRole is resolved by the service layer (via the shared
  // resolveAuthorizedHumanRole helper against the actual successful
  // authorization result), not derived here from
  // actorContext.organizationMemberships - this repository only ever
  // validates that the role it was handed is the exact canonical role
  // required for the decisionType.
  assert.equal(isCanonicalDecidedByRole("gk_admin", "export_authority_granted"), true);
  assert.equal(isCanonicalDecidedByRole("gk_reviewer", "export_authority_granted"), false);
  assert.equal(isCanonicalDecidedByRole("gk_admin", "final_gate"), false);
});

test("P3-17 authorized affirmative final-release authority write succeeds and existing evaluator recognizes it", async () => {
  const queries = [];
  const tx = fakeTx([
    [candidateRow()],
    [],
    [],
    [{ decision_id: "00000000-0000-4000-8000-000000000901", decision_action: "grant" }],
    [{ intake_file_id: "00000000-0000-4000-8000-000000000801", upload_state: "confirmed" }],
    [],
  ], queries);
  const repo = createPostgresHumanAuthorityDecisionRepository({
    runInTransaction: async (fn) => fn(tx),
    evaluateCandidateCurrentness: async () => ({ ok: true, data: { current: true, reason: null }, error: null }),
  });

  const result = await repo.recordDecision({
    organizationId: ORG,
    exportCandidateId: CANDIDATE,
    decisionType: "export_authority_granted",
    decisionAction: "grant",
    requestedAudience: "internal",
    actorContext: gkAdminActorContext,
    decidedByRole: "gk_admin",
    now: NOW,
  }, { metadataOnlyAudit: auditRecorder() });

  assert.equal(result.ok, true);
  assert.equal(result.data.decisionType, "export_authority_granted");
  assert.equal(result.data.decisionAction, "grant");
  assert.equal(result.data.requestedAudience, "internal");
  assert.equal(result.data.decidedByRole, "gk_admin");
  assert.equal(result.data.effective, true);
  assert.equal(result.data.replayed, false);
  assert.equal("finalGate" in result.data, false);
  assert.equal("manifest" in result.data, false);
  assert.equal(queries.some((query) => /INSERT INTO kai\.human_authority_decisions/.test(query.sql)), true);
  assert.equal(queries.some((query) => /INSERT INTO kai\.upload_lifecycle_audit/.test(query.sql)), true);
  assert.equal(queries.some((query) => /export_artifacts|export_manifests|final_gate|finalGate/.test(query.sql)), false);
});

test("P3-17 wrong audience fails before authority insert", async () => {
  const queries = [];
  const tx = fakeTx([[candidateRow("funder")]], queries);
  const repo = createPostgresHumanAuthorityDecisionRepository({
    runInTransaction: async (fn) => fn(tx),
    evaluateCandidateCurrentness: async () => ({ ok: true, data: { current: true, reason: null }, error: null }),
  });
  const result = await repo.recordDecision({
    organizationId: ORG,
    exportCandidateId: CANDIDATE,
    decisionType: "export_authority_granted",
    decisionAction: "grant",
    requestedAudience: "internal",
    actorContext: gkAdminActorContext,
    decidedByRole: "gk_admin",
    now: NOW,
  }, { metadataOnlyAudit: auditRecorder() });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(queries.some((query) => /INSERT INTO kai\.human_authority_decisions/.test(query.sql)), false);
});

test("P3-17 stale export candidate fails before authority insert; existing evaluator still makes earlier grants ineffective", async () => {
  const { evaluateHumanAuthorityEffectivenessInTransaction } = __humanAuthorityDecisionRepositoryTestables;
  const queries = [];
  const tx = fakeTx([[candidateRow()]], queries);
  const repo = createPostgresHumanAuthorityDecisionRepository({
    runInTransaction: async (fn) => fn(tx),
    evaluateCandidateCurrentness: async () => ({ ok: true, data: { current: false, reason: "fingerprint_mismatch" }, error: null }),
  });

  const result = await repo.recordDecision({
    organizationId: ORG,
    exportCandidateId: CANDIDATE,
    decisionType: "export_authority_granted",
    decisionAction: "grant",
    requestedAudience: "internal",
    actorContext: gkAdminActorContext,
    decidedByRole: "gk_admin",
    now: NOW,
  }, { metadataOnlyAudit: auditRecorder() });
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(queries.some((query) => /INSERT INTO kai\.human_authority_decisions/.test(query.sql)), false);

  const stale = await evaluateHumanAuthorityEffectivenessInTransaction(
    fakeTx([[{ decision_id: "00000000-0000-4000-8000-000000000901", decision_action: "grant" }]]),
    {
      organizationId: ORG,
      exportCandidateId: CANDIDATE,
      decisionType: "export_authority_granted",
    },
    async () => ({ ok: true, data: { current: false, reason: "fingerprint_mismatch" }, error: null }),
  );
  assert.equal(stale.data.effective, false);
  assert.equal(stale.data.reason, "fingerprint_mismatch");
});

test("P3-17 revocation/supersession makes earlier final-release authority ineffective", async () => {
  const queries = [];
  const tx = fakeTx([
    [candidateRow()],
    [{ decision_id: "00000000-0000-4000-8000-000000000901", decision_action: "grant" }],
    [],
    [{ decision_id: "00000000-0000-4000-8000-000000000902", decision_action: "revoke" }],
    [{ intake_file_id: "00000000-0000-4000-8000-000000000801", upload_state: "confirmed" }],
    [],
  ], queries);
  const repo = createPostgresHumanAuthorityDecisionRepository({
    runInTransaction: async (fn) => fn(tx),
    evaluateCandidateCurrentness: async () => ({ ok: true, data: { current: true, reason: null }, error: null }),
  });

  const revoked = await repo.recordDecision({
    organizationId: ORG,
    exportCandidateId: CANDIDATE,
    decisionType: "export_authority_granted",
    decisionAction: "revoke",
    requestedAudience: "internal",
    actorContext: gkAdminActorContext,
    decidedByRole: "gk_admin",
    now: NOW,
  }, { metadataOnlyAudit: auditRecorder() });

  assert.equal(revoked.ok, true);
  assert.equal(revoked.data.decisionAction, "revoke");
  assert.equal(revoked.data.supersedesDecisionId, "00000000-0000-4000-8000-000000000901");
  assert.equal(revoked.data.effective, false);
  assert.equal(revoked.data.effectivenessReason, "head_is_revoke");
});

test("P3-17 duplicate same-action authority decision follows existing no-op replay behavior", async () => {
  const queries = [];
  const tx = fakeTx([
    [candidateRow()],
    [{ decision_id: "00000000-0000-4000-8000-000000000901", decision_action: "grant" }],
    [{ decision_id: "00000000-0000-4000-8000-000000000901", decision_action: "grant" }],
  ], queries);
  const repo = createPostgresHumanAuthorityDecisionRepository({
    runInTransaction: async (fn) => fn(tx),
    evaluateCandidateCurrentness: async () => ({ ok: true, data: { current: true, reason: null }, error: null }),
  });

  const result = await repo.recordDecision({
    organizationId: ORG,
    exportCandidateId: CANDIDATE,
    decisionType: "export_authority_granted",
    decisionAction: "grant",
    requestedAudience: "internal",
    actorContext: gkAdminActorContext,
    decidedByRole: "gk_admin",
    now: NOW,
  }, { metadataOnlyAudit: auditRecorder() });

  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, true);
  assert.equal(result.data.decisionId, "00000000-0000-4000-8000-000000000901");
  assert.equal(queries.some((query) => /INSERT INTO kai\.human_authority_decisions/.test(query.sql)), false);
  assert.equal(queries.some((query) => /INSERT INTO kai\.upload_lifecycle_audit/.test(query.sql)), false);
});

test("P3-17 service blocks unauthorized, AI/system, and cross-tenant actors before repository write", async () => {
  let repositoryCalls = 0;
  const repository = {
    async recordDecision() {
      repositoryCalls += 1;
      return { ok: true, data: {}, error: null };
    },
  };
  const deps = { humanAuthorityDecisionRepository: repository, metadataOnlyAudit: auditRecorder(), env: enabledEnv };

  assert.equal((await recordHumanFinalReleaseAuthorityDecision(authorityInput({ actorContext: gkReviewerActorContext }), deps)).error.code, "authorization_denied");
  assert.equal((await recordHumanFinalReleaseAuthorityDecision(authorityInput({ actorContext: { actorType: "system", actorUserId: ACTOR } }), deps)).error.code, "authorization_denied");
  assert.equal((await recordHumanFinalReleaseAuthorityDecision(authorityInput({ organizationId: OTHER_ORG }), deps)).error.code, "authorization_denied");
  assert.equal(repositoryCalls, 0);

  const ok = await recordHumanFinalReleaseAuthorityDecision(authorityInput(), deps);
  assert.equal(ok.ok, true);
  assert.equal(repositoryCalls, 1);
});

test("P3-17 final-release authority route delegates successfully and preserves service-only API composition", async (t) => {
  let scenario = {
    authenticated: true,
    actorContext: gkAdminActorContext,
    serviceCalls: [],
    dependencyCalls: [],
  };
  const restoreFeatureFlag = (() => {
    const original = process.env.KAI_SPRINT2_ENABLED;
    process.env.KAI_SPRINT2_ENABLED = "true";
    return () => {
      if (original === undefined) delete process.env.KAI_SPRINT2_ENABLED;
      else process.env.KAI_SPRINT2_ENABLED = original;
    };
  })();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async recordHumanFinalReleaseAuthorityDecision(input, dependencies) {
      scenario.serviceCalls.push(input);
      scenario.dependencyCalls.push(dependencies);
      return {
        ok: true,
        data: {
          decisionId: "00000000-0000-4000-8000-000000000901",
          exportCandidateId: input.exportCandidateId,
          decisionType: "export_authority_granted",
          decisionAction: input.decisionAction,
          requestedAudience: input.requestedAudience,
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
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
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

  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/final-release-authority`;
  const before = Date.now();
  const response = await requestJson(path, { requested_audience: "internal", decision_action: "grant" });
  const after = Date.now();
  assert.equal(response.statusCode, 201);
  assert.equal(scenario.serviceCalls.length, 1);
  assert.deepEqual(scenario.serviceCalls[0], {
    organizationId: ORG,
    exportCandidateId: CANDIDATE,
    requestedAudience: "internal",
    decisionAction: "grant",
    actorContext: gkAdminActorContext,
    now: scenario.serviceCalls[0].now,
  });
  assert.equal(typeof scenario.dependencyCalls[0].metadataOnlyAudit?.prepareMetadataOnlyAudit, "function");
  assert.equal(response.body.data.effective, true);
  assert.equal("finalGate" in response.body.data, false);
  assert.equal("artifact" in response.body.data, false);
  const nowMs = new Date(scenario.serviceCalls[0].now).getTime();
  assert.ok(nowMs >= before && nowMs <= after);

  scenario = { authenticated: false, actorContext: gkAdminActorContext, serviceCalls: [], dependencyCalls: [] };
  const unauthorized = await requestJson(path, { requested_audience: "internal", decision_action: "grant" });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.body.error.code, "unauthorized");
  assert.deepEqual(scenario.serviceCalls, []);

  scenario = { authenticated: true, actorContext: gkAdminActorContext, serviceCalls: [], dependencyCalls: [] };
  const malformed = await requestJson(path, { requested_audience: "internal", decision_action: "grant", finalGate: true });
  assert.equal(malformed.statusCode, 422);
  assert.equal(malformed.body.error.code, "validation_blocker");
  assert.deepEqual(scenario.serviceCalls, []);
});

test("P3-17 route and service sources do not wire finalGate, VAL-EXP-001, artifact, manifest, or finalization behavior", () => {
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const serviceSource = readFileSync("Backend/kai/services/kaiHumanAuthorityDecisionService.js", "utf8");
  const repositorySource = readFileSync("Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js", "utf8");
  const routeStart = routeSource.indexOf('"/admin/organizations/:organizationId/export-candidates/:exportCandidateId/final-release-authority"');
  assert.notEqual(routeStart, -1);
  const routeEnd = routeSource.indexOf("router.get(", routeStart);
  const routeSlice = routeSource.slice(routeStart, routeEnd);

  assert.match(routeSlice, /service\.recordHumanFinalReleaseAuthorityDecision/);
  assert.doesNotMatch(routeSlice, /\b(?:SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b|\bpool\b|\bkaiDb\b|\brepository\b|\bkai\.(?!js\b)/i);
  for (const source of [routeSlice, serviceSource, repositorySource]) {
    assert.doesNotMatch(source, /finalGate\s*:\s*true|final_gate\s*=\s*true|export_manifests|export_artifacts|createWriteStream|writeFileSync|writeFile|finalizeExport|finalization_status/i);
  }
});

test("P3-17 route is mounted exactly once", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === routePath && layer.route?.methods?.post);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["post"]);
});
