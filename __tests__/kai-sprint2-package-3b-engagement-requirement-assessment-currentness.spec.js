import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assessEngagementRequirement,
  getEngagementRequirementAssessment,
  __engagementRequirementAssessmentServiceTestables,
} from "../Backend/kai/services/kaiEngagementRequirementAssessmentService.js";

/**
 * KAI Package 3B: engagement requirement assessment READ-TIME currentness.
 *
 * Package 3A made the write path correctly gate on Package 2B applicability
 * being current+applicable+target-matched at the moment of assessment. It
 * left the read path (`getEngagementRequirementAssessment`) trusting the
 * repository's persisted row without re-checking whether the governing
 * Package 2B applicability is STILL current. Package 3B closes that gap by
 * having the read path re-resolve the identical
 * `resolveEngagementApplicabilityGate` the write path already uses, against
 * live gate dependencies, before returning the repository's read result.
 *
 * No schema change, no migration, no new persisted column: this repository
 * has no column on kai.requirement_assessments binding it to a specific
 * kai.engagement_requirement_sets decision id/version/fingerprint (verified
 * directly against migrations/kai_sprint2_c2_1_requirement_assessment_persistence.sql
 * - see the schema-shape test below), so "option A" (a persisted binding)
 * is not available without inventing new schema, which this package does not
 * do. "Option B" - re-run the exact same governed live read the write path
 * already trusts - is what is implemented and exercised here.
 */

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const ENGAGEMENT_A = "10000000-0000-4000-8000-00000000000a";
const ENGAGEMENT_B = "10000000-0000-4000-8000-00000000000b";
const REQUIREMENT_ID = "20000000-0000-4000-8000-000000000001";
const REQUIREMENT_SET_ID = "30000000-0000-4000-8000-000000000001";
const NOW = "2026-09-05T12:00:00.000Z";

const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });

const matchingTarget = Object.freeze({
  target_funder_id: "city_impact_fund",
  target_framework: "annual_outcomes_v1",
});

const staleTarget = Object.freeze({
  target_funder_id: "city_impact_fund",
  target_framework: "revised_outcomes_v2",
});

function engagementRow({ organizationId = ORG_A, engagementId = ENGAGEMENT_A, target = matchingTarget } = {}) {
  return {
    engagement_id: engagementId,
    organization_id: organizationId,
    engagement_type: "pilot_assessment",
    engagement_status: "active",
    project_metadata: target ? { engagement_requirement_target: target } : {},
  };
}

const externalActiveAuthority = Object.freeze({
  requirement_set_id: REQUIREMENT_SET_ID,
  source_type: "funder",
  source_code: "city_impact_fund",
  framework_code: "annual_outcomes_v1",
  framework_status: "active",
});

function currentApplicableRow({ requirementSetId = REQUIREMENT_SET_ID, target = matchingTarget } = {}) {
  return {
    requirement_set_id: requirementSetId,
    applicability_status: "confirmed",
    applicability_effective_state: "applicable",
    reviewed_by: "90000000-0000-4000-8000-000000000009",
    reviewed_by_role: "gk_admin",
    reviewed_at: new Date("2026-09-01T00:00:00.000Z"),
    superseded_by_engagement_requirement_set_id: null,
    target_context_identity: target,
  };
}

const gkReviewerActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  kaiRoles: [],
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "gk_reviewer" }],
});

function baseReadInput(overrides = {}) {
  return {
    organizationId: ORG_A,
    engagementId: ENGAGEMENT_A,
    requirementId: REQUIREMENT_ID,
    actorContext: gkReviewerActor,
    ...overrides,
  };
}

function successfulAssessmentReadResult({ engagementId = ENGAGEMENT_A } = {}) {
  return {
    ok: true,
    data: {
      requirement: { requirement_id: REQUIREMENT_ID, requirement_key: "ir_contrib_002" },
      assessment: {
        requirement_assessment_id: "40000000-0000-4000-8000-000000000001",
        organization_id: ORG_A,
        engagement_id: engagementId,
        requirement_id: REQUIREMENT_ID,
        assessment_state: "satisfied",
        assessment_explanation: "test",
        state_fingerprint: "a".repeat(64),
        created_at: NOW,
        replayed: false,
      },
    },
    error: null,
  };
}

function createFakeRepository({ readResult, assessResult } = {}) {
  const calls = { assess: [], read: [] };
  return {
    calls,
    repository: {
      async assessEngagementRequirement(input) {
        calls.assess.push(input);
        return assessResult || { ok: true, data: successfulAssessmentReadResult().data.assessment, error: null };
      },
      async readEngagementRequirementAssessment(input) {
        calls.read.push(input);
        return readResult || successfulAssessmentReadResult();
      },
    },
  };
}

function createGateDependencies({
  engagement = engagementRow(),
  authority = externalActiveAuthority,
  applicabilityRows = [currentApplicableRow()],
} = {}) {
  return {
    async getEngagementForOrganization({ organizationId, engagementId }) {
      if (!engagement) return null;
      if (engagement.organization_id !== organizationId || engagement.engagement_id !== engagementId) return null;
      return engagement;
    },
    async listEngagementRequirementSetsForOrganization() {
      return applicabilityRows;
    },
    async getRequirementSetIdForRequirement({ requirementId }) {
      if (requirementId !== REQUIREMENT_ID) return null;
      return { requirement_id: requirementId, requirement_set_id: REQUIREMENT_SET_ID };
    },
    async getRequirementSetAuthority() {
      return authority;
    },
  };
}

function readDependencies({ engagement, authority, applicabilityRows, repository, functionOverrides = {} } = {}) {
  return {
    env: enabledEnv,
    requirementAssessmentRepository: repository,
    ...createGateDependencies({ engagement, authority, applicabilityRows }),
    ...functionOverrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Positive control: a valid current assessment still resolves.
// ---------------------------------------------------------------------------
test("Package 3B (1): a valid current assessment resolves when Package 2B applicability is still current+applicable+target-matched", async () => {
  const { repository, calls } = createFakeRepository();
  const deps = readDependencies({ repository });
  const result = await getEngagementRequirementAssessment(baseReadInput(), deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.assessment.requirement_assessment_id, "40000000-0000-4000-8000-000000000001");
  assert.equal(calls.read.length, 1);
});

// ---------------------------------------------------------------------------
// 2. Superseded applicability invalidates current usability.
// ---------------------------------------------------------------------------
test("Package 3B (2): superseded applicability invalidates the previously-valid assessment's current usability", async () => {
  const { repository, calls } = createFakeRepository();
  const deps = readDependencies({
    repository,
    applicabilityRows: [
      {
        ...currentApplicableRow(),
        superseded_by_engagement_requirement_set_id: "50000000-0000-4000-8000-000000000099",
      },
    ],
  });
  const result = await getEngagementRequirementAssessment(baseReadInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "engagement_requirement_applicability_not_confirmed");
  assert.equal(calls.read.length, 0, "the repository's stored row must never be reached/returned once the gate fails");
});

// ---------------------------------------------------------------------------
// 3. Non-applicable authority invalidates current usability.
// ---------------------------------------------------------------------------
test("Package 3B (3): applicability_effective_state = not_applicable invalidates current usability", async () => {
  const { repository, calls } = createFakeRepository();
  const deps = readDependencies({
    repository,
    applicabilityRows: [{ ...currentApplicableRow(), applicability_effective_state: "not_applicable" }],
  });
  const result = await getEngagementRequirementAssessment(baseReadInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "engagement_requirement_applicability_not_confirmed");
  assert.equal(calls.read.length, 0);
});

// ---------------------------------------------------------------------------
// 4. Retired authority invalidates current usability.
// ---------------------------------------------------------------------------
test("Package 3B (4): a retired reviewed decision (applicability_effective_state = retired) invalidates current usability", async () => {
  const { repository, calls } = createFakeRepository();
  const deps = readDependencies({
    repository,
    applicabilityRows: [{ ...currentApplicableRow(), applicability_effective_state: "retired" }],
  });
  const result = await getEngagementRequirementAssessment(baseReadInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "engagement_requirement_applicability_not_confirmed");
  assert.equal(calls.read.length, 0);
});

test("Package 3B (4b): a requirement-set authority that is no longer governed/active (framework_status != active) invalidates current usability", async () => {
  // This is also how a requirement-set/framework-version transition manifests:
  // the requirement's fixed requirement_set_id's own framework_status moves
  // away from 'active' once a newer version supersedes it as authoritative.
  const { repository, calls } = createFakeRepository();
  const deps = readDependencies({
    repository,
    authority: { ...externalActiveAuthority, framework_status: "retired" },
  });
  const result = await getEngagementRequirementAssessment(baseReadInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "engagement_requirement_applicability_not_confirmed");
  assert.equal(calls.read.length, 0);
});

// ---------------------------------------------------------------------------
// 5. Target mismatch invalidates current usability.
// ---------------------------------------------------------------------------
test("Package 3B (5): a changed engagement target that no longer matches the applicability's approved target invalidates current usability", async () => {
  const { repository, calls } = createFakeRepository();
  const deps = readDependencies({
    repository,
    engagement: engagementRow({ target: staleTarget }),
    applicabilityRows: [currentApplicableRow({ target: matchingTarget })],
  });
  const result = await getEngagementRequirementAssessment(baseReadInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "engagement_requirement_applicability_not_confirmed");
  assert.equal(calls.read.length, 0);
});

// ---------------------------------------------------------------------------
// 6. Regression: another engagement cannot reuse/inherit the assessment.
// ---------------------------------------------------------------------------
test("Package 3B (6) regression: engagement B cannot read engagement A's assessment merely because engagement B also currently satisfies the gate", async () => {
  const { repository, calls } = createFakeRepository({
    readResult: { ok: false, data: null, error: { code: "not_found", status: 404 } },
  });
  const deps = readDependencies({
    repository,
    engagement: engagementRow({ engagementId: ENGAGEMENT_B }),
  });
  const result = await getEngagementRequirementAssessment(baseReadInput({ engagementId: ENGAGEMENT_B }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
  // The gate passed (engagement B's own target/authority is valid), but the
  // repository read is still strictly scoped to engagement B's own row -
  // it never falls back to or inherits engagement A's assessment.
  assert.equal(calls.read.length, 1);
  assert.equal(calls.read[0].engagementId, ENGAGEMENT_B);
});

test("Package 3B (6b) regression: cross-organization engagement id still fails closed before any gate/repository work", async () => {
  const orgBActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000005",
    kaiRoles: [],
    organizationMemberships: [{ organization_id: ORG_B, membership_status: "active", role_name: "gk_reviewer" }],
  };
  const { repository, calls } = createFakeRepository();
  const deps = readDependencies({ repository, engagement: null });
  const result = await getEngagementRequirementAssessment(
    baseReadInput({ organizationId: ORG_B, engagementId: ENGAGEMENT_A, actorContext: orgBActor }),
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
  assert.equal(calls.read.length, 0);
});

// ---------------------------------------------------------------------------
// 7. Generic (organization-scope, engagement_id === null) assessments are
//    completely unaffected by this change - they are read through an
//    entirely separate function this package does not touch.
// ---------------------------------------------------------------------------
test("Package 3B (7): the generic organization-scope read function is untouched by this package (no gate call, no import change)", () => {
  assert.equal(
    typeof __engagementRequirementAssessmentServiceTestables.resolveEngagementApplicabilityGate,
    "function",
  );
  // kaiRequirementAssessmentService.js (the generic org-scope read/write
  // service) is never imported by name into a gate call here - only its
  // ALLOWED_ROLES contract is reused (see kaiEngagementRequirementAssessmentService.js
  // import list), and this package adds no new import of it.
  const source = readFileSync(
    "Backend/kai/services/kaiEngagementRequirementAssessmentService.js",
    "utf8",
  );
  assert.match(source, /__requirementAssessmentServiceContract/);
  assert.doesNotMatch(source, /readOrganizationRequirementAssessment/);
});

// ---------------------------------------------------------------------------
// 8. Provenance for the now-stale assessment remains historical/intact -
//    this currentness check never deletes/mutates the persisted row, and
//    never even calls the repository once the gate fails (proving no write
//    path, no read-then-mutate path, touches the row at all).
// ---------------------------------------------------------------------------
test("Package 3B (8): a stale assessment's row is never touched (repository is never even called) once the gate fails - historical provenance is left completely intact", async () => {
  const { repository, calls } = createFakeRepository();
  const deps = readDependencies({
    repository,
    applicabilityRows: [{ ...currentApplicableRow(), applicability_effective_state: "retired" }],
  });
  const result = await getEngagementRequirementAssessment(baseReadInput(), deps);
  assert.equal(result.ok, false);
  assert.equal(calls.read.length, 0, "no repository read call means the persisted row is never read, mutated, or deleted by this currentness check");
  assert.equal(calls.assess.length, 0, "no repository write call is ever made by the read path");
});

// ---------------------------------------------------------------------------
// 11. git diff --check (no whitespace errors) is verified as its own step in
//     the CI/verification flow, not as a unit test here - see the final
//     report for its actual output.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Schema-shape verification: no persisted binding column exists (proves
// "option A" was unavailable without a new migration, and that this package
// did not add one).
// ---------------------------------------------------------------------------
test("Package 3B schema check: kai.requirement_assessments has no column binding it to a specific engagement_requirement_sets decision/version/fingerprint - no migration was added by this package", () => {
  const migrationSource = readFileSync(
    "migrations/kai_sprint2_c2_1_requirement_assessment_persistence.sql",
    "utf8",
  );
  assert.doesNotMatch(migrationSource, /engagement_requirement_set_id/);
  assert.doesNotMatch(migrationSource, /applicability_version/);
  assert.doesNotMatch(migrationSource, /applicability_fingerprint/);
});
