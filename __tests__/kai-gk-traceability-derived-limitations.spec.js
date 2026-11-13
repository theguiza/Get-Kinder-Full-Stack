import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as D from "../Backend/kai/validators/kaiDerivedMeasurementValidators.js";
import { STORED_ORGANIZATION_MEMBERSHIP_SOURCE } from "../Backend/kai/auth/kaiOrganizationMembershipSource.js";
import { getClaimTraceabilitySummary } from "../Backend/kai/services/kaiClaimTraceabilityService.js";
import { projectTraceability } from "../frontend/impactEvidenceLibraryLogic.js";

/**
 * Owner prompt 2026-11-13: a Get Kinder reviewer deciding an unreviewed
 * non-paired derived claim (Cedar events_cancelled, tabular_count) in
 * Traceability saw none of the measurement's limitations - not even "KAI did
 * not check the recorded values against any other source" - because the
 * traceability read carried no derived limitation codes and the panel listed
 * only accepted coverage limitations. The GK Traceability route now asks for
 * the reviewer form of the read, which adds the authoritative
 * derivedMeasurementLimitationCodes for derived evidence, and the panel lists
 * them. The shared P2-06 DTO that generation, reports and the assistant
 * validate is unchanged. Connected proof: Cedar test "19a (browser)".
 */
const repoRoot = join(import.meta.dirname, "..");

const dto = (extra = {}) => ({
  requestedAudience: "internal", eligible: false, blockerCodes: ["evidence_review_unresolved"],
  dimensions: { time_period_clarity: { assessment_status: "resolved_risk_flagged" } }, ...extra,
});

test("projectTraceability carries the derived measurement limitations the server returns, in order, code and description only", () => {
  const limitations = [
    { code: D.DERIVED_LIMITATION_CODES.VALUES_NOT_VERIFIED, description: D.describeDerivedLimitationCode(D.DERIVED_LIMITATION_CODES.VALUES_NOT_VERIFIED) },
    { code: "coverage.time_period_clarity.resolved_risk_flagged", description: D.describeDerivedLimitationCode("coverage.time_period_clarity.resolved_risk_flagged") },
  ];
  const projected = projectTraceability(dto({ derived_measurement_limitations: limitations.map((l) => ({ ...l, extra: "ignored" })) }));
  assert.deepEqual(projected.derivedMeasurementLimitations, limitations);
  assert.equal(projected.derivedMeasurementLimitations[0].description, "KAI did not check the recorded values against any other source.");
});

test("projectTraceability: no derived limitations for other evidence, and malformed entries are dropped rather than invented", () => {
  assert.deepEqual(projectTraceability(dto()).derivedMeasurementLimitations, []);
  assert.deepEqual(projectTraceability(dto({ derived_measurement_limitations: "nope" })).derivedMeasurementLimitations, []);
  assert.deepEqual(projectTraceability(dto({ derived_measurement_limitations: [null, { code: "derived.x" }, { code: 1, description: "d" }, { code: "derived.y", description: "" }] }))
    .derivedMeasurementLimitations, []);
});

const ORG = "11111111-2222-4333-8444-555555555555";
const CLAIM = "3d000000-0000-4000-8000-000000000001";
const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const actor = (roleName) => ({
  actorType: "human", actorUserId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", kaiRoles: [], platformSuperuser: false,
  organizationMemberships: [{ organization_id: ORG, role_name: roleName, membership_status: "active", ...(roleName === "client_admin" ? { source: STORED_ORGANIZATION_MEMBERSHIP_SOURCE } : {}) }],
});
function recordingRepository() {
  const calls = [];
  const answer = (name) => async (input) => { calls.push([name, input]); return { ok: true, data: { blockerCodes: [], eligible: true, requestedAudience: input.requestedAudience } }; };
  return { calls, repository: { getClaimTraceabilitySummary: answer("summary"), getClaimTraceabilityReviewSummary: answer("review"), getOrganizationInternalDraftDiagnostic: answer("diagnostic") } };
}
const read = (role, extra = {}) => ({ organizationId: ORG, claimId: CLAIM, requestedAudience: "internal", actorContext: actor(role), ...extra });

test("the GK traceability read asks for the reviewer form only when requested; every other consumer keeps the unchanged P2-06 read", async () => {
  const plain = recordingRepository();
  assert.equal((await getClaimTraceabilitySummary(read("gk_reviewer"), { env: ENV, claimTraceabilityRepository: plain.repository })).ok, true);
  assert.deepEqual(plain.calls, [["summary", { organizationId: ORG, claimId: CLAIM, requestedAudience: "internal" }]]);
  const reviewer = recordingRepository();
  assert.equal((await getClaimTraceabilitySummary(read("gk_reviewer", { includeDerivedMeasurementLimitations: true }), { env: ENV, claimTraceabilityRepository: reviewer.repository })).ok, true);
  assert.deepEqual(reviewer.calls, [["review", { organizationId: ORG, claimId: CLAIM, requestedAudience: "internal" }]], "the flag is not passed on as input");
});

test("the flag grants nothing: an organization administrator still gets only the diagnostic, an outsider is refused, and only true is accepted", async () => {
  const admin = recordingRepository();
  const diagnostic = await getClaimTraceabilitySummary(read("client_admin", { includeDerivedMeasurementLimitations: true }), { env: ENV, claimTraceabilityRepository: admin.repository });
  assert.equal(diagnostic.ok, true);
  assert.deepEqual(admin.calls.map(([name]) => name), ["diagnostic"]);
  assert.equal(Object.hasOwn(diagnostic.data, "derived_measurement_limitations"), false);
  const outsider = recordingRepository();
  const refused = await getClaimTraceabilitySummary(read("client_viewer", { includeDerivedMeasurementLimitations: true }), { env: ENV, claimTraceabilityRepository: outsider.repository });
  assert.equal(refused.ok, false);
  assert.deepEqual(outsider.calls, []);
  for (const value of [false, "true", 1, null]) {
    const r = recordingRepository();
    const result = await getClaimTraceabilitySummary(read("gk_reviewer", { includeDerivedMeasurementLimitations: value }), { env: ENV, claimTraceabilityRepository: r.repository });
    assert.equal(result.error?.code, "validation_blocker", String(value));
    assert.deepEqual(r.calls, []);
  }
});

test("only the GK traceability route requests the reviewer form, and the review read uses the authoritative evaluation over its own dimensions", () => {
  const route = readFileSync(join(repoRoot, "Backend/kai/routes/sprint2IntakeApi.js"), "utf8");
  assert.equal(route.match(/includeDerivedMeasurementLimitations: true/g)?.length, 1);
  const handler = route.slice(route.indexOf("\"/admin/organizations/:organizationId/claims/:claimId/traceability\""));
  assert.ok(handler.indexOf("includeDerivedMeasurementLimitations: true") < handler.indexOf("router."), "set in the traceability handler");
  const repository = readFileSync(join(repoRoot, "Backend/kai/dictionary/postgresClaimTraceabilityRepository.js"), "utf8");
  const review = repository.slice(repository.indexOf("async getClaimTraceabilityReviewSummary("));
  assert.match(review, /derivedMeasurementLimitationCodes\(\{ measurementRow: derivedRow, dimensions: result\.data\.dimensions \}\)/);
  const summary = repository.slice(repository.indexOf("async getClaimTraceabilitySummary("), repository.indexOf("async getClaimTraceabilityReviewSummary("));
  assert.doesNotMatch(summary, /derived_measurement_limitations/, "the shared P2-06 read is unchanged");
});

test("the GK Traceability panel lists the derived limitations before the review decision forms", () => {
  const panel = readFileSync(join(repoRoot, "frontend/ImpactEvidenceLibrary.jsx"), "utf8");
  // Within the Traceability card (the Evidence tab has its own decision form earlier in the file).
  const card = panel.indexOf("<h5 className=\"mb-0\">Traceability</h5>");
  const list = panel.indexOf("data-gk-traceability-derived-limitations", card);
  assert.ok(card > 0 && list > card, "the list is rendered in the Traceability card");
  assert.ok(list < panel.indexOf("Record Evidence Review Decision", card), "before the evidence decision");
  assert.ok(list < panel.indexOf("Record claim review decision", card), "before the claim decision");
});
