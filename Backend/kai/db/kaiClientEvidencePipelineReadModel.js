import pool from "./kaiDb.js";

/**
 * Read-only, organization + engagement scoped lineage counts for the client
 * evidence-pipeline projection (kaiClientEvidencePipelineService.js).
 *
 * kai.intake_files is the only pipeline table that carries engagement_id, so
 * every downstream object is reached through the file's own lineage:
 * current parser run (bound to the file's CURRENT verified checksum, as in
 * getScopedIntakeFileP1Lifecycle) -> file profile -> data dictionary ->
 * sensitivity profile -> current sensitivity decision -> source candidates of
 * that sensitivity profile -> current source versions -> evidence items ->
 * claims -> open client follow-ups. Every join also matches organization_id.
 *
 * Only statuses, booleans, counts, a safe parser error code, and claim ids
 * (used by the service solely to intersect with the governed eligible-claim
 * read) are selected. `sensitivity_permission_predicate` is the server-side
 * result of the unchanged P1-07/P1-08 fail-closed permission predicate over
 * the sensitivity profile row, and `source_candidate_actionable_count` counts
 * candidates a P1-08 decision could act on now (the repository's own
 * completeness predicate: needs_gk_review with an open review item and no
 * decision, or needs_more_information awaiting the client); the service uses
 * them only to choose the file's next action and never returns them.
 * `source_candidate_continuation_ready` (owner decisions 2026-10-19) is the
 * server-side result of the source-preparation continuation's eligibility
 * over committed rows: exactly one current decision-lineage head, 'reviewed',
 * human, recorded by an authorized decider (any of the ledger's decider roles;
 * any organization administrator may continue it), its sensitivity_review
 * item resolved, and neither reviewed nor P1-05 allowed use not_allowed; it
 * is false without a requesting actor (`actorUserId`). The
 * service uses it only to choose the next action, and the continuation
 * re-checks everything on the write. `effective_allowed_use_not_allowed` is
 * VAL-KAI-B1A-02-003 over the same rows (the single current head's reviewed
 * allowed use, or the committed P1-05 fact, is not_allowed), and
 * `organization_administrator_available` is whether the organization has an
 * administrator path at all (an active GK organization binding, whose Get
 * Kinder organization administrators are its binding-derived client_admins,
 * or an active stored client_admin grant of an active account); both only
 * choose who the file waits on and are never returned. No file content,
 * profile/dictionary/sensitivity values, evidence or claim statements,
 * reviewer identities, notes, or queue metadata.
 */
export async function getClientEvidencePipelineEngagement(organizationId, engagementId, db = pool) {
  const { rows } = await db.query(
    `SELECT engagement_id, organization_id
       FROM kai.engagements
      WHERE organization_id = $1
        AND engagement_id = $2
      LIMIT 1`,
    [organizationId, engagementId],
  );
  return rows[0] || null;
}

export async function listClientEvidencePipelineFiles(organizationId, engagementId, { limit, actorUserId = null }, db = pool) {
  const { rows } = await db.query(
    `WITH files AS (
       SELECT f.organization_id, f.intake_file_id, f.safe_filename, f.upload_state, f.file_policy_status,
              f.verified_checksum, f.upload_expires_at, f.created_at
         FROM kai.intake_files f
        WHERE f.organization_id = $1
          AND f.engagement_id = $2
        ORDER BY f.created_at DESC, f.intake_file_id DESC
        LIMIT $3
     )
     SELECT files.intake_file_id,
            files.safe_filename,
            files.upload_state,
            files.file_policy_status,
            files.created_at,
            -- An unfinished upload whose window has ended can never be
            -- continued (the lifecycle trigger denies it), expired or not yet.
            (files.upload_state IN ('reserved', 'upload_started', 'uploaded_unconfirmed')
              AND files.upload_expires_at <= now()) AS upload_window_lapsed,
            sa.assessment_category AS security_assessment_pending_category,
            r.parser_status,
            r.error_code AS parser_error_code,
            r.retry_count AS parser_retry_count,
            (r.parser_status = 'completed' AND p.file_profile_id IS NOT NULL) AS file_profile_complete,
            (d.data_dictionary_id IS NOT NULL) AS data_dictionary_complete,
            (s.intake_sensitivity_profile_id IS NOT NULL) AS sensitivity_profile_complete,
            (s.human_review_required = true
              AND s.public_use_allowed = false
              AND s.funder_use_allowed = false
              AND s.llm_processing_allowed = false
              AND s.product_learning_allowed = false
              AND s.retention_posture = 'restricted_pending_review') AS sensitivity_permission_predicate,
            sd.decision_outcome AS sensitivity_decision_outcome,
            COALESCE(
              sd.head_count = 1
                AND sd.decision_outcome = 'reviewed'
                AND sd.created_by_type = 'human'
                AND sd.decided_by_role IN ('gk_admin', 'gk_operator', 'gk_reviewer', 'client_admin')
                AND sd.decided_by IS NOT NULL
                AND $4::uuid IS NOT NULL
                AND sq.review_queue_item_id = sd.review_queue_item_id
                AND sq.queue_status = 'resolved'
                AND sq.review_status = 'resolved'
                AND sd.reviewed_allowed_use_status IS DISTINCT FROM 'not_allowed'
                AND s.allowed_use_status IS DISTINCT FROM 'not_allowed',
              false
            ) AS source_candidate_continuation_ready,
            COALESCE(
              (sd.head_count = 1 AND sd.decision_outcome = 'reviewed' AND sd.reviewed_allowed_use_status = 'not_allowed')
                OR s.allowed_use_status = 'not_allowed',
              false
            ) AS effective_allowed_use_not_allowed,
            (
              EXISTS (
                SELECT 1 FROM kai.gk_organization_bindings b
                 WHERE b.kai_organization_id = files.organization_id AND b.status = 'active'
              )
              OR EXISTS (
                SELECT 1
                  FROM kai.organization_memberships om
                  JOIN kai.users u ON u.user_id = om.user_id
                 WHERE om.organization_id = files.organization_id
                   AND om.role_name = 'client_admin'
                   AND om.membership_status = 'active'
                   AND u.status = 'active'
              )
            ) AS organization_administrator_available,
            COALESCE(c.candidate_count, 0)::int AS source_candidate_count,
            COALESCE(c.needs_review_count, 0)::int AS source_candidate_needs_review_count,
            COALESCE(c.promoted_count, 0)::int AS source_candidate_promoted_count,
            COALESCE(c.rejected_count, 0)::int AS source_candidate_rejected_count,
            COALESCE(c.actionable_count, 0)::int AS source_candidate_actionable_count,
            COALESCE(sv.source_version_count, 0)::int AS source_version_count,
            COALESCE(e.evidence_count, 0)::int AS evidence_item_count,
            COALESCE(e.evidence_needs_review_count, 0)::int AS evidence_needs_review_count,
            COALESCE(e.evidence_reviewed_count, 0)::int AS evidence_reviewed_count,
            COALESCE(cl.claim_count, 0)::int AS claim_count,
            COALESCE(cl.claim_needs_review_count, 0)::int AS claim_needs_review_count,
            COALESCE(cl.claim_ids, ARRAY[]::uuid[]) AS claim_ids,
            COALESCE(fu.open_client_followup_count, 0)::int AS open_client_followup_count
       FROM files
       LEFT JOIN LATERAL (
         SELECT pr.parser_status, pr.output_profile_id, pr.error_code, pr.retry_count
           FROM kai.intake_parser_runs pr
          WHERE pr.organization_id = files.organization_id
            AND pr.intake_file_id = files.intake_file_id
            AND pr.checksum = files.verified_checksum
          ORDER BY pr.created_at DESC, pr.parser_run_id DESC
          LIMIT 1
       ) r ON true
       -- Why a confirmed file is still pending its security check: the
       -- latest non-policy assessment outcome (the safe category of the
       -- record_security_assessment_diagnostic audit), or none.
       LEFT JOIN LATERAL (
         SELECT ae.metadata->>'assessment_category' AS assessment_category
           FROM kai.audit_events ae
          WHERE files.upload_state = 'confirmed'
            AND files.file_policy_status = 'pending'
            AND ae.organization_id = files.organization_id
            AND ae.action = 'record_security_assessment_diagnostic'
            AND ae.metadata->>'object_id' = files.intake_file_id::text
          ORDER BY ae.created_at DESC
          LIMIT 1
       ) sa ON true
       LEFT JOIN kai.intake_file_profiles p
         ON p.organization_id = files.organization_id
        AND p.intake_file_id = files.intake_file_id
        AND p.file_profile_id = r.output_profile_id
       LEFT JOIN kai.data_dictionaries d
         ON d.organization_id = files.organization_id
        AND d.intake_file_id = files.intake_file_id
        AND d.file_profile_id = p.file_profile_id
       LEFT JOIN kai.intake_sensitivity_profiles s
         ON s.organization_id = files.organization_id
        AND s.intake_file_id = files.intake_file_id
        AND s.file_profile_id = p.file_profile_id
       LEFT JOIN LATERAL (
         SELECT dec.decision_outcome, dec.created_by_type, dec.decided_by_role, dec.decided_by,
                dec.review_queue_item_id, dec.reviewed_allowed_use_status,
                count(*) OVER () AS head_count
           FROM kai.intake_sensitivity_review_decisions dec
          WHERE dec.organization_id = s.organization_id
            AND dec.intake_sensitivity_profile_id = s.intake_sensitivity_profile_id
            AND NOT EXISTS (
              SELECT 1
                FROM kai.intake_sensitivity_review_decisions newer
               WHERE newer.organization_id = dec.organization_id
                 AND newer.supersedes_decision_id = dec.decision_id
            )
          ORDER BY dec.created_at DESC
          LIMIT 1
       ) sd ON true
       LEFT JOIN kai.review_queue_items sq
         ON sq.organization_id = s.organization_id
        AND sq.queue_type = 'sensitivity_review'
        AND sq.target_object_type = 'intake_sensitivity_profile'
        AND sq.target_object_id = s.intake_sensitivity_profile_id
       LEFT JOIN LATERAL (
         SELECT count(*) AS candidate_count,
                count(*) FILTER (WHERE ic.candidate_status = 'needs_gk_review') AS needs_review_count,
                count(*) FILTER (WHERE ic.candidate_status = 'promoted') AS promoted_count,
                count(*) FILTER (WHERE ic.candidate_status = 'rejected') AS rejected_count,
                count(*) FILTER (
                  WHERE ic.candidate_status = 'needs_gk_review'
                    AND (
                      (pd.decision_status IS NULL AND rq.queue_status = 'open')
                      OR (pd.decision_status = 'needs_more_information' AND rq.queue_status = 'waiting_on_client')
                    )
                ) AS actionable_count
           FROM kai.intake_source_candidates ic
           LEFT JOIN kai.intake_promotion_decisions pd
             ON pd.organization_id = ic.organization_id
            AND pd.intake_source_candidate_id = ic.intake_source_candidate_id
           LEFT JOIN kai.review_queue_items rq
             ON rq.organization_id = ic.organization_id
            AND rq.queue_type = 'source_candidate_review'
            AND rq.target_object_type = 'intake_source_candidate'
            AND rq.target_object_id = ic.intake_source_candidate_id
          WHERE ic.organization_id = s.organization_id
            AND ic.intake_file_id = files.intake_file_id
            AND ic.intake_sensitivity_profile_id = s.intake_sensitivity_profile_id
       ) c ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS source_version_count
           FROM kai.source_versions v
           JOIN kai.intake_source_candidates ic
             ON ic.organization_id = v.organization_id
            AND ic.intake_source_candidate_id = v.intake_source_candidate_id
          WHERE v.organization_id = s.organization_id
            AND v.is_current = true
            AND ic.intake_file_id = files.intake_file_id
            AND ic.intake_sensitivity_profile_id = s.intake_sensitivity_profile_id
       ) sv ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS evidence_count,
                count(*) FILTER (WHERE ei.evidence_review_status = 'needs_gk_review') AS evidence_needs_review_count,
                count(*) FILTER (WHERE ei.evidence_review_status = 'reviewed') AS evidence_reviewed_count
           FROM kai.evidence_items ei
           JOIN kai.source_versions v
             ON v.organization_id = ei.organization_id
            AND v.source_version_id = ei.source_version_id
           JOIN kai.intake_source_candidates ic
             ON ic.organization_id = v.organization_id
            AND ic.intake_source_candidate_id = v.intake_source_candidate_id
          WHERE ei.organization_id = s.organization_id
            AND v.is_current = true
            AND ic.intake_file_id = files.intake_file_id
            AND ic.intake_sensitivity_profile_id = s.intake_sensitivity_profile_id
       ) e ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS claim_count,
                count(*) FILTER (WHERE cm.claim_review_status = 'needs_gk_review') AS claim_needs_review_count,
                array_agg(cm.claim_id ORDER BY cm.claim_id) AS claim_ids
           FROM kai.claims cm
           JOIN kai.evidence_items ei
             ON ei.organization_id = cm.organization_id
            AND ei.evidence_item_id = cm.evidence_item_id
           JOIN kai.source_versions v
             ON v.organization_id = ei.organization_id
            AND v.source_version_id = ei.source_version_id
           JOIN kai.intake_source_candidates ic
             ON ic.organization_id = v.organization_id
            AND ic.intake_source_candidate_id = v.intake_source_candidate_id
          WHERE cm.organization_id = s.organization_id
            AND v.is_current = true
            AND ic.intake_file_id = files.intake_file_id
            AND ic.intake_sensitivity_profile_id = s.intake_sensitivity_profile_id
       ) cl ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS open_client_followup_count
           FROM kai.client_followup_items cf
           JOIN kai.review_queue_items rq
             ON rq.organization_id = cf.organization_id
            AND rq.queue_type = 'client_followup'
            AND rq.target_object_type = 'client_followup_item'
            AND rq.target_object_id = cf.client_followup_item_id
          WHERE cf.organization_id = s.organization_id
            AND cf.claim_id = ANY(COALESCE(cl.claim_ids, ARRAY[]::uuid[]))
            AND rq.queue_status NOT IN ('resolved', 'cancelled')
       ) fu ON true
      ORDER BY files.created_at DESC, files.intake_file_id DESC`,
    [organizationId, engagementId, limit, actorUserId],
  );
  return rows;
}
