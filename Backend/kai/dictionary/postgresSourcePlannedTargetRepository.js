import { validateComposedStatement } from '../validators/kaiSourceMeasurementValidators.js';
import { createHash } from 'node:crypto';
import { __sourceMeasurementRepositoryShared } from './postgresSourceMeasurementRepository.js';
import { __evidenceLineageRepositorySharedWrites } from './postgresEvidenceLineageRepository.js';
import { insertRequiredSuccessfulAuditEvent } from '../db/kaiAuditQueries.js';
import { getScopedSourceVersionEngagementReportingPeriod, listScopedEngagementDerivedMeasurementRows } from '../db/kaiIntakeQueries.js';
import { readPlanningTargetCandidates } from './planningTargetCandidateRead.js';
import { readSavedPlanningTargets } from './plannedTargetRead.js';
import { derivedContributingSourcesCurrent, derivedMeasurementArithmeticHolds, derivedMeasurementLabelsAdmitted } from '../validators/kaiDerivedMeasurementValidators.js';
import { composePlannedTargetStatement, saveablePlanningCandidate, validatePlannedTargetDecision, PLANNED_TARGET_EVIDENCE_TYPE, targetCoordinates } from '../validators/kaiSourcePlannedTargets.js';
const { loadMeasurableSourceVersion, failure, success, resolveDefaultRunInTransaction, RequiredMeasurementAuditRejectedError } = __sourceMeasurementRepositoryShared;
const { insertEvidenceReviewQueueItemIfAbsent, shapeEvidenceLineageError } = __evidenceLineageRepositorySharedWrites;
const hash = (x) => createHash('sha256').update(x).digest('hex');
const refuse = (reason) => failure('validation_blocker', [{ validator_key: 'VAL-KAI-PLAN-001', severity: 'blocker', object_type: 'source_planned_target', object_code: 'record_source_planned_target', object_id: null,
  blocking_reason: reason, message: reason.replaceAll('_',' '), required_fix: 'Refresh the source plan and answer only the specific relationship questions if applicable.', evidence: {} }]);

export function createPostgresSourcePlannedTargetRepository({ runInTransaction, insertAuditEvent = insertRequiredSuccessfulAuditEvent, worker = null } = {}) {
  async function transact(body) {
    const run = runInTransaction || await resolveDefaultRunInTransaction();
    return run(body).catch((error) => {
      if (error instanceof RequiredMeasurementAuditRejectedError) return failure('validation_blocker');
      return failure(shapeEvidenceLineageError(error).error.code);
    });
  }
  async function admitPlanSource(tx, input) {
    const admitted=await loadMeasurableSourceVersion(tx,input);
    if (!admitted.ok) return admitted;
    const { rows:[version] }=await tx.query('SELECT is_current,profile_canonical_sha256 FROM kai.source_versions WHERE organization_id=$1 AND source_version_id=$2 FOR SHARE',[input.organizationId,input.sourceVersionId]);
    if (!version?.is_current || version.profile_canonical_sha256 !== admitted.fileProfileRow.profile_canonical_sha256) return {ok:false,failure:failure('conflict_current_state_changed')};
    return admitted;
  }
  async function audit(tx, { organizationId, actorUserId, id, now }) {
    const r = await insertAuditEvent({ operation: 'record_source_planned_target', operation_type: 'record_source_planned_target', actor_user_id: actorUserId, actor_type: 'human', organization_id: organizationId,
      object_type: 'source_planned_target', target_object_type: 'source_planned_target', object_id: id, reason_code: 'source_planned_target_recorded', validator_key: 'VAL-KAI-PLAN-001', created_at: now }, tx);
    if (r?.ok !== true) throw new RequiredMeasurementAuditRejectedError();
  }
  async function evidence(tx, { target, decision, actual = null, actorUserId }) {
    const statement = composePlannedTargetStatement({ ...target, ...decision, actual_value: actual ? (actual.percentage ?? actual.measured_value) : null, actual_source_version_id: actual?.source_version_id });
    // Any refusal after a write must throw, ensuring transaction rollback.
    if (!validateComposedStatement(statement).ok) throw new Error('planned target statement exceeds supported evidence representation');
    const fingerprint = hash(`${target.organization_id}|${target.source_version_id}|${PLANNED_TARGET_EVIDENCE_TYPE}|${decision.decision_id}|${statement}`);
    const { rows: [e] } = await tx.query(`INSERT INTO kai.evidence_items
      (organization_id,source_id,source_version_id,source_locator_id,evidence_type,data_class,sensitivity_level,support_strength,statement,statement_fingerprint,created_by,created_by_type)
      VALUES ($1,$2,$3,$4,'source_planned_target','source_derived_aggregate','unknown','unassessed',$5,$6,$7,'human') RETURNING *`,
    [target.organization_id, target.source_id, target.source_version_id, target.source_locator_id, statement, fingerprint, actorUserId]);
    await tx.query(`INSERT INTO kai.evidence_planned_targets (evidence_item_id,organization_id,planned_target_id,decision_id) VALUES ($1,$2,$3,$4)`, [e.evidence_item_id,target.organization_id,target.planned_target_id,decision.decision_id]);
    if (!(await insertEvidenceReviewQueueItemIfAbsent(tx, { organizationId: target.organization_id, evidenceItemId: e.evidence_item_id, createdByType: 'system' }))) throw new Error('planned target evidence queue missing');
    return e;
  }
  async function insertDecision(tx, { target, input, supersedes = null, actorUserId, now }) {
    return (await tx.query(`INSERT INTO kai.planned_target_decisions (organization_id,planned_target_id,supersedes_decision_id,actual_measurement_id,relationship_status,comparison,metric_confirmed,population_confirmed,date_basis_confirmed,created_by,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [target.organization_id,target.planned_target_id,supersedes,input.actual_measurement_id ?? null,input.relationship_status,input.comparison,input.metric_confirmed,input.population_confirmed,input.date_basis_confirmed,actorUserId,now])).rows[0];
  }
  return Object.freeze({
    async saveSourcePlannedTargets({ organizationId, sourceVersionId, worksheetKey, selection, actorUserId, now }) {
      return transact(async (tx) => {
        const loaded = await admitPlanSource(tx, { organizationId, sourceVersionId, worksheetKey, operation: 'record_source_planned_target' });
        if (!loaded.ok) return loaded.failure;
        const { fileProfileRow, sourceVersionRow } = loaded;
        const period = await getScopedSourceVersionEngagementReportingPeriod({ organizationId, sourceVersionId }, tx);
        if (!period?.engagement_id) return refuse('planned_target_project_missing');
        const planning = await readPlanningTargetCandidates(tx, { organizationId, fileProfileRow, profile: fileProfileRow.profile, worksheetKey, sourceVersionRow, engagementId: period.engagement_id, worker });
        if (selection.profile_canonical_sha256 !== fileProfileRow.profile_canonical_sha256 || selection.source_checksum !== fileProfileRow.checksum) return failure('conflict_current_state_changed');
        const candidates = selection.row_numbers.map((n) => planning?.candidates?.find((c) => c.row_number === n));
        if (candidates.some((c) => !saveablePlanningCandidate(c))) return refuse('planned_target_candidate_invalid');
        let changed = false;
        const results = [];
        for (const candidate of candidates) {
          let saved = (await readSavedPlanningTargets(tx, { organizationId, sourceVersionId, worksheetKey })).find((p) => p.row_number === candidate.row_number);
          if (saved) {
            results.push({ target: saved, evidenceItem: { evidence_item_id: saved.evidence_item_id }, replayed: true });
            continue;
          }
          const coords = targetCoordinates(candidate);
          const lp = hash(`${organizationId}|${sourceVersionId}|planning_target_row|${JSON.stringify(coords)}`);
          const { rows: [insertedLocator] } = await tx.query(`INSERT INTO kai.source_locators (organization_id,source_version_id,locator_type,coordinates,locator_fingerprint,created_by_type)
            VALUES ($1,$2,'planning_target_row',$3::jsonb,$4,'system') ON CONFLICT (organization_id,source_version_id,locator_fingerprint) DO NOTHING RETURNING *`, [organizationId,sourceVersionId,JSON.stringify(coords),lp]);
          const locator = insertedLocator || (await tx.query('SELECT * FROM kai.source_locators WHERE organization_id=$1 AND source_version_id=$2 AND locator_fingerprint=$3', [organizationId,sourceVersionId,lp])).rows[0];
          // Only allow the canonical coordinates for this exact identity.
          if (locator.locator_type !== 'planning_target_row' || locator.coordinates.row_number !== candidate.row_number || locator.coordinates.sheet_key !== worksheetKey) throw new Error('planned target locator mismatch');
          const { rows: [target] } = await tx.query(`INSERT INTO kai.source_planned_targets
            (organization_id,engagement_id,source_id,source_version_id,source_locator_id,worksheet_key,row_number,file_profile_id,profile_canonical_sha256,source_checksum,indicator,planned_value,unit,unit_kind,period_start,period_end,scope,source_comparison,created_by,created_at,supersedes_target_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,(SELECT old.planned_target_id FROM kai.source_planned_targets old
              WHERE old.organization_id=$1 AND old.engagement_id=$2 AND old.source_id=$3 AND old.source_version_id<>$4
                AND old.worksheet_key=$6 AND old.row_number=$7 AND old.indicator=$11 AND old.unit=$13 AND old.unit_kind=$14
                AND old.scope IS NOT DISTINCT FROM $17 AND old.period_start=$15::date AND old.period_end=$16::date
                AND NOT EXISTS (SELECT 1 FROM kai.source_planned_targets n WHERE n.supersedes_target_id=old.planned_target_id)))
            RETURNING *, planned_value::text AS planned_value,period_start::text AS period_start,period_end::text AS period_end`,
          [organizationId,period.engagement_id,sourceVersionRow.source_id,sourceVersionId,locator.source_locator_id,worksheetKey,candidate.row_number,fileProfileRow.file_profile_id,fileProfileRow.profile_canonical_sha256,fileProfileRow.checksum,candidate.indicator,candidate.planned_value,candidate.unit || (candidate.unit_kind === 'percent' ? '%' : null),candidate.unit_kind,candidate.period.start,candidate.period.end,candidate.scope,candidate.comparator,actorUserId,now]);
          const decision = await insertDecision(tx, { target, actorUserId, now, input: { relationship_status:'unresolved',comparison:candidate.comparator,metric_confirmed:false,population_confirmed:false,date_basis_confirmed:false } });
          const e = await evidence(tx, { target, decision, actorUserId });
          await audit(tx, { organizationId, actorUserId, id: target.planned_target_id, now });
          changed = true;
          saved = (await readSavedPlanningTargets(tx, { organizationId, sourceVersionId, worksheetKey })).find((p) => p.row_number === candidate.row_number);
          results.push({ target: saved, evidenceItem: { evidence_item_id: e.evidence_item_id }, replayed: false });
        }
        return success({ targets: results, replayed: !changed });
      });
    },
    async recordSourcePlannedTargetDecision({ organizationId, plannedTargetId, decision: input, actorUserId, now }) {
      return transact(async (tx) => {
        const target = (await tx.query(`SELECT *, planned_value::text AS planned_value, period_start::text AS period_start, period_end::text AS period_end FROM kai.source_planned_targets WHERE organization_id=$1 AND planned_target_id=$2`, [organizationId,plannedTargetId])).rows[0];
        if (!target) return failure('not_found');
        const loaded = await admitPlanSource(tx, { organizationId,sourceVersionId:target.source_version_id,worksheetKey:target.worksheet_key,operation:'record_source_planned_target' });
        if (!loaded.ok) return loaded.failure;
        const current = (await readSavedPlanningTargets(tx, { organizationId,sourceVersionId:target.source_version_id,worksheetKey:target.worksheet_key })).find((p) => p.planned_target_id === plannedTargetId);
        let actual = null;
        if (input.actual_measurement_id) {
          const rows = await listScopedEngagementDerivedMeasurementRows({ organizationId,engagementId:target.engagement_id }, tx);
          actual = rows.find((r) => r.source_derived_measurement_id === input.actual_measurement_id && (r.interpretation_id ?? null) === (r.current_interpretation_id ?? null));
          if (actual) {
            actual = { ...actual, source_version_id: actual.measurement_source_version_id, is_current: actual.measurement_source_is_current, contributing_sources_current:derivedContributingSourcesCurrent(actual) };
            if (!derivedMeasurementArithmeticHolds(actual) || !derivedMeasurementLabelsAdmitted(actual)) return refuse('planned_target_actual_invalid');
            for (const source of [{ source_version_id:actual.source_version_id }, ...(actual.contributing_sources || [])]) {
              const a = await admitPlanSource(tx, { organizationId,sourceVersionId:source.source_version_id,operation:'record_source_planned_target' });
              if (!a.ok) return a.failure;
            }
          }
        }
        const valid = validatePlannedTargetDecision(input, { target,actual,actualEngagementId:actual ? target.engagement_id : null });
        if (!valid.ok) return refuse(valid.reason);
        const keys = ['actual_measurement_id','relationship_status','comparison','metric_confirmed','population_confirmed','date_basis_confirmed'];
        const same = keys.every((k) => (current[k] ?? null) === (input[k] ?? null));
        if (current.decision_id !== input.expected_decision_id) {
          if (!(same && current.supersedes_decision_id === input.expected_decision_id)) return failure('conflict_current_state_changed');
        }
        if (same) return success({ target: current, evidenceItem: { evidence_item_id:current.evidence_item_id }, replayed:true });
        const decision = await insertDecision(tx, { target,input,supersedes:current.decision_id,actorUserId,now });
        const e = await evidence(tx, { target,decision,actual,actorUserId });
        await audit(tx, { organizationId,actorUserId,id:decision.decision_id,now });
        const saved = (await readSavedPlanningTargets(tx, { organizationId,sourceVersionId:target.source_version_id,worksheetKey:target.worksheet_key })).find((p) => p.planned_target_id === plannedTargetId);
        return success({ target:saved,evidenceItem:{ evidence_item_id:e.evidence_item_id },replayed:false });
      });
    },
  });
}
