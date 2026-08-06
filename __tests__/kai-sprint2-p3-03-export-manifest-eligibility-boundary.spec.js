import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  evaluateGeneratedDraftExportEligibility,
  __exportEligibilityServiceTestables,
} from "../Backend/kai/services/kaiExportEligibilityService.js";
import {
  validateExportManifestEligibility,
  __exportManifestEligibilityValidatorContract,
} from "../Backend/kai/validators/kaiExportManifestEligibilityValidators.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const DRAFT = "00000000-0000-4000-8000-000000000301";
const QUEUE = "00000000-0000-4000-8000-000000000303";
const enabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_GENERATION_ENABLED: "true",
  KAI_PUBLIC_EXPORT_ENABLED: "true",
});
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  source: "public.userdata",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});

function input(overrides = {}) {
  return {
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    requestedExportAudience: "internal",
    actorContext,
    ...overrides,
  };
}

function packet(overrides = {}) {
  return {
    generatedContentDraftId: DRAFT,
    requestedAudience: "internal",
    draftStatus: "draft",
    reviewQueueItemId: QUEUE,
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    currentUseEligible: true,
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  const calls = { evaluatePacket: 0, runInTransaction: 0 };
  return {
    deps: {
      env: enabledEnv,
      runInTransaction: async (callback) => {
        calls.runInTransaction += 1;
        return callback({ async query() { return { rows: [] }; } });
      },
      evaluatePacket: async () => {
        calls.evaluatePacket += 1;
        return { ok: true, data: packet(), error: null };
      },
      evaluator: async () => ({ ok: true, data: {}, error: null }),
      ...overrides,
    },
    calls,
  };
}

// --- VAL-EXP-001 canonical validator contract ---

test("VAL-EXP-001 canonical pass result when every gate is satisfied", () => {
  const result = validateExportManifestEligibility({
    generatedContentDraftId: DRAFT,
    requestedExportAudience: "internal",
    draftAudience: "internal",
    draftIsStillDraft: false,
    reviewIsResolved: true,
    currentUseEligible: true,
    finalGate: true,
    affirmativeHumanExportAuthority: true,
  });
  assert.equal(result.validator_key, "VAL-EXP-001");
  assert.equal(result.severity, "pass");
  assert.equal(result.object_type, "generated_content_draft");
  assert.equal(result.object_code, "export_manifest_eligibility");
  assert.equal(result.object_id, DRAFT);
  assert.equal(result.blocking_reason, null);
  assert.deepEqual(result.evidence, {});
});

test("VAL-EXP-001 blocker result carries only failed_gates evidence with stable ordering", () => {
  const result = validateExportManifestEligibility({
    generatedContentDraftId: DRAFT,
    requestedExportAudience: "public",
    draftAudience: "internal",
    draftIsStillDraft: true,
    reviewIsResolved: false,
    currentUseEligible: false,
    finalGate: true,
    affirmativeHumanExportAuthority: false,
  });
  assert.equal(result.severity, "blocker");
  assert.equal(result.blocking_reason, "export_manifest_not_eligible");
  assert.deepEqual(Object.keys(result.evidence), ["failed_gates"]);
  assert.deepEqual(result.evidence.failed_gates, [
    "final_gate_true_while_draft",
    "generated_content_still_draft",
    "generated_content_review_unresolved",
    "current_use_ineligible",
    "export_audience_mismatch",
    "affirmative_human_export_authority_absent",
  ]);
});

test("VAL-EXP-001 the real repository path (no persisted authority or final gate) always fails final_export_gate_absent", () => {
  const result = validateExportManifestEligibility({
    generatedContentDraftId: DRAFT,
    requestedExportAudience: "internal",
    draftAudience: "internal",
    draftIsStillDraft: true,
    reviewIsResolved: false,
    currentUseEligible: true,
    finalGate: false,
    affirmativeHumanExportAuthority: false,
  });
  assert.equal(result.severity, "blocker");
  assert.deepEqual(result.evidence.failed_gates, [
    "generated_content_still_draft",
    "generated_content_review_unresolved",
    "affirmative_human_export_authority_absent",
    "final_export_gate_absent",
  ]);
});

test("VAL-EXP-001 final_gate_true_while_draft and final_export_gate_absent are mutually exclusive and never both fire", () => {
  const bothOff = validateExportManifestEligibility({
    generatedContentDraftId: DRAFT,
    requestedExportAudience: "internal",
    draftAudience: "internal",
    draftIsStillDraft: true,
    reviewIsResolved: true,
    currentUseEligible: true,
    finalGate: false,
    affirmativeHumanExportAuthority: true,
  });
  assert.ok(!bothOff.evidence.failed_gates.includes("final_gate_true_while_draft"));
  assert.ok(bothOff.evidence.failed_gates.includes("final_export_gate_absent"));

  const bothOn = validateExportManifestEligibility({
    generatedContentDraftId: DRAFT,
    requestedExportAudience: "internal",
    draftAudience: "internal",
    draftIsStillDraft: true,
    reviewIsResolved: true,
    currentUseEligible: true,
    finalGate: true,
    affirmativeHumanExportAuthority: true,
  });
  assert.ok(bothOn.evidence.failed_gates.includes("final_gate_true_while_draft"));
  assert.ok(!bothOn.evidence.failed_gates.includes("final_export_gate_absent"));
});

test("VAL-EXP-001 rejects a non-exact input contract", () => {
  assert.throws(() => validateExportManifestEligibility({
    generatedContentDraftId: DRAFT,
    requestedExportAudience: "internal",
    draftAudience: "internal",
    draftIsStillDraft: false,
    reviewIsResolved: true,
    currentUseEligible: true,
    finalGate: true,
    affirmativeHumanExportAuthority: true,
    extra: true,
  }), TypeError);
});

test("VAL-EXP-001 contract constants match the specification", () => {
  assert.deepEqual(__exportManifestEligibilityValidatorContract.VALIDATOR_KEY, "VAL-EXP-001");
  assert.deepEqual(__exportManifestEligibilityValidatorContract.OBJECT_TYPE, "generated_content_draft");
  assert.deepEqual(__exportManifestEligibilityValidatorContract.OBJECT_CODE, "export_manifest_eligibility");
  assert.deepEqual(__exportManifestEligibilityValidatorContract.BLOCKING_REASON, "export_manifest_not_eligible");
});

// --- service gates ---

test("P3-03 service requires KAI_SPRINT2_ENABLED, then KAI_GENERATION_ENABLED, then KAI_PUBLIC_EXPORT_ENABLED before any database-capable module loads", async () => {
  const { deps, calls } = dependencies();
  assert.equal((await evaluateGeneratedDraftExportEligibility(input(), { ...deps, env: {} })).error.code, "feature_disabled");
  assert.equal((await evaluateGeneratedDraftExportEligibility(input(), { ...deps, env: { KAI_SPRINT2_ENABLED: "true" } })).error.code, "feature_disabled");
  assert.equal(
    (await evaluateGeneratedDraftExportEligibility(input(), { ...deps, env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" } })).error.code,
    "feature_disabled",
  );
  assert.equal(calls.runInTransaction, 0);
  assert.equal(calls.evaluatePacket, 0);
});

test("P3-03 service lazy-loads database-capable modules only after all gates, per its own source", () => {
  const source = readFileSync(new URL("../Backend/kai/services/kaiExportEligibilityService.js", import.meta.url), "utf8");
  const topLevelImports = source.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/postgresGeneratedContentRepository|postgresClaimTraceabilityRepository|kaiDb\.js|"pg"/.test(line)));
  assert.ok(source.indexOf("isKaiSprint2Enabled") < source.indexOf("createDefaultDependencies"));
});

test("P3-03 service gates: exact input, mapped human, active tenant membership, and gk_admin authorization precede the transaction-scoped read", async () => {
  const { deps, calls } = dependencies();
  assert.equal((await evaluateGeneratedDraftExportEligibility({ ...input(), extra: true }, deps)).error.code, "validation_blocker");
  assert.equal((await evaluateGeneratedDraftExportEligibility(input({ requestedExportAudience: "invalid" }), deps)).error.code, "validation_blocker");
  assert.equal((await evaluateGeneratedDraftExportEligibility(input({ actorContext: { actorType: "system", actorUserId: actorContext.actorUserId } }), deps)).error.code, "authorization_denied");
  assert.equal((await evaluateGeneratedDraftExportEligibility(input({ organizationId: OTHER_ORG }), deps)).error.code, "authorization_denied");
  assert.equal(
    (await evaluateGeneratedDraftExportEligibility(input({
      actorContext: { ...actorContext, organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }] },
    }), deps)).error.code,
    "authorization_denied",
  );
  assert.equal(calls.runInTransaction, 0);
  assert.equal(calls.evaluatePacket, 0);
  const ok = await evaluateGeneratedDraftExportEligibility(input(), deps);
  assert.equal(ok.ok, true);
  assert.equal(calls.runInTransaction, 1);
  assert.equal(calls.evaluatePacket, 1);
});

test("P3-03 service maps a missing tenant-scoped draft to not_found", async () => {
  const { deps } = dependencies({
    evaluatePacket: async () => ({ ok: false, data: null, error: { code: "not_found", status: 404 } }),
  });
  const result = await evaluateGeneratedDraftExportEligibility(input(), deps);
  assert.equal(result.error.code, "not_found");
  assert.equal(result.data, null);
});

test("P3-03 service maps incomplete, duplicated, stale, cross-tenant, malformed, or incompatible P3-01/P3-02 state to conflict_current_state_changed without ever reaching VAL-EXP-001", async () => {
  for (const code of ["conflict_current_state_changed", "system_error", "validation_blocker"]) {
    const { deps } = dependencies({
      evaluatePacket: async () => ({ ok: false, data: null, error: { code, status: 409 } }),
    });
    const result = await evaluateGeneratedDraftExportEligibility(input(), deps);
    assert.equal(result.error.code, "conflict_current_state_changed");
    assert.equal(result.data, null);
  }
});

test("P3-03 a valid packet that fails export gates returns a successful DTO with exportEligible:false and a structured VAL-EXP-001 blocker", async () => {
  const { deps } = dependencies();
  const result = await evaluateGeneratedDraftExportEligibility(input(), deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.exportEligible, false);
  assert.equal(result.data.validatorResult.severity, "blocker");
  assert.equal(result.data.validatorResult.validator_key, "VAL-EXP-001");
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("final_export_gate_absent"));
  assert.ok(result.data.validatorResult.evidence.failed_gates.includes("affirmative_human_export_authority_absent"));
});

test("P3-03 no persisted human export authority or final gate is ever inferred from queue resolution, draft creation, citations, currentUseEligible, actor role, or absence of blockers", async () => {
  const { deps } = dependencies({
    evaluatePacket: async () => ({
      ok: true,
      data: packet({ currentUseEligible: true, queueStatus: "closed", reviewStatus: "approved" }),
      error: null,
    }),
  });
  const result = await evaluateGeneratedDraftExportEligibility(input(), deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.validatorResult.evidence.failed_gates.includes("final_export_gate_absent"), true);
  assert.equal(result.data.validatorResult.evidence.failed_gates.includes("affirmative_human_export_authority_absent"), true);
});

test("P3-03 output DTO contains exactly the specified fields and no generated text, evidence, or internal state", async () => {
  const { deps } = dependencies();
  const result = await evaluateGeneratedDraftExportEligibility(input(), deps);
  assert.equal(result.ok, true);
  assert.deepEqual(new Set(Object.keys(result.data)), new Set([
    "generatedContentDraftId",
    "requestedExportAudience",
    "exportEligible",
    "validatorResult",
    "reviewQueueItemId",
    "draftStatus",
    "queueStatus",
    "reviewStatus",
    "currentUseEligible",
  ]));
});

test("P3-03 requested-audience mismatch and current ineligibility each block independently", async () => {
  const { deps: mismatchDeps } = dependencies({
    evaluatePacket: async () => ({ ok: true, data: packet({ requestedAudience: "funder" }), error: null }),
  });
  const mismatch = await evaluateGeneratedDraftExportEligibility(input({ requestedExportAudience: "internal" }), mismatchDeps);
  assert.equal(mismatch.data.validatorResult.evidence.failed_gates.includes("export_audience_mismatch"), true);

  const { deps: ineligibleDeps } = dependencies({
    evaluatePacket: async () => ({ ok: true, data: packet({ currentUseEligible: false }), error: null }),
  });
  const ineligible = await evaluateGeneratedDraftExportEligibility(input(), ineligibleDeps);
  assert.equal(ineligible.data.validatorResult.evidence.failed_gates.includes("current_use_ineligible"), true);
});

test("P3-03 exports no writes: injected runInTransaction and evaluatePacket are read-only stand-ins and the service never calls any mutation dependency", async () => {
  const { deps } = dependencies();
  assert.equal(typeof deps.evaluator, "function");
  const result = await evaluateGeneratedDraftExportEligibility(input(), deps);
  assert.equal(result.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(deps, "afterPersist"), false);
});

test("P3-03 service testables expose only input and actor predicates", () => {
  assert.equal(typeof __exportEligibilityServiceTestables.isEvaluateExportEligibilityInput, "function");
  assert.equal(typeof __exportEligibilityServiceTestables.isMappedHumanActor, "function");
});
