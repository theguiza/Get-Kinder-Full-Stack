# BR-03A Board Reporting Candidate Review Request

- Adds `board_reporting_candidate_review` to the shared `kai.review_queue_items` queue type vocabulary.
- Adds a partial unique identity for one review request per `(organization_id, queue_type, target_object_type, target_object_id)`.
- Adds a Board-specific static queue contract for `target_object_type = 'board_reporting_candidate'` with `open / needs_gk_review` only.
- Does not create review start, completion, release authority, final eligibility, manifest, delivery, or a Board-specific queue table.
