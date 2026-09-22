import pool from "./kaiDb.js";

/**
 * Read-only organization-scoped Evidence Library index (KAI Impact Library
 * redesign, E1 correction).
 *
 * kai.evidence_items has no column and no foreign key referencing
 * kai.claims - the dependency runs the other way (kai.claims.evidence_item_id
 * REFERENCES kai.evidence_items, ON DELETE RESTRICT; see
 * migrations/kai_sprint2_p2_03_claim_proposal.sql). Nothing enforces that
 * every evidence item has a claim: the governed pipeline is source
 * promotion -> evidence extraction -> coverage/quality assessment -> claim
 * proposal, and an evidence item can exist at any stage before the last
 * one. Enumerating evidence through kai.claims (a LEFT JOIN from claims,
 * as the Knowledge Studio Evidence tab previously did) would silently
 * exclude every evidence item that has not yet had a claim proposed for
 * it. This read model enumerates kai.evidence_items directly instead.
 */
export async function listOrganizationEvidenceItems(
  organizationId,
  { limit, afterEvidenceItemId = null },
  db = pool,
) {
  const params = [organizationId, limit + 1];
  const cursorClause = afterEvidenceItemId === null ? "" : "AND evidence_item_id > $3::uuid";
  if (afterEvidenceItemId !== null) params.push(afterEvidenceItemId);

  const { rows } = await db.query(
    `SELECT evidence_item_id::text AS evidence_item_id,
            organization_id::text AS organization_id,
            source_id::text AS source_id,
            source_version_id::text AS source_version_id,
            evidence_type, data_class, support_strength, statement,
            evidence_review_status, internal_only, public_use_allowed, funder_use_allowed
       FROM kai.evidence_items
      WHERE organization_id = $1::uuid
        ${cursorClause}
      ORDER BY evidence_item_id ASC
      LIMIT $2::int`,
    params,
  );
  return rows;
}
