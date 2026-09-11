BEGIN;

-- P14-10 rollback is intentionally NOT a full reversal.
--
-- The forward migration removes an obsolete, pre-P1-06
-- review_queue_items_target_object_type_check fixed allowlist that was only
-- ever observed as a proven production-drift artifact - its complete
-- original vocabulary is not recorded anywhere in this repository (only the
-- fact, from the USER_CONFIRMED production snapshot, that it excluded
-- 'generated_content_draft'). Restoring "the legacy allowlist" is therefore
-- not something this rollback can do faithfully at all: reconstructing an
-- unknown allowlist and calling it a rollback would be pretending safety
-- that does not exist.
--
-- Even setting that aside, restoring ANY fixed target_object_type allowlist
-- narrower than the canonical P1-06 length bound is unsafe/impossible once
-- kai.review_queue_items holds rows for the target_object_type values every
-- package after P1-06 already writes under the canonical contract
-- (generated_content_draft, plus evidence/claim/client_followup/
-- conflict_resolution/export_review targets, and any future queue_type's
-- target) - a real re-narrowing would immediately violate on that existing,
-- legitimate data, or silently re-admit the exact incompatibility this
-- migration exists to remove.
--
-- This rollback therefore only proves whether restoring any allowlist
-- narrower than the canonical bound is even theoretically safe against
-- current data (it never is, once generated_content_draft or any other
-- post-P1-06 target has been written), and refuses outright rather than
-- perform a destructive or fictitious reversal. It does not touch
-- review_queue_items_p1_06_target_object_type_check or
-- review_queue_items_p3_04_generated_content_review_contract_check.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM kai.review_queue_items WHERE target_object_type = 'generated_content_draft'
  ) THEN
    RAISE EXCEPTION 'P14-10 rollback refused: kai.review_queue_items already holds generated_content_draft rows persisted under the repaired canonical contract; re-narrowing target_object_type to any fixed allowlist that excludes them (the only condition the removed legacy constraint is known to have enforced) would be destructive, and the legacy allowlist''s original complete vocabulary is not recoverable from this repository. Resolve or explicitly authorize data handling before attempting any reversal.';
  END IF;

  RAISE EXCEPTION 'P14-10 rollback refused: the pre-P1-06 review_queue_items_target_object_type_check allowlist this migration removed was only ever a proven production-drift artifact, not a repository-owned contract - its complete original definition is unknown, so this rollback cannot faithfully restore it under any data condition. Manual, explicitly authorized action is required if reversal is ever genuinely intended.';
END $$;

COMMIT;
