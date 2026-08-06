import test from "node:test";
import assert from "node:assert/strict";

import {
  validateEvidenceCoverageAssessmentIsPermitted,
  assessMissingness,
  assessDuplicates,
  assessDefinitionClarity,
  assessDenominatorClarity,
  assessTimePeriodClarity,
  assessEntityLevelClarity,
  assessSmallCellRisk,
  assessConflictingSourceIndicators,
  assessRequirementAlignment,
  assessCoverageGaps,
} from "../Backend/kai/validators/kaiEvidenceCoverageAssessmentValidators.js";
import { assessEvidenceCoverageForSourceVersion } from "../Backend/kai/services/kaiEvidenceCoverageAssessmentService.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const SOURCE_VERSION = "70000000-0000-4000-8000-000000000001";
const SOURCE = "71000000-0000-4000-8000-000000000001";
const CANDIDATE = "90000000-0000-4000-8000-000000000001";
const SENSITIVITY = "80000000-0000-4000-8000-000000000001";
const FILE_PROFILE = "50000000-0000-4000-8000-000000000001";
const DATA_DICTIONARY = "60000000-0000-4000-8000-000000000001";
const INTAKE_FILE = "20000000-0000-4000-8000-000000000001";
const SHA = "a".repeat(64);

function validRows(overrides = {}) {
  return {
    sourceVersionRow: {
      source_version_id: SOURCE_VERSION,
      organization_id: ORG,
      source_id: SOURCE,
      intake_source_candidate_id: CANDIDATE,
      intake_sensitivity_profile_id: SENSITIVITY,
      profile_canonical_sha256: SHA,
      is_current: true,
      ...overrides.sourceVersionRow,
    },
    sourceRow: {
      source_id: SOURCE,
      organization_id: ORG,
      ...overrides.sourceRow,
    },
    candidateRow: {
      intake_source_candidate_id: CANDIDATE,
      organization_id: ORG,
      intake_file_id: INTAKE_FILE,
      file_profile_id: FILE_PROFILE,
      data_dictionary_id: DATA_DICTIONARY,
      intake_sensitivity_profile_id: SENSITIVITY,
      profile_canonical_sha256: SHA,
      candidate_status: "promoted",
      ...overrides.candidateRow,
    },
    decisionRow: {
      organization_id: ORG,
      source_id: SOURCE,
      source_version_id: SOURCE_VERSION,
      decision_status: "promoted",
      ...overrides.decisionRow,
    },
    profileRow: {
      organization_id: ORG,
      intake_sensitivity_profile_id: SENSITIVITY,
      file_profile_id: FILE_PROFILE,
      data_dictionary_id: DATA_DICTIONARY,
      profile_canonical_sha256: SHA,
      human_review_required: true,
      public_use_allowed: false,
      funder_use_allowed: false,
      llm_processing_allowed: false,
      product_learning_allowed: false,
      retention_posture: "restricted_pending_review",
      allowed_use_status: "unknown",
      small_cell_risk_status: "unknown",
      ...overrides.profileRow,
    },
    dictionaryRow: {
      data_dictionary_id: DATA_DICTIONARY,
      organization_id: ORG,
      file_profile_id: FILE_PROFILE,
      profile_canonical_sha256: SHA,
      ...overrides.dictionaryRow,
    },
  };
}

test("validateEvidenceCoverageAssessmentIsPermitted: passes on a fully consistent, promoted, permission-satisfying, allowed lineage", () => {
  assert.deepEqual(validateEvidenceCoverageAssessmentIsPermitted(validRows()), { ok: true });
});

test("validateEvidenceCoverageAssessmentIsPermitted: reuses the P2-01 lineage gate wholesale - a stale source_version fails closed", () => {
  const result = validateEvidenceCoverageAssessmentIsPermitted(validRows({ sourceVersionRow: { is_current: false } }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "conflict_current_state_changed");
});

test("validateEvidenceCoverageAssessmentIsPermitted: reuses the P2-01 lineage gate wholesale - a missing row fails closed as not_found", () => {
  const rows = validRows();
  rows.dictionaryRow = null;
  const result = validateEvidenceCoverageAssessmentIsPermitted(rows);
  assert.equal(result.ok, false);
  assert.equal(result.code, "not_found");
});

test("validateEvidenceCoverageAssessmentIsPermitted: reuses the P2-01 permission predicate - a non-restricted retention posture fails closed", () => {
  const result = validateEvidenceCoverageAssessmentIsPermitted(
    validRows({ profileRow: { retention_posture: "unrestricted" } }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "validation_blocker");
});

test("validateEvidenceCoverageAssessmentIsPermitted: allowed_use_status 'not_allowed' fails closed even when P2-01's own lineage gate passes", () => {
  const result = validateEvidenceCoverageAssessmentIsPermitted(
    validRows({ profileRow: { allowed_use_status: "not_allowed" } }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "validation_blocker");
});

for (const status of ["unknown", "allowed"]) {
  test(`validateEvidenceCoverageAssessmentIsPermitted: allowed_use_status '${status}' does not itself block assessment`, () => {
    const result = validateEvidenceCoverageAssessmentIsPermitted(validRows({ profileRow: { allowed_use_status: status } }));
    assert.deepEqual(result, { ok: true });
  });
}

test("assessMissingness: no committed finding stays unresolved, never inferred from absence", () => {
  assert.equal(assessMissingness([]).evidence.assessment_status, "unresolved");
  assert.equal(assessMissingness(null).evidence.assessment_status, "unresolved");
  assert.equal(
    assessMissingness([{ finding_type: "duplicate_rows", finding_status: "open" }]).evidence.assessment_status,
    "unresolved",
  );
});

test("assessMissingness: an open committed missingness finding resolves risk_flagged", () => {
  const result = assessMissingness([{ finding_type: "missingness", finding_status: "open" }]);
  assert.equal(result.evidence.assessment_status, "resolved_risk_flagged");
  assert.equal(result.severity, "warning");
  assert.equal(result.evidence.open_finding_count, 1);
});

test("assessDuplicates: no committed finding stays unresolved; an open one resolves risk_flagged", () => {
  assert.equal(assessDuplicates([]).evidence.assessment_status, "unresolved");
  const result = assessDuplicates([{ finding_type: "duplicate_rows", finding_status: "open" }]);
  assert.equal(result.evidence.assessment_status, "resolved_risk_flagged");
});

test("assessDefinitionClarity: no committed fields stays unresolved", () => {
  assert.equal(assessDefinitionClarity([]).evidence.assessment_status, "unresolved");
});

test("assessDefinitionClarity: every field defined resolves clear; any 'unknown' field resolves risk_flagged", () => {
  const clear = assessDefinitionClarity([{ business_meaning: "signup count" }, { business_meaning: "email address" }]);
  assert.equal(clear.evidence.assessment_status, "resolved_clear");
  assert.equal(clear.severity, "pass");

  const flagged = assessDefinitionClarity([{ business_meaning: "signup count" }, { business_meaning: "unknown" }]);
  assert.equal(flagged.evidence.assessment_status, "resolved_risk_flagged");
  assert.equal(flagged.evidence.undefined_field_count, 1);
});

test("assessEntityLevelClarity: mirrors assessDefinitionClarity's unknown-default semantics for entity_level", () => {
  assert.equal(assessEntityLevelClarity([]).evidence.assessment_status, "unresolved");
  assert.equal(assessEntityLevelClarity([{ entity_level: "household" }]).evidence.assessment_status, "resolved_clear");
  assert.equal(assessEntityLevelClarity([{ entity_level: "unknown" }]).evidence.assessment_status, "resolved_risk_flagged");
});

test("assessDenominatorClarity and assessTimePeriodClarity are always unresolved - no committed schema fact exists for either", () => {
  assert.equal(assessDenominatorClarity().evidence.assessment_status, "unresolved");
  assert.equal(assessTimePeriodClarity().evidence.assessment_status, "unresolved");
});

test("assessSmallCellRisk: reads the committed small_cell_risk_status three-state fact directly", () => {
  assert.equal(assessSmallCellRisk({ small_cell_risk_status: "present" }).evidence.assessment_status, "resolved_risk_flagged");
  assert.equal(assessSmallCellRisk({ small_cell_risk_status: "absent" }).evidence.assessment_status, "resolved_clear");
  assert.equal(assessSmallCellRisk({ small_cell_risk_status: "unknown" }).evidence.assessment_status, "unresolved");
  assert.equal(assessSmallCellRisk({}).evidence.assessment_status, "unresolved");
});

test("assessConflictingSourceIndicators and assessRequirementAlignment are always unresolved - no authoritative engagement/requirement relationship is committed anywhere in the schema", () => {
  assert.equal(assessConflictingSourceIndicators().evidence.assessment_status, "unresolved");
  assert.equal(assessRequirementAlignment().evidence.assessment_status, "unresolved");
});

test("assessCoverageGaps: no committed fields stays unresolved", () => {
  assert.equal(assessCoverageGaps([], []).evidence.assessment_status, "unresolved");
});

test("assessCoverageGaps: every field covered by committed evidence resolves clear", () => {
  const result = assessCoverageGaps(
    [{ profile_field_key: "email" }, { profile_field_key: "signup_count" }],
    ["email", "signup_count"],
  );
  assert.equal(result.evidence.assessment_status, "resolved_clear");
});

test("assessCoverageGaps: a field with no committed evidence resolves risk_flagged and discloses the exact uncovered field keys", () => {
  const result = assessCoverageGaps(
    [{ profile_field_key: "email" }, { profile_field_key: "signup_count" }],
    ["email"],
  );
  assert.equal(result.evidence.assessment_status, "resolved_risk_flagged");
  assert.deepEqual(result.evidence.uncovered_field_keys, ["signup_count"]);
});

function humanActor(overrides = {}) {
  return {
    actorType: "human",
    actorUserId: "91000000-0000-4000-8000-000000000001",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_operator" }],
    ...overrides,
  };
}

function fakeRepository(rows) {
  return {
    async readEvidenceCoverageAssessmentFacts() {
      return { ok: true, data: { rows }, error: null };
    },
  };
}

test("assessEvidenceCoverageForSourceVersion: KAI_SPRINT2_ENABLED gates every repository call - disabled returns feature_disabled with zero repository calls", async () => {
  let calls = 0;
  const repository = {
    async readEvidenceCoverageAssessmentFacts() {
      calls += 1;
      return { ok: true, data: { rows: validRows() }, error: null };
    },
  };
  const result = await assessEvidenceCoverageForSourceVersion(
    { organizationId: ORG, sourceVersionId: SOURCE_VERSION, actorContext: humanActor() },
    { env: {}, evidenceCoverageAssessmentRepository: repository },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
  assert.equal(calls, 0);
});

test("assessEvidenceCoverageForSourceVersion: rejects an unknown input key", async () => {
  const result = await assessEvidenceCoverageForSourceVersion(
    { organizationId: ORG, sourceVersionId: SOURCE_VERSION, actorContext: humanActor(), extraKey: true },
    { env: { KAI_SPRINT2_ENABLED: "true" }, evidenceCoverageAssessmentRepository: fakeRepository(validRows()) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("assessEvidenceCoverageForSourceVersion: rejects a missing required key", async () => {
  const result = await assessEvidenceCoverageForSourceVersion(
    { organizationId: ORG, actorContext: humanActor() },
    { env: { KAI_SPRINT2_ENABLED: "true" }, evidenceCoverageAssessmentRepository: fakeRepository(validRows()) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("assessEvidenceCoverageForSourceVersion: a non-human actor is rejected outright, with no bypass", async () => {
  const result = await assessEvidenceCoverageForSourceVersion(
    { organizationId: ORG, sourceVersionId: SOURCE_VERSION, actorContext: { actorType: "ai", actorUserId: "x" } },
    { env: { KAI_SPRINT2_ENABLED: "true" }, evidenceCoverageAssessmentRepository: fakeRepository(validRows()) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("assessEvidenceCoverageForSourceVersion: an actor with no active membership in the requested organization is denied", async () => {
  const result = await assessEvidenceCoverageForSourceVersion(
    {
      organizationId: OTHER_ORG,
      sourceVersionId: SOURCE_VERSION,
      actorContext: humanActor(),
    },
    { env: { KAI_SPRINT2_ENABLED: "true" }, evidenceCoverageAssessmentRepository: fakeRepository(validRows({ sourceVersionRow: { organization_id: OTHER_ORG }, sourceRow: { organization_id: OTHER_ORG }, candidateRow: { organization_id: OTHER_ORG }, decisionRow: { organization_id: OTHER_ORG }, profileRow: { organization_id: OTHER_ORG }, dictionaryRow: { organization_id: OTHER_ORG } })) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_boundary_violation");
});

test("assessEvidenceCoverageForSourceVersion: a role outside gk_admin/gk_operator/gk_reviewer is denied", async () => {
  const result = await assessEvidenceCoverageForSourceVersion(
    {
      organizationId: ORG,
      sourceVersionId: SOURCE_VERSION,
      actorContext: humanActor({ organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_viewer" }] }),
    },
    { env: { KAI_SPRINT2_ENABLED: "true" }, evidenceCoverageAssessmentRepository: fakeRepository(validRows()) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_boundary_violation");
});

test("assessEvidenceCoverageForSourceVersion: repository not_found propagates unchanged", async () => {
  const result = await assessEvidenceCoverageForSourceVersion(
    { organizationId: ORG, sourceVersionId: SOURCE_VERSION, actorContext: humanActor() },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      evidenceCoverageAssessmentRepository: {
        async readEvidenceCoverageAssessmentFacts() {
          return { ok: false, data: null, error: { code: "not_found", status: 404 } };
        },
      },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("assessEvidenceCoverageForSourceVersion: a stale (non-current) source_version fails closed via the reused lineage gate", async () => {
  const result = await assessEvidenceCoverageForSourceVersion(
    { organizationId: ORG, sourceVersionId: SOURCE_VERSION, actorContext: humanActor() },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      evidenceCoverageAssessmentRepository: fakeRepository(validRows({ sourceVersionRow: { is_current: false } })),
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("assessEvidenceCoverageForSourceVersion: allowed_use_status 'not_allowed' fails closed", async () => {
  const result = await assessEvidenceCoverageForSourceVersion(
    { organizationId: ORG, sourceVersionId: SOURCE_VERSION, actorContext: humanActor() },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      evidenceCoverageAssessmentRepository: fakeRepository(validRows({ profileRow: { allowed_use_status: "not_allowed" } })),
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("assessEvidenceCoverageForSourceVersion: a fully permitted lineage returns all ten dimensions, computed fresh, with no persistence side effect", async () => {
  const rows = validRows({
    dictionaryFieldRows: [
      { profile_field_key: "email", business_meaning: "unknown", entity_level: "unknown" },
      { profile_field_key: "signup_count", business_meaning: "count of signups", entity_level: "household" },
    ],
    qualityFindingRows: [{ finding_type: "missingness", finding_status: "open" }],
    evidenceFieldKeys: ["email"],
  });
  rows.dictionaryFieldRows = [
    { profile_field_key: "email", business_meaning: "unknown", entity_level: "unknown" },
    { profile_field_key: "signup_count", business_meaning: "count of signups", entity_level: "household" },
  ];
  rows.qualityFindingRows = [{ finding_type: "missingness", finding_status: "open" }];
  rows.evidenceFieldKeys = ["email"];

  const result = await assessEvidenceCoverageForSourceVersion(
    { organizationId: ORG, sourceVersionId: SOURCE_VERSION, actorContext: humanActor() },
    { env: { KAI_SPRINT2_ENABLED: "true" }, evidenceCoverageAssessmentRepository: fakeRepository(rows) },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(
    Object.keys(result.data.dimensions).sort(),
    [
      "conflicting_source_indicators", "coverage_gaps", "definition_clarity", "denominator_clarity",
      "duplicates", "entity_level_clarity", "missingness", "requirement_alignment",
      "small_cell_risk", "time_period_clarity",
    ],
  );
  assert.equal(result.data.dimensions.missingness.evidence.assessment_status, "resolved_risk_flagged");
  assert.equal(result.data.dimensions.duplicates.evidence.assessment_status, "unresolved");
  assert.equal(result.data.dimensions.definition_clarity.evidence.assessment_status, "resolved_risk_flagged");
  assert.equal(result.data.dimensions.entity_level_clarity.evidence.assessment_status, "resolved_risk_flagged");
  assert.equal(result.data.dimensions.coverage_gaps.evidence.assessment_status, "resolved_risk_flagged");
  assert.deepEqual(result.data.dimensions.coverage_gaps.evidence.uncovered_field_keys, ["signup_count"]);
  assert.equal(result.data.organization_id, ORG);
  assert.equal(result.data.source_version_id, SOURCE_VERSION);
  assert.equal(result.data.data_dictionary_id, DATA_DICTIONARY);
});
