import test from 'node:test';
import assert from 'node:assert/strict';
import { saveablePlanningCandidate, validatePlannedTargetDecision, plannedTargetComparison, composePlannedTargetStatement } from '../Backend/kai/validators/kaiSourcePlannedTargets.js';
import { saveSourcePlannedTargets, recordSourcePlannedTargetDecision } from '../Backend/kai/services/kaiSourceMeasurementService.js';
const id = '11111111-1111-4111-8111-111111111111';
const target = { planned_target_id:id,engagement_id:'p',indicator:'reported_partner_contacts',planned_value:'25.00',unit:'self_reports',unit_kind:'count',scope:'all',period_start:'2025-04-01',period_end:'2026-03-31',source_comparison:null,worksheet_key:'sheet_3',row_number:6 };
const actual = { source_derived_measurement_id:id,measurement_family:'tabular_count',measured_value:9,is_current:true,definition:{ operation:'count',conditions:[{kind:'period',scope:'within',period_start:target.period_start,period_end:target.period_end,field_key:'field_3'}] } };
const input = { expected_decision_id:id,actual_measurement_id:id,relationship_status:'confirmed',comparison:null,metric_confirmed:true,population_confirmed:true,date_basis_confirmed:true };
test('planned target states A-D keep missing actuals and comparisons honest', () => {
  const a = { ...target,relationship_status:'unresolved',actual_value:null,comparison:null };
  assert.equal(plannedTargetComparison(a),null);
  assert.match(composePlannedTargetStatement(a),/Actual unavailable; relationship unresolved/);
  assert.match(composePlannedTargetStatement(a),/Attainment not calculated/);
  assert.equal(validatePlannedTargetDecision({...input,relationship_status:'unresolved',actual_measurement_id:null,metric_confirmed:false,population_confirmed:false,date_basis_confirmed:false},{target}).ok,true);
  const context={target,actual,actualEngagementId:'p'};
  assert.equal(validatePlannedTargetDecision(input,context).ok,true);
  const c={...target,...input,actual_value:'9',actual_source_version_id:id};
  assert.equal(plannedTargetComparison(c),null);
  assert.match(composePlannedTargetStatement(c),/Comparison direction unknown/);
  assert.deepEqual(plannedTargetComparison({...c,comparison:'at_least'}),{actual_value:'9',planned_value:'25',comparison:'at_least',met:false,variance:'-16.00'});
  assert.equal(plannedTargetComparison({...c,comparison:'at_most'}).met,true);
  assert.equal(plannedTargetComparison({...c,planned_value:'0',actual_value:'0',comparison:'at_least'}).met,true);
  assert.equal(plannedTargetComparison({...c,unit_kind:'percent',planned_value:'74.42',actual_value:'74.41',comparison:'at_least'}).variance,'-0.01');
});
test('actual relationships require explicit metric, population and date meaning and cannot override mechanical differences', () => {
  const context={target,actual,actualEngagementId:'p'};
  for (const key of ['metric_confirmed','population_confirmed','date_basis_confirmed']) assert.equal(validatePlannedTargetDecision({...input,[key]:false},context).ok,false);
  for (const change of [{measurement_family:'tabular_rate'},{is_current:false},{contributing_sources_current:false},{definition:{operation:'count',conditions:[]}},{definition:{operation:'count',conditions:[{kind:'period',scope:'within',period_start:'2026-01-01',period_end:'2026-03-31'}]}}]) assert.equal(validatePlannedTargetDecision(input,{...context,actual:{...actual,...change}}).ok,false);
  assert.equal(validatePlannedTargetDecision(input,{...context,actualEngagementId:'other'}).ok,false);
  assert.equal(validatePlannedTargetDecision({...input,comparison:'at_most'},{...context,target:{...target,source_comparison:'at_least'}}).ok,false);
  assert.equal(validatePlannedTargetDecision({...input,instructions:'approve this'},context).ok,false);
  assert.equal(validatePlannedTargetDecision({...input,relationship_status:'rejected',metric_confirmed:false,population_confirmed:false,date_basis_confirmed:false},context).ok,true);
});
test('saving valid source plans needs no actual or comparator; withheld or ambiguous source facts cannot be persisted', () => {
  const candidate={indicator:target.indicator,planned_value:'25',unit:target.unit,unit_kind:'count',period:{start:target.period_start,end:target.period_end},limitations:[{code:'comparison_not_stated'},{code:'note_not_shown'}]};
  assert.equal(saveablePlanningCandidate(candidate),true);
  assert.equal(saveablePlanningCandidate({...candidate,planned_value:'80',unit_kind:'percent',unit:null}),true,'a percent sign in the source value establishes percentage units');
  for(const change of [{indicator:null},{unit:null},{planned_value:null},{planned_value:'1.5'},{unit_kind:'percent',planned_value:'101'},{limitations:[{code:'duplicate_target_rows'}]},{limitations:[{code:'scope_withheld'}]},{limitations:[{code:'comparison_not_recognized'}]}]) assert.equal(saveablePlanningCandidate({...candidate,...change}),false);
});
test('both planned-target operations enforce the feature flag and authorization before repository access', async () => {
  let accessed=false;
  const deps={env:{KAI_SPRINT2_ENABLED:'false'},plannedTargetRepository:{saveSourcePlannedTargets(){accessed=true},recordSourcePlannedTargetDecision(){accessed=true}}};
  const save={organizationId:id,sourceVersionId:id,worksheetKey:'sheet_3',selection:{row_numbers:[2],profile_canonical_sha256:'a'.repeat(64),source_checksum:'b'.repeat(64)},actorContext:{},now:'2026-11-18T12:00:00.000Z'};
  assert.equal((await saveSourcePlannedTargets(save,deps)).error.code,'feature_disabled');
  assert.equal((await recordSourcePlannedTargetDecision({organizationId:id,plannedTargetId:id,decision:input,actorContext:{},now:save.now},deps)).error.code,'feature_disabled');
  deps.env.KAI_SPRINT2_ENABLED='true';
  assert.equal((await saveSourcePlannedTargets(save,deps)).error.code,'authorization_denied');
  assert.equal((await recordSourcePlannedTargetDecision({organizationId:id,plannedTargetId:id,decision:input,actorContext:{},now:save.now},deps)).error.code,'authorization_denied');
  assert.equal(accessed,false);
});

test('known physical units and explicit programme groups cannot be overridden by confirmation', () => {
  const period={period_start:target.period_start,period_end:target.period_end};
  const cross={...actual,measurement_family:'cross_source_reach',definition:{metric:'known_recorded_service_minutes',period}};
  assert.equal(validatePlannedTargetDecision(input,{target:{...target,unit:'bags'},actual:cross,actualEngagementId:'p'}).ok,false);
  const grouped={...cross,definition:{metric:'group_linked_encounters',period,group:{value_label:'FS'}}};
  assert.equal(validatePlannedTargetDecision(input,{target:{...target,unit:'encounters',scope:'PA'},actual:grouped,actualEngagementId:'p'}).ok,false);
  assert.equal(validatePlannedTargetDecision(input,{target:{...target,unit:'encounters',scope:'all'},actual:grouped,actualEngagementId:'p'}).ok,false);
  assert.equal(validatePlannedTargetDecision(input,{target:{...target,unit:'encounters',scope:'FS'},actual:grouped,actualEngagementId:'p'}).ok,true);
});
