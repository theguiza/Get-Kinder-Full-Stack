# BR-03A Board Reporting Candidate Review Request Runbook

1. Apply migrations through `migrations/kai_sprint2_br_02_board_reporting_candidate_foundation.sql`.
2. Apply `migrations/kai_sprint2_br_03a_board_reporting_candidate_review_request.sql`.
3. Run `scripts/kai-sprint2-br-03a-board-reporting-candidate-review-request-verifier.sql`.
4. Optionally run the smoke seed, smoke verifier, and failure checks in that order.
5. Rollback is a draft only and refuses to run while any `board_reporting_candidate_review` rows exist.
