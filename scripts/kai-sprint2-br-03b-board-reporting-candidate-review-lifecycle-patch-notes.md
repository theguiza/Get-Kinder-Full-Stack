# BR-03B Board Reporting Candidate Review Lifecycle

- Widens the BR-03A `board_reporting_candidate_review` contract check from `open / needs_gk_review` only to the full lifecycle matrix: `open / needs_gk_review` (REQUEST), `in_progress / needs_gk_review` (START), `resolved / resolved` (COMPLETE).
- Every other static field (`target_object_type`, `priority`, `summary`, `required_action`, `blocked_reason`, `assigned_to`, `due_at`, `queue_metadata`, `created_by`, `created_by_type`) remains pinned exactly as BR-03A established it.
- Preserves the BR-03A partial unique review identity, the shared `queue_type` vocabulary, and every existing valid BR-03A REQUEST row unchanged.
- This turn implements Board review START only: `startBoardReportingCandidateReview` (service + repository + route) transitions an existing REQUEST row (`open / needs_gk_review`) to START (`in_progress / needs_gk_review`) under repository-standard optimistic concurrency (`expectedUpdatedAt`), with repository-standard replay semantics and a metadata-only start audit.
- Does not implement Board review completion, human final release authority, final eligibility, Board manifest, or Board delivery. The COMPLETE (`resolved / resolved`) pair is declared in the schema contract now (so the lifecycle CHECK is defined once) but no code path transitions into it yet.
- Never mutates the immutable `kai.board_reporting_candidates` / `kai.board_reporting_candidate_members` rows.
