import pool from "./kaiDb.js";

/**
 * Read-only Impact Evidence Library claim index.
 *
 * This deliberately small read model only enumerates organization-scoped claim
 * identities already connected to the canonical claim/evidence review queues.
 * It does not evaluate audience eligibility, blocker state, or coverage policy;
 * P2-08 and P2-06 remain authoritative for those decisions.
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
    `WITH candidate_queue AS (
       SELECT c.claim_id, c.organization_id, c.evidence_item_id, c.claim_type,
              c.claim_status, c.claim_review_status, c.claim_strength,
              q.review_queue_item_id, q.queue_type, q.target_object_type,
              q.target_object_id, q.queue_status, q.review_status, q.created_at
         FROM kai.claims c
         JOIN kai.review_queue_items q
           ON q.organization_id = c.organization_id
          AND q.queue_type = 'claim_review'
          AND q.target_object_type = 'claim'
          AND q.target_object_id = c.claim_id
        WHERE c.organization_id = $1::uuid
       UNION ALL
       SELECT c.claim_id, c.organization_id, c.evidence_item_id, c.claim_type,
              c.claim_status, c.claim_review_status, c.claim_strength,
              q.review_queue_item_id, q.queue_type, q.target_object_type,
              q.target_object_id, q.queue_status, q.review_status, q.created_at
         FROM kai.claims c
         JOIN kai.review_queue_items q
           ON q.organization_id = c.organization_id
          AND q.queue_type = 'evidence_review'
          AND q.target_object_type = 'evidence_item'
          AND q.target_object_id = c.evidence_item_id
        WHERE c.organization_id = $1::uuid
     )
     SELECT claim_id::text AS claim_id,
            organization_id::text AS organization_id,
            evidence_item_id::text AS evidence_item_id,
            claim_type, claim_status,
            claim_review_status, claim_strength,
            jsonb_agg(
              jsonb_build_object(
                'review_queue_item_id', review_queue_item_id::text,
                'queue_type', queue_type,
                'target_object_type', target_object_type,
                'target_object_id', target_object_id::text,
                'queue_status', queue_status,
                'review_status', review_status
              )
              ORDER BY created_at DESC, review_queue_item_id DESC
            ) AS review_queue_items
       FROM candidate_queue c
      WHERE c.organization_id = $1::uuid
        ${cursorClause}
      GROUP BY claim_id, organization_id, evidence_item_id, claim_type,
               claim_status, claim_review_status, claim_strength
      ORDER BY claim_id ASC
      LIMIT $2::int`,
    params,
  );
  return rows;
}
