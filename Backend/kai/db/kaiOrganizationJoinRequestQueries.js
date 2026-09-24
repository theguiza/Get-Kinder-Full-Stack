import pool from "./kaiDb.js";

/**
 * JOIN-1 repository primitives for kai.organization_join_requests
 * (migrations/kai_sprint2_join_1_organization_join_requests.sql).
 *
 * Every read/write is keyed by the authoritative kai.organizations
 * organization_id and the requester's kai.users user_id - never by an
 * organization name. No requested role is accepted or stored. Approving a
 * request here only records the decision; creating the resulting
 * kai.organization_memberships row is a later package's responsibility.
 *
 * Every function accepts an optional `db` (a pool or an already-open
 * transaction client) so a later service can compose these with its own
 * authorization read, membership write, and required audit in one
 * transaction.
 */

export const ORGANIZATION_JOIN_REQUEST_STATUSES = Object.freeze(["pending", "approved", "declined"]);
export const ORGANIZATION_JOIN_REQUEST_DECISIONS = Object.freeze(["approved", "declined"]);

const ORGANIZATION_JOIN_REQUEST_COLUMNS = `
  organization_join_request_id,
  organization_id,
  requester_user_id,
  status,
  created_at,
  reviewed_at,
  reviewed_by_user_id,
  updated_at
`;

const ORGANIZATION_JOIN_REQUEST_LIST_MAX_LIMIT = 100;
const ORGANIZATION_JOIN_REQUEST_LIST_DEFAULT_LIMIT = 50;

function boundedListLimit(limit) {
  return Math.min(
    Math.max(Number.isInteger(limit) ? limit : ORGANIZATION_JOIN_REQUEST_LIST_DEFAULT_LIMIT, 1),
    ORGANIZATION_JOIN_REQUEST_LIST_MAX_LIMIT,
  );
}

/**
 * Submit a new pending request. The partial unique index
 * ux_organization_join_requests_j1_one_pending is the concurrency authority
 * for "one pending request per requester + organization"; a duplicate
 * surfaces as `pending_request_exists` rather than a second row.
 */
export async function insertPendingOrganizationJoinRequest({ organizationId, requesterUserId }, db = pool) {
  if (!organizationId || !requesterUserId) return { ok: false, error_code: "invalid_join_request_fields" };
  try {
    const { rows } = await db.query(
      `INSERT INTO kai.organization_join_requests (organization_id, requester_user_id)
       VALUES ($1, $2)
       RETURNING ${ORGANIZATION_JOIN_REQUEST_COLUMNS}`,
      [organizationId, requesterUserId],
    );
    return { ok: true, joinRequest: rows[0] };
  } catch (error) {
    if (error?.code === "23505") {
      return { ok: false, error_code: "pending_request_exists" };
    }
    if (error?.code === "23503") {
      return { ok: false, error_code: "invalid_reference" };
    }
    if (error?.code === "23514" || error?.code === "22P02") {
      return { ok: false, error_code: "invalid_join_request_fields" };
    }
    throw error;
  }
}

export async function getOrganizationJoinRequestForOrganization(
  { organizationId, organizationJoinRequestId },
  db = pool,
) {
  if (!organizationId || !organizationJoinRequestId) return null;
  const { rows } = await db.query(
    `SELECT ${ORGANIZATION_JOIN_REQUEST_COLUMNS}
       FROM kai.organization_join_requests
      WHERE organization_id = $1
        AND organization_join_request_id = $2
      LIMIT 1`,
    [organizationId, organizationJoinRequestId],
  );
  return rows[0] || null;
}

export async function getPendingOrganizationJoinRequestForRequester(
  { organizationId, requesterUserId },
  db = pool,
) {
  if (!organizationId || !requesterUserId) return null;
  const { rows } = await db.query(
    `SELECT ${ORGANIZATION_JOIN_REQUEST_COLUMNS}
       FROM kai.organization_join_requests
      WHERE organization_id = $1
        AND requester_user_id = $2
        AND status = 'pending'
      LIMIT 1`,
    [organizationId, requesterUserId],
  );
  return rows[0] || null;
}

/** The requester's own requests across organizations, newest first. */
export async function listOrganizationJoinRequestsForRequester(
  { requesterUserId, limit = ORGANIZATION_JOIN_REQUEST_LIST_DEFAULT_LIMIT },
  db = pool,
) {
  if (!requesterUserId) return [];
  const { rows } = await db.query(
    `SELECT ${ORGANIZATION_JOIN_REQUEST_COLUMNS}
       FROM kai.organization_join_requests
      WHERE requester_user_id = $1
      ORDER BY created_at DESC, organization_join_request_id ASC
      LIMIT $2`,
    [requesterUserId, boundedListLimit(limit)],
  );
  return rows;
}

/** One organization's pending requests (reviewer queue), oldest first. */
export async function listPendingOrganizationJoinRequestsForOrganization(
  { organizationId, limit = ORGANIZATION_JOIN_REQUEST_LIST_DEFAULT_LIMIT },
  db = pool,
) {
  if (!organizationId) return [];
  const { rows } = await db.query(
    `SELECT ${ORGANIZATION_JOIN_REQUEST_COLUMNS}
       FROM kai.organization_join_requests
      WHERE organization_id = $1
        AND status = 'pending'
      ORDER BY created_at ASC, organization_join_request_id ASC
      LIMIT $2`,
    [organizationId, boundedListLimit(limit)],
  );
  return rows;
}

/**
 * Record a terminal decision on a pending request. The `status = 'pending'`
 * predicate is the compare-and-swap: a zero-row result means the request
 * doesn't exist in this organization or was already decided, and nothing
 * changes. Authorization of the reviewer is the caller's responsibility.
 */
export async function recordOrganizationJoinRequestDecision(
  { organizationId, organizationJoinRequestId, decision, reviewerUserId },
  db = pool,
) {
  if (!ORGANIZATION_JOIN_REQUEST_DECISIONS.includes(decision)) {
    return { ok: false, error_code: "invalid_join_request_decision" };
  }
  if (!organizationId || !organizationJoinRequestId || !reviewerUserId) {
    return { ok: false, error_code: "invalid_join_request_fields" };
  }
  try {
    const { rows } = await db.query(
      `UPDATE kai.organization_join_requests
          SET status = $1,
              reviewed_at = now(),
              reviewed_by_user_id = $2
        WHERE organization_id = $3
          AND organization_join_request_id = $4
          AND status = 'pending'
        RETURNING ${ORGANIZATION_JOIN_REQUEST_COLUMNS}`,
      [decision, reviewerUserId, organizationId, organizationJoinRequestId],
    );
    if (rows.length === 0) return { ok: false, error_code: "join_request_not_pending" };
    return { ok: true, joinRequest: rows[0] };
  } catch (error) {
    if (error?.code === "23514" && error?.constraint === "organization_join_requests_j1_no_self_review_check") {
      return { ok: false, error_code: "self_review_not_permitted" };
    }
    if (error?.code === "23503") {
      return { ok: false, error_code: "invalid_reference" };
    }
    if (error?.code === "23514" || error?.code === "22P02") {
      return { ok: false, error_code: "invalid_join_request_fields" };
    }
    throw error;
  }
}
