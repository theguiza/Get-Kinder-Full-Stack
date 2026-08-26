# KAI P13-01 Patch Notes - Impact-Narrative Content-Type Contract

## Added

- `migrations/kai_sprint2_p13_01_impact_narrative_content_type.sql` extends only
  the two existing P3-01 generated-content `content_type` CHECK constraints on
  `kai.generation_runs` and `kai.generated_content_drafts` from
  `evidence_summary` to `evidence_summary` plus `impact_narrative`.
- `migrations/kai_sprint2_p13_01_impact_narrative_content_type.rollback.sql`
  restores the historical `evidence_summary`-only CHECK contract without
  deleting or rewriting domain rows.
- `scripts/kai-sprint2-p13-01-impact-narrative-content-type-verifier.sql`
  verifies the exact catalog delta and negative scope.
- `scripts/kai-sprint2-p13-01-impact-narrative-content-type-smoke-seed.sql`
  creates only synthetic generated-content run/draft pairs for
  `evidence_summary` and `impact_narrative` in the runner-owned database.
- `scripts/kai-sprint2-p13-01-impact-narrative-content-type-smoke-verifier.sql`
  proves both content types are admitted and that run/draft content type and
  audience remain coherent.
- `scripts/kai-sprint2-p13-01-impact-narrative-content-type-failure-checks.sql`
  proves unrelated content types and non-system generation-run creation still
  fail closed.
- `scripts/kai-sprint2-p13-01-impact-narrative-content-type-local-postgres.js`
  is the package-owned ephemeral loopback PostgreSQL runner for this migration
  package.
- `scripts/kai-sprint2-p13-01-impact-narrative-content-type-runbook.md`
  documents the synthetic verification and rollback characterization.

## Rollback Characterization

The rollback file is non-destructive. With synthetic `impact_narrative` rows
present under the forward schema, the actual rollback fails cleanly while
preserving row counts, preserving `impact_narrative` values, and leaving both
target constraints in the known forward state. After the runner removes only
its own synthetic `impact_narrative` fixtures as test cleanup, the same
rollback file succeeds and restores the historical `evidence_summary`-only
contract.

This is local synthetic verification only. Production migration was not
performed. Production rollback safety is NOT_CONFIRMED.

## Not Changed

No content-type constants module, canonical contract, constants
centralization, export request wiring, Package 3C wiring, persisted Impact
Facts, funder/public generation, finalization, deployment, production
migration, production rollback, or real-client-data handling is included.
