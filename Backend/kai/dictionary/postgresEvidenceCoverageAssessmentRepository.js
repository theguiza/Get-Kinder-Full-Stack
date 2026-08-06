import {
  getScopedSourceVersionById,
  getScopedSourceById,
  getScopedSourceCandidateByIdentity,
  getScopedPromotionDecisionBySourceVersionId,
  getScopedDataDictionaryById,
} from "../db/kaiIntakeQueries.js";

/**
 * KAI P2-02 deterministic evidence-coverage-assessment repository adapter:
 * read-only, tenant-scoped assembly of the exact committed rows the P2-02
 * assessment validators need, and nothing else. This module performs no
 * write, no lock acquisition beyond what the reused `getScoped*` lookups
 * already take, and no row mutation of any kind.
 *
 * This module is the only authorized location for P2-02's own SQL, other than
 * the reused `getScoped*` lookups already committed to
 * Backend/kai/db/kaiIntakeQueries.js by P1-08/P2-01. The two reads owned here
 * (the full data-dictionary-field projection and the evidence/locator
 * coverage projection) are additive: they read columns no existing exported
 * query already selects (`business_meaning`, `entity_level` on
 * kai.data_dictionary_fields; the evidence-to-locator column-name join), and
 * they change no existing table, index, or exported function.
 *
 * Every fact this package reads is already committed by P1-04/P1-05/P1-08/
 * P2-01: it never reads `kai.intake_file_profiles.profile` (machine-generated
 * profiling metadata), a raw sample value, a storage location, a signed URL,
 * a credential, a prompt, or any unrestricted audit metadata.
 */

const EVIDENCE_COVERAGE_ASSESSMENT_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  not_found: 404,
  system_error: 500,
});

function assessmentFailure(code) {
  return {
    ok: false,
    data: null,
    error: {
      code,
      status: EVIDENCE_COVERAGE_ASSESSMENT_RESULT_STATUS[code] || 500,
    },
  };
}

function assessmentSuccess(data) {
  return { ok: true, data, error: null };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * P2-02 narrow, tenant-scoped, additive read of one committed
 * `kai.intake_sensitivity_profiles` row, including every lineage/permission
 * column the reused `getScopedSensitivityProfileById` export already selects
 * (needed by `validateEvidenceHasSourceLineage`) plus the two P2-02-owned
 * dimension columns that export does not select: `small_cell_risk_status`
 * (assessSmallCellRisk) and `allowed_use_status` (the P2-02 allowed-use fail-
 * closed gate). Added here rather than widening the existing P2-01-owned
 * export, so no other package's read shape changes. Never locked FOR UPDATE:
 * this package never mutates this table.
 */
async function readSensitivityProfileForAssessment({ organizationId, intakeSensitivityProfileId }, db) {
  const { rows } = await db.query(
    `SELECT organization_id::text AS organization_id,
            intake_sensitivity_profile_id::text AS intake_sensitivity_profile_id,
            intake_file_id::text AS intake_file_id,
            file_profile_id::text AS file_profile_id,
            data_dictionary_id::text AS data_dictionary_id,
            profile_canonical_sha256,
            human_review_required,
            public_use_allowed,
            funder_use_allowed,
            llm_processing_allowed,
            product_learning_allowed,
            retention_posture,
            small_cell_risk_status,
            allowed_use_status
       FROM kai.intake_sensitivity_profiles
      WHERE organization_id = $1
        AND intake_sensitivity_profile_id = $2`,
    [organizationId, intakeSensitivityProfileId],
  );
  return rows[0] || null;
}

/**
 * P2-02 narrow, tenant-scoped, additive read of every committed
 * `kai.data_dictionary_fields` row for one dictionary, including the
 * `business_meaning`/`entity_level` columns the existing P2-01-owned
 * `getScopedDataDictionaryFieldsByDictionaryId` export does not select.
 * Ordered deterministically by `profile_field_key ASC`, exactly like that
 * export, so assessment composition is reproducible run to run. Never locked
 * FOR UPDATE: this package never mutates this table.
 */
async function readDataDictionaryFieldsForAssessment({ organizationId, dataDictionaryId }, db) {
  const { rows } = await db.query(
    `SELECT data_dictionary_field_id, profile_field_key, data_type, business_meaning, entity_level, sensitivity
       FROM kai.data_dictionary_fields
      WHERE organization_id = $1
        AND data_dictionary_id = $2
      ORDER BY profile_field_key ASC`,
    [organizationId, dataDictionaryId],
  );
  return rows;
}

/**
 * P2-02 narrow, tenant-scoped, additive read of every committed, open
 * `kai.data_quality_findings` row for one dictionary. Ordered deterministically
 * by `finding_type ASC, profile_field_key ASC` (never by `created_at`, which
 * carries no assessment meaning here) so assessment composition is
 * reproducible run to run.
 */
async function readDataQualityFindingsForAssessment({ organizationId, dataDictionaryId }, db) {
  const { rows } = await db.query(
    `SELECT data_quality_finding_id, profile_field_key, finding_type, finding_status
       FROM kai.data_quality_findings
      WHERE organization_id = $1
        AND data_dictionary_id = $2
      ORDER BY finding_type ASC, profile_field_key ASC`,
    [organizationId, dataDictionaryId],
  );
  return rows;
}

/**
 * P2-02 narrow, tenant-scoped, additive read of the committed `column_name`
 * coordinate for every P2-01 evidence item already bound to this exact
 * source_version, via the source_locator each evidence item is required to
 * carry. This is the only fact `assessCoverageGaps` may use to decide which
 * dictionary fields already have committed evidence - never a sample value, a
 * count alone, or an inferred mapping. Ordered deterministically by
 * `profile_field_key ASC`.
 */
async function readEvidenceCoverageFieldKeys({ organizationId, sourceVersionId }, db) {
  const { rows } = await db.query(
    `SELECT sl.coordinates ->> 'column_name' AS profile_field_key
       FROM kai.evidence_items e
       JOIN kai.source_locators sl
         ON sl.source_locator_id = e.source_locator_id
        AND sl.organization_id = e.organization_id
      WHERE e.organization_id = $1
        AND e.source_version_id = $2
      ORDER BY sl.coordinates ->> 'column_name' ASC`,
    [organizationId, sourceVersionId],
  );
  return rows.map((row) => row.profile_field_key);
}

async function resolveDefaultRunInTransaction() {
  const { withTransaction } = await import("../db/kaiDb.js");
  return withTransaction;
}

export function createPostgresEvidenceCoverageAssessmentRepository({ runInTransaction } = {}) {
  return Object.freeze({
    /**
     * Reads every row the P2-02 assessment validators need for one
     * organization-scoped source_version, without applying any fail-closed
     * lineage/permission judgment itself - that judgment belongs entirely to
     * `validateEvidenceCoverageAssessmentIsPermitted` in the validators
     * module, over the rows this function returns. A missing row anywhere in
     * the lineage chain is returned as `null` here, never fabricated and
     * never silently skipped.
     */
    async readEvidenceCoverageAssessmentFacts({ organizationId, sourceVersionId }) {
      if (!isNonEmptyString(organizationId) || !isNonEmptyString(sourceVersionId)) {
        return assessmentFailure("validation_blocker");
      }
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      try {
        return await run(async (tx) => {
          const sourceVersionRow = await getScopedSourceVersionById({ organizationId, sourceVersionId }, tx);

          const sourceRow = sourceVersionRow
            ? await getScopedSourceById({ organizationId, sourceId: sourceVersionRow.source_id }, tx)
            : null;

          const candidateRow = sourceVersionRow
            ? await getScopedSourceCandidateByIdentity(
              { organizationId, intakeSourceCandidateId: sourceVersionRow.intake_source_candidate_id },
              tx,
            )
            : null;

          const decisionRow = await getScopedPromotionDecisionBySourceVersionId({ organizationId, sourceVersionId }, tx);

          const profileRow = candidateRow
            ? await readSensitivityProfileForAssessment(
              { organizationId, intakeSensitivityProfileId: candidateRow.intake_sensitivity_profile_id },
              tx,
            )
            : null;

          const dictionaryRow = candidateRow
            ? await getScopedDataDictionaryById({ organizationId, dataDictionaryId: candidateRow.data_dictionary_id }, tx)
            : null;

          const dictionaryFieldRows = dictionaryRow
            ? await readDataDictionaryFieldsForAssessment({ organizationId, dataDictionaryId: dictionaryRow.data_dictionary_id }, tx)
            : [];

          const qualityFindingRows = dictionaryRow
            ? await readDataQualityFindingsForAssessment({ organizationId, dataDictionaryId: dictionaryRow.data_dictionary_id }, tx)
            : [];

          const evidenceFieldKeys = await readEvidenceCoverageFieldKeys({ organizationId, sourceVersionId }, tx);

          return assessmentSuccess({
            rows: {
              sourceVersionRow,
              sourceRow,
              candidateRow,
              decisionRow,
              profileRow,
              dictionaryRow,
              dictionaryFieldRows,
              qualityFindingRows,
              evidenceFieldKeys,
            },
          });
        });
      } catch (error) {
        return assessmentFailure(error?.code === "22P02" ? "validation_blocker" : "system_error");
      }
    },
  });
}

export const __evidenceCoverageAssessmentRepositoryTestables = Object.freeze({
  readSensitivityProfileForAssessment,
  readDataDictionaryFieldsForAssessment,
  readDataQualityFindingsForAssessment,
  readEvidenceCoverageFieldKeys,
});
