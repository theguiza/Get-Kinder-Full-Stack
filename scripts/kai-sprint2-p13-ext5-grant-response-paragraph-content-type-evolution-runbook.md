# KAI P13-EXT-5 grant_response_paragraph Content-Type Evolution Verification Runbook

This runbook documents how to run this package's verification against a
live ephemeral PostgreSQL target. **None of these steps were executed
against a live database in the pass that authored this package** - per
that pass's explicit constraint against connecting to any real or ephemeral
Postgres instance and against executing any SQL migration, every SQL file
listed below was authored and statically reviewed only. Live execution
(building a package-owned ephemeral runner, in the style of
`scripts/kai-sprint2-p14-14-generated-content-type-evolution-local-postgres.js`)
is future work.

## Intended sequence (not run in this pass)

Against an ephemeral PostgreSQL target bound only to `127.0.0.1`, with the
bootstrap and prerequisite migrations through P13-EXT-4's
`funder_outcome_table` content-type evolution already applied:

1. Apply `migrations/kai_sprint2_p13_ext5_grant_response_paragraph_content_type_evolution.sql`.
2. Apply `migrations/kai_sprint2_p13_ext5_grant_response_paragraph_export_candidate_content_type_evolution.sql`.
3. Run `scripts/kai-sprint2-p13-ext5-grant-response-paragraph-content-type-evolution-verifier.sql`
   and confirm every row reports `PASS` (it raises otherwise).
4. Run `scripts/kai-sprint2-p13-ext5-grant-response-paragraph-content-type-evolution-smoke-seed.sql`
   (synthetic data only).
5. Run `scripts/kai-sprint2-p13-ext5-grant-response-paragraph-content-type-evolution-smoke-verifier.sql`
   and confirm every row reports `PASS`.
6. Run `scripts/kai-sprint2-p13-ext5-grant-response-paragraph-content-type-evolution-failure-checks.sql`
   (read-only catalog/query assertions; no probe rows are written and no
   rollback is used to claim read-only compliance) and confirm every row
   reports `PASS`.
7. Apply `migrations/kai_sprint2_p13_ext5_grant_response_paragraph_export_candidate_content_type_evolution.rollback.sql`
   while the step-4 `grant_response_paragraph` export-candidate row still
   exists, and confirm it is refused (data-loss guard).
8. Apply `migrations/kai_sprint2_p13_ext5_grant_response_paragraph_content_type_evolution.rollback.sql`
   while the step-4 `grant_response_paragraph` generation-run/draft rows
   still exist, and confirm it is refused (data-loss guard).
9. Remove the step-4 synthetic rows, then re-apply both rollback files and
   confirm they now succeed and restore the P13-EXT-4 vocabulary.

## Verifier coverage

`scripts/kai-sprint2-p13-ext5-grant-response-paragraph-content-type-evolution-verifier.sql`
covers exactly the three constraints this package touches:

- `generation_runs_p3_01_content_type_check` (`kai.generation_runs`)
- `generated_content_drafts_p3_01_content_type_check` (`kai.generated_content_drafts`)
- `export_candidates_p3_16_content_type_check` (`kai.export_candidates`)

It fails closed (raises a non-zero-exit exception) on:

- any of the three constraints being missing;
- any of the three constraints having an unrecognized/unexpected
  definition (neither the exact P13-EXT-4 predecessor definition nor the
  exact P13-EXT-5 target definition);
- a mixed state, where some of the three constraints are at the target
  `grant_response_paragraph`-inclusive definition and others are still at
  the predecessor definition;
- `grant_response_paragraph` being absent from any constraint that
  otherwise reports itself as being at the target definition;
- any content-type token appearing inside a constraint definition that is
  not a member of the exact recognized vocabulary (`evidence_summary`,
  `impact_narrative`, `readiness_assessment`, `data_gap_memo`,
  `case_for_support`, `board_update`, `annual_report_section`,
  `funder_outcome_table`, `grant_response_paragraph`) - this guards against
  a future or unknown type (including `grant_response_packet`, the distinct
  Grant Response Packet composite-export object_type) being silently
  admitted by a drifted or hand-edited constraint.

## Forward Delta

Only these three CHECK constraints are changed by the two forward
migrations this package verifies:

- `kai.generation_runs.content_type`
- `kai.generated_content_drafts.content_type`
- `kai.export_candidates.content_type`

The target vocabulary is exactly the current application vocabulary
(`Backend/kai/dictionary/postgresGeneratedContentRepository.js`,
`ALLOWED_GENERATED_CONTENT_TYPES`, and
`Backend/kai/dictionary/exportCandidateContract.js`,
`EXPORT_CANDIDATE_CONTENT_TYPES`): `evidence_summary`, `impact_narrative`,
`readiness_assessment`, `data_gap_memo`, `case_for_support`,
`board_update`, `annual_report_section`, `funder_outcome_table`,
`grant_response_paragraph`. No audience, status, queue, actor, or
export-manifest contract is touched, and `content_type` remains an
explicit `IN (...)` enumeration, never weakened to free text.
`grant_response_packet` (the distinct Grant Response Packet
composite-export object_type) is not part of this vocabulary and is not
admitted by any constraint this package touches.

## Rollback

Both rollback files refuse (fail closed, `RAISE EXCEPTION`) when any
`grant_response_paragraph` row exists in the table they would otherwise
narrow, rather than deleting or rewriting `content_type` values, following
the same guard shape used by every prior extension's rollback.

This runbook does not claim production rollback safety. No migration in
this package was executed. Production and even local-ephemeral rollback
safety are both **NOT_CONFIRMED** pending the live run described above.
