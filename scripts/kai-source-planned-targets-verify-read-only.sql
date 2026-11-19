-- Catalog-only postcondition checks. Run in a read-only transaction.
WITH checks(check_id, passed) AS (
 SELECT 'tables', count(*) = 3 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='kai' AND c.relname IN ('source_planned_targets','planned_target_decisions','evidence_planned_targets') AND c.relkind='r'
 UNION ALL
 SELECT 'tenant_foreign_keys', count(*) = 8 AND bool_and(convalidated)
 FROM pg_constraint WHERE conrelid IN (to_regclass('kai.source_planned_targets'),to_regclass('kai.planned_target_decisions'),to_regclass('kai.evidence_planned_targets')) AND contype='f'
 UNION ALL
 SELECT 'append_only_and_integrity', count(*) = 6 AND bool_and(tgenabled='O') FROM pg_trigger
 WHERE tgrelid IN (to_regclass('kai.source_planned_targets'),to_regclass('kai.planned_target_decisions'),to_regclass('kai.evidence_planned_targets')) AND NOT tgisinternal
 UNION ALL
 SELECT 'nullable_actual_and_comparison',count(*)=2 AND bool_and(NOT attnotnull) FROM pg_attribute WHERE attrelid=to_regclass('kai.planned_target_decisions') AND attname IN ('actual_measurement_id','comparison')
 UNION ALL
 SELECT 'linear_history_and_row_identity', count(*)=4 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
 WHERE c.relname IN ('planned_target_decisions_root','planned_target_decisions_successor','source_planned_targets_row_unique','source_planned_targets_successor') AND i.indrelid IN (to_regclass('kai.source_planned_targets'),to_regclass('kai.planned_target_decisions')) AND i.indisunique AND i.indisvalid
 UNION ALL
 SELECT 'evidence_vocabulary', EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='kai.evidence_items'::regclass AND conname='evidence_items_p2_01_evidence_type_check' AND pg_get_constraintdef(oid) LIKE '%source_planned_target%')
 UNION ALL
 SELECT 'locator_vocabulary', EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='kai.source_locators'::regclass AND conname='source_locators_p2_01_coordinates_check' AND pg_get_constraintdef(oid) LIKE '%planning_target_row%')
 UNION ALL
 SELECT 'manual_targets_preserved', EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='kai.measurement_targets'::regclass AND attname='set_on_measurement_id' AND attnotnull)
)
SELECT check_id,CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS status FROM checks
UNION ALL SELECT 'OVERALL',CASE WHEN bool_and(passed) THEN 'PASS' ELSE 'FAIL' END FROM checks ORDER BY check_id;
