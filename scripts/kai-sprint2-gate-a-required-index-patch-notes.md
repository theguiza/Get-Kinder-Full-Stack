# KAI Gate A Required Index Forward Repair Patch Notes

## Scope

USER_CONFIRMED production pgAdmin inspection reported these current-required
Gate A indexes are missing:

- `ux_intake_files_gate_a_org_declared_checksum`
- `ix_intake_files_gate_a_tenant_upload_state`
- `ix_intake_files_gate_a_object_version`

TOOL_VERIFIED repository inspection established that current HEAD still
requires all three objects in
`migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql`, and no existing
complete forward repair restored them.

This package restores only those missing indexes using the exact authoritative
definitions from the original Gate A upload-lifecycle migration.

## Added

- `migrations/kai_sprint2_gate_a_p0_required_index_forward_repair.sql`
  recreates the three current-required Gate A indexes after failing closed
  unless `kai.intake_files` and the exact index-referenced column shapes are
  present.
- `migrations/kai_sprint2_gate_a_p0_required_index_forward_repair.rollback.sql`
  is an operational rollback draft for this index repair only.
- `scripts/kai-sprint2-gate-a-required-index-verifier.sql`
  verifies exact index name, uniqueness, key order, predicate, access method,
  and target table contract without querying business rows.
- `scripts/kai-sprint2-gate-a-required-index-failure-checks.sql`
  provides read-only checks for table, column, and exact index-contract drift.
- `scripts/kai-sprint2-gate-a-required-index-drift-fixture.sql`
  is a local-only synthetic fixture that drops only the three missing indexes
  in an ephemeral database to reproduce the observed drift.
- `scripts/kai-sprint2-gate-a-required-index-smoke-seed.sql`
  creates valid synthetic rows before repair, including an allowed
  forced-version duplicate.
- `scripts/kai-sprint2-gate-a-required-index-smoke-verifier.sql`
  proves valid synthetic state survives repair and that the restored unique
  index rejects a same-tenant non-forced declared-checksum duplicate.
- `scripts/kai-sprint2-gate-a-required-index-conflict-seed.sql`
  creates synthetic conflicting rows after the indexes are absent.
- `scripts/kai-sprint2-gate-a-required-index-conflict-fail-closed-verifier.sql`
  proves conflicting state leaves rows untouched and creates no partial index
  repair after PostgreSQL rejects the unique index.
- `scripts/kai-sprint2-gate-a-required-index-local-postgres.js`
  creates a loopback-only ephemeral PostgreSQL 16 database, reproduces missing
  indexes, proves pre-repair detection, applies the forward repair, runs
  focused/Gate-A/Gate-C verification, proves unique valid/conflict behavior,
  and replays the repair idempotently.

## Not Changed

The original Gate A migration is not modified. The already-applied Gate A
function/trigger repair migration is not modified. Gate C-1 is not modified.
No application runtime behavior, feature flag, deployment setting, production
configuration, credential, real client data, UPDATE, DELETE, deduplication, or
client-data repair is changed.

Production has not been repaired by this package.
