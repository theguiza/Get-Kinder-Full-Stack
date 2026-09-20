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

const basePath = "/api/kai/sprint2/intake";
const routePath = "/admin/organizations/:organizationId/export-candidates/:exportCandidateId/export-manifests";
const ORG = "00000000-0000-4000-8000-000000000001";
const CANDIDATE = "00000000-0000-4000-8000-000000000701";
const QUEUE_ITEM = "00000000-0000-4000-8000-000000000703";
const MANIFEST = "00000000-0000-4000-8000-000000000901";
const ACTOR = "90000000-0000-4000-8000-000000000001";

const gkAdminActorContext = Object.freeze({
  actorType: "human",
  actorUserId: ACTOR,
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});

async function startServer(scenario) {
  const restoreFeatureFlag = (() => {
    const original = process.env.KAI_SPRINT2_ENABLED;
    process.env.KAI_SPRINT2_ENABLED = "true";
    return () => {
      if (original === undefined) delete process.env.KAI_SPRINT2_ENABLED;
      else process.env.KAI_SPRINT2_ENABLED = original;
    };
  })();
  const restoreService = intakeRouteTestables.setIntakeServiceForTest({
    async createExportManifest(input, dependencies) {
      scenario.serviceCalls.push(input);
      scenario.dependencyCalls.push(dependencies);
      return scenario.result;
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
  return {
    server,
    async close() {
      restoreService();
      restoreFeatureFlag();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function requestJson(server, path, body) {
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

test("governed export finalization route delegates to createExportManifest and returns the exact exportManifestId", async (t) => {
  const scenario = {
    authenticated: true,
    actorContext: gkAdminActorContext,
    serviceCalls: [],
    dependencyCalls: [],
    result: {
      ok: true,
      data: {
        exportManifestId: MANIFEST,
        exportCandidateId: CANDIDATE,
        effectiveAuthorityDecisionId: "00000000-0000-4000-8000-000000000902",
        fingerprintContractVersion: 1,
        canonicalFingerprint: "deadbeef",
        replayed: false,
      },
      error: null,
    },
  };
  const { server, close } = await startServer(scenario);
  t.after(close);

  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;
  const before = Date.now();
  const response = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM });
  const after = Date.now();

  assert.equal(response.statusCode, 201);
  assert.equal(scenario.serviceCalls.length, 1);
  assert.deepEqual(scenario.serviceCalls[0], {
    organizationId: ORG,
    exportCandidateId: CANDIDATE,
    exportReviewQueueItemId: QUEUE_ITEM,
    actorContext: gkAdminActorContext,
    now: scenario.serviceCalls[0].now,
  });
  assert.equal(typeof scenario.dependencyCalls[0].metadataOnlyAudit?.prepareMetadataOnlyAudit, "function");
  assert.equal(response.body.data.exportManifestId, MANIFEST);
  assert.equal(response.body.data.exportCandidateId, CANDIDATE);
  const nowMs = new Date(scenario.serviceCalls[0].now).getTime();
  assert.ok(nowMs >= before && nowMs <= after);
});

test("governed export finalization route rejects missing/unknown body fields before service", async (t) => {
  const scenario = { authenticated: true, actorContext: gkAdminActorContext, serviceCalls: [], dependencyCalls: [], result: { ok: true, data: {}, error: null } };
  const { server, close } = await startServer(scenario);
  t.after(close);
  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;

  const missing = await requestJson(server, path, {});
  assert.equal(missing.statusCode, 422);
  assert.equal(missing.body.error.code, "validation_blocker");

  const unknown = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM, finalGate: true });
  assert.equal(unknown.statusCode, 422);
  assert.equal(unknown.body.error.code, "validation_blocker");

  assert.deepEqual(scenario.serviceCalls, []);
});

test("governed export finalization route propagates a P3-19 structured blocker without creating a manifest", async (t) => {
  const scenario = {
    authenticated: true,
    actorContext: gkAdminActorContext,
    serviceCalls: [],
    dependencyCalls: [],
    result: { ok: false, error: { code: "conflict_current_state_changed" }, data: null },
  };
  const { server, close } = await startServer(scenario);
  t.after(close);
  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;

  const response = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM });
  assert.equal(response.body.error.code, "conflict_current_state_changed");
  assert.equal(response.body.ok, false);
});

test("Test 6: governed export finalization route propagates the VAL-EXP-001 structured blocker, including evidence.failed_gates, over HTTP", async (t) => {
  const scenario = {
    authenticated: true,
    actorContext: gkAdminActorContext,
    serviceCalls: [],
    dependencyCalls: [],
    result: {
      ok: false,
      error: { code: "validation_blocker" },
      data: null,
      blockers: [{
        validator_key: "VAL-EXP-001",
        severity: "blocker",
        object_type: "generated_content_draft",
        object_code: "export_manifest_eligibility",
        object_id: "00000000-0000-4000-8000-000000000301",
        message: "Export manifest eligibility gates failed.",
        blocking_reason: "export_manifest_not_eligible",
        required_fix: null,
        evidence: { failed_gates: ["affirmative_human_export_authority_absent"] },
      }],
    },
  };
  const { server, close } = await startServer(scenario);
  t.after(close);
  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;

  const response = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM });

  assert.equal(response.statusCode, 422);
  assert.equal(response.body.error.code, "validation_blocker");
  assert.equal(Array.isArray(response.body.blockers), true);
  assert.equal(response.body.blockers.length, 1);
  assert.equal(response.body.blockers[0].validator_key, "VAL-EXP-001");
  assert.deepEqual(response.body.blockers[0].evidence.failed_gates, ["affirmative_human_export_authority_absent"]);
});

function authorityBlockerScenario({ failedGates, authorityEffectivenessReason }) {
  return {
    authenticated: true,
    actorContext: gkAdminActorContext,
    serviceCalls: [],
    dependencyCalls: [],
    result: {
      ok: false,
      error: { code: "validation_blocker" },
      data: null,
      blockers: [{
        validator_key: "VAL-EXP-001",
        severity: "blocker",
        object_type: "generated_content_draft",
        object_code: "export_manifest_eligibility",
        object_id: "00000000-0000-4000-8000-000000000301",
        message: "Export manifest eligibility gates failed.",
        blocking_reason: "export_manifest_not_eligible",
        required_fix: null,
        evidence: {
          failed_gates: failedGates,
          ...(authorityEffectivenessReason !== undefined ? { authority_effectiveness_reason: authorityEffectivenessReason } : {}),
        },
      }],
    },
  };
}

test("Test 1 (HTTP): a stale-candidate authority diagnostic (fingerprint_mismatch) reaches the HTTP blocker", async (t) => {
  const scenario = authorityBlockerScenario({
    failedGates: ["affirmative_human_export_authority_absent"],
    authorityEffectivenessReason: "fingerprint_mismatch",
  });
  const { server, close } = await startServer(scenario);
  t.after(close);
  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;

  const response = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM });

  assert.equal(response.statusCode, 422);
  assert.equal(response.body.error.code, "validation_blocker");
  assert.equal(response.body.blockers[0].validator_key, "VAL-EXP-001");
  assert.deepEqual(response.body.blockers[0].evidence.failed_gates, ["affirmative_human_export_authority_absent"]);
  assert.equal(response.body.blockers[0].evidence.authority_effectiveness_reason, "fingerprint_mismatch");
});

test("Test 2 (HTTP): a missing-authority diagnostic (no_decision) reaches the HTTP blocker", async (t) => {
  const scenario = authorityBlockerScenario({
    failedGates: ["affirmative_human_export_authority_absent"],
    authorityEffectivenessReason: "no_decision",
  });
  const { server, close } = await startServer(scenario);
  t.after(close);
  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;

  const response = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM });

  assert.equal(response.body.blockers[0].evidence.authority_effectiveness_reason, "no_decision");
});

test("Test 4 (HTTP): multiple failed gates survive unchanged and the authority reason appears exactly once", async (t) => {
  const scenario = authorityBlockerScenario({
    failedGates: [
      "generated_content_review_unresolved",
      "current_use_ineligible",
      "affirmative_human_export_authority_absent",
    ],
    authorityEffectivenessReason: "no_decision",
  });
  const { server, close } = await startServer(scenario);
  t.after(close);
  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;

  const response = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM });

  assert.deepEqual(response.body.blockers[0].evidence.failed_gates, [
    "generated_content_review_unresolved",
    "current_use_ineligible",
    "affirmative_human_export_authority_absent",
  ]);
  assert.equal(response.body.blockers[0].evidence.authority_effectiveness_reason, "no_decision");
  assert.equal(Object.keys(response.body.blockers[0].evidence).length, 2);
});

test("Test 5 (sanitizer boundary): an unsafe/malformed authority_effectiveness_reason is stripped before HTTP, without weakening failed_gates", () => {
  const { sanitizeServiceBlockers } = intakeRouteTestables;
  const unsafeReasons = [
    "Fingerprint Mismatch",
    "fingerprint_mismatch; DROP TABLE kai.export_manifests;",
    "a".repeat(65),
    "",
    null,
    42,
    { injected: true },
  ];
  for (const unsafeReason of unsafeReasons) {
    const sanitized = sanitizeServiceBlockers([{
      validator_key: "VAL-EXP-001",
      severity: "blocker",
      object_type: "generated_content_draft",
      object_code: "export_manifest_eligibility",
      message: "Export manifest eligibility gates failed.",
      blocking_reason: "export_manifest_not_eligible",
      evidence: {
        failed_gates: ["affirmative_human_export_authority_absent"],
        authority_effectiveness_reason: unsafeReason,
      },
    }]);
    assert.deepEqual(sanitized[0].evidence.failed_gates, ["affirmative_human_export_authority_absent"], JSON.stringify(unsafeReason));
    assert.equal(Object.hasOwn(sanitized[0].evidence, "authority_effectiveness_reason"), false, JSON.stringify(unsafeReason));
  }
});

test("Test 5b (sanitizer boundary): a safe authority_effectiveness_reason is dropped when the authority gate did not fail", () => {
  const { sanitizeServiceBlockers } = intakeRouteTestables;
  const sanitized = sanitizeServiceBlockers([{
    validator_key: "VAL-EXP-001",
    severity: "blocker",
    object_type: "generated_content_draft",
    object_code: "export_manifest_eligibility",
    message: "Export manifest eligibility gates failed.",
    blocking_reason: "export_manifest_not_eligible",
    evidence: {
      failed_gates: ["generated_content_review_unresolved"],
      authority_effectiveness_reason: "no_decision",
    },
  }]);
  assert.deepEqual(sanitized[0].evidence.failed_gates, ["generated_content_review_unresolved"]);
  assert.equal(Object.hasOwn(sanitized[0].evidence, "authority_effectiveness_reason"), false);
});

test("Test 6 (success path): a passing manifest create response is unaffected by the authority-reason sanitization", async (t) => {
  const scenario = {
    authenticated: true,
    actorContext: gkAdminActorContext,
    serviceCalls: [],
    dependencyCalls: [],
    result: {
      ok: true,
      data: {
        exportManifestId: MANIFEST,
        exportCandidateId: CANDIDATE,
        effectiveAuthorityDecisionId: "00000000-0000-4000-8000-000000000902",
        fingerprintContractVersion: 1,
        canonicalFingerprint: "deadbeef",
        replayed: false,
      },
      error: null,
    },
  };
  const { server, close } = await startServer(scenario);
  t.after(close);
  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;

  const response = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.data.exportManifestId, MANIFEST);
  assert.equal(Object.hasOwn(response.body, "blockers"), false);
});

test("Test 8 (HTTP): the unstructured export-eligibility diagnostic blocker reaches the HTTP response", async (t) => {
  const scenario = {
    authenticated: true,
    actorContext: gkAdminActorContext,
    serviceCalls: [],
    dependencyCalls: [],
    result: {
      ok: false,
      error: { code: "validation_blocker" },
      data: null,
      blockers: [{
        validator_key: "VAL-SYS-P0-001",
        severity: "blocker",
        object_type: "export_candidate",
        message: "Export eligibility evaluation was blocked before a structured validator result was produced.",
        blocking_reason: "unstructured_export_eligibility_blocker",
        required_fix: "Use the diagnostic evidence to identify the failing export-eligibility stage.",
        evidence: {
          failure_stage: "authority_effectiveness_evaluation",
          upstream_error_code: "validation_blocker",
        },
      }],
    },
  };
  const { server, close } = await startServer(scenario);
  t.after(close);
  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;

  const response = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM });

  assert.equal(response.statusCode, 422);
  assert.equal(response.body.error.code, "validation_blocker");
  assert.equal(response.body.blockers.length, 1);
  assert.equal(response.body.blockers[0].validator_key, "VAL-SYS-P0-001");
  assert.equal(response.body.blockers[0].blocking_reason, "unstructured_export_eligibility_blocker");
  assert.equal(response.body.blockers[0].evidence.failure_stage, "authority_effectiveness_evaluation");
  assert.equal(response.body.blockers[0].evidence.upstream_error_code, "validation_blocker");
  // The previously-observed production shape (blockers:[]) must not recur.
  assert.notDeepEqual(response.body.blockers, []);
});

test("Test 9 (HTTP): the ordinary export-manifest bare-422 diagnostic (repository-side, not eligibility) reaches the HTTP response", async (t) => {
  const scenario = {
    authenticated: true,
    actorContext: gkAdminActorContext,
    serviceCalls: [],
    dependencyCalls: [],
    result: {
      ok: false,
      error: { code: "validation_blocker" },
      data: null,
      blockers: [{
        validator_key: "VAL-SYS-P0-001",
        severity: "blocker",
        object_type: "export_manifest",
        message: "Export manifest creation was blocked before a structured validator result was produced.",
        blocking_reason: "unstructured_export_manifest_failure",
        required_fix: "Use the diagnostic evidence to identify the failing export-manifest stage.",
        evidence: {
          failure_stage: "export_manifest_insert",
          upstream_error_code: "23503",
        },
      }],
    },
  };
  const { server, close } = await startServer(scenario);
  t.after(close);
  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;

  const response = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM });

  assert.equal(response.statusCode, 422);
  assert.equal(response.body.error.code, "validation_blocker");
  assert.equal(response.body.blockers.length, 1);
  assert.equal(response.body.blockers[0].validator_key, "VAL-SYS-P0-001");
  assert.equal(response.body.blockers[0].blocking_reason, "unstructured_export_manifest_failure");
  assert.equal(response.body.blockers[0].evidence.failure_stage, "export_manifest_insert");
  assert.equal(response.body.blockers[0].evidence.upstream_error_code, "23503");
});

test("Test 9c (HTTP): the ordinary export-manifest bare-422 diagnostic (service-side input contract) reaches the HTTP response", async (t) => {
  const scenario = {
    authenticated: true,
    actorContext: gkAdminActorContext,
    serviceCalls: [],
    dependencyCalls: [],
    result: {
      ok: false,
      error: { code: "validation_blocker" },
      data: null,
      blockers: [{
        validator_key: "VAL-SYS-P0-001",
        severity: "blocker",
        object_type: "export_manifest",
        message: "Export manifest creation was blocked before a structured validator result was produced.",
        blocking_reason: "unstructured_export_manifest_failure",
        required_fix: "Use the diagnostic evidence to identify the failing export-manifest stage.",
        evidence: {
          failure_stage: "service_input_contract",
        },
      }],
    },
  };
  const { server, close } = await startServer(scenario);
  t.after(close);
  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;

  const response = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM });

  assert.equal(response.statusCode, 422);
  assert.equal(response.body.error.code, "validation_blocker");
  assert.equal(response.body.blockers.length, 1);
  assert.equal(response.body.blockers[0].validator_key, "VAL-SYS-P0-001");
  assert.equal(response.body.blockers[0].blocking_reason, "unstructured_export_manifest_failure");
  assert.equal(response.body.blockers[0].evidence.failure_stage, "service_input_contract");
});

test("service error.message survives for an expected service error (validation_blocker)", async (t) => {
  const scenario = {
    authenticated: true,
    actorContext: gkAdminActorContext,
    serviceCalls: [],
    dependencyCalls: [],
    result: {
      ok: false,
      error: { code: "validation_blocker", status: 422, message: "SPECIFIC_SAFE_TEST_MESSAGE" },
      data: null,
      blockers: [],
    },
  };
  const { server, close } = await startServer(scenario);
  t.after(close);
  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;

  const response = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM });

  assert.equal(response.statusCode, 422);
  assert.equal(response.body.error.code, "validation_blocker");
  assert.equal(response.body.error.message, "SPECIFIC_SAFE_TEST_MESSAGE");
});

test("missing service error.message retains the existing KAI fallback message", async (t) => {
  const scenario = {
    authenticated: true,
    actorContext: gkAdminActorContext,
    serviceCalls: [],
    dependencyCalls: [],
    result: {
      ok: false,
      error: { code: "validation_blocker", status: 422 },
      data: null,
      blockers: [],
    },
  };
  const { server, close } = await startServer(scenario);
  t.after(close);
  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;

  const response = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM });

  assert.equal(response.statusCode, 422);
  assert.equal(response.body.error.message, "Request failed KAI validation.");
});

test("a system_error service message is never exposed over HTTP", async (t) => {
  const scenario = {
    authenticated: true,
    actorContext: gkAdminActorContext,
    serviceCalls: [],
    dependencyCalls: [],
    result: {
      ok: false,
      error: { code: "system_error", status: 500, message: "DO_NOT_EXPOSE_THIS" },
      data: null,
    },
  };
  const { server, close } = await startServer(scenario);
  t.after(close);
  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;

  const response = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM });

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.error.message, "KAI Sprint 2 server error.");
  assert.doesNotMatch(JSON.stringify(response.body), /DO_NOT_EXPOSE_THIS/);
});

test("a structured blocker is returned unchanged alongside a surviving service error message", async (t) => {
  const scenario = {
    authenticated: true,
    actorContext: gkAdminActorContext,
    serviceCalls: [],
    dependencyCalls: [],
    result: {
      ok: false,
      error: { code: "validation_blocker", status: 422, message: "SPECIFIC_SAFE_TEST_MESSAGE" },
      data: null,
      blockers: [{
        validator_key: "VAL-EXP-001",
        severity: "blocker",
        object_type: "generated_content_draft",
        object_code: "export_manifest_eligibility",
        object_id: "00000000-0000-4000-8000-000000000301",
        message: "Export manifest eligibility gates failed.",
        blocking_reason: "export_manifest_not_eligible",
        required_fix: "Resolve the failing export-eligibility gate and retry.",
        evidence: { failed_gates: ["affirmative_human_export_authority_absent"] },
      }],
    },
  };
  const { server, close } = await startServer(scenario);
  t.after(close);
  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;

  const response = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM });

  assert.equal(response.statusCode, 422);
  assert.equal(response.body.error.message, "SPECIFIC_SAFE_TEST_MESSAGE");
  assert.equal(response.body.blockers.length, 1);
  assert.equal(response.body.blockers[0].validator_key, "VAL-EXP-001");
  assert.equal(response.body.blockers[0].blocking_reason, "export_manifest_not_eligible");
  assert.equal(response.body.blockers[0].required_fix, "Resolve the failing export-eligibility gate and retry.");
  assert.equal(response.body.blockers[0].message, "Export manifest eligibility gates failed.");
  assert.deepEqual(response.body.blockers[0].evidence.failed_gates, ["affirmative_human_export_authority_absent"]);
});

test("Test 9 (sanitizer boundary): unsafe failure_stage/upstream_error_code/upstream_reason values are stripped before HTTP", () => {
  const { sanitizeServiceBlockers } = intakeRouteTestables;
  const unsafeValues = [
    "Authority Effectiveness Evaluation",
    "authority_effectiveness_evaluation; DROP TABLE kai.export_manifests;",
    "authority/effectiveness",
    "authority\neffectiveness",
    "a".repeat(65),
    "",
    null,
    42,
    { injected: true },
  ];
  for (const unsafeValue of unsafeValues) {
    const sanitized = sanitizeServiceBlockers([{
      validator_key: "VAL-SYS-P0-001",
      severity: "blocker",
      blocking_reason: "unstructured_export_eligibility_blocker",
      evidence: {
        failure_stage: unsafeValue,
        upstream_error_code: unsafeValue,
        upstream_reason: unsafeValue,
      },
    }]);
    assert.equal(Object.hasOwn(sanitized[0].evidence, "failure_stage"), false, JSON.stringify(unsafeValue));
    assert.equal(Object.hasOwn(sanitized[0].evidence, "upstream_error_code"), false, JSON.stringify(unsafeValue));
    assert.equal(Object.hasOwn(sanitized[0].evidence, "upstream_reason"), false, JSON.stringify(unsafeValue));
  }
});

test("Test 9d (HTTP): a known-constraint export-manifest insert failure reaches the HTTP response as an actionable blocker with constraint_key", async (t) => {
  const scenario = {
    authenticated: true,
    actorContext: gkAdminActorContext,
    serviceCalls: [],
    dependencyCalls: [],
    result: {
      ok: false,
      error: { code: "validation_blocker" },
      data: null,
      blockers: [{
        validator_key: "VAL-SYS-P0-001",
        severity: "blocker",
        object_type: "export_manifest",
        object_code: "export_manifest_authority_reference",
        message: "The selected export authority decision is not valid for this export candidate.",
        blocking_reason: "export_authority_reference_invalid",
        required_fix:
          "Re-evaluate the current export authority decision for this organization and export candidate, then retry export finalization.",
        evidence: {
          failure_stage: "export_manifest_insert",
          upstream_error_code: "23503",
          constraint_key: "authority_decision_fk",
        },
      }],
    },
  };
  const { server, close } = await startServer(scenario);
  t.after(close);
  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;

  const response = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM });

  assert.equal(response.statusCode, 422);
  assert.equal(response.body.error.code, "validation_blocker");
  assert.equal(response.body.blockers.length, 1);
  const [blocker] = response.body.blockers;
  assert.equal(blocker.blocking_reason, "export_authority_reference_invalid");
  assert.equal(blocker.evidence.failure_stage, "export_manifest_insert");
  assert.equal(blocker.evidence.upstream_error_code, "23503");
  assert.equal(blocker.evidence.constraint_key, "authority_decision_fk");
});

test("Test 9e (sanitizer boundary): an unsafe/unknown constraint_key is stripped before HTTP", () => {
  const { sanitizeServiceBlockers } = intakeRouteTestables;
  const unsafeValues = [
    "export_manifests_p3_19_authority_decision_fk",
    "some_future_unmapped_fk",
    "authority_decision_fk; DROP TABLE kai.export_manifests;",
    "AUTHORITY_DECISION_FK",
    "",
    null,
    42,
    { injected: true },
  ];
  for (const unsafeValue of unsafeValues) {
    const sanitized = sanitizeServiceBlockers([{
      validator_key: "VAL-SYS-P0-001",
      severity: "blocker",
      blocking_reason: "export_authority_reference_invalid",
      evidence: {
        failure_stage: "export_manifest_insert",
        upstream_error_code: "23503",
        constraint_key: unsafeValue,
      },
    }]);
    assert.equal(Object.hasOwn(sanitized[0].evidence, "constraint_key"), false, JSON.stringify(unsafeValue));
  }
});

test("Test 9f (sanitizer boundary): each known constraint_key survives HTTP sanitization", () => {
  const { sanitizeServiceBlockers } = intakeRouteTestables;
  const knownConstraintKeys = [
    "authority_decision_fk",
    "candidate_fk",
    "review_queue_item_fk",
    "canonical_fingerprint_check",
    "created_by_type_check",
    "decision_type_check",
    "fingerprint_contract_version_check",
  ];
  for (const constraintKey of knownConstraintKeys) {
    const sanitized = sanitizeServiceBlockers([{
      validator_key: "VAL-SYS-P0-001",
      severity: "blocker",
      blocking_reason: "export_authority_reference_invalid",
      evidence: {
        failure_stage: "export_manifest_insert",
        upstream_error_code: "23503",
        constraint_key: constraintKey,
      },
    }]);
    assert.equal(sanitized[0].evidence.constraint_key, constraintKey);
  }
});

test("Test 9b (sanitizer boundary): safe failure_stage/upstream_error_code/upstream_reason values survive alongside failed_gates", () => {
  const { sanitizeServiceBlockers } = intakeRouteTestables;
  const sanitized = sanitizeServiceBlockers([{
    validator_key: "VAL-SYS-P0-001",
    severity: "blocker",
    blocking_reason: "unstructured_export_eligibility_blocker",
    evidence: {
      failure_stage: "authority_effectiveness_evaluation",
      upstream_error_code: "validation_blocker",
      upstream_reason: "no_decision",
      failed_gates: ["affirmative_human_export_authority_absent"],
    },
  }]);
  assert.equal(sanitized[0].evidence.failure_stage, "authority_effectiveness_evaluation");
  assert.equal(sanitized[0].evidence.upstream_error_code, "validation_blocker");
  assert.equal(sanitized[0].evidence.upstream_reason, "no_decision");
  assert.deepEqual(sanitized[0].evidence.failed_gates, ["affirmative_human_export_authority_absent"]);
});

test("governed export finalization route requires authentication", async (t) => {
  const scenario = { authenticated: false, actorContext: gkAdminActorContext, serviceCalls: [], dependencyCalls: [], result: { ok: true, data: {}, error: null } };
  const { server, close } = await startServer(scenario);
  t.after(close);
  const path = `${basePath}/admin/organizations/${ORG}/export-candidates/${CANDIDATE}/export-manifests`;

  const response = await requestJson(server, path, { export_review_queue_item_id: QUEUE_ITEM });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(scenario.serviceCalls, []);
});

test("governed export finalization route is mounted exactly once and delegates to the service only", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === routePath && layer.route?.methods?.post);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["post"]);

  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const routeStart = routeSource.indexOf(`"${routePath}"`);
  assert.notEqual(routeStart, -1);
  const routeEnd = routeSource.indexOf("async function getExportManifestMarkdownService(", routeStart);
  const routeSlice = routeSource.slice(routeStart, routeEnd);
  assert.match(routeSlice, /service\.createExportManifest/);
  assert.doesNotMatch(routeSlice, /\b(?:SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b|\bpool\b|\bkaiDb\b|\brepository\b|\bkai\.(?!js\b)/i);
});

test("kaiExportManifestService remains the sole authority: no manifest-selection-by-timestamp/latest logic in the route", () => {
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const routeStart = routeSource.indexOf(`"${routePath}"`);
  const routeEnd = routeSource.indexOf("async function getExportManifestMarkdownService(", routeStart);
  const routeSlice = routeSource.slice(routeStart, routeEnd);
  assert.doesNotMatch(routeSlice, /ORDER BY|LIMIT 1|latest|most recent|current\s*=\s*true|active\s*=\s*true/i);
});
