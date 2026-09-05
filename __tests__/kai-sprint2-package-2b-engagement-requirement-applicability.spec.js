import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  proposeEngagementRequirementSetApplicability,
  approveEngagementRequirementSetApplicability,
  __engagementRequirementApplicabilityServiceContract,
  __engagementRequirementApplicabilityServiceTestables,
} from "../Backend/kai/services/kaiEngagementRequirementApplicabilityService.js";
import { classifyEngagementFunderRequirementsState } from "../Backend/kai/services/kaiEngagementContextService.js";

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const ENGAGEMENT_A = "10000000-0000-4000-8000-00000000000a";
const ENGAGEMENT_B = "10000000-0000-4000-8000-00000000000b";
const REQUIREMENT_SET_ID = "20000000-0000-4000-8000-000000000001";
const PROPOSAL_ID = "50000000-0000-4000-8000-000000000001";
const CONFIRMED_ID = "50000000-0000-4000-8000-000000000002";
const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const requirementAssessmentRepositorySource = readFileSync(
  "Backend/kai/dictionary/postgresRequirementAssessmentRepository.js",
  "utf8",
);

const matchingTarget = Object.freeze({
  target_funder_id: "city_impact_fund",
  target_framework: "annual_outcomes_v1",
});

const mismatchedTarget = Object.freeze({
  target_funder_id: "city_impact_fund",
  target_framework: "different_framework_v9",
});

const governedActiveAuthority = Object.freeze({
  requirement_set_id: REQUIREMENT_SET_ID,
  set_key: "annual_outcomes",
  set_name: "Annual Outcomes",
  requirement_framework_version_id: "30000000-0000-4000-8000-000000000001",
  framework_code: "annual_outcomes_v1",
  framework_status: "active",
  requirement_source_id: "40000000-0000-4000-8000-000000000001",
  source_type: "funder",
  source_code: "city_impact_fund",
});

const kaiStandardAuthority = Object.freeze({
  ...governedActiveAuthority,
  source_type: "kai_standard",
});

const retiredAuthority = Object.freeze({
  ...governedActiveAuthority,
  framework_status: "retired",
});

const gkOperatorActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  kaiRoles: [],
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "gk_operator" }],
});

const clientAdminActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000002",
  kaiRoles: [],
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "client_admin" }],
});

const gkReviewerActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000003",
  kaiRoles: [],
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "gk_reviewer" }],
});

const otherGkReviewerActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000005",
  kaiRoles: [],
  organizationMemberships: [{ organization_id: ORG_A, membership_status: "active", role_name: "gk_reviewer" }],
});

const crossOrganizationActor = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000004",
  kaiRoles: [],
  organizationMemberships: [{ organization_id: ORG_B, membership_status: "active", role_name: "gk_reviewer" }],
});

const systemActor = Object.freeze({ actorType: "system", actorUserId: null });
const aiActor = Object.freeze({ actorType: "ai", actorUserId: null });

function engagementRow({ organizationId = ORG_A, engagementId = ENGAGEMENT_A, target = matchingTarget } = {}) {
  return {
    engagement_id: engagementId,
    organization_id: organizationId,
    engagement_type: "pilot_assessment",
    engagement_status: "draft",
    project_metadata: { engagement_requirement_target: target },
  };
}

function createProposeHarness({
  engagement = engagementRow(),
  authority = governedActiveAuthority,
  auditResult = { ok: true, auditEventId: "audit-1" },
} = {}) {
  const calls = { transactions: 0, insert: [], audit: [] };
  const tx = { tx: true };
  return {
    calls,
    dependencies: {
      env: enabledEnv,
      async runInTransaction(callback) {
        calls.transactions += 1;
        return callback(tx);
      },
      async getEngagementForOrganization(input) {
        if (!engagement) return null;
        if (input.organizationId !== engagement.organization_id || input.engagementId !== engagement.engagement_id) {
          return null;
        }
        return engagement;
      },
      async getRequirementSetAuthority() {
        return authority;
      },
      async insertEngagementRequirementSetProposal(input, db) {
        calls.insert.push({ input, db });
        return {
          engagement_requirement_set_id: PROPOSAL_ID,
          organization_id: input.organizationId,
          engagement_id: input.engagementId,
          requirement_set_id: input.requirementSetId,
          applicability_status: "proposed",
          applicability_effective_state: "pending_review",
          created_by: input.createdBy,
          created_by_type: input.createdByType,
          created_at: "2026-09-05T00:00:00.000Z",
        };
      },
      async insertRequiredSuccessfulAuditEvent(metadata, db) {
        calls.audit.push({ metadata, db });
        return auditResult;
      },
    },
  };
}

const defaultCurrent = Object.freeze({
  engagement_requirement_set_id: PROPOSAL_ID,
  organization_id: ORG_A,
  engagement_id: ENGAGEMENT_A,
  requirement_set_id: REQUIREMENT_SET_ID,
  applicability_status: "proposed",
  applicability_effective_state: "pending_review",
  supersedes_engagement_requirement_set_id: null,
});

function createReviewHarness({
  engagement = engagementRow(),
  current = defaultCurrent,
  authority = governedActiveAuthority,
  auditResult = { ok: true, auditEventId: "audit-2" },
  now = "2026-09-05T12:00:00.000Z",
  insertedId = "60000000-0000-4000-8000-000000000001",
} = {}) {
  const calls = { transactions: 0, insert: [], audit: [], currentLookup: [] };
  const tx = { tx: true };
  return {
    calls,
    dependencies: {
      env: enabledEnv,
      now: () => now,
      async runInTransaction(callback) {
        calls.transactions += 1;
        return callback(tx);
      },
      async getEngagementForOrganization(input) {
        if (!engagement) return null;
        if (input.organizationId !== engagement.organization_id || input.engagementId !== engagement.engagement_id) {
          return null;
        }
        return engagement;
      },
      async getCurrentEngagementRequirementSetForIdentity(input) {
        calls.currentLookup.push(input);
        return current;
      },
      async getRequirementSetAuthority() {
        return authority;
      },
      async insertEngagementRequirementSetReviewApproval(input, db) {
        calls.insert.push({ input, db });
        return {
          engagement_requirement_set_id: insertedId,
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
          created_at: "2026-09-05T12:00:00.000Z",
        };
      },
      async insertRequiredSuccessfulAuditEvent(metadata, db) {
        calls.audit.push({ metadata, db });
        return auditResult;
      },
    },
  };
}

test("propose: valid human proposal is non-authoritative and never sets applicability_status confirmed or effective state applicable", async () => {
  const harness = createProposeHarness();
  const result = await proposeEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, actorContext: gkOperatorActor },
    harness.dependencies,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.applicability_status, "proposed");
  assert.notEqual(result.data.applicability_status, "confirmed");
  assert.equal(result.data.applicability_effective_state, "pending_review");
  assert.equal(Object.hasOwn(result.data, "reviewed_by"), false);
  assert.equal(harness.calls.transactions, 1);
  assert.equal(harness.calls.audit[0].metadata.operation, __engagementRequirementApplicabilityServiceContract.PROPOSE_OPERATION);
  assert.equal(harness.calls.audit[0].metadata.organization_id, ORG_A);
  assert.equal(harness.calls.audit[0].metadata.engagement_id, ENGAGEMENT_A);
});

test("propose: client_admin may propose (same allowed roles as engagement target selection)", async () => {
  const harness = createProposeHarness();
  const result = await proposeEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, actorContext: clientAdminActor },
    harness.dependencies,
  );
  assert.equal(result.ok, true);
});

test("propose: AI/system actor may propose", async () => {
  const harness = createProposeHarness();
  const systemResult = await proposeEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, actorContext: systemActor },
    harness.dependencies,
  );
  assert.equal(systemResult.ok, true);
  assert.equal(systemResult.data.created_by, null);

  const aiHarness = createProposeHarness();
  const aiResult = await proposeEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, actorContext: aiActor },
    aiHarness.dependencies,
  );
  assert.equal(aiResult.ok, true);
});

test("propose: cross-tenant actor without active membership in the target organization is denied", async () => {
  const harness = createProposeHarness();
  const result = await proposeEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, actorContext: crossOrganizationActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(harness.calls.transactions, 0);
});

test("propose: engagement belonging to a different organization than requested fails closed", async () => {
  const harness = createProposeHarness({ engagement: null });
  const result = await proposeEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_B, requirementSetId: REQUIREMENT_SET_ID, actorContext: gkOperatorActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
  assert.equal(harness.calls.transactions, 0);
});

test("propose: kai_standard requirement authority cannot become funder-specific applicability", async () => {
  const harness = createProposeHarness({ authority: kaiStandardAuthority });
  const result = await proposeEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, actorContext: gkOperatorActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.blockers[0].blocking_reason, "kai_standard_not_governable_authority");
  assert.equal(harness.calls.transactions, 0);
});

test("propose: a non-authoritative (draft/retired) external requirement set cannot become current", async () => {
  const harness = createProposeHarness({ authority: retiredAuthority });
  const result = await proposeEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, actorContext: gkOperatorActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.blockers[0].blocking_reason, "requirement_authority_not_governed_active");
});

test("propose: target mismatch fails closed with no fuzzy/label inference", async () => {
  const harness = createProposeHarness({ engagement: engagementRow({ target: mismatchedTarget }) });
  const result = await proposeEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, actorContext: gkOperatorActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.blockers[0].blocking_reason, "target_identity_mismatch");
});

test("propose: no target selected on the engagement fails closed", async () => {
  const harness = createProposeHarness({ engagement: engagementRow({ target: {} }) });
  const result = await proposeEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, actorContext: gkOperatorActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("review: input validation rejects a decision outside Package 2A's existing vocabulary (no new vocabulary invented)", async () => {
  const harness = createReviewHarness();
  const result = await approveEngagementRequirementSetApplicability(
    {
      organizationId: ORG_A,
      engagementId: ENGAGEMENT_A,
      requirementSetId: REQUIREMENT_SET_ID,
      decision: "definitely_maybe",
      actorContext: gkReviewerActor,
    },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(harness.calls.transactions, 0);
});

test("review: unauthorized human (wrong role) cannot review", async () => {
  const harness = createReviewHarness();
  const result = await approveEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, decision: "applicable", actorContext: clientAdminActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(harness.calls.transactions, 0);
});

test("review: AI/system actor cannot self-approve, even the same actor type allowed to propose", async () => {
  for (const actorContext of [systemActor, aiActor]) {
    const harness = createReviewHarness();
    const result = await approveEngagementRequirementSetApplicability(
      { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, decision: "applicable", actorContext },
      harness.dependencies,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "authorization_denied");
    assert.equal(harness.calls.transactions, 0);
  }
});

test("review: cross-tenant reviewer cannot review another organization's identity", async () => {
  const harness = createReviewHarness();
  const result = await approveEngagementRequirementSetApplicability(
    { organizationId: ORG_B, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, decision: "applicable", actorContext: crossOrganizationActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  // Engagement A does not belong to organization B, so the scoped read fails closed.
  assert.equal(result.error.code, "not_found");
});

test("review: reviewing an engagement that does not resolve for this organization fails closed as not_found", async () => {
  const harness = createReviewHarness({ engagement: null });
  const result = await approveEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, decision: "applicable", actorContext: gkReviewerActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("review: no current decision exists for this identity fails closed as not_found (nothing was ever proposed)", async () => {
  const harness = createReviewHarness({ current: null });
  const result = await approveEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, decision: "applicable", actorContext: gkReviewerActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("review: current-decision lookup is scoped by the exact governed identity, not a client-supplied row id (no such field is even accepted)", async () => {
  const harness = createReviewHarness();
  const result = await approveEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, decision: "applicable", actorContext: gkReviewerActor },
    harness.dependencies,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(harness.calls.currentLookup[0], {
    organizationId: ORG_A,
    engagementId: ENGAGEMENT_A,
    requirementSetId: REQUIREMENT_SET_ID,
    lockForUpdate: true,
  });
});

test("review: requirement authority demoted to draft/retired fails closed before any row is written", async () => {
  const harness = createReviewHarness({ authority: retiredAuthority });
  const result = await approveEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, decision: "applicable", actorContext: gkReviewerActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(harness.calls.insert.length, 0);
});

test("review: engagement target changed since the current decision was created fails closed instead of inheriting stale applicability", async () => {
  const harness = createReviewHarness({ engagement: engagementRow({ target: mismatchedTarget }) });
  const result = await approveEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, decision: "applicable", actorContext: gkReviewerActor },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(result.blockers[0].blocking_reason, "target_context_mismatch");
  assert.equal(harness.calls.insert.length, 0);
});

test("review: authorized human review of a proposal creates the reviewed/current applicability row with server-derived authority only", async () => {
  const harness = createReviewHarness();
  const result = await approveEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, decision: "applicable", actorContext: gkReviewerActor },
    harness.dependencies,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.applicability_status, "confirmed");
  assert.equal(result.data.applicability_effective_state, "applicable");
  assert.equal(result.data.reviewed_by, gkReviewerActor.actorUserId);
  assert.equal(result.data.reviewed_by_role, "gk_reviewer");
  assert.equal(result.data.reviewed_at, "2026-09-05T12:00:00.000Z");
  assert.equal(result.data.supersedes_engagement_requirement_set_id, PROPOSAL_ID);
  assert.deepEqual(result.data.target_context_identity, matchingTarget);
  assert.equal(harness.calls.transactions, 1);

  // Reviewer identity, timestamp, and target snapshot must all be
  // server-derived - the insert call never receives them from client input,
  // because the input schema does not even accept those fields.
  const insertedInput = harness.calls.insert[0].input;
  assert.equal(insertedInput.reviewedBy, gkReviewerActor.actorUserId);
  assert.equal(insertedInput.reviewedByRole, "gk_reviewer");
  assert.deepEqual(insertedInput.targetContextIdentity, matchingTarget);

  assert.equal(harness.calls.audit[0].metadata.operation, __engagementRequirementApplicabilityServiceContract.APPROVE_OPERATION);
  assert.equal(harness.calls.audit[0].metadata.actor_user_id, gkReviewerActor.actorUserId);
});

test("review: client-supplied reviewer/timestamp/target/supersession fields are rejected as unknown input, never accepted as authoritative", async () => {
  const harness = createReviewHarness();
  const result = await approveEngagementRequirementSetApplicability(
    {
      organizationId: ORG_A,
      engagementId: ENGAGEMENT_A,
      requirementSetId: REQUIREMENT_SET_ID,
      decision: "applicable",
      actorContext: gkReviewerActor,
      reviewedBy: "90000000-0000-4000-8000-000000000099",
      targetContextIdentity: { target_funder_id: "spoofed", target_framework: "spoofed" },
      engagementRequirementSetId: "90000000-0000-4000-8000-000000000098",
    },
    harness.dependencies,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(harness.calls.transactions, 0);
});

test("replacement (Package 2B-B): a second valid review supersedes an already-confirmed current decision, preserving the prior row unchanged as history", async () => {
  const confirmedCurrent = Object.freeze({
    engagement_requirement_set_id: CONFIRMED_ID,
    organization_id: ORG_A,
    engagement_id: ENGAGEMENT_A,
    requirement_set_id: REQUIREMENT_SET_ID,
    applicability_status: "confirmed",
    applicability_effective_state: "applicable",
    supersedes_engagement_requirement_set_id: PROPOSAL_ID,
  });
  const harness = createReviewHarness({ current: confirmedCurrent, insertedId: "60000000-0000-4000-8000-000000000002" });
  const result = await approveEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, decision: "not_applicable", actorContext: otherGkReviewerActor },
    harness.dependencies,
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.applicability_effective_state, "not_applicable");
  assert.equal(result.data.reviewed_by, otherGkReviewerActor.actorUserId);
  // Supersedes the confirmed row that was current, not the original proposal.
  assert.equal(result.data.supersedes_engagement_requirement_set_id, CONFIRMED_ID);
  assert.notEqual(result.data.supersedes_engagement_requirement_set_id, PROPOSAL_ID);

  // The prior current row itself is never read back as mutated by this
  // service - the writer only ever inserts a new row (proven at the schema
  // level by Package 2A's append-only trigger; proven here by the fact that
  // insertEngagementRequirementSetReviewApproval, the only mutation the
  // service calls, receives no update/delete-shaped input for confirmedCurrent).
  const insertedInput = harness.calls.insert[0].input;
  assert.equal(insertedInput.supersedesEngagementRequirementSetId, CONFIRMED_ID);
});

test("replacement (Package 2B-B): reviewed retired decision does not qualify as current applicable in the Package 1B classifier", async () => {
  const harness = createReviewHarness();
  const retiredResult = await approveEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, decision: "retired", actorContext: gkReviewerActor },
    harness.dependencies,
  );
  assert.equal(retiredResult.ok, true);
  assert.equal(retiredResult.data.applicability_effective_state, "retired");

  const retiredRow = {
    engagement_requirement_set_id: retiredResult.data.engagement_requirement_set_id,
    organization_id: ORG_A,
    engagement_id: ENGAGEMENT_A,
    requirement_set_id: REQUIREMENT_SET_ID,
    applicability_status: retiredResult.data.applicability_status,
    applicability_effective_state: retiredResult.data.applicability_effective_state,
    reviewed_by: retiredResult.data.reviewed_by,
    reviewed_by_role: retiredResult.data.reviewed_by_role,
    reviewed_at: retiredResult.data.reviewed_at,
    supersedes_engagement_requirement_set_id: retiredResult.data.supersedes_engagement_requirement_set_id,
    superseded_by_engagement_requirement_set_id: null,
    target_context_identity: retiredResult.data.target_context_identity,
    created_by_type: "human",
    created_at: retiredResult.data.created_at,
    ...governedActiveAuthority,
  };

  const classifierResult = await classifyEngagementFunderRequirementsState(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor },
    {
      env: enabledEnv,
      async getEngagementForOrganization() {
        return engagementRow();
      },
      async listExternalRequirementSetsForTarget() {
        return [governedActiveAuthority];
      },
      async listEngagementRequirementSetsForOrganization() {
        return [retiredRow];
      },
    },
  );

  assert.equal(classifierResult.ok, true);
  // A retired decision is never CURRENT_APPLICABLE/CURRENT_NOT_APPLICABLE -
  // Package 2A's own classifier only recognizes 'applicable'/'not_applicable'
  // as current; this is existing, unmodified classifier behavior.
  assert.equal(classifierResult.data.state, "authoritative_requirement_set_not_applicable");
  assert.equal(classifierResult.data.applicable_requirement_sets.length, 0);
});

test("writer-created review causes Package 1B's classifier to reach applicable_requirement_set_assessment_not_available", async () => {
  const harness = createReviewHarness();
  const reviewResult = await approveEngagementRequirementSetApplicability(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, requirementSetId: REQUIREMENT_SET_ID, decision: "applicable", actorContext: gkReviewerActor },
    harness.dependencies,
  );
  assert.equal(reviewResult.ok, true);

  const applicabilityRow = {
    engagement_requirement_set_id: reviewResult.data.engagement_requirement_set_id,
    organization_id: ORG_A,
    engagement_id: ENGAGEMENT_A,
    requirement_set_id: REQUIREMENT_SET_ID,
    applicability_status: reviewResult.data.applicability_status,
    applicability_effective_state: reviewResult.data.applicability_effective_state,
    reviewed_by: reviewResult.data.reviewed_by,
    reviewed_by_role: reviewResult.data.reviewed_by_role,
    reviewed_at: reviewResult.data.reviewed_at,
    supersedes_engagement_requirement_set_id: reviewResult.data.supersedes_engagement_requirement_set_id,
    superseded_by_engagement_requirement_set_id: null,
    target_context_identity: reviewResult.data.target_context_identity,
    created_by_type: "human",
    created_at: reviewResult.data.created_at,
    ...governedActiveAuthority,
  };

  const classifierResult = await classifyEngagementFunderRequirementsState(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor },
    {
      env: enabledEnv,
      async getEngagementForOrganization() {
        return engagementRow();
      },
      async listExternalRequirementSetsForTarget() {
        return [governedActiveAuthority];
      },
      async listEngagementRequirementSetsForOrganization() {
        return [applicabilityRow];
      },
    },
  );

  assert.equal(classifierResult.ok, true);
  assert.equal(classifierResult.data.state, "applicable_requirement_set_assessment_not_available");
  assert.equal(classifierResult.data.applicable_requirement_sets.length, 1);
});

test("Package 1 classifier states 1-3 still pass (no target, no authority, authority not applicable)", async () => {
  const noTarget = await classifyEngagementFunderRequirementsState(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor },
    {
      env: enabledEnv,
      async getEngagementForOrganization() {
        return engagementRow({ target: {} });
      },
      async listExternalRequirementSetsForTarget() {
        return [];
      },
      async listEngagementRequirementSetsForOrganization() {
        return [];
      },
    },
  );
  assert.equal(noTarget.ok, true);
  assert.equal(noTarget.data.state, "no_target_selected");

  const noAuthority = await classifyEngagementFunderRequirementsState(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor },
    {
      env: enabledEnv,
      async getEngagementForOrganization() {
        return engagementRow();
      },
      async listExternalRequirementSetsForTarget() {
        return [];
      },
      async listEngagementRequirementSetsForOrganization() {
        return [];
      },
    },
  );
  assert.equal(noAuthority.ok, true);
  assert.equal(noAuthority.data.state, "target_selected_no_authoritative_requirement_set");

  const authorityNotApplicable = await classifyEngagementFunderRequirementsState(
    { organizationId: ORG_A, engagementId: ENGAGEMENT_A, actorContext: gkOperatorActor },
    {
      env: enabledEnv,
      async getEngagementForOrganization() {
        return engagementRow();
      },
      async listExternalRequirementSetsForTarget() {
        return [governedActiveAuthority];
      },
      async listEngagementRequirementSetsForOrganization() {
        return [];
      },
    },
  );
  assert.equal(authorityNotApplicable.ok, true);
  assert.equal(authorityNotApplicable.data.state, "authoritative_requirement_set_not_applicable");
});

test("static contract: the generic organization-scope requirement-assessment repository remains untouched (engagement_id stays null)", () => {
  const insertAssessmentRow = requirementAssessmentRepositorySource.match(/async function insertAssessmentRow[\s\S]*?^}/m)?.[0];
  assert.ok(insertAssessmentRow, "insertAssessmentRow must still exist unmodified");
  assert.match(insertAssessmentRow, /organization_id, engagement_id, requirement_id/);
  assert.match(insertAssessmentRow, /WHERE engagement_id IS NULL/);
});

test("testables: isAutomatedProposerActor and isMappedHumanActor are mutually exclusive for the fixtures used here", () => {
  const { isAutomatedProposerActor, isMappedHumanActor } = __engagementRequirementApplicabilityServiceTestables;
  assert.equal(isAutomatedProposerActor(systemActor), true);
  assert.equal(isMappedHumanActor(systemActor), false);
  assert.equal(isAutomatedProposerActor(gkReviewerActor), false);
  assert.equal(isMappedHumanActor(gkReviewerActor), true);
});

test("contract: REVIEW_DECISION_VALUES contains exactly Package 2A's existing reviewed states, no new vocabulary", () => {
  assert.deepEqual(
    [...__engagementRequirementApplicabilityServiceContract.REVIEW_DECISION_VALUES].sort(),
    ["applicable", "not_applicable", "retired"],
  );
});
