import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { listClientFollowupWorkflowsForOrganization } from "../db/kaiIntakeQueries.js";

/**
 * KAI P2-11 client-reviewer-facing read companion: the smallest authorized
 * read of CURRENT `client_followup` review-queue workflow state, scoped to
 * exactly the same role - `client_reviewer` - as the P2-11 completion service
 * (Backend/kai/services/kaiClientFollowupCompletionService.js). Never exposes
 * raw evidence, claim text beyond the already-established-safe dimension_key/
 * question_text, source rows, answer values, free text, rationale, PII, or
 * unrestricted queue/audit metadata (queue_metadata, assigned_to are never
 * selected). This never mutates anything.
 */
const LIST_CLIENT_FOLLOWUP_WORKFLOWS_ALLOWED_ROLES = new Set(["client_reviewer"]);
const LIST_CLIENT_FOLLOWUP_WORKFLOWS_OPERATION = "list_client_followup_workflows";

/**
 * Assistant-specific read boundary for the impact_evidence_library KAI
 * surface. This is NOT the P2-11 client_reviewer read above - it is a
 * separate authorization boundary (gk_admin/gk_operator/gk_reviewer, the
 * same role set already governing the other three Impact Library tools and
 * already governing this same follow-up state as surfaced per-claim by
 * get_claim_traceability_summary) layered over the *same* tenant-scoped
 * query and DTO shape, so the P2-11 client_reviewer route/service keeps its
 * original role boundary and route semantics untouched.
 */
const IMPACT_LIBRARY_CLIENT_FOLLOWUP_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const LIST_CLIENT_FOLLOWUP_WORKFLOWS_FOR_IMPACT_LIBRARY_OPERATION =
  "list_client_followup_workflows_impact_library";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

function isListClientFollowupWorkflowsInput(value) {
  const allowedKeys = new Set(["organizationId", "actorContext"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  return isNonEmptyString(value.organizationId) && isPlainObject(value.actorContext);
}

function toSafeWorkflow(row) {
  return {
    claim_id: row.claim_id,
    client_followup_item_id: row.client_followup_item_id,
    dimension_key: row.dimension_key,
    question_text: row.question_text,
    review_queue_item_id: row.review_queue_item_id,
    queue_status: row.queue_status,
    review_status: row.review_status,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export async function listClientFollowupWorkflows(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isListClientFollowupWorkflowsInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    LIST_CLIENT_FOLLOWUP_WORKFLOWS_OPERATION,
    input.organizationId,
    { allowedRoles: LIST_CLIENT_FOLLOWUP_WORKFLOWS_ALLOWED_ROLES },
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

  const listWorkflows = dependencies.listClientFollowupWorkflowsForOrganization || listClientFollowupWorkflowsForOrganization;
  const rows = await listWorkflows({ organizationId: input.organizationId });

  return { ok: true, data: { items: rows.map(toSafeWorkflow) }, error: null };
}

export async function listClientFollowupWorkflowsForImpactLibrary(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isListClientFollowupWorkflowsInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    LIST_CLIENT_FOLLOWUP_WORKFLOWS_FOR_IMPACT_LIBRARY_OPERATION,
    input.organizationId,
    { allowedRoles: IMPACT_LIBRARY_CLIENT_FOLLOWUP_ALLOWED_ROLES },
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

  const listWorkflows = dependencies.listClientFollowupWorkflowsForOrganization || listClientFollowupWorkflowsForOrganization;
  const rows = await listWorkflows({ organizationId: input.organizationId });

  return { ok: true, data: { items: rows.map(toSafeWorkflow) }, error: null };
}

export const __clientFollowupReadServiceContract = Object.freeze({
  LIST_CLIENT_FOLLOWUP_WORKFLOWS_ALLOWED_ROLES,
  LIST_CLIENT_FOLLOWUP_WORKFLOWS_OPERATION,
  IMPACT_LIBRARY_CLIENT_FOLLOWUP_ALLOWED_ROLES,
  LIST_CLIENT_FOLLOWUP_WORKFLOWS_FOR_IMPACT_LIBRARY_OPERATION,
});

export const __clientFollowupReadServiceTestables = Object.freeze({
  isListClientFollowupWorkflowsInput,
  isMappedHumanActor,
  toSafeWorkflow,
});
