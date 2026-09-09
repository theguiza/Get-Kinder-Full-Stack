# KAI P14-01 Generation-Run Engagement Binding Runbook

Run either of the two runners that own this migration's dependency chain
(P14-01 has no runner of its own - it is proven inside the runners for the
migrations it directly extends):

```sh
node scripts/kai-sprint2-p3-01-generated-content-drafts-local-postgres.js
node scripts/kai-sprint2-p13-01-impact-narrative-content-type-local-postgres.js
```

Each runner creates its own ephemeral PostgreSQL target bound only to
`127.0.0.1`, applies the organization-enablement bootstrap schema (so
`kai.organizations`/`kai.engagements` exist), applies a runner-local
composite-unique accommodation on `kai.engagements (engagement_id,
organization_id)` (never a modification of the shared bootstrap file, the
same accommodation the B1.1/C2.1 runners already apply for this identical FK
shape), applies the existing Gate A through P3-01 (and, for the second
runner, P13-01) migrations, then applies the P14-01 forward migration.

It then runs:

- P14-01 catalog verifier;
- P14-01 synthetic smoke seed (one engagement-bound run/draft pair, one
  legacy `NULL`-engagement run/draft pair);
- P14-01 smoke verifier (exact engagement resolution, legacy-NULL validity,
  transitive draft-to-engagement lineage for both);
- P14-01 read-only failure checks (fabricated engagement rejected,
  cross-tenant engagement/organization pair rejected, `NULL` engagement
  accepted - the whole probe transaction is rolled back, so nothing persists);
- the runner's own focused generated-content/P3-01/P13-01 tests, which now
  exercise `engagementId` end to end against real Postgres;
- (P3-01 runner only) an attempted rollback while non-null `engagement_id`
  rows exist, which must fail closed.

## Forward Delta

Only one column and one foreign key are added:

- `kai.generation_runs.engagement_id uuid` (nullable)
- `generation_runs_p14_01_engagement_fk FOREIGN KEY (engagement_id,
  organization_id) REFERENCES kai.engagements (engagement_id,
  organization_id)`

`kai.generated_content_drafts` and `kai.engagements` are not altered. No
other table, column, constraint, queue contract, or audit vocabulary is
touched.

## Rollback

The rollback file refuses to run (raises an exception, changes nothing)
while any `generation_runs.engagement_id` row is non-null - it does not
silently discard a real engagement binding. Observed local synthetic
behavior: with the P3-01 runner's own synthetic engagement-bound rows
present, the rollback attempt fails cleanly with no schema or data change. A
clean (all-NULL) rollback path was not separately exercised in this package.

This runbook does not claim production rollback safety. Production migration
was not performed. Production rollback safety beyond the refusal behavior
above is NOT_CONFIRMED.

## Known Pre-Existing Gap

Both runners fail one pre-existing, unrelated integration test ("Package
14-05: P3-01 real service path allows an internally governed but currently
ineligible claim...") with `relation "kai.evidence_review_decisions" does not
exist`, because neither runner's migration chain includes
`migrations/kai_sprint2_p2_12_human_review_decision_ledger.sql`. This gap
exists identically at the pre-P14-01 HEAD of both runner scripts and is not
attributable to this package. Every other test in both runners passes,
including every test that now depends on the engagement requirement.
