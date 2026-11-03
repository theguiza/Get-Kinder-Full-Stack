import { withTransaction } from "../db/kaiDb.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Read-only lookups behind an organization administrator's receipt of an
 * already GK-released internal report (Plan A Prompt 8). They only locate a
 * P3-19 export manifest and what it is bound to; whether it may be retrieved
 * now is decided by the existing render-model repository, which re-runs
 * candidate currentness and the P3-18 final export gate (effective release
 * authority, current-use eligibility, audience) on every render.
 */
export function createPostgresClientReleasedReportRepository({ runInTransaction = withTransaction } = {}) {
  async function readOnly(callback) {
    return runInTransaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      return callback(tx);
    });
  }

  return Object.freeze({
    // The manifest's own candidate audience, content type, and draft, scoped
    // to the organization; null when the organization has no such manifest.
    async readReleasedReportScope({ organizationId, exportManifestId }) {
      if (!UUID_PATTERN.test(organizationId) || !UUID_PATTERN.test(exportManifestId)) return null;
      return readOnly(async (tx) => {
        const { rows } = await tx.query(
          `SELECT m.export_manifest_id::text AS export_manifest_id,
                  c.generated_content_draft_id::text AS generated_content_draft_id,
                  c.requested_audience,
                  c.content_type
             FROM kai.export_manifests m
             JOIN kai.export_candidates c
               ON c.organization_id = m.organization_id
              AND c.export_candidate_id = m.export_candidate_id
            WHERE m.organization_id = $1::uuid AND m.export_manifest_id = $2::uuid`,
          [organizationId, exportManifestId],
        );
        const row = rows[0];
        return row
          ? {
              exportManifestId: row.export_manifest_id,
              generatedContentDraftId: row.generated_content_draft_id,
              requestedAudience: row.requested_audience,
              contentType: row.content_type,
            }
          : null;
      });
    },

    // The source versions a released manifest's content cites - each cited
    // evidence item's own version and every contributing version of a
    // multi-source measurement - with each version's currentness now and,
    // for one that is no longer current, its logical source's current
    // version. Read-only: the release, its manifest and its provenance are
    // never changed; this only tells a reader why the release is historical.
    async readReleasedReportSourceProvenance({ organizationId, exportManifestId }) {
      if (!UUID_PATTERN.test(organizationId) || !UUID_PATTERN.test(exportManifestId)) return null;
      return readOnly(async (tx) => {
        const { rows } = await tx.query(
          `SELECT DISTINCT e.source_id::text AS source_id, e.source_version_id::text AS source_version_id, e.evidence_type,
                  e.evidence_item_id::text AS evidence_item_id
             FROM kai.export_manifests m
             JOIN kai.export_candidates c ON c.organization_id = m.organization_id AND c.export_candidate_id = m.export_candidate_id
             JOIN kai.generated_content_blocks b ON b.organization_id = c.organization_id AND b.generated_content_draft_id = c.generated_content_draft_id
             JOIN kai.generated_content_citations gc ON gc.generated_content_block_id = b.generated_content_block_id
             JOIN kai.evidence_items e ON e.organization_id = gc.organization_id AND e.evidence_item_id = gc.evidence_item_id
            WHERE m.organization_id = $1::uuid AND m.export_manifest_id = $2::uuid`,
          [organizationId, exportManifestId],
        );
        const versions = new Map(rows.map((row) => [row.source_version_id, { sourceId: row.source_id, sourceVersionId: row.source_version_id, role: "evidence" }]));
        const derivedEvidenceIds = rows.filter((row) => row.evidence_type === "source_derived_measurement").map((row) => row.evidence_item_id);
        if (derivedEvidenceIds.length > 0) {
          const contributors = await tx.query(
            `SELECT DISTINCT sv.source_id::text AS source_id, s.source_version_id::text AS source_version_id, s.source_role
               FROM kai.evidence_derived_measurements edm
               JOIN kai.source_derived_measurement_sources s
                 ON s.organization_id = edm.organization_id AND s.source_derived_measurement_id = edm.source_derived_measurement_id
               JOIN kai.source_versions sv ON sv.organization_id = s.organization_id AND sv.source_version_id = s.source_version_id
              WHERE edm.organization_id = $1::uuid AND edm.evidence_item_id = ANY($2::uuid[])`,
            [organizationId, derivedEvidenceIds],
          );
          for (const row of contributors.rows) {
            if (!versions.has(row.source_version_id)) versions.set(row.source_version_id, { sourceId: row.source_id, sourceVersionId: row.source_version_id, role: row.source_role });
          }
        }
        if (versions.size === 0) return { citedSourceVersions: [] };
        const state = await tx.query(
          `SELECT sv.source_version_id::text AS source_version_id, sv.is_current,
                  (SELECT cur.source_version_id::text FROM kai.source_versions cur
                    WHERE cur.organization_id = sv.organization_id AND cur.source_id = sv.source_id AND cur.is_current = true) AS current_source_version_id
             FROM kai.source_versions sv
            WHERE sv.organization_id = $1::uuid AND sv.source_version_id = ANY($2::uuid[])`,
          [organizationId, [...versions.keys()]],
        );
        const byId = new Map(state.rows.map((row) => [row.source_version_id, row]));
        return {
          citedSourceVersions: [...versions.values()]
            .map((version) => ({
              ...version,
              isCurrent: byId.get(version.sourceVersionId)?.is_current === true,
              currentSourceVersionId: byId.get(version.sourceVersionId)?.current_source_version_id ?? null,
            }))
            .sort((a, b) => (a.sourceVersionId < b.sourceVersionId ? -1 : 1)),
        };
      });
    },

    // The draft's most recent internal-audience manifest (the latest release),
    // or null when nothing has been released for it, with the role recorded
    // on the final-release decision the manifest was made under (gk_admin, or
    // client_admin for the organization's own release, owner amendment
    // 2026-10-23).
    async readLatestInternalReleaseForDraft({ organizationId, generatedContentDraftId }) {
      if (!UUID_PATTERN.test(organizationId) || !UUID_PATTERN.test(generatedContentDraftId)) return null;
      return readOnly(async (tx) => {
        const { rows } = await tx.query(
          `SELECT m.export_manifest_id::text AS export_manifest_id, d.decided_by_role
             FROM kai.export_manifests m
             JOIN kai.export_candidates c
               ON c.organization_id = m.organization_id
              AND c.export_candidate_id = m.export_candidate_id
             JOIN kai.human_authority_decisions d
               ON d.organization_id = m.organization_id
              AND d.decision_id = m.effective_authority_decision_id
            WHERE m.organization_id = $1::uuid
              AND c.generated_content_draft_id = $2::uuid
              AND c.requested_audience = 'internal'
            ORDER BY m.created_at DESC, m.export_manifest_id DESC
            LIMIT 1`,
          [organizationId, generatedContentDraftId],
        );
        return rows[0] ? { exportManifestId: rows[0].export_manifest_id, decidedByRole: rows[0].decided_by_role } : null;
      });
    },
  });
}
