import { composePlannedTargetStatement, PLANNED_TARGET_EVIDENCE_TYPE } from '../validators/kaiSourcePlannedTargets.js';

export const PLAN_SELECT = `p.*, p.planned_value::text AS planned_value, p.period_start::text AS period_start, p.period_end::text AS period_end,
 d.decision_id, d.supersedes_decision_id, d.actual_measurement_id, d.relationship_status, d.comparison,
 d.metric_confirmed, d.population_confirmed, d.date_basis_confirmed,
 CASE WHEN a.measurement_family IN ('tabular_rate','paired_outcome_change') THEN a.percentage::text ELSE a.measured_value::text END AS actual_value,
 a.source_version_id AS actual_source_version_id, av.source_id AS actual_source_id, av.is_current AS actual_is_current,
 a.profile_canonical_sha256 AS actual_profile_canonical_sha256, a.worksheet_key AS actual_worksheet_key,
 l.evidence_item_id, e.statement, c.claim_id,
 NOT EXISTS (SELECT 1 FROM kai.planned_target_decisions n WHERE n.supersedes_decision_id = d.decision_id) AS decision_is_current`;
export const PLAN_FROM = `kai.source_planned_targets p JOIN kai.planned_target_decisions d USING (planned_target_id, organization_id)
 LEFT JOIN kai.source_derived_measurements a ON a.source_derived_measurement_id = d.actual_measurement_id AND a.organization_id = d.organization_id
 LEFT JOIN kai.source_versions av ON av.source_version_id = a.source_version_id AND av.organization_id = a.organization_id
 LEFT JOIN kai.evidence_planned_targets l ON l.decision_id = d.decision_id AND l.organization_id = d.organization_id
 LEFT JOIN kai.evidence_items e ON e.evidence_item_id = l.evidence_item_id AND e.organization_id = l.organization_id
 LEFT JOIN kai.claims c ON c.evidence_item_id = e.evidence_item_id AND c.organization_id = e.organization_id`;
export async function readSavedPlanningTargets(tx, { organizationId, sourceVersionId, worksheetKey }) {
  return (await tx.query(`SELECT ${PLAN_SELECT} FROM ${PLAN_FROM}
    WHERE p.organization_id = $1 AND p.source_version_id = $2 AND p.worksheet_key = $3
      AND NOT EXISTS (SELECT 1 FROM kai.planned_target_decisions n WHERE n.supersedes_decision_id = d.decision_id)
    ORDER BY p.row_number`, [organizationId, sourceVersionId, worksheetKey])).rows;
}
export async function readPlannedTargetEvidence(tx, { organizationId, evidenceItemId }) {
  return (await tx.query(`SELECT ${PLAN_SELECT} FROM ${PLAN_FROM} WHERE p.organization_id = $1 AND l.evidence_item_id = $2`, [organizationId, evidenceItemId])).rows[0] || null;
}
export function plannedEvidenceIntact({ row, evidenceItemRow, locatorRow, sourceVersionRow, requireCurrentDecision = true }) {
  return Boolean(row && evidenceItemRow?.evidence_type === PLANNED_TARGET_EVIDENCE_TYPE
    && row.organization_id === evidenceItemRow.organization_id
    && row.source_id === evidenceItemRow.source_id && row.source_version_id === evidenceItemRow.source_version_id
    && row.source_locator_id === evidenceItemRow.source_locator_id && locatorRow?.source_locator_id === row.source_locator_id
    && locatorRow.source_version_id === row.source_version_id && locatorRow.locator_type === 'planning_target_row'
    && locatorRow.coordinates?.sheet_key === row.worksheet_key && locatorRow.coordinates?.row_number === row.row_number
    && row.profile_canonical_sha256 === sourceVersionRow?.profile_canonical_sha256
    && sourceVersionRow?.is_current === true && (!requireCurrentDecision || row.decision_is_current)
    && (row.relationship_status !== 'confirmed' || row.actual_is_current === true)
    && composePlannedTargetStatement(row) === evidenceItemRow.statement);
}

// Every actual source cited by a confirmed relationship (including the
// register of a linked measurement). Reused by processing and saved delivery.
export async function readPlannedTargetContributors(tx, { organizationId, evidenceItemId }) {
  return (await tx.query(`SELECT DISTINCT v.source_id, v.source_version_id, v.intake_sensitivity_profile_id, v.is_current,
      v.profile_canonical_sha256, x.profile_canonical_sha256 AS measured_profile_canonical_sha256
    FROM kai.evidence_planned_targets l JOIN kai.planned_target_decisions d USING (decision_id,organization_id)
    JOIN kai.source_derived_measurements a ON a.source_derived_measurement_id=d.actual_measurement_id AND a.organization_id=d.organization_id
    CROSS JOIN LATERAL (
      SELECT a.source_version_id,a.profile_canonical_sha256
      UNION SELECT s.source_version_id,s.profile_canonical_sha256 FROM kai.source_derived_measurement_sources s
        WHERE s.source_derived_measurement_id=a.source_derived_measurement_id AND s.organization_id=a.organization_id
    ) x JOIN kai.source_versions v ON v.source_version_id=x.source_version_id AND v.organization_id=a.organization_id
    WHERE l.organization_id=$1 AND l.evidence_item_id=$2 AND d.relationship_status='confirmed'`, [organizationId,evidenceItemId])).rows;
}
