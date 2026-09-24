// JOIN-4 Join Existing Organization: pure path/state/copy helpers shared by
// the Impact Library join UI (frontend/impactLibrary/OrganizationJoinPanel.jsx,
// frontend/ImpactLibraryApp.jsx) and the /admin KAI Access join-request
// review section (frontend/adminDashboard.jsx). Network calls are made by
// those components with their existing fetch helpers; this module holds
// only what is safe and useful to unit-test without rendering React.
//
// The backend (JOIN-2 kaiOrganizationJoinRequestService.js, JOIN-3
// kaiOrganizationJoinRequestReviewService.js) is the only authority for who
// may search, request, or review. Nothing here infers authorization, builds
// a requester/reviewer identity, or carries a role.

const INTAKE_BASE_PATH = "/api/kai/sprint2/intake";
const ACCESS_ADMINISTRATION_BASE_PATH = "/api/kai/sprint2/access-administration";

// Mirrors kaiOrganizationJoinRequestService.js SEARCH_TERM_MIN_LENGTH /
// SEARCH_TERM_MAX_LENGTH; the backend still validates.
export const JOIN_SEARCH_MIN_LENGTH = 2;
export const JOIN_SEARCH_MAX_LENGTH = 200;
export const JOIN_SEARCH_DEBOUNCE_MS = 300;

export function normalizeJoinSearchTerm(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < JOIN_SEARCH_MIN_LENGTH || normalized.length > JOIN_SEARCH_MAX_LENGTH) return null;
  return normalized;
}

export function joinableOrganizationsSearchPath(searchTerm) {
  const normalized = normalizeJoinSearchTerm(searchTerm);
  if (!normalized) return null;
  return `${INTAKE_BASE_PATH}/admin/organization-join/organizations?q=${encodeURIComponent(normalized)}`;
}

export function organizationJoinRequestsPath() {
  return `${INTAKE_BASE_PATH}/admin/organization-join/requests`;
}

export function myOrganizationJoinRequestsPath() {
  return `${INTAKE_BASE_PATH}/admin/organization-join/requests/mine`;
}

// The one request body the browser ever sends: the organization id chosen
// from search results. Never a requester id, role, or status.
export function buildOrganizationJoinRequestBody(organizationId) {
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new Error("organization_id is required");
  }
  return { organization_id: organizationId };
}

export function kaiOrganizationJoinRequestsReviewPath(kaiOrganizationId) {
  return `${ACCESS_ADMINISTRATION_BASE_PATH}/organizations/${encodeURIComponent(kaiOrganizationId)}/join-requests`;
}

export function kaiOrganizationJoinRequestDecisionPath(kaiOrganizationId, organizationJoinRequestId, decision) {
  if (decision !== "approve" && decision !== "decline") throw new Error(`unsupported decision: ${decision}`);
  return `${kaiOrganizationJoinRequestsReviewPath(kaiOrganizationId)}/${encodeURIComponent(organizationJoinRequestId)}/${decision}`;
}

/** Only the two backend-supplied fields are kept for display. */
export function toJoinSearchResults(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => typeof item?.organization_id === "string" && typeof item?.display_name === "string")
    .map((item) => ({ organization_id: item.organization_id, display_name: item.display_name }));
}

function requestTime(request) {
  const parsed = Date.parse(request?.submitted_at || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Derives the join-request states to show from the user's own requests and
 * the authorized organization list. The authorized list is the only
 * authority for usable access: approved requests never create a parallel
 * state, and a pending request for an organization the user can already use
 * is reported only as "stale" (awaiting administrator cleanup), never as a
 * waiting state that blocks selection. Only the latest request per
 * organization counts, so a newer request supersedes an older declined one.
 */
export function deriveJoinRequestView({ requests = [], authorizedOrganizationIds = [] } = {}) {
  const authorized = new Set(authorizedOrganizationIds);
  const latestByOrganization = new Map();
  for (const request of Array.isArray(requests) ? requests : []) {
    if (typeof request?.organization_id !== "string") continue;
    const current = latestByOrganization.get(request.organization_id);
    if (!current || requestTime(request) > requestTime(current)) latestByOrganization.set(request.organization_id, request);
  }
  const view = { pending: [], declined: [], stalePending: [], pendingOrganizationIds: [] };
  for (const request of latestByOrganization.values()) {
    const entry = {
      organization_join_request_id: request.organization_join_request_id,
      organization_id: request.organization_id,
      organization_display_name: request.organization_display_name || "",
      status: request.status,
      submitted_at: request.submitted_at || null,
      reviewed_at: request.reviewed_at || null,
    };
    if (request.status === "pending") {
      view.pendingOrganizationIds.push(request.organization_id);
      if (authorized.has(request.organization_id)) view.stalePending.push(entry);
      else view.pending.push(entry);
    } else if (request.status === "declined" && !authorized.has(request.organization_id)) {
      view.declined.push(entry);
    }
  }
  const newestFirst = (a, b) => requestTime(b) - requestTime(a);
  view.pending.sort(newestFirst);
  view.declined.sort(newestFirst);
  view.stalePending.sort(newestFirst);
  return view;
}

function organizationLabel(name) {
  return typeof name === "string" && name.trim() ? name.trim() : "this organization";
}

export function pendingJoinRequestMessage(organizationDisplayName) {
  return `Your request to join ${organizationLabel(organizationDisplayName)} is waiting for approval.`;
}

export function declinedJoinRequestMessage(organizationDisplayName) {
  return `Your request to join ${organizationLabel(organizationDisplayName)} was not approved. You can search again and send a new request.`;
}

export function stalePendingJoinRequestMessage(organizationDisplayName) {
  return `You already have access to ${organizationLabel(organizationDisplayName)}. An earlier join request is still listed as pending and is waiting for administrator cleanup.`;
}

function blockingReason(body) {
  const blockers = Array.isArray(body?.blockers) ? body.blockers : [];
  return typeof blockers[0]?.blocking_reason === "string" ? blockers[0].blocking_reason : "";
}

const GENERIC_ERROR = "Something went wrong. Please try again.";

/** Concise, user-facing copy for a failed search; never raw backend text. */
export function describeJoinSearchError({ statusCode, body } = {}) {
  if (statusCode === 422 || body?.error?.code === "validation_blocker") {
    return `Enter at least ${JOIN_SEARCH_MIN_LENGTH} characters of the organization name.`;
  }
  if (statusCode === 401 || statusCode === 403) return "Your account can't search organizations right now.";
  return GENERIC_ERROR;
}

/** Concise, user-facing copy for a failed join-request submission. */
export function describeJoinSubmissionError({ statusCode, body } = {}) {
  const reason = blockingReason(body);
  if (reason === "join_request_already_authorized") return "You already have access to this organization.";
  if (reason === "join_request_administrator_action_required") {
    return "An administrator of this organization needs to review your existing access before you can join.";
  }
  if (reason === "join_request_organization_not_joinable" || statusCode === 404) {
    return "That organization is not available to join. Try searching again.";
  }
  if (statusCode === 400 || statusCode === 422) return "Choose an organization from the search results.";
  if (statusCode === 401 || statusCode === 403) return "Your account can't send join requests right now.";
  return GENERIC_ERROR;
}

/** Admin review: user-facing copy for a failed approve/decline. */
export function describeJoinReviewError({ status, code, blockingReason: reason } = {}) {
  if (reason === "join_request_requester_already_authorized") {
    return "This person already has access to the organization, so nothing was changed. The request is still pending.";
  }
  if (reason === "join_request_administrator_action_required") {
    return "This person has an existing non-active membership. Manage it in the access list instead of approving the request.";
  }
  if (reason === "join_request_membership_state_conflict") {
    return "This person's stored membership is ambiguous. Resolve it in the access list first.";
  }
  if (reason === "join_request_self_review_denied") return "You can't review your own join request.";
  if (status === 409 || code === "conflict_current_state_changed") {
    return "This request has already changed. The list has been refreshed.";
  }
  if (status === 404) return "This request is no longer in this organization's queue. The list has been refreshed.";
  if (status === 401 || status === 403) return "You are not authorized to review join requests for this organization.";
  return "Unable to update the join request. Please try again.";
}

export function shouldRefreshJoinQueueAfterError(status) {
  return status === 404 || status === 409;
}
