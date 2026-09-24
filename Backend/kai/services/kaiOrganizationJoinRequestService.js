import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_PATTERNS, KAI_SPRINT2_P0_STRING_LIMITS } from "../config/kaiSprint2P0Contract.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { resolveKaiActorContext } from "../auth/kaiActorContext.js";
import { listAuthorizedOrganizations } from "./kaiOrganizationContextService.js";
import { withTransaction } from "../db/kaiDb.js";
import { insertRequiredSuccessfulAuditEvent } from "../db/kaiAuditQueries.js";
import { getActorOrganizationAccess } from "../db/kaiQueries.js";
import {
  getJoinableKaiOrganization,
  getPendingOrganizationJoinRequestForRequester,
  insertPendingOrganizationJoinRequest,
  listOwnOrganizationJoinRequestsWithOrganization,
  searchJoinableKaiOrganizations,
} from "../db/kaiOrganizationJoinRequestQueries.js";

/**
 * JOIN-2 (Join Existing Organization): user self-service discovery, request
 * submission, and own-request status over JOIN-1's
 * kai.organization_join_requests. Ordinary authenticated self-service - no
 * client_admin/GK-admin role is required, because the requester by
 * definition has no access to the target organization yet. Approval,
 * membership creation, and UI are later packages.
 *
 * Identity: the requester is always actorContext.actorUserId from
 * resolveKaiActorContext; no caller-supplied user id is accepted anywhere.
 * The browser supplies only a search term (discovery) or the target KAI
 * organization id (submission). No role is accepted, stored, or returned.
 *
 * Effective access reuses the existing authorized-organization authority
 * (listAuthorizedOrganizations, which already merges internal
 * kai.organization_memberships with derived gk_organization_binding
 * client_admin authority) plus any other active membership carried on the
 * actor context, and submission additionally re-reads the stored
 * kai.organization_memberships rows inside its transaction.
 */
const SUBMIT_ORGANIZATION_JOIN_REQUEST_OPERATION = "submit_organization_join_request";
const SEARCH_TERM_MIN_LENGTH = 2;
const SEARCH_TERM_MAX_LENGTH = KAI_SPRINT2_P0_STRING_LIMITS.displayLabelMaxLength;
const SEARCH_RESULT_LIMIT = 10;

export const ORGANIZATION_JOIN_SUBMISSION_OUTCOMES = Object.freeze({
  CREATED: "created",
  EXISTING_PENDING: "existing_pending",
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isCanonicalUuid(value) {
  return typeof value === "string" && KAI_SPRINT2_P0_PATTERNS.uuid.test(value) && value === value.toLowerCase();
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

function hasOnlyKeys(value, allowedKeys) {
  return isPlainObject(value) && Object.keys(value).every((key) => allowedKeys.has(key));
}

function hasActorSource(value) {
  return isPlainObject(value.actorContext) || isPlainObject(value.req);
}

function joinBlocker(blockingReason, message, requiredFix) {
  return {
    validator_key: "VAL-KAI-ORG-JOIN-001",
    severity: "blocker",
    object_type: "organization_join_request",
    object_code: "organization_id",
    object_id: null,
    message,
    blocking_reason: blockingReason,
    required_fix: requiredFix,
    evidence: {},
  };
}

const BLOCKERS = Object.freeze({
  already_authorized: () =>
    buildKaiError("membership_state_conflict", {
      message: "You already have access to this organization.",
      blockers: [
        joinBlocker(
          "join_request_already_authorized",
          "You already have access to this organization.",
          "Open the organization from your organization list instead of requesting to join.",
        ),
      ],
    }),
  administrator_action_required: () =>
    buildKaiError("membership_state_conflict", {
      message: "An organization administrator must review your existing membership.",
      blockers: [
        joinBlocker(
          "join_request_administrator_action_required",
          "An organization administrator must review your existing membership.",
          "Contact an administrator of this organization to restore your access.",
        ),
      ],
    }),
  organization_not_joinable: () =>
    buildKaiError("not_found", {
      message: "Organization is not available to join.",
      blockers: [
        joinBlocker(
          "join_request_organization_not_joinable",
          "Organization is not available to join.",
          "Choose an organization returned by organization search.",
        ),
      ],
    }),
});

function actorError(actorResult) {
  if (actorResult.error_code === "mapped_kai_user_required") return buildKaiError("mapped_kai_user_required");
  return buildKaiError(actorResult.error_code || "unauthorized");
}

async function resolveMappedHumanActor(input, dependencies) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return { ok: false, error: buildKaiError("feature_disabled") };
  }
  const resolveActor = dependencies.resolveKaiActorContext || resolveKaiActorContext;
  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveActor(input.req, dependencies);
  if (!actorResult.ok) return { ok: false, error: actorError(actorResult) };
  if (!isMappedHumanActor(actorResult.actorContext)) {
    return { ok: false, error: buildKaiError("authorization_denied") };
  }
  return { ok: true, actorContext: actorResult.actorContext };
}

/**
 * Organization ids the actor can already use: the existing authorized-
 * organization authority, plus any other active membership (any role,
 * internal or derived) on the actor context.
 */
async function resolveEffectiveOrganizationIds(actorContext, dependencies) {
  const listOrganizations = dependencies.listAuthorizedOrganizations || listAuthorizedOrganizations;
  const authorized = await listOrganizations({ actorContext }, dependencies);
  if (!authorized.ok) return { ok: false, error: authorized };
  const organizationIds = new Set();
  for (const item of authorized.data?.items || []) {
    if (isNonEmptyString(item?.organization_id)) organizationIds.add(item.organization_id);
  }
  for (const membership of Array.isArray(actorContext.organizationMemberships) ? actorContext.organizationMemberships : []) {
    if (membership?.membership_status === "active" && isNonEmptyString(membership?.organization_id)) {
      organizationIds.add(membership.organization_id);
    }
  }
  return { ok: true, organizationIds };
}

function normalizeSearchTerm(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < SEARCH_TERM_MIN_LENGTH || normalized.length > SEARCH_TERM_MAX_LENGTH) return null;
  return normalized;
}

function serializeJoinableOrganization(row = {}) {
  return {
    organization_id: row.organization_id,
    display_name: row.display_name,
  };
}

function serializeOwnJoinRequest(row = {}, organizationDisplayName = row.organization_display_name) {
  return {
    organization_join_request_id: row.organization_join_request_id,
    organization_id: row.organization_id,
    organization_display_name: organizationDisplayName ?? null,
    status: row.status,
    submitted_at: row.created_at,
    reviewed_at: row.reviewed_at || null,
  };
}

/**
 * Bounded pre-membership discovery: a 2..200 character search term is
 * required (no browse-all), at most SEARCH_RESULT_LIMIT results, only
 * active KAI organizations, only organization_id + display_name, and
 * organizations the actor can already use are excluded.
 */
export async function searchJoinableOrganizations(input = {}, dependencies = {}) {
  if (!hasOnlyKeys(input, new Set(["req", "actorContext", "searchTerm"])) || !hasActorSource(input)) {
    return buildKaiError("validation_blocker");
  }
  const actor = await resolveMappedHumanActor(input, dependencies);
  if (!actor.ok) return actor.error;

  const searchTerm = normalizeSearchTerm(input.searchTerm);
  if (!searchTerm) {
    return buildKaiError("validation_blocker", {
      blockers: [
        joinBlocker(
          "organization_search_term_invalid",
          `Enter between ${SEARCH_TERM_MIN_LENGTH} and ${SEARCH_TERM_MAX_LENGTH} characters to search organizations.`,
          "Provide an organization name search term.",
        ),
      ],
    });
  }

  const effective = await resolveEffectiveOrganizationIds(actor.actorContext, dependencies);
  if (!effective.ok) return effective.error;

  const search = dependencies.searchJoinableKaiOrganizations || searchJoinableKaiOrganizations;
  const rows = await search({
    searchTerm,
    excludeOrganizationIds: [...effective.organizationIds],
    limit: SEARCH_RESULT_LIMIT,
  });
  const items = rows
    .filter((row) => !effective.organizationIds.has(row?.organization_id))
    .slice(0, SEARCH_RESULT_LIMIT)
    .map(serializeJoinableOrganization);
  return { ok: true, data: { items }, error: null };
}

class JoinRequestRaceReplay extends Error {}

/**
 * Submit (or replay) the actor's pending request to join one KAI
 * organization. A new request is inserted and audited in one transaction;
 * an existing pending request is returned unchanged with no new audit.
 * Existing memberships of any status are never created, reactivated, or
 * overwritten here.
 */
export async function submitOrganizationJoinRequest(input = {}, dependencies = {}) {
  if (!hasOnlyKeys(input, new Set(["req", "actorContext", "organizationId"])) || !hasActorSource(input)) {
    return buildKaiError("validation_blocker");
  }
  if (!isCanonicalUuid(input.organizationId)) {
    return buildKaiError("validation_blocker", {
      blockers: [
        joinBlocker(
          "invalid_uuid_field",
          "Organization id is invalid.",
          "Choose an organization returned by organization search.",
        ),
      ],
    });
  }

  const actor = await resolveMappedHumanActor(input, dependencies);
  if (!actor.ok) return actor.error;
  const { actorContext } = actor;
  const organizationId = input.organizationId;
  const requesterUserId = actorContext.actorUserId;

  const effective = await resolveEffectiveOrganizationIds(actorContext, dependencies);
  if (!effective.ok) return effective.error;
  if (effective.organizationIds.has(organizationId)) return BLOCKERS.already_authorized();

  const runInTransaction = dependencies.runInTransaction || withTransaction;
  const getOrganization = dependencies.getJoinableKaiOrganization || getJoinableKaiOrganization;
  const listStoredMemberships = dependencies.getActorOrganizationAccess || getActorOrganizationAccess;
  const getPending = dependencies.getPendingOrganizationJoinRequestForRequester || getPendingOrganizationJoinRequestForRequester;
  const insertRequest = dependencies.insertPendingOrganizationJoinRequest || insertPendingOrganizationJoinRequest;
  const insertAudit = dependencies.insertRequiredSuccessfulAuditEvent || insertRequiredSuccessfulAuditEvent;

  const respond = (outcome, joinRequest, organizationDisplayName) => ({
    ok: true,
    data: { outcome, join_request: serializeOwnJoinRequest(joinRequest, organizationDisplayName) },
    error: null,
  });

  let result;
  try {
    result = await runInTransaction(async (tx) => {
      const organization = await getOrganization({ organizationId }, tx);
      if (!organization) return { blocked: BLOCKERS.organization_not_joinable() };

      const storedMemberships = await listStoredMemberships(requesterUserId, organizationId, tx);
      if (storedMemberships.some((row) => row?.membership_status === "active")) {
        return { blocked: BLOCKERS.already_authorized() };
      }
      if (storedMemberships.length > 0) return { blocked: BLOCKERS.administrator_action_required() };

      const pending = await getPending({ organizationId, requesterUserId }, tx);
      if (pending) {
        return { outcome: ORGANIZATION_JOIN_SUBMISSION_OUTCOMES.EXISTING_PENDING, joinRequest: pending, organization };
      }

      const insertResult = await insertRequest({ organizationId, requesterUserId }, tx);
      if (!insertResult.ok) {
        if (insertResult.error_code === "pending_request_exists") throw new JoinRequestRaceReplay();
        const error = new Error(insertResult.error_code || "system_error");
        error.kaiErrorCode = insertResult.error_code === "invalid_reference" ? "validation_blocker" : "system_error";
        throw error;
      }

      const auditResult = await insertAudit(
        {
          operation: SUBMIT_ORGANIZATION_JOIN_REQUEST_OPERATION,
          operation_type: SUBMIT_ORGANIZATION_JOIN_REQUEST_OPERATION,
          reason_code: "organization_join_request_submitted",
          object_type: "other",
          target_object_type: "organization_join_request",
          object_id: insertResult.joinRequest.organization_join_request_id,
          organization_id: organizationId,
          actor_type: actorContext.actorType,
          actor_user_id: requesterUserId,
          new_status: "pending",
          created_by_service: "kaiOrganizationJoinRequestService",
          metadata_only: true,
        },
        tx,
      );
      if (!auditResult?.ok) {
        const error = new Error("required audit rejected");
        error.kaiErrorCode = "audit_payload_rejected";
        throw error;
      }

      return { outcome: ORGANIZATION_JOIN_SUBMISSION_OUTCOMES.CREATED, joinRequest: insertResult.joinRequest, organization };
    });
  } catch (error) {
    if (error instanceof JoinRequestRaceReplay) {
      // A concurrent submission won the one-pending unique index; that
      // transaction rolled back, so replay the winner's pending row.
      const pending = await getPending({ organizationId, requesterUserId });
      if (!pending) return buildKaiError("conflict_current_state_changed");
      const organization = await getOrganization({ organizationId });
      return respond(ORGANIZATION_JOIN_SUBMISSION_OUTCOMES.EXISTING_PENDING, pending, organization?.display_name);
    }
    if (error?.kaiErrorCode) return buildKaiError(error.kaiErrorCode);
    throw error;
  }

  if (result.blocked) return result.blocked;
  return respond(result.outcome, result.joinRequest, result.organization.display_name);
}

/** The actor's own join requests only; no reviewer identity is returned. */
export async function listMyOrganizationJoinRequests(input = {}, dependencies = {}) {
  if (!hasOnlyKeys(input, new Set(["req", "actorContext"])) || !hasActorSource(input)) {
    return buildKaiError("validation_blocker");
  }
  const actor = await resolveMappedHumanActor(input, dependencies);
  if (!actor.ok) return actor.error;

  const listOwn = dependencies.listOwnOrganizationJoinRequestsWithOrganization || listOwnOrganizationJoinRequestsWithOrganization;
  const rows = await listOwn({ requesterUserId: actor.actorContext.actorUserId });
  return { ok: true, data: { items: rows.map((row) => serializeOwnJoinRequest(row)) }, error: null };
}

export const __organizationJoinRequestServiceContract = Object.freeze({
  SUBMIT_ORGANIZATION_JOIN_REQUEST_OPERATION,
  SEARCH_TERM_MIN_LENGTH,
  SEARCH_TERM_MAX_LENGTH,
  SEARCH_RESULT_LIMIT,
});
