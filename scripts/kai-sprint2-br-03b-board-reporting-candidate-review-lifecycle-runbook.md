# BR-03B Board Reporting Candidate Review Lifecycle Runbook

1. Apply migrations through `migrations/kai_sprint2_br_03a_board_reporting_candidate_review_request.sql`.
2. Apply `migrations/kai_sprint2_br_03b_board_reporting_candidate_review_lifecycle.sql`.
3. Run `scripts/kai-sprint2-br-03b-board-reporting-candidate-review-lifecycle-verifier.sql`.
4. Optionally run the smoke seed, smoke verifier, and failure checks in that order.
5. Rollback is a draft only and refuses to run while any `board_reporting_candidate_review` row exists outside the BR-03A REQUEST state (`open / needs_gk_review`) - i.e. any row already in START (`in_progress / needs_gk_review`) or COMPLETE (`resolved / resolved`).
6. This package does not apply to production and must only be exercised against an ephemeral/local PostgreSQL target.
