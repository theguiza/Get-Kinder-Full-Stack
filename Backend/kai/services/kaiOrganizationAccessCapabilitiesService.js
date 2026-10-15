import { __generatedContentServiceContract } from "./kaiGeneratedContentService.js";
import { __generatedDraftLibraryServiceContract } from "./kaiGeneratedDraftLibraryService.js";
import { __humanReviewServiceContract } from "./kaiHumanReviewService.js";
import { __evidenceLineageServiceContract } from "./kaiEvidenceLineageService.js";
import { __evidenceCoverageAssessmentServiceContract } from "./kaiEvidenceCoverageAssessmentService.js";
import { __claimProposalServiceContract } from "./kaiClaimProposalService.js";
import { __claimGapFollowupServiceContract } from "./kaiClaimGapFollowupService.js";
import { __conflictReviewCandidateServiceContract } from "./kaiConflictReviewCandidateService.js";
import { __coverageReviewDecisionServiceContract } from "./kaiCoverageReviewDecisionService.js";
import { __requirementAssessmentServiceContract } from "./kaiRequirementAssessmentService.js";
import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_OPERATION_ROLES, KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation, validateActorCanAccessKnowledgeWorkspace } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { __clientFollowupReadServiceContract } from "./kaiClientFollowupReadService.js";
import { __engagementContextServiceContract } from "./kaiEngagementContextService.js";
import { __improvementPracticeServiceContract } from "./kaiImprovementPracticeService.js";
import { __organizationJoinRequestReviewServiceContract } from "./kaiOrganizationJoinRequestReviewService.js";
import { hasOrganizationRoleAdministrationAuthority } from "./kaiAccessAdministrationService.js";

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
function workflowOperations(actorContext, organizationId) {
  return {
    generateDrafts: validateActorCanPerformOperation(
      actorContext, __generatedContentServiceContract.CREATE_EVIDENCE_SUMMARY_OPERATION, organizationId,
      { allowedRoles: __generatedContentServiceContract.GENERATED_CONTENT_ALLOWED_ROLES },
    ).ok === true,
    reviewGeneratedDrafts: validateActorCanPerformOperation(
      actorContext, __generatedContentServiceContract.COMPLETE_GENERATED_CONTENT_REVIEW_OPERATION, organizationId,
      { allowedRoles: __generatedContentServiceContract.COMPLETE_GENERATED_CONTENT_REVIEW_ALLOWED_ROLES },
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
  };
}

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
