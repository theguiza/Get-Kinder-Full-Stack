# KAI P13-01 Impact-Narrative Content-Type Contract Runbook

Run:

```sh
npm run verify:kai-sprint2-p13-01-impact-narrative-content-type
```

The runner creates an ephemeral PostgreSQL target bound only to `127.0.0.1`,
uses the synthetic database
`kai_p13_01_impact_narrative_content_type_synthetic`, applies the existing
bootstrap and prerequisite Gate A through P3-01 migrations, then applies the
P13-01 forward migration.

It then runs:

- P13-01 catalog verifier;
- P13-01 synthetic smoke seed;
- P13-01 smoke verifier;
- P13-01 read-only failure checks;
- focused generated-content/P13 boundary and integration tests;
- actual rollback against incompatible synthetic `impact_narrative` data;
- actual rollback again after runner-only synthetic cleanup.

## Forward Delta

Only these CHECK constraints are changed:

- `kai.generation_runs.content_type`
- `kai.generated_content_drafts.content_type`

The forward vocabulary is exactly:

- `evidence_summary`
- `impact_narrative`

The package does not widen audiences, statuses, queue contracts, actor
vocabulary, export contracts, tables, or columns.

## Rollback

The rollback file uses one transaction and attempts to restore the historical
`evidence_summary`-only CHECK contract on both target tables. It does not
delete rows and does not rewrite `content_type` values.

Observed local synthetic behavior:

- with synthetic `impact_narrative` rows present, rollback fails cleanly and
  leaves rows and target constraints unchanged;
- after the runner deletes only its own synthetic `impact_narrative` fixtures
  as test cleanup, the same rollback succeeds and restores the historical
  contract.

This runbook does not claim production rollback safety. Production migration
was not performed. Production rollback safety is NOT_CONFIRMED.
