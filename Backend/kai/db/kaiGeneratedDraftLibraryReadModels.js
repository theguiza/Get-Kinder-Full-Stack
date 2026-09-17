import pool from "./kaiDb.js";

/**
 * Read-only Impact Evidence Library generated-drafts index.
 *
 * This deliberately small read model only enumerates organization-scoped
 * `internal`-audience generated-content-draft identities already persisted
 * through the accepted P3-01/P13-01/Readiness paths (content types:
 * `evidence_summary`, `impact_narrative`, `readiness_assessment`,
 * `data_gap_memo`), joined to
 * their existing `generated_content_review` queue row. It carries no generated
 * block text, citation detail,
 * evidence/source content, or storage identifiers; P3-02 remains
 * authoritative for the full draft/review packet.
 *
 * Also left-joins each draft's existing `export_review` queue row (the same
 * organization + generated_content_draft_id -> 0-or-1 row relationship the
 * single-draft read path already established, batched here in the one list
 * query instead of a per-draft follow-up call - no N+1). `queue_type`/
 * `target_object_type` are inlined literals ('export_review' /
 * 'generated_content_draft'), matching this file's existing convention of
 * inlining the sibling `generated_content_review` join above rather than
 * importing a contract constant.
 *
 * The joined export_review row's full internal field set (priority,
 * blocked_reason, assigned_to, due_at, summary, required_action,
 * queue_metadata, created_by, created_by_type, plus organization_id/
 * queue_type/target_object_type/target_object_id) is selected here too -
 * not because the list DTO exposes them, but because the service layer
 * validates the joined row against the same authoritative
 * isExportReviewQueueContractRow static-contract + lifecycle check the
 * selected-draft read applies, and that check needs the whole row.
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
            d.created_at,
            eq.review_queue_item_id::text AS export_review_queue_item_id,
            eq.organization_id::text AS export_review_organization_id,
            eq.queue_type AS export_review_queue_type,
            eq.target_object_type AS export_review_target_object_type,
            eq.target_object_id::text AS export_review_target_object_id,
            eq.priority AS export_review_priority,
            eq.queue_status AS export_review_queue_status,
            eq.review_status AS export_review_status,
            eq.blocked_reason AS export_review_blocked_reason,
            eq.assigned_to::text AS export_review_assigned_to,
            eq.due_at AS export_review_due_at,
            eq.summary AS export_review_summary,
            eq.required_action AS export_review_required_action,
            eq.queue_metadata AS export_review_queue_metadata,
            eq.created_by::text AS export_review_created_by,
            eq.created_by_type AS export_review_created_by_type
       FROM kai.generated_content_drafts d
       JOIN kai.review_queue_items q
         ON q.organization_id = d.organization_id
        AND q.queue_type = 'generated_content_review'
        AND q.target_object_type = 'generated_content_draft'
        AND q.target_object_id = d.generated_content_draft_id
       LEFT JOIN kai.review_queue_items eq
         ON eq.organization_id = d.organization_id
        AND eq.queue_type = 'export_review'
        AND eq.target_object_type = 'generated_content_draft'
        AND eq.target_object_id = d.generated_content_draft_id
      WHERE d.organization_id = $1::uuid
        AND d.content_type IN ('evidence_summary', 'impact_narrative', 'readiness_assessment', 'data_gap_memo', 'case_for_support', 'board_update')
        AND d.requested_audience = 'internal'
        AND d.draft_status = 'draft'
        AND q.priority = 'medium'
        AND q.summary = 'Generated draft requires human review.'
        AND q.required_action = 'Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.'
        AND q.assigned_to IS NULL
        AND q.due_at IS NULL
        AND q.created_by_type = 'system'
        AND (
          (q.queue_status = 'open' AND q.review_status = 'needs_gk_review')
          OR (q.queue_status = 'in_progress' AND q.review_status = 'needs_gk_review')
          OR (q.queue_status = 'resolved' AND q.review_status = 'resolved')
        )
        ${cursorClause}
      ORDER BY d.generated_content_draft_id ASC
      LIMIT $2::int`,
    params,
  );
  return rows;
}
