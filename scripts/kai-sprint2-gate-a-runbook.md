# KAI Sprint 2 Gate A Local PostgreSQL Runbook

Scope: isolated local PostgreSQL only, synthetic fixtures only. Do not use production, shared nonproduction, cloud storage, real client data, credentials, deployments, tenant changes, feature flags, Gate B-D, P1, or Current State updates.

Artifacts:

- `migrations/kai_sprint2_gate_a_persistent_upload_lifecycle.sql`: forward migration.
- `migrations/kai_sprint2_gate_a_persistent_upload_lifecycle.rollback.sql`: rollback draft.
- `scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql`: local synthetic baseline.
- `scripts/kai-sprint2-gate-a-smoke-seed.sql`: deterministic synthetic fixture seed.
- `scripts/kai-sprint2-gate-a-verifier.sql`: single-result-set catalog verifier.
- `scripts/kai-sprint2-gate-a-smoke-verifier.sql`: single-result-set behavioral smoke verifier.
- `scripts/kai-sprint2-gate-a-local-postgres.js`: ephemeral local runner.

Local command:

```sh
DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-gate-a-local
```

The runner creates a temporary local cluster under the OS temp directory, applies the synthetic baseline, applies the forward migration, seeds synthetic rows, runs both verifiers, applies the rollback draft, stops the cluster, and removes the temp directory.

Verification coverage:

- PostgreSQL version capture.
- DDL syntax and vocabulary.
- canonical checksum, object-version, upload-state, timestamp, replay, and state/fact constraints.
- tenant-scoped indexes and enqueue replay identity.
- foreign key binding where the target primary key exists.
- lifecycle transitions, expiry rejection, identical replay, conflicting object-version rejection, tenant predicates, 25-file active upload limit, transaction rollback, and audit atomicity.
- two-session identical replay, two-session conflicting replay, and row-lock contention through the local runner.

Patch notes:

- Adds durable lifecycle columns to `kai.intake_files`: `upload_state`, `upload_state_changed_at`, `upload_expires_at`, `object_version_id`, `verified_checksum`, `verified_size_bytes`, `verified_at`, and `policy_decision_replay`.
- Adds Gate A lifecycle constraints, indexes, and a trigger enforcing immutable tenant/file/object/checksum identity, allowed lifecycle edges, pre-confirmation expiry behavior, and the 25-active-file synthetic limit.
- Adds `kai.security_assessment_enqueue` with an immutable replay identity for organization, intake file, object version, and verified checksum.
- Does not mount production lifecycle code, mutate feature flags or tenants, touch cloud storage, deploy, or update Current State.
