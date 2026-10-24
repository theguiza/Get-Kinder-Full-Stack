import { __generatedContentServiceContract } from "./kaiGeneratedContentService.js";
import { __generatedDraftLibraryServiceContract } from "./kaiGeneratedDraftLibraryService.js";
import { __humanReviewServiceContract } from "./kaiHumanReviewService.js";
import { __evidenceLineageServiceContract } from "./kaiEvidenceLineageService.js";
import { __sourceMeasurementServiceContract } from "./kaiSourceMeasurementService.js";
import { __evidenceCoverageAssessmentServiceContract } from "./kaiEvidenceCoverageAssessmentService.js";
import { __claimProposalServiceContract } from "./kaiClaimProposalService.js";
import { __claimGapFollowupServiceContract } from "./kaiClaimGapFollowupService.js";
import { authorizeClaimTraceabilityRead } from "./kaiClaimTraceabilityService.js";
import { __conflictReviewCandidateServiceContract } from "./kaiConflictReviewCandidateService.js";
import { __coverageReviewDecisionServiceContract } from "./kaiCoverageReviewDecisionService.js";
import { __requirementAssessmentServiceContract } from "./kaiRequirementAssessmentService.js";
import { __grantResponsePacketServiceContract } from "./kaiGrantResponsePacketService.js";
import { __boardReportingPacketServiceContract } from "./kaiBoardReportingPacketService.js";
import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_OPERATION_ROLES, KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import {
  KAI_KNOWLEDGE_WORKSPACE_ROLES,
  validateActorCanPerformOperation,
  validateActorCanAccessKnowledgeWorkspace,
  validateActorCanPerformSensitivityReview,
} from "../auth/kaiAuthorizationService.js";
import { __reviewCockpitServiceContract } from "./kaiReviewCockpitService.js";
import { __sourcePromotionServiceContract, authorizeSourcePromotionDecision } from "./kaiSourcePromotionService.js";
import { __exportReviewServiceContract } from "./kaiExportReviewService.js";
import {
  KAI_DELEGATED_GK_ADMINISTRATOR_ROLE,
  KAI_DELEGATED_GK_ADMIN_ASSIGNABLE_ORGANIZATION_ROLES,
  KAI_ASSIGNABLE_ORGANIZATION_ROLES,
  KAI_STAFF_ONBOARDING_GLOBAL_ROLE_BY_ORGANIZATION_ROLE,
} from "../config/kaiAccessAdministrationContract.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { __clientFollowupReadServiceContract } from "./kaiClientFollowupReadService.js";
import { __engagementContextServiceContract } from "./kaiEngagementContextService.js";
import { __improvementPracticeServiceContract } from "./kaiImprovementPracticeService.js";
import { __organizationJoinRequestReviewServiceContract } from "./kaiOrganizationJoinRequestReviewService.js";
import { hasOrganizationRoleAdministrationAuthority } from "./kaiAccessAdministrationService.js";
import { __clientGeneratedContentServiceContract } from "./kaiClientGeneratedContentService.js";

/**
 * Organization access capabilities for the Impact Library client. The
 * Impact Library shell mounts both client and GK users, and Knowledge Studio
 * and the Impact Library list were built over GK-internal reads (claim
 * library, evidence library, review queue, sources, generated drafts, ...).
 * Without a server answer the browser could only guess roles or call those
 * reads and treat 403 as "not for you". This read answers, per organization,
 * which existing policies admit the actor - each boolean is the result of the
 * same validateActorCanPerformOperation call (same operation, same role set)
 * the governing service itself makes. No role list is defined here and no
 * authority is granted; like the review-cockpit capabilities read, it only
 * reports.
 *
 * - internalKnowledgeWorkspace: effective GK workspace admission. The GK
 *   Knowledge Studio / Impact Library views (every GK-internal read they
 *   make) are mounted only when this is true; otherwise the client views use
 *   client-safe reads only.
 * - intakeContribution: the P0 create_intake_batch and create_intake_file
 *   policies (upload/intake contribution).
 * - clientFollowupReview: the P2-11 client follow-up review policy
 *   (client_reviewer).
 * - projectManagement: the create_engagement policy ("+ New Project").
 *   Reading Projects is ordinary client context and needs no flag.
 * - improvementPlanManagement: the create_improvement_practice and
 *   update_improvement_practice_status policies ("+ New Practice" and the
 *   status control). Reading the plan needs no flag.
 * - organizationJoinReview: the JOIN-3 join-request review list policy
 *   (organization client_admin). The shell requests the review queue only
 *   when this is true.
 * - organizationAccessManagement: the access-administration roster read and
 *   organization-role administration policies, through the service's own
 *   resolveOrganizationRoleAdministration (organization client_admin, stored
 *   or derived; or global gk_admin with an active organization gk_admin
 *   membership). The Impact Library offers Team & Access only when this is
 *   true; the access-administration service still authorizes every read and
 *   change itself.
 *
 * Admission reuses the existing read_intake role set for an active same-org
 * member, then tenant validation. Cross-org actors are denied (VAL-AUT-003).
 */
const ACCESS_CAPABILITIES_OPERATION = "read_organization_access_capabilities";
const ACCESS_CAPABILITIES_ALLOWED_ROLES = new Set(KAI_SPRINT2_P0_OPERATION_ROLES.read_intake);
const UUID_RE = KAI_SPRINT2_P0_PATTERNS.uuid;

const { LIST_CLIENT_FOLLOWUP_WORKFLOWS_ALLOWED_ROLES, LIST_CLIENT_FOLLOWUP_WORKFLOWS_OPERATION } =
  __clientFollowupReadServiceContract;
const { CREATE_ENGAGEMENT_ALLOWED_ROLES, CREATE_ENGAGEMENT_OPERATION } = __engagementContextServiceContract;
const {
  IMPROVEMENT_PRACTICE_ALLOWED_ROLES,
  CREATE_IMPROVEMENT_PRACTICE_OPERATION,
  UPDATE_IMPROVEMENT_PRACTICE_STATUS_OPERATION,
} = __improvementPracticeServiceContract;
const { REVIEWER_ALLOWED_ROLES: JOIN_REVIEW_ALLOWED_ROLES, LIST_OPERATION: JOIN_REVIEW_LIST_OPERATION } =
  __organizationJoinRequestReviewServiceContract;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && typeof actorContext?.actorUserId === "string" && actorContext.actorUserId.length > 0;
}

function isAccessCapabilitiesInput(value) {
  const allowedKeys = new Set(["organizationId", "actorContext"]);
  return (
    isPlainObject(value)
    && Object.keys(value).every((key) => allowedKeys.has(key))
    && typeof value.organizationId === "string"
    && value.organizationId === value.organizationId.toLowerCase()
    && UUID_RE.test(value.organizationId)
    && isPlainObject(value.actorContext)
  );
}

function passes(actorContext, operation, organizationId, allowedRoles) {
  const options = allowedRoles ? { allowedRoles } : {};
  return validateActorCanPerformOperation(actorContext, operation, organizationId, options).ok === true;
}

// Each UI capability projects the governing service's exact role set and mode.
// These booleans never replace service authorization or object eligibility.
// generateDrafts is the internal evidence-summary and impact-narrative
// authority (CLIENT_ADMIN_DRAFT_ALLOWED_ROLES); generateAllDraftTypes is the
// funder evidence summary and the seven other generators
// (GENERATED_CONTENT_ALLOWED_ROLES), which client_admin never holds.
// reviewSensitivity is the review-cockpit sensitivity decision gate
// (GK roles, or an organization administrator: binding-derived or a delegated
// stored client_admin grant, owner decisions 2026-10-19). promoteSource
// is P1-08's own authorizeSourcePromotionDecision; for a GK actor the decision
// route additionally requires the cockpit read gate (a global GK role), and
// for an organization administrator the source-candidate
// gate admits the same actor P1-08 does (owner decision 2026-10-18).
function canPromoteSource(actorContext, organizationId) {
  const decision = authorizeSourcePromotionDecision(actorContext, organizationId);
  if (!decision.ok) return false;
  if (decision.organizationAdminAuthorized === true) return true;
  return validateActorCanPerformOperation(
    actorContext, __reviewCockpitServiceContract.REVIEW_COCKPIT_READ_OPERATION, organizationId,
    { allowedRoles: __reviewCockpitServiceContract.REVIEW_COCKPIT_READ_ROLES, globalRolesOnly: true },
  ).ok === true;
}

function workflowOperations(actorContext, organizationId) {
  return {
    reviewSensitivity: actorContext?.actorType === "human" && validateActorCanPerformSensitivityReview(
      actorContext, "record_sensitivity_allowed_use_decision", organizationId,
      __reviewCockpitServiceContract.REVIEW_COCKPIT_READ_ROLES, { globalRolesOnly: true },
    ).ok === true,
    promoteSource: canPromoteSource(actorContext, organizationId),
    generateDrafts: validateActorCanPerformOperation(
      actorContext, __generatedContentServiceContract.CREATE_EVIDENCE_SUMMARY_OPERATION, organizationId,
      { allowedRoles: __generatedContentServiceContract.CLIENT_ADMIN_DRAFT_ALLOWED_ROLES },
    ).ok === true,
    generateAllDraftTypes: validateActorCanPerformOperation(
      actorContext, __generatedContentServiceContract.CREATE_READINESS_ASSESSMENT_OPERATION, organizationId,
      { allowedRoles: __generatedContentServiceContract.GENERATED_CONTENT_ALLOWED_ROLES },
    ).ok === true,
    reviewGeneratedDrafts: validateActorCanPerformOperation(
      actorContext, __generatedContentServiceContract.COMPLETE_GENERATED_CONTENT_REVIEW_OPERATION, organizationId,
      { allowedRoles: __generatedContentServiceContract.COMPLETE_GENERATED_CONTENT_REVIEW_ALLOWED_ROLES },
    ).ok === true,
    // The organization administrator's own internal drafts (owner decision
    // 2026-10-19): listClientInternalDrafts / getClientInternalDraft's own check.
    readInternalDrafts: validateActorCanPerformOperation(
      actorContext, __clientGeneratedContentServiceContract.CLIENT_INTERNAL_DRAFT_OPERATION, organizationId,
      { allowedRoles: __clientGeneratedContentServiceContract.CLIENT_INTERNAL_DRAFT_READ_ROLES },
    ).ok === true,
    readGeneratedDrafts: validateActorCanPerformOperation(
      actorContext, __generatedDraftLibraryServiceContract.GENERATED_DRAFT_LIBRARY_READ_OPERATION, organizationId,
      { allowedRoles: __generatedDraftLibraryServiceContract.GENERATED_DRAFT_LIBRARY_READ_ROLES, combineGlobalRoles: true },
    ).ok === true,
    recordEvidenceReview: validateActorCanPerformOperation(
      actorContext, __humanReviewServiceContract.RECORD_EVIDENCE_REVIEW_DECISION_OPERATION, organizationId,
      { allowedRoles: __humanReviewServiceContract.RECORD_EVIDENCE_REVIEW_DECISION_ALLOWED_ROLES, combineGlobalRoles: true },
    ).ok === true,
    recordClaimReview: validateActorCanPerformOperation(
      actorContext, __humanReviewServiceContract.RECORD_CLAIM_REVIEW_DECISION_OPERATION, organizationId,
      { allowedRoles: __humanReviewServiceContract.RECORD_CLAIM_REVIEW_DECISION_ALLOWED_ROLES, combineGlobalRoles: true },
    ).ok === true,
    extractEvidence: validateActorCanPerformOperation(
      actorContext, __evidenceLineageServiceContract.EVIDENCE_LINEAGE_OPERATION, organizationId,
      { allowedRoles: __evidenceLineageServiceContract.EVIDENCE_LINEAGE_ALLOWED_ROLES },
    ).ok === true,
    recordSourceMeasurement: validateActorCanPerformOperation(
      actorContext, __sourceMeasurementServiceContract.SOURCE_MEASUREMENT_OPERATION, organizationId,
      { allowedRoles: __sourceMeasurementServiceContract.SOURCE_MEASUREMENT_ALLOWED_ROLES },
    ).ok === true,
    readReleasedInternalReports: validateActorCanPerformOperation(
      actorContext, __clientGeneratedContentServiceContract.CLIENT_RELEASED_REPORT_OPERATION, organizationId,
      { allowedRoles: __clientGeneratedContentServiceContract.CLIENT_RELEASED_REPORT_READ_ROLES },
    ).ok === true,
    // Owner amendment 2026-10-23: approveClientInternalDraftFactualReview's
    // own role check. Whether a given draft may be approved is per draft
    // (the Internal Drafts detail's factualReview.actorMayApprove).
    reviewInternalDraftFactualContent: validateActorCanPerformOperation(
      actorContext, __clientGeneratedContentServiceContract.CLIENT_INTERNAL_FACTUAL_REVIEW_OPERATION, organizationId,
      { allowedRoles: __clientGeneratedContentServiceContract.CLIENT_INTERNAL_FACTUAL_REVIEW_ROLES },
    ).ok === true,
    // Owner amendment 2026-10-23: releaseClientInternalReport's own role
    // check. Whether a given draft may be released is per draft (the Internal
    // Drafts detail's organizationRelease.actorMayRelease).
    releaseInternalReports: validateActorCanPerformOperation(
      actorContext, __clientGeneratedContentServiceContract.CLIENT_INTERNAL_RELEASE_OPERATION, organizationId,
      { allowedRoles: __clientGeneratedContentServiceContract.CLIENT_INTERNAL_RELEASE_ROLES },
    ).ok === true,
    assessEvidenceCoverage: validateActorCanPerformOperation(
      actorContext, __evidenceCoverageAssessmentServiceContract.EVIDENCE_COVERAGE_ASSESSMENT_OPERATION, organizationId,
      { allowedRoles: __evidenceCoverageAssessmentServiceContract.EVIDENCE_COVERAGE_ASSESSMENT_ALLOWED_ROLES },
    ).ok === true,
    proposeClaim: validateActorCanPerformOperation(
      actorContext, __claimProposalServiceContract.CLAIM_PROPOSAL_OPERATION, organizationId,
      { allowedRoles: __claimProposalServiceContract.CLAIM_PROPOSAL_ALLOWED_ROLES },
    ).ok === true,
    generateClaimGapFollowups: validateActorCanPerformOperation(
      actorContext, __claimGapFollowupServiceContract.CLAIM_GAP_FOLLOWUP_OPERATION, organizationId,
      { allowedRoles: __claimGapFollowupServiceContract.CLAIM_GAP_FOLLOWUP_ALLOWED_ROLES },
    ).ok === true,
    // Owner authorization 2026-10-24: getClaimTraceabilitySummary's own
    // check for the internal audience (GK roles: the full DTO; an
    // organization administrator: the client-safe diagnostic only).
    readClaimTraceabilityDiagnostics: actorContext?.actorType === "human"
      && authorizeClaimTraceabilityRead(actorContext, organizationId, "internal").ok === true,
    recordConflict: validateActorCanPerformOperation(
      actorContext, __conflictReviewCandidateServiceContract.CONFLICT_REVIEW_CANDIDATE_OPERATION, organizationId,
      { allowedRoles: __conflictReviewCandidateServiceContract.CONFLICT_REVIEW_CANDIDATE_ALLOWED_ROLES },
    ).ok === true,
    acceptCoverageLimitation: validateActorCanPerformOperation(
      actorContext, __coverageReviewDecisionServiceContract.ACCEPT_INTERNAL_COVERAGE_LIMITATION_OPERATION, organizationId,
      { allowedRoles: __coverageReviewDecisionServiceContract.ACCEPT_INTERNAL_COVERAGE_LIMITATION_ALLOWED_ROLES },
    ).ok === true,
    assessRequirement: validateActorCanPerformOperation(
      actorContext, __requirementAssessmentServiceContract.ASSESS_REQUIREMENT_OPERATION, organizationId,
      { allowedRoles: __requirementAssessmentServiceContract.ASSESS_REQUIREMENT_ALLOWED_ROLES },
    ).ok === true,
    readGrantResponsePacket: validateActorCanPerformOperation(
      actorContext, __grantResponsePacketServiceContract.GET_GRANT_RESPONSE_PACKET_OPERATION, organizationId,
      { allowedRoles: __grantResponsePacketServiceContract.GENERATED_CONTENT_REVIEW_ALLOWED_ROLES, combineGlobalRoles: true },
    ).ok === true,
    readBoardReportingPacket: validateActorCanPerformOperation(
      actorContext, __boardReportingPacketServiceContract.GET_BOARD_REPORTING_PACKET_OPERATION, organizationId,
      { allowedRoles: __boardReportingPacketServiceContract.GENERATED_CONTENT_REVIEW_ALLOWED_ROLES, combineGlobalRoles: true },
    ).ok === true,
  };
}

/**
 * Team & Access readiness for one person in one organization (Prompt 4):
 * which product operations their KAI roles admit right now, and for each
 * that is not yet admitted, which assignment is missing and which
 * administrator can supply it. Every clause is the governing operation's own
 * exported role set evaluated by the shared validator in that operation's
 * own mode: "organization" (an active organization role in the set),
 * "global" (a global KAI role in the set, plus active organization access),
 * or "either" (combineGlobalRoles). It grants nothing and reports only KAI
 * role authority - not site-administrator authority, and not content
 * eligibility (a ready decision or export operation still needs eligible
 * content and its own human decision). `category` separates reading,
 * deciding, administering, and export/release.
 */
const GLOBAL = "global";
const ORGANIZATION = "organization";
const EITHER = "either";
const roleSet = (roles) => new Set(roles);
const OPERATION_READINESS = Object.freeze([
  { key: "gk_workspace", category: "read", operation: "read_knowledge_workspace",
    clauses: [{ scope: EITHER, roles: roleSet(KAI_KNOWLEDGE_WORKSPACE_ROLES) }] },
  { key: "generated_content_read", category: "read", operation: __generatedDraftLibraryServiceContract.GENERATED_DRAFT_LIBRARY_READ_OPERATION,
    clauses: [{ scope: EITHER, roles: __generatedDraftLibraryServiceContract.GENERATED_DRAFT_LIBRARY_READ_ROLES }] },
  { key: "evidence_processing", category: "process", operation: __evidenceLineageServiceContract.EVIDENCE_LINEAGE_OPERATION,
    clauses: [{ scope: ORGANIZATION, roles: __evidenceLineageServiceContract.EVIDENCE_LINEAGE_ALLOWED_ROLES }] },
  { key: "draft_generation", category: "process", operation: __generatedContentServiceContract.CREATE_EVIDENCE_SUMMARY_OPERATION,
    clauses: [{ scope: ORGANIZATION, roles: __generatedContentServiceContract.CLIENT_ADMIN_DRAFT_ALLOWED_ROLES }] },
  { key: "source_review", category: "decide", operation: __sourcePromotionServiceContract.SOURCE_PROMOTION_OPERATION,
    clauses: [
      { scope: GLOBAL, roles: __reviewCockpitServiceContract.REVIEW_COCKPIT_READ_ROLES },
      { scope: ORGANIZATION, roles: __sourcePromotionServiceContract.SOURCE_PROMOTION_ALLOWED_ROLES },
    ], sourcePromotion: true },
  { key: "sensitivity_review", category: "decide", operation: "record_sensitivity_allowed_use_decision",
    clauses: [{ scope: GLOBAL, roles: __reviewCockpitServiceContract.REVIEW_COCKPIT_READ_ROLES }], sensitivity: true },
  { key: "evidence_review", category: "decide", operation: __humanReviewServiceContract.RECORD_EVIDENCE_REVIEW_DECISION_OPERATION,
    clauses: [{ scope: EITHER, roles: __humanReviewServiceContract.RECORD_EVIDENCE_REVIEW_DECISION_ALLOWED_ROLES }] },
  { key: "claim_review", category: "decide", operation: __humanReviewServiceContract.RECORD_CLAIM_REVIEW_DECISION_OPERATION,
    clauses: [{ scope: EITHER, roles: __humanReviewServiceContract.RECORD_CLAIM_REVIEW_DECISION_ALLOWED_ROLES }] },
  { key: "coverage_acceptance", category: "decide", operation: __coverageReviewDecisionServiceContract.ACCEPT_INTERNAL_COVERAGE_LIMITATION_OPERATION,
    clauses: [{ scope: ORGANIZATION, roles: __coverageReviewDecisionServiceContract.ACCEPT_INTERNAL_COVERAGE_LIMITATION_ALLOWED_ROLES }] },
  { key: "generated_content_review", category: "decide", operation: __generatedContentServiceContract.COMPLETE_GENERATED_CONTENT_REVIEW_OPERATION,
    clauses: [{ scope: ORGANIZATION, roles: __generatedContentServiceContract.COMPLETE_GENERATED_CONTENT_REVIEW_ALLOWED_ROLES }] },
  { key: "export_release", category: "export", operation: __exportReviewServiceContract.COMPLETE_EXPORT_REVIEW_OPERATION,
    clauses: [{ scope: ORGANIZATION, roles: __exportReviewServiceContract.EXPORT_REVIEW_ALLOWED_ROLES }] },
  { key: "delegated_administration", category: "administer", operation: "manage_organization_membership",
    clauses: [
      { scope: ORGANIZATION, roles: roleSet([KAI_DELEGATED_GK_ADMINISTRATOR_ROLE]) },
      { scope: GLOBAL, roles: roleSet([KAI_DELEGATED_GK_ADMINISTRATOR_ROLE]) },
    ] },
]);

const DELEGATED_GRANTABLE = new Set(KAI_DELEGATED_GK_ADMIN_ASSIGNABLE_ORGANIZATION_ROLES);
const CLIENT_GRANTABLE = new Set(KAI_ASSIGNABLE_ORGANIZATION_ROLES);
const STAFF_ONBOARDING_GLOBAL_ROLES = new Set(Object.values(KAI_STAFF_ONBOARDING_GLOBAL_ROLE_BY_ORGANIZATION_ROLE));

function clauseSatisfied(actorContext, operation, organizationId, clause) {
  const mode = clause.scope === GLOBAL ? { globalRolesOnly: true } : clause.scope === EITHER ? { combineGlobalRoles: true } : {};
  return validateActorCanPerformOperation(actorContext, operation, organizationId, { allowedRoles: clause.roles, ...mode }).ok === true;
}

// Who can supply a missing assignment: global roles a platform superuser, and
// global gk_operator/gk_reviewer also a delegated GK administrator through
// staff onboarding (only while the person has no access to another
// organization - Repair 1); organization Get Kinder roles a platform
// superuser, and gk_operator/gk_reviewer also a delegated GK administrator;
// client roles an organization administrator.
function grantedBy(clause) {
  const roles = [...clause.roles];
  const by = ["platform_superuser"];
  if (clause.scope === GLOBAL && roles.some((role) => STAFF_ONBOARDING_GLOBAL_ROLES.has(role))) by.push("delegated_gk_admin_staff_onboarding");
  if (clause.scope !== GLOBAL && roles.some((role) => DELEGATED_GRANTABLE.has(role))) by.push("delegated_gk_admin");
  if (clause.scope !== GLOBAL && roles.some((role) => CLIENT_GRANTABLE.has(role))) by.push("organization_client_admin");
  return by;
}

export function computeOrganizationOperationReadiness(actorContext, organizationId) {
  const hasActiveAccess = (actorContext?.organizationMemberships || []).some(
    (membership) => String(membership.organization_id) === String(organizationId) && membership.membership_status === "active",
  );
  return OPERATION_READINESS.map((definition) => {
    const missing = definition.clauses
      .filter((clause) => !clauseSatisfied(actorContext, definition.operation, organizationId, clause))
      .map((clause) => ({ scope: clause.scope, roles: [...clause.roles].sort(), granted_by: grantedBy(clause) }));
    // Sensitivity review also admits an active organization
    // administrator (validateActorCanPerformSensitivityReview).
    // Source promotion also admits an active organization
    // administrator (authorizeSourcePromotionDecision, owner decision 2026-10-18).
    const ready = definition.sensitivity
      ? validateActorCanPerformSensitivityReview(actorContext, definition.operation, organizationId,
        __reviewCockpitServiceContract.REVIEW_COCKPIT_READ_ROLES, { globalRolesOnly: true }).ok === true
      : definition.sourcePromotion
        ? canPromoteSource(actorContext, organizationId)
        : missing.length === 0;
    return {
      key: definition.key,
      category: definition.category,
      ready,
      organization_access: hasActiveAccess,
      missing: ready ? [] : missing,
    };
  });
}

export const __organizationOperationReadinessContract = Object.freeze({
  OPERATION_READINESS_KEYS: Object.freeze(OPERATION_READINESS.map((definition) => definition.key)),
});

export async function getOrganizationAccessCapabilities(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isAccessCapabilitiesInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext, organizationId } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    ACCESS_CAPABILITIES_OPERATION,
    organizationId,
    { allowedRoles: ACCESS_CAPABILITIES_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  return {
    ok: true,
    data: {
      workflowOperations: workflowOperations(actorContext, organizationId),
      internalKnowledgeWorkspace: validateActorCanAccessKnowledgeWorkspace(actorContext, organizationId).ok === true,
      intakeContribution:
        passes(actorContext, "create_intake_batch", organizationId)
        && passes(actorContext, "create_intake_file", organizationId),
      clientFollowupReview: passes(
        actorContext,
        LIST_CLIENT_FOLLOWUP_WORKFLOWS_OPERATION,
        organizationId,
        LIST_CLIENT_FOLLOWUP_WORKFLOWS_ALLOWED_ROLES,
      ),
      projectManagement: passes(actorContext, CREATE_ENGAGEMENT_OPERATION, organizationId, CREATE_ENGAGEMENT_ALLOWED_ROLES),
      improvementPlanManagement:
        passes(actorContext, CREATE_IMPROVEMENT_PRACTICE_OPERATION, organizationId, IMPROVEMENT_PRACTICE_ALLOWED_ROLES)
        && passes(actorContext, UPDATE_IMPROVEMENT_PRACTICE_STATUS_OPERATION, organizationId, IMPROVEMENT_PRACTICE_ALLOWED_ROLES),
      organizationJoinReview: passes(actorContext, JOIN_REVIEW_LIST_OPERATION, organizationId, JOIN_REVIEW_ALLOWED_ROLES),
      organizationAccessManagement: hasOrganizationRoleAdministrationAuthority(actorContext, organizationId),
    },
    error: null,
  };
}

export const __organizationAccessCapabilitiesServiceContract = Object.freeze({
  ACCESS_CAPABILITIES_OPERATION,
  ACCESS_CAPABILITIES_ALLOWED_ROLES,
});
