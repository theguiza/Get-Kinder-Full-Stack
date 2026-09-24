import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { createPostgresRequirementAssessmentRepository } from "../dictionary/postgresRequirementAssessmentRepository.js";
import { createProductionMetadataOnlyAuditForEngagementRequirementAssessment } from "./kaiMetadataOnlyAuditComposition.js";
import {
  getEngagementForOrganization,
  listEngagementRequirementSetsForOrganization,
  getRequirementSetIdForRequirement,
  getRequirementSetAuthority,
} from "../db/kaiQueries.js";
import {
  __requirementAssessmentServiceContract,
} from "./kaiRequirementAssessmentService.js";
import {
  __engagementContextServiceTestables,
} from "./kaiEngagementContextService.js";

/**
 * KAI Package 3A: engagement-specific requirement assessment foundation.
 *
 * This service is the write/read seam for an ENGAGEMENT-scoped sibling of
 * the existing organization-scope requirement assessment
 * (kaiRequirementAssessmentService.js /
 * Backend/kai/dictionary/postgresRequirementAssessmentRepository.js). It
 * never touches the organization-scope (engagement_id IS NULL) identity,
 * never reinterprets it, and never overwrites it - the underlying C2.1
 * migration (migrations/kai_sprint2_c2_1_requirement_assessment_persistence.sql)
 * already defines a nullable engagement_id column with a tenant-safe
 * (engagement_id, organization_id) -> kai.engagements FK and a dedicated
 * engagement-scope partial unique index
 * (ux_requirement_assessments_c2_1_engagement_scope_fingerprint), so no
 * schema change is required for this package.
 *
 * Reuse, not reinvention:
 *  - Actor authority: the identical role set/operation-authorization
 *    mechanism as the organization-scope write
 *    (kaiRequirementAssessmentService.js's ASSESS_REQUIREMENT_ALLOWED_ROLES /
 *    READ_REQUIREMENT_ASSESSMENT_ALLOWED_ROLES, imported via
 *    __requirementAssessmentServiceContract - never redefined here).
 *  - Deterministic state computation: the repository's own
 *    assessEngagementRequirement/readEngagementRequirementAssessment methods
 *    call the exact same rule table, loadInputs/deriveState/
 *    computeFingerprint/writeProvenance functions as the organization-scope
 *    path - governed evidence/claims are organization-scope data regardless
 *    of which engagement is asking, so the computed state/fingerprint is
 *    identical; only the persisted identity (engagement_id) differs.
 *  - Package 2B applicability gate: this service resolves "is this
 *    requirement's requirement set currently reviewed, effective-applicable,
 *    unsuperseded, and target-matched for this engagement" by calling the
 *    exact same governed data-access functions Package 2B's own
 *    classifyEngagementFunderRequirementsState
 *    (Backend/kai/services/kaiEngagementContextService.js) calls
 *    (getEngagementForOrganization, listEngagementRequirementSetsForOrganization,
 *    getRequirementSetAuthority - the same kaiQueries.js exports) and the
 *    exact same pure classification predicates that function composes
 *    (isExternalAuthoritativeRequirementSet, rowMatchesTarget,
 *    targetContextMatches, isCurrentReviewedApplicability, plus
 *    serializeEngagementTarget to read "the engagement's current target" -
 *    Package 1A's own foundation), imported via
 *    __engagementContextServiceTestables. This service deliberately does
 *    NOT call classifyEngagementFunderRequirementsState itself: that
 *    function's own actor-authorization gate
 *    (CLASSIFY_FUNDER_REQUIREMENTS_ALLOWED_ROLES: gk_admin/gk_operator/
 *    client_admin) is unrelated to, and narrower than the union of, this
 *    operation's own actor gate (ASSESS_REQUIREMENT_ALLOWED_ROLES:
 *    gk_reviewer/gk_admin) - calling it internally would incorrectly block a
 *    gk_reviewer actor who is authorized to assess but not to independently
 *    classify funder requirements. Reusing its underlying data functions and
 *    pure predicates (never its authorization wrapper) reuses the identical
 *    governed decision logic without that authorization mismatch.
 *
 * Known limitation (documented, not a defect requiring schema change): the
 * Package 2B gate is resolved in a read separate from the repository's own
 * write transaction, so there is a narrow race window between "gate
 * confirmed current+applicable" and "assessment row written" during which a
 * concurrent Package 2B review could supersede or retire the applicability
 * this write relied on. This mirrors the same class of check-then-act
 * window already accepted elsewhere in this codebase's service/repository
 * split (e.g. Package 2B's own review path re-derives current state at
 * write time rather than trusting a stale read) and does not corrupt data:
 * the persisted assessment remains an accurate, fingerprinted record of
 * governed state at the moment it was written: it does not retroactively
 * assert that Package 2B applicability is still current after the fact.
 *
 * Package 3B: the read path closes the corresponding read-time gap. A
 * persisted engagement-scope assessment row on its own only proves "this
 * was a correct assessment when it was written" - it does not prove the
 * governing Package 2B applicability is STILL current at read time.
 * `getEngagementRequirementAssessment` therefore re-resolves the identical
 * `resolveEngagementApplicabilityGate` (same governed data-access functions,
 * same pure predicates, same fail-closed semantics as the write path) against
 * live state before returning the repository's read. There is deliberately
 * no new persisted column/table for this (no migration, no new schema): the
 * existing kai.requirement_assessments row carries no reference to which
 * kai.engagement_requirement_sets decision justified it, and no such
 * reference is required, because Package 2B's own current-authority read
 * (getEngagementForOrganization / listEngagementRequirementSetsForOrganization
 * / getRequirementSetAuthority, plus Package 1A's serializeEngagementTarget
 * and Package 2B's own pure predicates) already answers "is this
 * (organization, engagement, requirement) triple CURRENTLY applicable, with
 * what target, under what requirement-set authority" from first principles,
 * every time, cheaply. A stale assessment row is never deleted, mutated, or
 * hidden by this check - it simply stops being resolvable as CURRENT through
 * this read once the gate it depended on no longer holds; the row itself
 * remains intact, unmodified, historical provenance in
 * kai.requirement_assessments and its link tables.
 *
 * One transition is NOT separately distinguishable from
 * "the requirement's requirement set is no longer a governed/active external
 * authority": a change to which requirement-set/framework-version is
 * currently authoritative. This schema does not persist a "version" or
 * "fingerprint" for an applicability decision independent of the requirement
 * set's own `requirement_framework_versions.framework_status` column - a
 * requirement row (`kai.requirements`) belongs to exactly one
 * `requirement_set_id`/`requirement_framework_version_id` permanently, so a
 * framework-version transition is represented by that version's
 * `framework_status` moving away from 'active' (isExternalAuthoritativeRequirementSet
 * already fails closed on that), not by a separate version-compare. No new
 * schema is invented to distinguish "framework retired" from "framework
 * superseded by a new version" any more finely than the existing
 * `framework_status` column already does.
 */
const ASSESS_ENGAGEMENT_REQUIREMENT_ALLOWED_ROLES = __requirementAssessmentServiceContract.ASSESS_REQUIREMENT_ALLOWED_ROLES;
const ASSESS_ENGAGEMENT_REQUIREMENT_OPERATION = "assess_requirement_engagement_scope";
const READ_ENGAGEMENT_REQUIREMENT_ASSESSMENT_ALLOWED_ROLES = __requirementAssessmentServiceContract.READ_REQUIREMENT_ASSESSMENT_ALLOWED_ROLES;
const READ_ENGAGEMENT_REQUIREMENT_ASSESSMENT_OPERATION = "read_requirement_assessment_engagement_scope";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNormalizedNow(value) {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString() === value;
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

function isAssessEngagementRequirementInput(value) {
  const allowedKeys = new Set(["organizationId", "engagementId", "requirementId", "actorContext", "now"]);
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedKeys)) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.engagementId) &&
    isNonEmptyString(value.requirementId) &&
    isPlainObject(value.actorContext) &&
    isNormalizedNow(value.now)
  );
}

function isGetEngagementRequirementAssessmentInput(value) {
  const allowedKeys = new Set(["organizationId", "engagementId", "requirementId", "actorContext"]);
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedKeys)) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.engagementId) &&
    isNonEmptyString(value.requirementId) &&
    isPlainObject(value.actorContext)
  );
}

/**
 * Resolves the Package 2B + Package 1A prerequisite gate for exactly one
 * (organizationId, engagementId, requirementId) triple. Returns
 * { ok: true, requirementSetId } once every condition holds, or
 * { ok: false, reason } naming exactly which condition failed - never a
 * partial/ambiguous result. Fails closed: any missing/unmatched governed
 * fact is a failure, never a default allow.
 */
async function resolveEngagementApplicabilityGate({ organizationId, engagementId, requirementId }, dependencies) {
  const {
    getEngagement,
    listApplicability,
    getRequirementSetId,
    getRequirementSetAuthority: getAuthority,
    serializeEngagementTarget,
    isExternalAuthoritativeRequirementSet,
    rowMatchesTarget,
    isCurrentReviewedApplicability,
  } = dependencies;

  const engagement = await getEngagement({ organizationId, engagementId });
  if (!engagement) return { ok: false, reason: "engagement_not_found" };

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId, engagement_id: engagementId },
    engagementRecord: engagement,
  });
  if (tenant.severity === "blocker") return { ok: false, reason: "tenant_boundary_violation", tenant };

  const target = serializeEngagementTarget(engagement).requirement_target;
  if (!target || Object.keys(target).length === 0) {
    return { ok: false, reason: "no_target_selected" };
  }

  const requirementSetLookup = await getRequirementSetId({ requirementId });
  if (!requirementSetLookup) return { ok: false, reason: "requirement_not_found" };
  const requirementSetId = requirementSetLookup.requirement_set_id;

  const authority = await getAuthority({ requirementSetId });
  if (!authority) return { ok: false, reason: "requirement_set_not_found" };

  if (!isExternalAuthoritativeRequirementSet(authority)) {
    return { ok: false, reason: "requirement_set_not_authoritative_external" };
  }
  if (!rowMatchesTarget(authority, target)) {
    return { ok: false, reason: "requirement_set_target_mismatch" };
  }

  const applicabilityRows = await listApplicability({ organizationId, engagementId });
  const currentApplicableRow = applicabilityRows.find((row) =>
    row.requirement_set_id === requirementSetId &&
    row.applicability_effective_state === "applicable" &&
    isCurrentReviewedApplicability(row, target),
  );
  if (!currentApplicableRow) {
    return { ok: false, reason: "applicability_not_current_applicable" };
  }

  return { ok: true, requirementSetId, target };
}

function gateFailureToKaiError(gateResult) {
  if (gateResult.reason === "engagement_not_found" || gateResult.reason === "requirement_not_found" || gateResult.reason === "requirement_set_not_found") {
    return buildKaiError("not_found");
  }
  if (gateResult.reason === "tenant_boundary_violation") {
    return buildKaiError("tenant_boundary_violation", { blockers: [gateResult.tenant] });
  }
  return buildKaiError("engagement_requirement_applicability_not_confirmed");
}

export async function assessEngagementRequirement(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isAssessEngagementRequirementInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    ASSESS_ENGAGEMENT_REQUIREMENT_OPERATION,
    input.organizationId,
    { allowedRoles: ASSESS_ENGAGEMENT_REQUIREMENT_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const gateDependencies = {
    getEngagement: dependencies.getEngagementForOrganization || getEngagementForOrganization,
    listApplicability: dependencies.listEngagementRequirementSetsForOrganization || listEngagementRequirementSetsForOrganization,
    getRequirementSetId: dependencies.getRequirementSetIdForRequirement || getRequirementSetIdForRequirement,
    getRequirementSetAuthority: dependencies.getRequirementSetAuthority || getRequirementSetAuthority,
    serializeEngagementTarget: dependencies.serializeEngagementTarget || __engagementContextServiceTestables.serializeEngagementTarget,
    isExternalAuthoritativeRequirementSet: dependencies.isExternalAuthoritativeRequirementSet || __engagementContextServiceTestables.isExternalAuthoritativeRequirementSet,
    rowMatchesTarget: dependencies.rowMatchesTarget || __engagementContextServiceTestables.rowMatchesTarget,
    isCurrentReviewedApplicability: dependencies.isCurrentReviewedApplicability || __engagementContextServiceTestables.isCurrentReviewedApplicability,
  };

  const gate = await resolveEngagementApplicabilityGate(
    { organizationId: input.organizationId, engagementId: input.engagementId, requirementId: input.requirementId },
    gateDependencies,
  );
  if (!gate.ok) {
    return gateFailureToKaiError(gate);
  }

  const repository = dependencies.requirementAssessmentRepository || createPostgresRequirementAssessmentRepository();
  const metadataOnlyAudit = dependencies.metadataOnlyAudit || createProductionMetadataOnlyAuditForEngagementRequirementAssessment({
    organizationId: input.organizationId,
    engagementId: input.engagementId,
    requirementId: input.requirementId,
    actorContext,
    now: input.now,
  });

  const result = await repository.assessEngagementRequirement({
    organizationId: input.organizationId,
    engagementId: input.engagementId,
    requirementId: input.requirementId,
    actorUserId: actorContext.actorUserId,
    actorRole: [...ASSESS_ENGAGEMENT_REQUIREMENT_ALLOWED_ROLES].find((role) =>
      (actorContext.kaiRoles || []).includes(role) ||
      (actorContext.organizationMemberships || []).some((membership) => membership.role_name === role),
    ) || "gk_reviewer",
    now: input.now,
    metadataOnlyAudit,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}

export async function getEngagementRequirementAssessment(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isGetEngagementRequirementAssessmentInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    READ_ENGAGEMENT_REQUIREMENT_ASSESSMENT_OPERATION,
    input.organizationId,
    { allowedRoles: READ_ENGAGEMENT_REQUIREMENT_ASSESSMENT_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }

  return readCurrentEngagementRequirementAssessmentForAuthorizedCaller(
    { organizationId: input.organizationId, engagementId: input.engagementId, requirementId: input.requirementId },
    dependencies,
  );
}

/**
 * The CURRENT engagement-scope assessment for one requirement, with no actor
 * authorization of its own: the caller must already have authorized the
 * actor for this organization. getEngagementRequirementAssessment (above)
 * calls it after its own gate; the client-safe Funder Requirements read calls
 * it after its own gate and projects only the assessment state. Same
 * engagement/tenant check, same live Package 2B gate, same
 * recompute-and-compare repository read, same failure codes.
 */
export async function readCurrentEngagementRequirementAssessmentForAuthorizedCaller(input, dependencies = {}) {
  const getEngagement = dependencies.getEngagementForOrganization || getEngagementForOrganization;
  const engagement = await getEngagement({ organizationId: input.organizationId, engagementId: input.engagementId });
  if (!engagement) return buildKaiError("not_found");

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId, engagement_id: input.engagementId },
    engagementRecord: engagement,
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  // Package 3B: a persisted engagement-scope assessment row is only ever a
  // record of what was true when it was written - it is never retroactively
  // re-asserted as still-current authority merely by existing. Before this
  // read can hand a caller "here is the currently usable assessment for this
  // engagement/requirement", it must re-resolve the exact same Package 2B +
  // Package 1A prerequisite gate the write path resolved at write time
  // (resolveEngagementApplicabilityGate, above) against LIVE governed state.
  // If the governing applicability has since been superseded, turned
  // not_applicable, been retired, lost target-context match, or the
  // requirement's requirement-set authority is no longer governed/active
  // (which is how a requirement-set/framework-version transition manifests
  // in this schema - see module comment on resolveEngagementApplicabilityGate
  // for why no separate persisted "version" concept exists to check), this
  // read fails closed with the same gate-failure mapping the write path uses
  // - it never fabricates a null/stale result and never silently swallows
  // the requirement. The underlying kai.requirement_assessments row is never
  // read, mutated, or deleted by this check: this is a read-time currentness
  // gate only, not a write, so historical provenance remains completely
  // intact in persistence regardless of the outcome here.
  const gateDependencies = {
    getEngagement: dependencies.getEngagementForOrganization || getEngagementForOrganization,
    listApplicability: dependencies.listEngagementRequirementSetsForOrganization || listEngagementRequirementSetsForOrganization,
    getRequirementSetId: dependencies.getRequirementSetIdForRequirement || getRequirementSetIdForRequirement,
    getRequirementSetAuthority: dependencies.getRequirementSetAuthority || getRequirementSetAuthority,
    serializeEngagementTarget: dependencies.serializeEngagementTarget || __engagementContextServiceTestables.serializeEngagementTarget,
    isExternalAuthoritativeRequirementSet: dependencies.isExternalAuthoritativeRequirementSet || __engagementContextServiceTestables.isExternalAuthoritativeRequirementSet,
    rowMatchesTarget: dependencies.rowMatchesTarget || __engagementContextServiceTestables.rowMatchesTarget,
    isCurrentReviewedApplicability: dependencies.isCurrentReviewedApplicability || __engagementContextServiceTestables.isCurrentReviewedApplicability,
  };

  const gate = await resolveEngagementApplicabilityGate(
    { organizationId: input.organizationId, engagementId: input.engagementId, requirementId: input.requirementId },
    gateDependencies,
  );
  if (!gate.ok) {
    return gateFailureToKaiError(gate);
  }

  const repository = dependencies.requirementAssessmentRepository || createPostgresRequirementAssessmentRepository();
  const result = await repository.readEngagementRequirementAssessment({
    organizationId: input.organizationId,
    engagementId: input.engagementId,
    requirementId: input.requirementId,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}

export const __engagementRequirementAssessmentServiceContract = Object.freeze({
  ASSESS_ENGAGEMENT_REQUIREMENT_ALLOWED_ROLES,
  ASSESS_ENGAGEMENT_REQUIREMENT_OPERATION,
  READ_ENGAGEMENT_REQUIREMENT_ASSESSMENT_ALLOWED_ROLES,
  READ_ENGAGEMENT_REQUIREMENT_ASSESSMENT_OPERATION,
});

export const __engagementRequirementAssessmentServiceTestables = Object.freeze({
  isAssessEngagementRequirementInput,
  isGetEngagementRequirementAssessmentInput,
  isMappedHumanActor,
  resolveEngagementApplicabilityGate,
  gateFailureToKaiError,
});
