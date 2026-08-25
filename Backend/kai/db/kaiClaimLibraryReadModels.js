import pool from "./kaiDb.js";

/**
 * Read-only Impact Evidence Library claim index.
 *
 * This read model enumerates all organization-scoped governed claims from
 * kai.claims as the authoritative base. A claim's admission does not depend
 * on the presence of a claim_review or evidence_review queue row; relevant
 * queue rows are attached as optional metadata (reviewQueueItems: []) when
 * absent. It does not evaluate audience eligibility, blocker state, or
 * coverage policy; P2-08 and P2-06 remain authoritative for those decisions.
 */
export async function listClaimLibraryReviewCandidates(
  organizationId,
  { limit, afterClaimId = null },
  db = pool,
) {
  const params = [organizationId, limit + 1];
  const cursorClause = afterClaimId === null ? "" : "AND c.claim_id > $3::uuid";
  if (afterClaimId !== null) params.push(afterClaimId);

  const { rows } = await db.query(
    `SELECT c.claim_id::text AS claim_id,
            c.organization_id::text AS organization_id,
            c.evidence_item_id::text AS evidence_item_id,
            c.claim_type, c.claim_status,
            c.claim_review_status, c.claim_strength,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'review_queue_item_id', q.review_queue_item_id::text,
                  'queue_type', q.queue_type,
                  'target_object_type', q.target_object_type,
                  'target_object_id', q.target_object_id::text,
                  'queue_status', q.queue_status,
                  'review_status', q.review_status
                )
                ORDER BY q.created_at DESC, q.review_queue_item_id DESC
              ) FILTER (WHERE q.review_queue_item_id IS NOT NULL),
              '[]'::jsonb
            ) AS review_queue_items
       FROM kai.claims c
       LEFT JOIN kai.review_queue_items q
         ON q.organization_id = c.organization_id
        AND (
          (q.queue_type = 'claim_review' AND q.target_object_type = 'claim' AND q.target_object_id = c.claim_id)
          OR (q.queue_type = 'evidence_review' AND q.target_object_type = 'evidence_item' AND q.target_object_id = c.evidence_item_id)
        )
      WHERE c.organization_id = $1::uuid
        ${cursorClause}
      GROUP BY c.claim_id, c.organization_id, c.evidence_item_id, c.claim_type,
               c.claim_status, c.claim_review_status, c.claim_strength
      ORDER BY claim_id ASC
      LIMIT $2::int`,
    params,
  );
  return rows;
}
