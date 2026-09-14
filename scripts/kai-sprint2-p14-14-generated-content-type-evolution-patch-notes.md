# KAI P14-14 Patch Notes - Generated-Content Type-Evolution Contract

## Added

- `migrations/kai_sprint2_p14_14_generated_content_type_evolution.sql` extends
  only the two existing P3-01/P13-01 generated-content `content_type` CHECK
  constraints on `kai.generation_runs` and `kai.generated_content_drafts` from
  `evidence_summary, impact_narrative` to the current, complete application
  vocabulary: `evidence_summary`, `impact_narrative`, `readiness_assessment`,
  `data_gap_memo`.
- `migrations/kai_sprint2_p14_14_generated_content_type_evolution.rollback.sql`
  restores the P13-01 `evidence_summary`/`impact_narrative`-only CHECK
  contract, refusing if any `readiness_assessment` or `data_gap_memo` row
  already exists.
- `scripts/kai-sprint2-p14-14-generated-content-type-evolution-verifier.sql`
  verifies the exact catalog delta, an unrelated-constraint negative check,
  and that unrelated P3-01/P13-01 contracts are unchanged.
- `scripts/kai-sprint2-p14-14-generated-content-type-evolution-local-postgres.js`
  is the package-owned ephemeral loopback PostgreSQL runner for this migration
  package. It reproduces the pre-fix drift (SQLSTATE 23514 on
  `generation_runs_p3_01_content_type_check` for `data_gap_memo` and
  `readiness_assessment`), applies the fix, proves all four content types are
  now accepted at both tables, proves an unknown type is still rejected, and
  exercises both the incompatible-data-refused and clean-restore rollback
  paths.
- `scripts/kai-sprint2-p14-14-generated-content-type-evolution-runbook.md`
  documents the synthetic verification and rollback characterization.

## Problem Closed

The application repository (`Backend/kai/dictionary/
postgresGeneratedContentRepository.js`, `ALLOWED_GENERATED_CONTENT_TYPES`)
has supported `readiness_assessment` and `data_gap_memo` generated-content
types since those product surfaces landed, but no migration after P13-01 had
widened the database `content_type` CHECK constraints to admit them. Every
readiness-assessment or data-gap-memo generation attempt failed at the
`kai.generation_runs` insert with a real check_violation, surfaced by the
repository as `VAL-GEN-PERSIST-P0-001` / `persistence_validation_rejected`
(HTTP 422). This package closes that drift with the smallest correct schema
change.

## Rollback Characterization

The rollback file is non-destructive. With synthetic `readiness_assessment`/
`data_gap_memo` rows present under the forward schema, the actual rollback
fails cleanly and leaves both target constraints in the known forward state.
After those rows are removed, the same rollback file succeeds and restores
the P13-01 contract.

This is local synthetic verification only. Production migration was not
performed. Production rollback safety is NOT_CONFIRMED.

## Not Changed

No fingerprint, requested_audience, draft_status, review_status,
created_by_type, foreign-key, uniqueness, tenant/organization, review-queue,
or audit-contract constraint is touched. No application code, validators,
citations, idempotency behavior, review-queue contract, or feature flags are
changed.
