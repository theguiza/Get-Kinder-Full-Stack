# KAI P13-EXT-4 Patch Notes - funder_outcome_table Content-Type Evolution Verification Package

## Added

- `migrations/kai_sprint2_p13_ext4_funder_outcome_table_content_type_evolution.sql`
  widens `generation_runs_p3_01_content_type_check`
  (`kai.generation_runs`) and `generated_content_drafts_p3_01_content_type_check`
  (`kai.generated_content_drafts`) from the P13-EXT-3 vocabulary
  (`evidence_summary`, `impact_narrative`, `readiness_assessment`,
  `data_gap_memo`, `case_for_support`, `board_update`,
  `annual_report_section`) to add the eighth generated-content type,
  `funder_outcome_table`.
- `migrations/kai_sprint2_p13_ext4_funder_outcome_table_content_type_evolution.rollback.sql`
  restores the P13-EXT-3 vocabulary on both constraints, refusing (fails
  closed) if any `funder_outcome_table` row already exists in either table.
- `migrations/kai_sprint2_p13_ext4_funder_outcome_table_export_candidate_content_type_evolution.sql`
  widens the companion `export_candidates_p3_16_content_type_check`
  (`kai.export_candidates`) the same way.
- `migrations/kai_sprint2_p13_ext4_funder_outcome_table_export_candidate_content_type_evolution.rollback.sql`
  restores the P13-EXT-3 vocabulary on that constraint, refusing if any
  `funder_outcome_table` export-candidate row already exists.
- `scripts/kai-sprint2-p13-ext4-funder-outcome-table-content-type-evolution-verifier.sql`
  verifies, read-only, that all three named constraints
  (`generation_runs_p3_01_content_type_check`,
  `generated_content_drafts_p3_01_content_type_check`,
  `export_candidates_p3_16_content_type_check`) are at the exact target
  `funder_outcome_table`-inclusive definition, that none are missing, that
  none are in a mixed predecessor/target state, that `funder_outcome_table`
  is present wherever a constraint claims to be at target, and that no
  unrecognized/future content-type token appears in any of the three
  definitions.
- `scripts/kai-sprint2-p13-ext4-funder-outcome-table-content-type-evolution-smoke-seed.sql`
  (synthetic data only, **not executed in this pass**) seeds one synthetic
  `funder_outcome_table` `generation_runs`/`generated_content_drafts`/
  `limitation_snapshots`/`export_candidates` row set, using
  `requested_audience` `'funder'` to exercise `funder_outcome_table`'s
  funder-only audience gate (enforced at the service-level input validator,
  `isCreateFunderOutcomeTableDraftInput`, not by this schema layer).
- `scripts/kai-sprint2-p13-ext4-funder-outcome-table-content-type-evolution-smoke-verifier.sql`
  proves the seeded `funder_outcome_table` fixtures are admitted and
  coherent, and that predecessor types remain admitted alongside
  `funder_outcome_table` (a widening, not a replacement).
- `scripts/kai-sprint2-p13-ext4-funder-outcome-table-content-type-evolution-failure-checks.sql`
  proves read-only from catalog definitions that an unrelated content type
  (including `grant_response_paragraph`), a near-miss
  `funder_outcome_table`-like token, a non-`system` `created_by_type`, and
  an unrelated `export_candidates.content_type` all remain outside the
  accepted contracts after the widening.
- `scripts/kai-sprint2-p13-ext4-funder-outcome-table-content-type-evolution-runbook.md`
  documents how this package's verification would be run against a live
  ephemeral PostgreSQL target.

## Problem Closed

The `funder_outcome_table` application/runtime work (service, repository,
route, generator, frontend label, Generated Drafts library) landed in this
same working tree without accompanying schema migrations or a verification
package - no forward/rollback migration SQL, no catalog verifier, smoke
fixtures, read-only failure checks, or runbook - leaving the two
`content_type` CHECK constraints this type depends on unwidened, matching
the gap the P13-EXT-3 repair pass closed for `annual_report_section`.

## Not Executed

No SQL in this package (forward migration, rollback, verifier, smoke seed,
smoke verifier, or failure checks) was executed against any PostgreSQL
instance, real or ephemeral, in this pass. No database connection was
opened. Live execution of this package's SQL against an ephemeral
verification database is future work, matching how prior packages separate
"authored" from "run" (see
`scripts/kai-sprint2-p13-ext3-annual-report-section-content-type-evolution-*`
for the direct structural precedent this package's SQL shape follows).

## Rollback Characterization

Both `funder_outcome_table` rollback files in this package are newly
authored and contain the same data-loss guard used by every prior
extension's rollback (refusing when `funder_outcome_table` rows exist).
Rollback safety here is **NOT_CONFIRMED** against a live database - it was
reviewed statically only.

## Not Changed

No fingerprint, requested_audience, draft_status, review_status,
created_by_type, foreign-key, uniqueness, tenant/organization,
review-queue, or audit-contract constraint is touched by this package.
`funder_outcome_table` is not added to any Grant Response Packet or Board
Reporting membership set. `grant_response_paragraph` is not admitted
anywhere in this package.
