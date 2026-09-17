# KAI P13-EXT-2 Patch Notes - board_update Content-Type Evolution Verification Package

## Added

- `migrations/kai_sprint2_p13_ext2_board_update_content_type_evolution.sql`
  widens `generation_runs_p3_01_content_type_check`
  (`kai.generation_runs`) and `generated_content_drafts_p3_01_content_type_check`
  (`kai.generated_content_drafts`) from the P13-EXT-1 vocabulary
  (`evidence_summary`, `impact_narrative`, `readiness_assessment`,
  `data_gap_memo`, `case_for_support`) to add the sixth generated-content
  type, `board_update`.
- `migrations/kai_sprint2_p13_ext2_board_update_content_type_evolution.rollback.sql`
  restores the P13-EXT-1 vocabulary on both constraints, refusing (fails
  closed) if any `board_update` row already exists in either table.
- `migrations/kai_sprint2_p13_ext2_board_update_export_candidate_content_type_evolution.sql`
  widens the companion `export_candidates_p3_16_content_type_check`
  (`kai.export_candidates`) the same way.
- `migrations/kai_sprint2_p13_ext2_board_update_export_candidate_content_type_evolution.rollback.sql`
  restores the P13-EXT-1 vocabulary on that constraint, refusing if any
  `board_update` export-candidate row already exists.
- `scripts/kai-sprint2-p13-ext2-board-update-content-type-evolution-verifier.sql`
  (this package) verifies, read-only, that all three named constraints
  (`generation_runs_p3_01_content_type_check`,
  `generated_content_drafts_p3_01_content_type_check`,
  `export_candidates_p3_16_content_type_check`) are at the exact target
  `board_update`-inclusive definition, that none are missing, that none
  are in a mixed predecessor/target state, that `board_update` is present
  wherever a constraint claims to be at target, and that no unrecognized/
  future content-type token appears in any of the three definitions.
- `scripts/kai-sprint2-p13-ext2-board-update-content-type-evolution-smoke-seed.sql`
  (synthetic data only, **not executed in this pass**) seeds one synthetic
  `board_update` `generation_runs`/`generated_content_drafts`/
  `limitation_snapshots`/`export_candidates` row set.
- `scripts/kai-sprint2-p13-ext2-board-update-content-type-evolution-smoke-verifier.sql`
  proves the seeded `board_update` fixtures are admitted and coherent, and
  that predecessor types remain admitted alongside `board_update` (a
  widening, not a replacement).
- `scripts/kai-sprint2-p13-ext2-board-update-content-type-evolution-failure-checks.sql`
  proves read-only from catalog definitions that an unrelated content type,
  a near-miss `board_update`-like token, a non-`system`
  `created_by_type`, and an unrelated `export_candidates.content_type` all
  remain outside the accepted contracts after the widening.
- `scripts/kai-sprint2-p13-ext2-board-update-content-type-evolution-runbook.md`
  documents how this package's verification would be run against a live
  ephemeral PostgreSQL target.

## Problem Closed

The four `board_update` migration SQL files existed (as of the start of
this repair pass) with no accompanying verification package - no
catalog verifier, smoke fixtures, read-only failure checks, or runbook -
leaving the Roadmap-required package incomplete for this content type,
unlike the completed P14-14/P14-15 packages this one mirrors.

## Not Executed

No SQL in this package (forward migration, rollback, verifier, smoke seed,
smoke verifier, or failure checks) was executed against any PostgreSQL
instance, real or ephemeral, in this pass. `DATABASE_URL` was set only to
the sentinel value `postgres://127.0.0.1:9/kai_sentinel` for unrelated
Node-based test/build commands, which never resolves a real connection.
Live execution of this package's SQL against an ephemeral verification
database is future work, matching how prior packages separate "authored"
from "run" (see `scripts/kai-sprint2-p14-14-generated-content-type-evolution-*`
for the fully-run precedent this package's SQL shape follows).

## Rollback Characterization

Both `board_update` rollback files already contained the data-loss guard
(refusing when `board_update` rows exist) before this pass; this package
adds no new guard, only the missing verification/smoke/failure-check/
patch-notes/runbook artifacts around the four pre-existing migration files.
Rollback safety here is **NOT_CONFIRMED** against a live database - it was
reviewed statically only.

## Not Changed

No fingerprint, requested_audience, draft_status, review_status,
created_by_type, foreign-key, uniqueness, tenant/organization,
review-queue, or audit-contract constraint is touched by this package.
`board_update` is not added to any Grant Response Packet or Board
Reporting membership set.
