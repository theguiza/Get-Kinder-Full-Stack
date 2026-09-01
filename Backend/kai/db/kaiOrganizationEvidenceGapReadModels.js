import pool from "./kaiDb.js";

/**
 * Read-only organization-scoped Impact Evidence Library gap index.
 *
 * Enumerates kai.gap_log_items directly, scoped to one organization, with no
 * per-claim fan-out: the existing per-claim gap read
 * (postgresClaimTraceabilityRepository.js#readGapRows) stays the
 * authoritative per-claim view; this is a separate, additive bounded read
 * over the same table for organization-level enumeration. gap_log_items has
 * no current/stale/superseded lineage column (uniqueness is enforced by
 * (organization_id, claim_id, dimension_key)), so no such filtering is
 * applied here either.
 */
export async function listOrganizationEvidenceGaps(
  organizationId,
  { limit, afterGapLogItemId = null },
  db = pool,
) {
  const params = [organizationId, limit + 1];
  const cursorClause = afterGapLogItemId === null ? "" : "AND gap_log_item_id > $3::uuid";
  if (afterGapLogItemId !== null) params.push(afterGapLogItemId);

  const { rows } = await db.query(
    `SELECT gap_log_item_id::text AS gap_log_item_id,
            claim_id::text AS claim_id,
            dimension_key,
            assessment_status,
            validator_key
       FROM kai.gap_log_items
      WHERE organization_id = $1::uuid
        ${cursorClause}
      ORDER BY gap_log_item_id ASC
      LIMIT $2::int`,
    params,
  );
  return rows;
}
