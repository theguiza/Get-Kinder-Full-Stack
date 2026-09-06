import test from "node:test";
import assert from "node:assert/strict";

import { registerExternalRequirementSet } from "../Backend/kai/services/kaiExternalRequirementSetRegistrationService.js";
import { updateEngagementRequirementTarget, classifyEngagementFunderRequirementsState } from "../Backend/kai/services/kaiEngagementContextService.js";
import {
  proposeEngagementRequirementSetApplicability,
  approveEngagementRequirementSetApplicability,
} from "../Backend/kai/services/kaiEngagementRequirementApplicabilityService.js";
import { assessEngagementRequirement } from "../Backend/kai/services/kaiEngagementRequirementAssessmentService.js";
import { getEngagementFunderRequirementsForImpactLibrary } from "../Backend/kai/services/kaiEngagementFunderRequirementsCompositionService.js";

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const ENGAGEMENT_A = "10000000-0000-4000-8000-00000000000a";
const ENGAGEMENT_B = "10000000-0000-4000-8000-00000000000b";
const SOURCE_ID = "20000000-0000-4000-8000-000000000001";
const FRAMEWORK_ID = "30000000-0000-4000-8000-000000000001";
const SET_ID = "40000000-0000-4000-8000-000000000001";
const REQUIREMENT_1 = "50000000-0000-4000-8000-000000000001";
const REQUIREMENT_2 = "50000000-0000-4000-8000-000000000002";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const NOW = "2026-09-06T12:00:00.000Z";

const gkAdminActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  kaiRoles: ["gk_admin"],
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "gk_admin" }],
});

const gkOperatorActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000002",
  kaiRoles: [],
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "gk_operator" }],
});

const gkReviewerActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000003",
  kaiRoles: [],
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "gk_reviewer" }],
});

const crossTenantReviewerActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000004",
  kaiRoles: [],
  organizationMemberships: [{ organization_id: ORG_B, membership_status: "active", role_name: "gk_reviewer" }],
});

function registrationPayload() {
  return {
    source: {
      source_type: "funder",
      source_code: "city_impact_fund",
      source_name: "City Impact Fund",
    },
    framework: {
      framework_code: "annual_outcomes_v1",
      framework_name: "Annual Outcomes",
      version_label: "v1",
      framework_status: "active",
    },
    requirement_set: {
      set_key: "annual_report",
      set_name: "Annual Report",
    },
    requirements: [
      {
        requirement_key: "outcomes_summary",
        requirement_label: "Outcomes summary",
        requirement_description: "Summarize annual outcomes.",
        display_order: 0,
      },
      {
        requirement_key: "participant_count",
        requirement_label: "Participant count",
        requirement_description: "Report participant count.",
        display_order: 1,
      },
    ],
  };
}

function createProofState() {
  return {
    engagements: new Map([
      [ENGAGEMENT_A, {
        engagement_id: ENGAGEMENT_A,
        organization_id: ORG_A,
        engagement_type: "pilot_assessment",
        engagement_status: "active",
        project_metadata: {},
      }],
      [ENGAGEMENT_B, {
        engagement_id: ENGAGEMENT_B,
        organization_id: ORG_B,
        engagement_type: "pilot_assessment",
        engagement_status: "active",
        project_metadata: {},
      }],
    ]),
    requirementSource: null,
    framework: null,
    requirementSet: null,
    requirements: [],
    applicabilityRows: [],
    assessments: new Map(),
    audit: [],
    nextApplicabilityNumber: 1,
  };
}

function sourceDto(state, input) {
  state.requirementSource ||= {
    requirement_source_id: SOURCE_ID,
    source_type: input.source.source_type,
    source_code: input.source.source_code,
    source_name: input.source.source_name,
    organization_id: null,
    created_by: input.actorUserId,
    created_by_type: "human",
    created_at: NOW,
  };
  return state.requirementSource;
}

function frameworkDto(state, input) {
  state.framework ||= {
    requirement_framework_version_id: FRAMEWORK_ID,
    requirement_source_id: SOURCE_ID,
    framework_code: input.framework.framework_code,
    framework_name: input.framework.framework_name,
    version_label: input.framework.version_label,
    framework_status: input.framework.framework_status,
    created_by: input.actorUserId,
    created_by_type: "human",
    created_at: NOW,
  };
  return state.framework;
}

function requirementSetDto(state, input) {
  state.requirementSet ||= {
    requirement_set_id: SET_ID,
    requirement_framework_version_id: FRAMEWORK_ID,
    set_key: input.requirementSet.set_key,
    set_name: input.requirementSet.set_name,
    created_by: input.actorUserId,
    created_by_type: "human",
    created_at: NOW,
  };
  return state.requirementSet;
}

function requirementDtos(state, input) {
  if (state.requirements.length === 0) {
    state.requirements = input.requirements.map((requirement, index) => ({
      requirement_id: index === 0 ? REQUIREMENT_1 : REQUIREMENT_2,
      requirement_set_id: SET_ID,
      requirement_key: requirement.requirement_key,
      requirement_label: requirement.requirement_label,
      requirement_description: requirement.requirement_description,
      display_order: requirement.display_order,
      created_by: input.actorUserId,
      created_by_type: "human",
      created_at: NOW,
    }));
  }
  return state.requirements;
}

function authorityRow(state) {
  if (!state.requirementSet) return null;
  return {
    requirement_set_id: state.requirementSet.requirement_set_id,
    set_key: state.requirementSet.set_key,
    set_name: state.requirementSet.set_name,
    requirement_count: state.requirements.length,
    requirements: state.requirements.map((requirement) => ({
      requirement_id: requirement.requirement_id,
      requirement_key: requirement.requirement_key,
    })),
    requirement_framework_version_id: state.framework.requirement_framework_version_id,
    framework_code: state.framework.framework_code,
    framework_name: state.framework.framework_name,
    version_label: state.framework.version_label,
    framework_status: state.framework.framework_status,
    requirement_source_id: state.requirementSource.requirement_source_id,
    source_type: state.requirementSource.source_type,
    source_code: state.requirementSource.source_code,
  };
}

function applicabilityRowsWithAuthority(state, { organizationId, engagementId }) {
  const authority = authorityRow(state);
  if (!authority) return [];
  return state.applicabilityRows
    .filter((row) => row.organization_id === organizationId && row.engagement_id === engagementId)
    .map((row) => ({
      ...authority,
      ...row,
      superseded_by_engagement_requirement_set_id: state.applicabilityRows.find((candidate) =>
        candidate.supersedes_engagement_requirement_set_id === row.engagement_requirement_set_id
      )?.engagement_requirement_set_id || null,
    }));
}

function createProofDependencies(state) {
  const registrationRepository = {
    async registerExternalRequirementSet(input) {
      const replayed = Boolean(state.requirementSet);
      const requirement_source = sourceDto(state, input);
      const requirement_framework_version = frameworkDto(state, input);
      const requirement_set = requirementSetDto(state, input);
      const requirements = requirementDtos(state, input);
      return {
        ok: true,
        data: {
          replayed,
          inserted: {
            source: !replayed,
            framework: !replayed,
            requirement_set: !replayed,
            requirements: replayed ? 0 : requirements.length,
          },
          requirement_source,
          requirement_framework_version,
          requirement_set,
          requirements,
        },
        error: null,
      };
    },
  };

  const requirementAssessmentRepository = {
    async assessEngagementRequirement(input) {
      const data = {
        requirement_assessment_id: "60000000-0000-4000-8000-000000000001",
        organization_id: input.organizationId,
        engagement_id: input.engagementId,
        requirement_id: input.requirementId,
        assessment_state: "satisfied",
        assessment_explanation: "Synthetic downstream proof assessment.",
        state_fingerprint: "a".repeat(64),
        created_at: input.now,
        replayed: false,
      };
      state.assessments.set(`${input.organizationId}:${input.engagementId}:${input.requirementId}`, data);
      return { ok: true, data, error: null };
    },
    async readEngagementRequirementAssessment(input) {
      const assessment = state.assessments.get(`${input.organizationId}:${input.engagementId}:${input.requirementId}`);
      if (!assessment) return { ok: false, data: null, error: { code: "not_found", status: 404 } };
      return {
        ok: true,
        data: {
          requirement: { requirement_id: input.requirementId },
          assessment,
        },
        error: null,
      };
    },
  };

  return {
    env: enabledEnv,
    now: () => NOW,
    registrationRepository,
    requirementAssessmentRepository,
    metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => ({ ok: true }) }) },
    async runInTransaction(callback) {
      return callback({ tx: true });
    },
    async insertRequiredSuccessfulAuditEvent(metadata) {
      state.audit.push(metadata);
      return { ok: true, auditEventId: `audit-${state.audit.length}` };
    },
    async getEngagementForOrganization({ organizationId, engagementId }) {
      const engagement = state.engagements.get(engagementId);
      if (!engagement || engagement.organization_id !== organizationId) return null;
      return engagement;
    },
    async updateEngagementProjectMetadata({ organizationId, engagementId, projectMetadata }) {
      const engagement = state.engagements.get(engagementId);
      if (!engagement || engagement.organization_id !== organizationId) return null;
      engagement.project_metadata = projectMetadata;
      return engagement;
    },
    async getRequirementSetAuthority({ requirementSetId }) {
      const authority = authorityRow(state);
      if (!authority || authority.requirement_set_id !== requirementSetId) return null;
      return authority;
    },
    async listExternalRequirementSetsForTarget({ sourceCode, frameworkCode }) {
      const authority = authorityRow(state);
      if (!authority) return [];
      if (authority.source_code !== sourceCode || authority.framework_code !== frameworkCode) return [];
      return [authority];
    },
    async insertEngagementRequirementSetProposal(input) {
      const row = {
        engagement_requirement_set_id: `70000000-0000-4000-8000-${String(state.nextApplicabilityNumber).padStart(12, "0")}`,
        organization_id: input.organizationId,
        engagement_id: input.engagementId,
        requirement_set_id: input.requirementSetId,
        applicability_status: "proposed",
        applicability_effective_state: "pending_review",
        reviewed_by: null,
        reviewed_by_role: null,
        reviewed_at: null,
        supersedes_engagement_requirement_set_id: null,
        target_context_identity: null,
        created_by: input.createdBy,
        created_by_type: input.createdByType,
        created_at: NOW,
      };
      state.nextApplicabilityNumber += 1;
      state.applicabilityRows.push(row);
      return row;
    },
    async getCurrentEngagementRequirementSetForIdentity({ organizationId, engagementId, requirementSetId }) {
      const rows = applicabilityRowsWithAuthority(state, { organizationId, engagementId });
      return rows.find((row) =>
        row.requirement_set_id === requirementSetId &&
        !row.superseded_by_engagement_requirement_set_id
      ) || null;
    },
    async insertEngagementRequirementSetReviewApproval(input) {
      const row = {
        engagement_requirement_set_id: `70000000-0000-4000-8000-${String(state.nextApplicabilityNumber).padStart(12, "0")}`,
        organization_id: input.organizationId,
        engagement_id: input.engagementId,
        requirement_set_id: input.requirementSetId,
        applicability_status: "confirmed",
        applicability_effective_state: input.applicabilityEffectiveState,
        reviewed_by: input.reviewedBy,
        reviewed_by_role: input.reviewedByRole,
        reviewed_at: input.reviewedAt,
        supersedes_engagement_requirement_set_id: input.supersedesEngagementRequirementSetId,
        target_context_identity: input.targetContextIdentity,
        created_by: input.createdBy,
        created_by_type: input.createdByType,
        created_at: NOW,
      };
      state.nextApplicabilityNumber += 1;
      state.applicabilityRows.push(row);
      return row;
    },
    async listEngagementRequirementSetsForOrganization({ organizationId, engagementId }) {
      return applicabilityRowsWithAuthority(state, { organizationId, engagementId });
    },
    async getRequirementSetIdForRequirement({ requirementId }) {
      const requirement = state.requirements.find((candidate) => candidate.requirement_id === requirementId);
      if (!requirement) return null;
      return { requirement_id: requirement.requirement_id, requirement_set_id: requirement.requirement_set_id };
    },
  };
}

async function registerAndTarget(deps) {
  const registration = await registerExternalRequirementSet(
    { organizationId: ORG_A, payload: registrationPayload(), actorContext: gkAdminActor },
    deps,
  );
  assert.equal(registration.ok, true);

  const target = await updateEngagementRequirementTarget(
    {
      organizationId: ORG_A,
      engagementId: ENGAGEMENT_A,
      target: { target_funder_id: "city_impact_fund", target_framework: "annual_outcomes_v1" },
      actorContext: gkOperatorActor,
    },
    deps,
  );
  assert.equal(target.ok, true);
  return registration;
}

test("STATE A: registered external requirement set remains non-authoritative until existing applicability review", async () => {
  const state = createProofState();
  const deps = createProofDependencies(state);
  const registration = await registerAndTarget(deps);

  assert.equal(registration.data.requirement_set.requirement_set_id, SET_ID);
  assert.deepEqual(registration.data.requirements.map((requirement) => requirement.requirement_set_id), [SET_ID, SET_ID]);
  assert.equal(registration.data.requirement_source.source_type, "funder");
  assert.equal(registration.data.applicability_created, false);
  assert.equal(registration.data.assessment_created, false);

  const classified = await classifyEngagementFunderRequirementsState(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor },
    deps,
  );
  assert.equal(classified.ok, true);
  assert.equal(classified.data.state, "authoritative_requirement_set_not_applicable");
  assert.equal(classified.data.authoritative_requirement_sets[0].requirement_set_id, SET_ID);
  assert.deepEqual(classified.data.applicable_requirement_sets, []);

  const assessment = await assessEngagementRequirement(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementId: REQUIREMENT_1, actorContext: gkReviewerActor, now: NOW },
    deps,
  );
  assert.equal(assessment.ok, false);
  assert.equal(assessment.error.code, "engagement_requirement_applicability_not_confirmed");
  assert.equal(state.assessments.size, 0);

  const composed = await getEngagementFunderRequirementsForImpactLibrary(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor },
    deps,
  );
  assert.equal(composed.ok, true);
  assert.equal(composed.data.state, "authoritative_requirement_set_not_applicable");
  assert.deepEqual(composed.data.applicable_requirement_sets, []);
});

test("STATE B: existing applicability review makes the registered set current and consumable downstream", async () => {
  const state = createProofState();
  const deps = createProofDependencies(state);
  await registerAndTarget(deps);

  const proposal = await proposeEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: SET_ID, actorContext: gkOperatorActor },
    deps,
  );
  assert.equal(proposal.ok, true);
  assert.equal(proposal.data.applicability_status, "proposed");
  assert.equal(proposal.data.applicability_effective_state, "pending_review");

  let classified = await classifyEngagementFunderRequirementsState(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor },
    deps,
  );
  assert.equal(classified.ok, true);
  assert.equal(classified.data.state, "authoritative_requirement_set_not_applicable");
  assert.equal(classified.data.applicability_rows[0].applicability_conclusion, "NOT_CONFIRMED");
  assert.deepEqual(classified.data.applicable_requirement_sets, []);

  const review = await approveEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: SET_ID, decision: "applicable", actorContext: gkReviewerActor },
    deps,
  );
  assert.equal(review.ok, true);
  assert.equal(review.data.applicability_status, "confirmed");
  assert.equal(review.data.applicability_effective_state, "applicable");
  assert.equal(review.data.supersedes_engagement_requirement_set_id, proposal.data.engagement_requirement_set_id);

  classified = await classifyEngagementFunderRequirementsState(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor },
    deps,
  );
  assert.equal(classified.ok, true);
  assert.equal(classified.data.state, "applicable_requirement_set_assessment_not_available");
  assert.equal(classified.data.applicable_requirement_sets[0].requirement_set_id, SET_ID);
  assert.deepEqual(
    classified.data.applicable_requirement_sets[0].requirements.map((requirement) => requirement.requirement_id),
    [REQUIREMENT_1, REQUIREMENT_2],
  );

  const staleProposal = classified.data.applicability_rows.find((row) =>
    row.engagement_requirement_set_id === proposal.data.engagement_requirement_set_id
  );
  assert.equal(staleProposal.applicability_conclusion, "NOT_CONFIRMED");
  assert.equal(staleProposal.superseded_by_engagement_requirement_set_id, review.data.engagement_requirement_set_id);

  const crossTenant = await assessEngagementRequirement(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementId: REQUIREMENT_1, actorContext: crossTenantReviewerActor, now: NOW },
    deps,
  );
  assert.equal(crossTenant.ok, false);
  assert.equal(crossTenant.error.code, "authorization_denied");
  assert.equal(state.assessments.size, 0);

  const assessment = await assessEngagementRequirement(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementId: REQUIREMENT_1, actorContext: gkReviewerActor, now: NOW },
    deps,
  );
  assert.equal(assessment.ok, true);
  assert.equal(assessment.data.engagement_id, ENGAGEMENT_A);
  assert.equal(assessment.data.requirement_id, REQUIREMENT_1);

  const composed = await getEngagementFunderRequirementsForImpactLibrary(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor },
    deps,
  );
  assert.equal(composed.ok, true);
  assert.equal(composed.data.state, "applicable_requirement_set_assessment_not_available");
  const [set] = composed.data.applicable_requirement_sets;
  assert.equal(set.requirement_set_id, SET_ID);
  const assessed = set.requirements.find((requirement) => requirement.requirement_id === REQUIREMENT_1);
  const unassessed = set.requirements.find((requirement) => requirement.requirement_id === REQUIREMENT_2);
  assert.equal(assessed.current_assessment.assessment.assessment_state, "satisfied");
  assert.equal(assessed.current_assessment.assessment.engagement_id, ENGAGEMENT_A);
  assert.equal(unassessed.current_assessment, null);

  const retirement = await approveEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: SET_ID, decision: "not_applicable", actorContext: gkReviewerActor },
    deps,
  );
  assert.equal(retirement.ok, true);

  const afterRetirement = await getEngagementFunderRequirementsForImpactLibrary(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor },
    deps,
  );
  assert.equal(afterRetirement.ok, true);
  assert.equal(afterRetirement.data.state, "authoritative_requirement_set_not_applicable");
  assert.deepEqual(afterRetirement.data.applicable_requirement_sets, []);
  assert.equal(state.assessments.size, 1);
});
