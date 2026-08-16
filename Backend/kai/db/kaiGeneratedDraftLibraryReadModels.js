import pool from "./kaiDb.js";

/**
 * Read-only Impact Evidence Library generated-drafts index.
 *
 * This deliberately small read model only enumerates organization-scoped
 * `evidence_summary`/`internal` generated-content-draft identities already
 * persisted through the accepted P3-01 path, joined to their existing
 * `generated_content_review` queue row. It carries no generated block text,
 * citation detail, evidence/source content, or storage identifiers; P3-02
 * remains authoritative for the full draft/review packet.
 */
export async function listGeneratedDraftLibraryIndex(
  organizationId,
  { limit, afterGeneratedContentDraftId = null },
  db = pool,
) {
  const params = [organizationId, limit + 1];
  const cursorClause = afterGeneratedContentDraftId === null ? "" : "AND d.generated_content_draft_id > $3::uuid";
  if (afterGeneratedContentDraftId !== null) params.push(afterGeneratedContentDraftId);

  const { rows } = await db.query(
    `SELECT d.generated_content_draft_id::text AS generated_content_draft_id,
            d.organization_id::text AS organization_id,
            d.content_type,
            d.requested_audience,
            d.draft_status,
            q.review_queue_item_id::text AS review_queue_item_id,
            q.queue_status,
            q.review_status,
            d.created_at
       FROM kai.generated_content_drafts d
       JOIN kai.review_queue_items q
         ON q.organization_id = d.organization_id
        AND q.queue_type = 'generated_content_review'
        AND q.target_object_type = 'generated_content_draft'
        AND q.target_object_id = d.generated_content_draft_id
      WHERE d.organization_id = $1::uuid
        AND d.content_type = 'evidence_summary'
        AND d.requested_audience = 'internal'
        ${cursorClause}
      ORDER BY d.generated_content_draft_id ASC
      LIMIT $2::int`,
    params,
  );
  return rows;
}
