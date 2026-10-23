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
