import pool from "./kaiDb.js";

const IMPROVEMENT_PRACTICE_COLUMNS = `
  improvement_practice_id,
  organization_id,
  engagement_id,
  gap_log_item_id,
  title,
  rationale,
  status,
  cadence,
  next_due_date,
  responsible_actor_user_id,
  created_by,
  created_by_type,
  created_at,
  updated_at
`;

/**
 * Package G foundation write: kai.improvement_practices is a plain mutable
 * table (no append-only ledger), so this is an ordinary INSERT with no
 * lineage/supersession bookkeeping.
 */
export async function insertImprovementPractice(
  {
    organizationId,
    engagementId = null,
    gapLogItemId = null,
    title,
    rationale,
    status = "recommended",
    cadence,
    nextDueDate = null,
    responsibleActorUserId = null,
    createdByUserId = null,
  },
  db = pool,
) {
  try {
    const { rows } = await db.query(
      `INSERT INTO kai.improvement_practices (
         organization_id, engagement_id, gap_log_item_id, title, rationale,
         status, cadence, next_due_date, responsible_actor_user_id, created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${IMPROVEMENT_PRACTICE_COLUMNS}`,
      [
        organizationId,
        engagementId,
        gapLogItemId,
        title,
        rationale,
        status,
        cadence,
        nextDueDate,
        responsibleActorUserId,
        createdByUserId,
      ],
    );
    return { ok: true, practice: rows[0] };
  } catch (error) {
    if (error?.code === "23503") {
      return { ok: false, error_code: "invalid_reference" };
    }
    if (error?.code === "23514" || error?.code === "22P02") {
      return { ok: false, error_code: "invalid_practice_fields" };
    }
    throw error;
  }
}

export async function getImprovementPracticeForOrganization(
  { organizationId, improvementPracticeId },
  db = pool,
) {
  if (!organizationId || !improvementPracticeId) return null;
  const { rows } = await db.query(
    `SELECT ${IMPROVEMENT_PRACTICE_COLUMNS}
       FROM kai.improvement_practices
      WHERE organization_id = $1
        AND improvement_practice_id = $2
      LIMIT 1`,
    [organizationId, improvementPracticeId],
  );
  return rows[0] || null;
}

const IMPROVEMENT_PRACTICE_LIST_MAX_LIMIT = 100;
const IMPROVEMENT_PRACTICE_LIST_DEFAULT_LIMIT = 50;

export async function listImprovementPracticesForOrganization(
  { organizationId, engagementId = null, limit = IMPROVEMENT_PRACTICE_LIST_DEFAULT_LIMIT },
  db = pool,
) {
  if (!organizationId) return [];
  const boundedLimit = Math.min(
    Math.max(Number.isInteger(limit) ? limit : IMPROVEMENT_PRACTICE_LIST_DEFAULT_LIMIT, 1),
    IMPROVEMENT_PRACTICE_LIST_MAX_LIMIT,
  );
  if (engagementId) {
    const { rows } = await db.query(
      `SELECT ${IMPROVEMENT_PRACTICE_COLUMNS}
         FROM kai.improvement_practices
        WHERE organization_id = $1
          AND engagement_id = $2
        ORDER BY created_at DESC, improvement_practice_id ASC
        LIMIT $3`,
      [organizationId, engagementId, boundedLimit],
    );
    return rows;
  }
  const { rows } = await db.query(
    `SELECT ${IMPROVEMENT_PRACTICE_COLUMNS}
       FROM kai.improvement_practices
      WHERE organization_id = $1
      ORDER BY created_at DESC, improvement_practice_id ASC
      LIMIT $2`,
    [organizationId, boundedLimit],
  );
  return rows;
}

/**
 * Mutable-field update (title/rationale/cadence/next_due_date/responsible
 * actor) with an optimistic-concurrency compare-and-swap on updated_at,
 * mirroring the Board Reporting candidate review's
 * date_trunc('milliseconds', ...) convention - the caller must supply the
 * updated_at it last read, and a zero-row result means either the row
 * doesn't exist/isn't in this tenant, or it changed underneath the caller.
 */
export async function updateImprovementPracticeFields(
  {
    organizationId,
    improvementPracticeId,
    expectedUpdatedAt,
    title,
    rationale,
    cadence,
    nextDueDate,
    responsibleActorUserId,
  },
  db = pool,
) {
  try {
    const { rows } = await db.query(
      `UPDATE kai.improvement_practices
          SET title = $1,
              rationale = $2,
              cadence = $3,
              next_due_date = $4,
              responsible_actor_user_id = $5
        WHERE organization_id = $6
          AND improvement_practice_id = $7
          AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $8::timestamptz)
        RETURNING ${IMPROVEMENT_PRACTICE_COLUMNS}`,
      [
        title,
        rationale,
        cadence,
        nextDueDate,
        responsibleActorUserId,
        organizationId,
        improvementPracticeId,
        expectedUpdatedAt,
      ],
    );
    if (rows.length === 0) return { ok: false, error_code: "conflict_current_state_changed" };
    return { ok: true, practice: rows[0] };
  } catch (error) {
    if (error?.code === "23514" || error?.code === "22P02") {
      return { ok: false, error_code: "invalid_practice_fields" };
    }
    throw error;
  }
}

export async function updateImprovementPracticeStatus(
  { organizationId, improvementPracticeId, expectedUpdatedAt, status },
  db = pool,
) {
  try {
    const { rows } = await db.query(
      `UPDATE kai.improvement_practices
          SET status = $1
        WHERE organization_id = $2
          AND improvement_practice_id = $3
          AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $4::timestamptz)
        RETURNING ${IMPROVEMENT_PRACTICE_COLUMNS}`,
      [status, organizationId, improvementPracticeId, expectedUpdatedAt],
    );
    if (rows.length === 0) return { ok: false, error_code: "conflict_current_state_changed" };
    return { ok: true, practice: rows[0] };
  } catch (error) {
    if (error?.code === "23514" || error?.code === "22P02") {
      return { ok: false, error_code: "invalid_practice_fields" };
    }
    throw error;
  }
}
