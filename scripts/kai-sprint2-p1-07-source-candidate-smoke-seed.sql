BEGIN;

-- P1-07 owner decision: this smoke seed intentionally inserts no new fixtures.
-- The existing, unmodified Gate A/P1-04/P1-05/P1-06 smoke seeds already committed
-- two independent, predicate-satisfying P1-05 sensitivity profiles under org1:
-- sensitivity1 (org1/file1/profile1/dictionary1, 80000000-0000-4000-8000-000000000001)
-- and sensitivity2 (org1/file1/profile2/dictionary2,
-- 80000000-0000-4000-8000-000000000002), each already at its fail-closed
-- VAL-KAI-P1-07-001 predicate default (human_review_required = true,
-- public/funder/llm/product_learning_allowed = false, retention_posture =
-- 'restricted_pending_review'). P1-06 already uses both of these same two rows as
-- its own two independent 'sensitivity_review' targets; P1-07 reuses them as its
-- own two independent 'source_candidate_review' targets. The two packages' queue
-- rows never collide because they use different queue_type and target_object_type
-- values, and a fresh kai.intake_source_candidates row (with its own generated id)
-- is what P1-07's target_object_id actually references - never the sensitivity
-- profile id directly. No new intake_file, file_profile, data_dictionary, or
-- sensitivity_profile row is required to exercise P1-07.

COMMIT;
