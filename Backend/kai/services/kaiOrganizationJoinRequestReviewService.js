import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import {
  KAI_ACCESS_ADMINISTRATION_OPERATIONS,
  KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS,
} from "../config/kaiAccessAdministrationContract.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { withTransaction } from "../db/kaiDb.js";
import { insertRequiredSuccessfulAuditEvent } from "../db/kaiAuditQueries.js";
import { listOrganizationMembershipRowsForUserInOrganization } from "../db/kaiAccessAdministrationQueries.js";
import {
  getActiveGkOrganizationIdForKaiOrganization,
  listActiveGkOrganizationAdminLegacyUserIds,
} from "../auth/gkOrganizationAdminQueries.js";
import {
  getOrganizationJoinRequestForDecisionForUpdate,
  listPendingOrganizationJoinRequestsForReview,
  recordOrganizationJoinRequestDecision,
} from "../db/kaiOrganizationJoinRequestQueries.js";
import { applyOrganizationMembershipChangeInTransaction } from "./kaiAccessAdministrationService.js";

/**
 * JOIN-3 (Join Existing Organization): administrator review of pending
 * kai.organization_join_requests.
 *
 * Reviewer authority is the existing access-administration authority, not a
 * new reviewer-role system: validateActorCanPerformOperation with the same
 * client_admin allowed-role set kaiAccessAdministrationService.js uses, so
 * (a) actorContext.platformSuperuser (existing Get Kinder site-admin
 * authority) may act on any explicit organization, and (b) otherwise only an
 * effective active client_admin of the exact organization - stored or
 * derived through the GK->KAI binding, both already merged into
 * actorContext.organizationMemberships by resolveKaiActorContext. A global
 * kai.user_roles role alone does not satisfy it. The queue read uses
 * VIEW_KAI_ACCESS; approve/decline use MANAGE_ORGANIZATION_MEMBERSHIP.
 *
 * A requester may never decide their own request, whatever authority they
 * hold (checked here before any mutation; JOIN-1's no-self-review CHECK
 * remains the database backstop).
 *
 * Approval creates exactly one server-fixed active client_contributor
 * membership through the access-administration membership core
 * (applyOrganizationMembershipChangeInTransaction, onlyCreate) inside the
 * same transaction as JOIN-1's pending-only decision CAS and the decision
 * audit. It never replaces, downgrades, or reactivates an existing
 * membership: any current access or stored membership leaves the request
 * pending and returns a structured current-state conflict.
 */
const { VIEW_KAI_ACCESS, MANAGE_ORGANIZATION_MEMBERSHIP } = KAI_ACCESS_ADMINISTRATION_OPERATIONS;
const REVIEWER_ALLOWED_ROLES = new Set(["client_admin"]);
const APPROVED_MEMBERSHIP_ROLE_NAME = "client_contributor";
const APPROVED_MEMBERSHIP_STATUS = KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS;
const APPROVE_OPERATION = "approve_organization_join_request";
const DECLINE_OPERATION = "decline_organization_join_request";
const SERVICE_NAME = "kaiOrganizationJoinRequestReviewService";

function isCanonicalUuid(value) {
  return typeof value === "string" && KAI_SPRINT2_P0_PATTERNS.uuid.test(value) && value === value.toLowerCase();
}

function isNormalizedNow(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function failure(code, blockers) {
  return { ok: false, data: null, error: { code }, ...(blockers ? { blockers } : {}) };
}

function success(data) {
  return { ok: true, data, error: null, warnings: [] };
}

function blocker(blockingReason, message, requiredFix) {
  return {
    validator_key: "VAL-KAI-ORG-JOIN-002",
    severity: "blocker",
    object_type: "organization_join_request",
    object_code: "organization_join_request_id",
    object_id: null,
    message,
    blocking_reason: blockingReason,
    required_fix: requiredFix,
    evidence: {},
  };
}

const BLOCKED = Object.freeze({
  notFound: () => failure("not_found", [
    blocker("join_request_not_found", "Join request not found for this organization.", "Use a pending join request from this organization's queue."),
  ]),
  selfReview: () => failure("authorization_denied", [
    blocker("join_request_self_review_denied", "You cannot review your own join request.", "Another authorized administrator must review this request."),
  ]),
  notPending: () => failure("conflict_current_state_changed", [
    blocker("join_request_not_pending", "This join request has already been decided.", "Refresh the queue; decided requests cannot be changed."),
  ]),
  requesterAlreadyAuthorized: () => failure("membership_state_conflict", [
    blocker(
      "join_request_requester_already_authorized",
      "The requester already has access to this organization.",
      "No approval is needed; the request remains pending for an administrator to decline or leave.",
    ),
  ]),
  administratorActionRequired: () => failure("membership_state_conflict", [
    blocker(
      "join_request_administrator_action_required",
      "The requester has an existing non-active membership in this organization.",
      "Manage the existing membership through access administration instead of join approval.",
    ),
  ]),
  membershipStateConflict: () => failure("membership_state_conflict", [
    blocker(
      "join_request_membership_state_conflict",
      "The requester's stored membership state is ambiguous.",
      "Resolve the requester's stored memberships through access administration.",
    ),
  ]),
});

class DecisionRollback extends Error {
  constructor(result) {
    super("organization join request decision rolled back");
    this.result = result;
  }
}

function preflight({ actorContext, organizationId, organizationJoinRequestId, now }, operation, dependencies, { requireRequest }) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) return { error: failure("feature_disabled") };
  if (actorContext?.actorType !== "human") return { error: failure("authorization_denied") };
  if (!isCanonicalUuid(organizationId)) return { error: failure("validation_blocker") };
  if (requireRequest && (!isCanonicalUuid(organizationJoinRequestId) || !isNormalizedNow(now))) {
    return { error: failure("validation_blocker") };
  }
  const auth = validateActorCanPerformOperation(actorContext, operation, organizationId, {
    allowedRoles: REVIEWER_ALLOWED_ROLES,
  });
  if (!auth.ok) {
    return { error: { ok: false, data: null, error: { code: auth.error_code }, blockers: auth.blockers || [] } };
  }
  return { auth };
}

function serializeDecision(row, membership = null) {
  return {
    organization_join_request_id: row.organization_join_request_id,
    organization_id: row.organization_id,
    requester_user_id: row.requester_user_id,
    status: row.status,
    submitted_at: row.created_at,
    reviewed_at: row.reviewed_at || null,
    reviewed_by_user_id: row.reviewed_by_user_id || null,
    ...(membership ? { membership } : {}),
  };
}

/** Pending join requests for ONE organization, for an authorized reviewer. */
export async function listPendingOrganizationJoinRequestsForReviewer(
  { actorContext, organizationId } = {},
  dependencies = {},
) {
  const checked = preflight({ actorContext, organizationId }, VIEW_KAI_ACCESS, dependencies, { requireRequest: false });
  if (checked.error) return checked.error;

  const listPending = dependencies.listPendingOrganizationJoinRequestsForReview || listPendingOrganizationJoinRequestsForReview;
  const rows = await listPending({ organizationId });
  return success({
    organization_id: organizationId,
    items: rows
      .filter((row) => row.organization_id === organizationId && row.status === "pending")
      .map((row) => ({
        organization_join_request_id: row.organization_join_request_id,
        organization_id: row.organization_id,
        requester_user_id: row.requester_user_id,
        requester_email: row.requester_email || null,
        status: row.status,
        submitted_at: row.created_at,
      })),
  });
}

/**
 * Locked read + tenant/self-review/terminal checks shared by approve and
 * decline. Returns { request } or { blocked }.
 */
async function loadPendingRequestForDecision(tx, { actorContext, organizationId, organizationJoinRequestId }, dependencies) {
  const getForUpdate = dependencies.getOrganizationJoinRequestForDecisionForUpdate || getOrganizationJoinRequestForDecisionForUpdate;
  const request = await getForUpdate({ organizationJoinRequestId }, tx);
  if (!request || request.organization_id !== organizationId) return { blocked: BLOCKED.notFound() };
  if (request.requester_user_id === actorContext.actorUserId) return { blocked: BLOCKED.selfReview() };
  if (request.status !== "pending") return { blocked: BLOCKED.notPending() };
  return { request };
}

/**
 * Approval-time recheck of the requester's current state (it may have
 * changed while the request was pending). Returns a blocked result or null.
 */
async function recheckRequesterCurrentState(tx, request, organizationId, dependencies) {
  if (request.requester_kai_user_status !== "active") return BLOCKED.administratorActionRequired();

  const listRows = dependencies.listOrganizationMembershipRowsForUserInOrganization || listOrganizationMembershipRowsForUserInOrganization;
  const storedRows = await listRows(organizationId, request.requester_user_id, tx);
  if (storedRows.length > 1) return BLOCKED.membershipStateConflict();
  if (storedRows.length === 1) {
    return storedRows[0].membership_status === KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS
      ? BLOCKED.requesterAlreadyAuthorized()
      : BLOCKED.administratorActionRequired();
  }

  // Derived GK->KAI client_admin authority is never a stored row; detect it
  // through the same binding + GK org-admin roster the access-administration
  // effective-access read uses.
  const getGkOrganizationId =
    dependencies.getActiveGkOrganizationIdForKaiOrganization || getActiveGkOrganizationIdForKaiOrganization;
  const listGkAdmins = dependencies.listActiveGkOrganizationAdminLegacyUserIds || listActiveGkOrganizationAdminLegacyUserIds;
  const gkOrganizationId = await getGkOrganizationId(organizationId, tx);
  if (gkOrganizationId) {
    const legacyId = Number(request.requester_legacy_public_userdata_id);
    const adminLegacyIds = await listGkAdmins(gkOrganizationId, tx);
    if (Number.isInteger(legacyId) && adminLegacyIds.includes(legacyId)) return BLOCKED.requesterAlreadyAuthorized();
  }
  return null;
}

function decisionFailureToResult(decision) {
  if (decision.error_code === "join_request_not_pending") return BLOCKED.notPending();
  if (decision.error_code === "self_review_not_permitted") return BLOCKED.selfReview();
  return failure("system_error");
}

async function insertDecisionAudit(tx, { actorContext, request, toState, membership }, dependencies, operation) {
  const insertAudit = dependencies.insertRequiredSuccessfulAuditEvent || insertRequiredSuccessfulAuditEvent;
  const auditResult = await insertAudit(
    {
      operation,
      operation_type: operation,
      reason_code: toState === "approved" ? "organization_join_request_approved" : "organization_join_request_declined",
      object_type: "other",
      target_object_type: "organization_join_request",
      object_id: request.organization_join_request_id,
      organization_id: request.organization_id,
      target_user_id: request.requester_user_id,
      actor_type: actorContext.actorType,
      actor_user_id: actorContext.actorUserId,
      from_state: "pending",
      to_state: toState,
      ...(membership
        ? {
            resulting_role_name: membership.role_name,
            resulting_membership_status: membership.membership_status,
          }
        : {}),
      created_by_service: SERVICE_NAME,
      metadata_only: true,
    },
    tx,
  );
  if (!auditResult?.ok) throw new DecisionRollback(failure("audit_payload_rejected"));
}

async function runDecision(work, dependencies) {
  const runInTransaction = dependencies.runInTransaction || withTransaction;
  try {
    return await runInTransaction(work);
  } catch (error) {
    if (error instanceof DecisionRollback) return error.result;
    if (error?.code === "23514" || error?.code === "22P02") return failure("validation_blocker");
    return failure("system_error");
  }
}

/**
 * Approve: one transaction - locked pending request -> tenant/self-review
 * checks -> requester current-state recheck -> access-administration
 * membership core creates active client_contributor (+ its membership
 * audit) -> JOIN-1 pending-only CAS to approved -> decision audit -> COMMIT.
 * Any failure after a write rolls everything back.
 */
export async function approveOrganizationJoinRequest(
  { actorContext, organizationId, organizationJoinRequestId, now } = {},
  dependencies = {},
) {
  const checked = preflight(
    { actorContext, organizationId, organizationJoinRequestId, now },
    MANAGE_ORGANIZATION_MEMBERSHIP,
    dependencies,
    { requireRequest: true },
  );
  if (checked.error) return checked.error;
  const platformSuperuserAuthorized = Boolean(checked.auth.platformSuperuserAuthorized);

  const applyMembership =
    dependencies.applyOrganizationMembershipChangeInTransaction || applyOrganizationMembershipChangeInTransaction;
  const recordDecision = dependencies.recordOrganizationJoinRequestDecision || recordOrganizationJoinRequestDecision;

  return runDecision(async (tx) => {
    const loaded = await loadPendingRequestForDecision(tx, { actorContext, organizationId, organizationJoinRequestId }, dependencies);
    if (loaded.blocked) return loaded.blocked;
    const { request } = loaded;

    const currentStateBlock = await recheckRequesterCurrentState(tx, request, organizationId, dependencies);
    if (currentStateBlock) return currentStateBlock;

    const membershipResult = await applyMembership(
      tx,
      {
        actorContext,
        organizationId,
        targetUserId: request.requester_user_id,
        roleName: APPROVED_MEMBERSHIP_ROLE_NAME,
        membershipStatus: APPROVED_MEMBERSHIP_STATUS,
        now,
        platformSuperuserAuthorized,
        onlyCreate: true,
      },
      dependencies,
    );
    if (!membershipResult.ok) {
      throw new DecisionRollback(
        membershipResult.error?.code === "membership_state_conflict" ? BLOCKED.membershipStateConflict() : membershipResult,
      );
    }
    if (!membershipResult.data?.mutated) throw new DecisionRollback(BLOCKED.membershipStateConflict());

    const decision = await recordDecision(
      { organizationId, organizationJoinRequestId, decision: "approved", reviewerUserId: actorContext.actorUserId },
      tx,
    );
    if (!decision.ok) throw new DecisionRollback(decisionFailureToResult(decision));

    const membership = { role_name: APPROVED_MEMBERSHIP_ROLE_NAME, membership_status: APPROVED_MEMBERSHIP_STATUS };
    await insertDecisionAudit(tx, { actorContext, request, toState: "approved", membership }, dependencies, APPROVE_OPERATION);
    return success(serializeDecision(decision.joinRequest, membership));
  }, dependencies);
}

/**
 * Decline: one transaction - locked pending request -> tenant/self-review
 * checks -> JOIN-1 pending-only CAS to declined -> decision audit -> COMMIT.
 * No organization membership is read for mutation, created, or changed.
 */
export async function declineOrganizationJoinRequest(
  { actorContext, organizationId, organizationJoinRequestId, now } = {},
  dependencies = {},
) {
  const checked = preflight(
    { actorContext, organizationId, organizationJoinRequestId, now },
    MANAGE_ORGANIZATION_MEMBERSHIP,
    dependencies,
    { requireRequest: true },
  );
  if (checked.error) return checked.error;

  const recordDecision = dependencies.recordOrganizationJoinRequestDecision || recordOrganizationJoinRequestDecision;

  return runDecision(async (tx) => {
    const loaded = await loadPendingRequestForDecision(tx, { actorContext, organizationId, organizationJoinRequestId }, dependencies);
    if (loaded.blocked) return loaded.blocked;

    const decision = await recordDecision(
      { organizationId, organizationJoinRequestId, decision: "declined", reviewerUserId: actorContext.actorUserId },
      tx,
    );
    if (!decision.ok) throw new DecisionRollback(decisionFailureToResult(decision));

    await insertDecisionAudit(tx, { actorContext, request: loaded.request, toState: "declined" }, dependencies, DECLINE_OPERATION);
    return success(serializeDecision(decision.joinRequest));
  }, dependencies);
}

export const __organizationJoinRequestReviewServiceContract = Object.freeze({
  REVIEWER_ALLOWED_ROLES,
  LIST_OPERATION: VIEW_KAI_ACCESS,
  APPROVED_MEMBERSHIP_ROLE_NAME,
  APPROVED_MEMBERSHIP_STATUS,
  APPROVE_OPERATION,
  DECLINE_OPERATION,
});
