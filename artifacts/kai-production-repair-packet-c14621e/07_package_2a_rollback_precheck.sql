-- Step G: read-only Package 2A rollback precheck.
-- Expected result before any Package 2A rollback: exactly SAFE_TO_ROLL_BACK or
-- UNSAFE_TO_ROLL_BACK_WITH_EXISTING_DATA.
-- Stop condition: if the result is UNSAFE_TO_ROLL_BACK_WITH_EXISTING_DATA,
-- do not execute Package 2A rollback SQL.

WITH authority_state AS (
  SELECT EXISTS (
    SELECT 1
      FROM kai.engagement_requirement_sets
     WHERE reviewed_by IS NOT NULL
        OR reviewed_by_role IS NOT NULL
        OR reviewed_at IS NOT NULL
        OR applicability_effective_state <> 'pending_review'
        OR supersedes_engagement_requirement_set_id IS NOT NULL
        OR target_context_identity IS NOT NULL
  ) AS present
), restored_unique_conflict AS (
  SELECT EXISTS (
    SELECT 1
      FROM kai.engagement_requirement_sets
     GROUP BY organization_id, engagement_id, requirement_set_id
    HAVING count(*) > 1
  ) AS present
)
SELECT 'G_PACKAGE_2A_ROLLBACK_PRECHECK' AS result_type,
       CASE
         WHEN authority_state.present OR restored_unique_conflict.present
           THEN 'UNSAFE_TO_ROLL_BACK_WITH_EXISTING_DATA'
         ELSE 'SAFE_TO_ROLL_BACK'
       END AS rollback_precheck,
       authority_state.present AS package_2a_authority_state_present,
       restored_unique_conflict.present AS restored_unique_conflict_present
  FROM authority_state, restored_unique_conflict;
