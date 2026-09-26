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
 * read) are selected. No file content, profile/dictionary/sensitivity values,
 * evidence or claim statements, reviewer identities, notes, or queue metadata.
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

export async function listClientEvidencePipelineFiles(organizationId, engagementId, { limit }, db = pool) {
  const { rows } = await db.query(
    `WITH files AS (
       SELECT f.organization_id, f.intake_file_id, f.safe_filename, f.upload_state, f.file_policy_status,
              f.verified_checksum, f.created_at
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
            r.parser_status,
            r.error_code AS parser_error_code,
            (r.parser_status = 'completed' AND p.file_profile_id IS NOT NULL) AS file_profile_complete,
            (d.data_dictionary_id IS NOT NULL) AS data_dictionary_complete,
            (s.intake_sensitivity_profile_id IS NOT NULL) AS sensitivity_profile_complete,
            sd.decision_outcome AS sensitivity_decision_outcome,
            COALESCE(c.candidate_count, 0)::int AS source_candidate_count,
            COALESCE(c.needs_review_count, 0)::int AS source_candidate_needs_review_count,
            COALESCE(c.promoted_count, 0)::int AS source_candidate_promoted_count,
            COALESCE(c.rejected_count, 0)::int AS source_candidate_rejected_count,
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
         SELECT pr.parser_status, pr.output_profile_id, pr.error_code
           FROM kai.intake_parser_runs pr
          WHERE pr.organization_id = files.organization_id
            AND pr.intake_file_id = files.intake_file_id
            AND pr.checksum = files.verified_checksum
          ORDER BY pr.created_at DESC, pr.parser_run_id DESC
          LIMIT 1
       ) r ON true
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
         SELECT dec.decision_outcome
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
       LEFT JOIN LATERAL (
         SELECT count(*) AS candidate_count,
                count(*) FILTER (WHERE ic.candidate_status = 'needs_gk_review') AS needs_review_count,
                count(*) FILTER (WHERE ic.candidate_status = 'promoted') AS promoted_count,
                count(*) FILTER (WHERE ic.candidate_status = 'rejected') AS rejected_count
           FROM kai.intake_source_candidates ic
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
    [organizationId, engagementId, limit],
  );
  return rows;
}
