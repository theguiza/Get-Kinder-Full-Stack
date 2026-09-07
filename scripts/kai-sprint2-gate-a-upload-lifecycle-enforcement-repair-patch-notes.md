# KAI Gate A Upload Lifecycle Enforcement Forward Repair Patch Notes

## Scope

USER_CONFIRMED production pgAdmin inspection reported:

- `kai.enforce_gate_a_p0_upload_lifecycle()` is missing.
- `trg_gate_a_p0_upload_lifecycle` on `kai.intake_files` is missing.

TOOL_VERIFIED repository inspection established that current HEAD still
requires both objects in
`migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql`, and no existing
forward repair restored them.

This package restores only those missing executable enforcement objects:

- `kai.enforce_gate_a_p0_upload_lifecycle()`
- `trg_gate_a_p0_upload_lifecycle` on `kai.intake_files`

## Added

- `migrations/kai_sprint2_gate_a_p0_upload_lifecycle_enforcement_forward_repair.sql`
  creates the current authoritative Gate A trigger function and trigger after
  failing closed unless the required `kai.intake_files` table and
  function-referenced column shapes are present.
- `migrations/kai_sprint2_gate_a_p0_upload_lifecycle_enforcement_forward_repair.rollback.sql`
  is an operational rollback draft for this repair only.
- `scripts/kai-sprint2-gate-a-upload-lifecycle-enforcement-repair-verifier.sql`
  verifies the restored function/trigger contract and preserved Gate C-1
  trigger state without querying business rows.
- `scripts/kai-sprint2-gate-a-upload-lifecycle-enforcement-repair-failure-checks.sql`
  read-only checks detect absent or incompatible repair objects, required
  column drift, and Gate C-1 trigger drift.
- `scripts/kai-sprint2-gate-a-upload-lifecycle-enforcement-repair-drift-fixture.sql`
  is a local-only synthetic fixture that drops only the two missing objects in
  an ephemeral database to reproduce the observed drift.
- `scripts/kai-sprint2-gate-a-upload-lifecycle-enforcement-repair-smoke-verifier.sql`
  proves the restored trigger executes on synthetic insert/update lifecycle
  operations.
- `scripts/kai-sprint2-gate-a-upload-lifecycle-enforcement-repair-local-postgres.js`
  creates a loopback-only ephemeral PostgreSQL 16 database, reproduces the
  drift, proves the focused verifier fails before repair, applies the repair,
  runs focused/Gate-A/Gate-C verification, proves smoke behavior, and replays
  the repair idempotently.

## Not Changed

The original Gate A migration is not modified. Gate C-1 is not modified.
No Gate-A column, constraint, index, audit table, audit vocabulary, tenant
boundary, application code, feature flag, deployment setting, production
configuration, credential, or real client data is changed.

Production has not been repaired by this package.
