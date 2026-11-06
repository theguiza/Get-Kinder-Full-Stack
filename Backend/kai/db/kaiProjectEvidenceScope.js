/**
 * Project (engagement) working-view scope for the organization's evidence
 * reads (owner direction 2026-11-06). Uses only existing relationships; it
 * writes nothing and creates no association.
 *
 * Evidence belongs to a Project's working view when either
 * - its own source version descends from a file uploaded to that Project
 *   (source_versions -> intake_source_candidates -> intake_files.engagement_id), or
 * - a draft generated for that Project cites it (generated_content_citations
 *   -> generated_content_blocks -> generated_content_drafts ->
 *   generation_runs.engagement_id): evidence an authorized person explicitly
 *   selected from the organization library and reused in that Project.
 *
 * EXISTS keeps one row per evidence item, claim or source (no join
 * duplication), and the predicate sits in the WHERE clause, so it filters
 * before LIMIT and the page/truncation metadata describe the same scope.
 * Callers that omit the engagement keep the organization-wide library read.
 */
function uploadedToProjectSql({ organizationSql, sourceVersionMatchSql, engagementParam }) {
  return `EXISTS (
      SELECT 1
        FROM kai.source_versions scope_sv
        JOIN kai.intake_source_candidates scope_ic
          ON scope_ic.organization_id = scope_sv.organization_id
         AND scope_ic.intake_source_candidate_id = scope_sv.intake_source_candidate_id
        JOIN kai.intake_files scope_f
          ON scope_f.organization_id = scope_ic.organization_id
         AND scope_f.intake_file_id = scope_ic.intake_file_id
       WHERE scope_sv.organization_id = ${organizationSql}
         AND ${sourceVersionMatchSql}
         AND scope_f.engagement_id = ${engagementParam}::uuid
    )`;
}

function reusedInProjectSql({ organizationSql, evidenceMatchSql, engagementParam, extraJoinSql = "" }) {
  return `EXISTS (
      SELECT 1
        FROM kai.generated_content_citations scope_gc
        JOIN kai.generated_content_blocks scope_gb
          ON scope_gb.organization_id = scope_gc.organization_id
         AND scope_gb.generated_content_block_id = scope_gc.generated_content_block_id
        JOIN kai.generated_content_drafts scope_gd
          ON scope_gd.organization_id = scope_gb.organization_id
         AND scope_gd.generated_content_draft_id = scope_gb.generated_content_draft_id
        JOIN kai.generation_runs scope_gr
          ON scope_gr.organization_id = scope_gd.organization_id
         AND scope_gr.generation_run_id = scope_gd.generation_run_id
        ${extraJoinSql}
       WHERE scope_gc.organization_id = ${organizationSql}
         AND ${evidenceMatchSql}
         AND scope_gr.engagement_id = ${engagementParam}::uuid
    )`;
}

// An evidence item row aliased `evidenceAlias` (organization_id,
// evidence_item_id, source_version_id).
export function projectEvidenceScopeSql({ evidenceAlias, engagementParam }) {
  return `(${uploadedToProjectSql({
    organizationSql: `${evidenceAlias}.organization_id`,
    sourceVersionMatchSql: `scope_sv.source_version_id = ${evidenceAlias}.source_version_id`,
    engagementParam,
  })}
    OR ${reusedInProjectSql({
    organizationSql: `${evidenceAlias}.organization_id`,
    evidenceMatchSql: `scope_gc.evidence_item_id = ${evidenceAlias}.evidence_item_id`,
    engagementParam,
  })})`;
}

// A source row aliased `sourceAlias` (organization_id, source_id): one of its
// versions was uploaded to the Project, or evidence from it was reused there.
export function projectSourceScopeSql({ sourceAlias, engagementParam }) {
  return `(${uploadedToProjectSql({
    organizationSql: `${sourceAlias}.organization_id`,
    sourceVersionMatchSql: `scope_sv.source_id = ${sourceAlias}.source_id`,
    engagementParam,
  })}
    OR ${reusedInProjectSql({
    organizationSql: `${sourceAlias}.organization_id`,
    evidenceMatchSql: `scope_ei.source_id = ${sourceAlias}.source_id`,
    engagementParam,
    extraJoinSql: `JOIN kai.evidence_items scope_ei
          ON scope_ei.organization_id = scope_gc.organization_id
         AND scope_ei.evidence_item_id = scope_gc.evidence_item_id`,
  })})`;
}
