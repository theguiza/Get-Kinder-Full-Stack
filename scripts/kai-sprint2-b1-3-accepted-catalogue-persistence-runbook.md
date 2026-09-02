# B1.3 — Persist Owner-Accepted Baseline Catalogue — Runbook

## Preconditions

- B1.1 (`kai.requirement_sources`, `kai.requirement_framework_versions`,
  `kai.requirement_sets`, `kai.requirements`, `kai.engagement_requirement_sets`)
  is already applied.
- B1.2's canonical artefact
  (`docs/kai/catalogues/KAI_B1_2_BASELINE_IMPACT_REQUIREMENTS_CATALOGUE_V1_ACCEPTED.md`)
  is owner-accepted and unchanged from what this package was built against.

## Local verification (isolated synthetic PostgreSQL only)

```bash
DATABASE_URL="postgres://127.0.0.1:9/kai_sentinel" npm run test:kai-sprint2-b1-3-accepted-catalogue-persistence
DATABASE_URL="postgres://127.0.0.1:9/kai_sentinel" npm run verify:kai-sprint2-b1-3-accepted-catalogue-persistence
```

The verify script boots an ephemeral local PostgreSQL cluster, bootstraps the
organization/engagement foundation, applies the B1.1 migration, applies this
package's forward migration, runs the integration suite, then applies this
package's rollback migration and proves the B1.1 tables and the
organization/engagement prerequisites remain intact. It never touches shared
or production PostgreSQL.

## Applying to a real environment (separately authorized action, not performed by this package)

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/kai_sprint2_b1_3_accepted_catalogue_persistence.sql
```

Safe to run more than once: every insert is guarded by `WHERE NOT EXISTS`
against the same natural keys B1.1's own `UNIQUE` constraints enforce.

## Rolling back (separately authorized action)

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/kai_sprint2_b1_3_accepted_catalogue_persistence.rollback.sql
```

Deletes only the `kai_baseline_impact_v1`/`v1` catalogue rows under the
`kai_standard`/`kai_baseline_impact_requirements` source. Drops no table, no
column, no index. B1.1's schema and every other row in it are left intact.

## Post-apply expectations

- `framework_status = 'draft'` for `kai_baseline_impact_v1`/`v1` — this
  package never activates it.
- 0 `kai.engagement_requirement_sets` rows added.
- No Requirement Coverage, assessment, evidence/claim mapping, gap,
  recommendation, or funder-overlay object exists — none is created by this
  package.
