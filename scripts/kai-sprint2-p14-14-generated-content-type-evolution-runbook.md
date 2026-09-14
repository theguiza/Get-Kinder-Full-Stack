# KAI P14-14 Generated-Content Type-Evolution Contract Runbook

Run:

```sh
npm run verify:kai-sprint2-p14-14-generated-content-type-evolution
```

The runner creates an ephemeral PostgreSQL target bound only to `127.0.0.1`,
uses the synthetic database
`kai_p14_14_generated_content_type_evolution_synthetic`, applies the existing
bootstrap and prerequisite Gate A through P13-01 migrations, then:

- proves, before the fix migration, that inserting `content_type =
  'data_gap_memo'` or `content_type = 'readiness_assessment'` into
  `kai.generation_runs` fails with a real SQLSTATE 23514 on
  `generation_runs_p3_01_content_type_check` (the confirmed application/schema
  drift this package closes);
- applies the P14-14 forward migration;
- runs the P14-14 catalog verifier;
- seeds and verifies the P14-14 smoke fixtures (one synthetic
  generation-run/draft pair per content type) and runs the P14-14 read-only
  failure checks (unrelated type, near-miss type, non-system
  `created_by_type` are all still rejected);
- proves all four application content types (`evidence_summary`,
  `impact_narrative`, `readiness_assessment`, `data_gap_memo`) are accepted at
  both `kai.generation_runs` and `kai.generated_content_drafts`, and that an
  unknown type (`not_a_real_type`) is still rejected with SQLSTATE 23514 at
  both tables;
- applies the additional prerequisite migration chain (A1.1-A1.4, B1.1,
  C2.1, P2-04/P2-05/P2-09/P2-10/P2-11/P2-12, C3-A3, C3-A4) needed only for the
  real, unstubbed Readiness Assessment / Data Gap Memo read services, then
  runs the actual `createDataGapMemoDraft`/`createReadinessAssessmentDraft`
  production service functions and the real `postgresGeneratedContentRepository`
  persistence path, against real governed fixtures built through the real
  P2-01/P2-03/P2-04 services (a real source_version -> evidence_item -> claim
  -> gap_log_item) and a real seeded B1.1 requirement row - stubbing only the
  external generation-provider `draftGenerator` call - and proves the
  complete durable row set for both content types: `generation_runs`,
  `generated_content_drafts`, `generated_content_blocks`,
  `generated_content_citations`, a `generated_content_review` review-queue
  item, a `generated_content_draft_created` audit row, and a successful
  reread through `getGeneratedDraftReviewPacket`;
- proves the rollback fails cleanly while synthetic `readiness_assessment`/
  `data_gap_memo` rows are present, then succeeds and restores the P13-01
  contract after those rows (including the real-service-generated ones) are
  removed.

## Forward Delta

Only these CHECK constraints are changed:

- `kai.generation_runs.content_type`
- `kai.generated_content_drafts.content_type`

The forward vocabulary is exactly the current application vocabulary
(`Backend/kai/dictionary/postgresGeneratedContentRepository.js`,
`ALLOWED_GENERATED_CONTENT_TYPES`):

- `evidence_summary`
- `impact_narrative`
- `readiness_assessment`
- `data_gap_memo`

The package does not widen audiences, statuses, queue contracts, actor
vocabulary, export contracts, tables, or columns, and does not weaken
`content_type` to free text - it remains an explicit `IN (...)` enumeration.

## Rollback

The rollback file uses one transaction and restores the P13-01
`evidence_summary`/`impact_narrative`-only CHECK contract on both target
tables. It refuses (fails closed) if any `readiness_assessment` or
`data_gap_memo` row already exists, rather than deleting or rewriting
`content_type` values.

This runbook does not claim production rollback safety. Production migration
was not performed. Production rollback safety is NOT_CONFIRMED.
