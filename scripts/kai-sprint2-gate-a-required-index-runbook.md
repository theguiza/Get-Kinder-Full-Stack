# KAI Gate A Required Index Forward Repair Runbook

This runbook documents the local proof package and the future production
boundary. It does not authorize production execution.

## Local Proof

Run:

```sh
DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-gate-a-required-index-repair
```

The runner:

- creates a temporary PostgreSQL 16 data directory under the OS temp directory;
- starts PostgreSQL bound only to `127.0.0.1` on a runner-chosen port;
- creates the synthetic database `kai_gate_a_required_index_repair_synthetic`;
- applies the synthetic Gate A bootstrap schema, original Gate A lifecycle
  migration, already-applied Gate A function/trigger repair migration, original
  Gate A policy-decision replay migration, and Gate C-1 migration;
- applies the local-only drift fixture that drops only the three required Gate
  A indexes;
- proves the focused verifier detects all three missing indexes before repair;
- inserts valid synthetic rows and applies the forward repair migration;
- runs exact focused verification, read-only failure checks, unique valid-state
  smoke verification, the Gate-A enforcement-repair verifier, existing Gate-A
  verifier/failure checks, and Gate C-1 verifier;
- replays the repair idempotently;
- drops the three indexes again, inserts synthetic conflicting rows, proves
  PostgreSQL rejects the unique index without cleanup or partial repair, then
  tears down the ephemeral target.

The runner fails closed unless it proves the target database name, loopback
address, port, `listen_addresses`, and PostgreSQL 16 version. It must not be
pointed at a shared, quarantined, cloud, production, staging, or
real-client-data database.

## Future Production Boundary

Future production execution remains a separate authorization boundary. Under
that separate authorization, the bounded procedure is:

1. Confirm the committed repair package being applied.
2. Use the established authenticated pgAdmin workflow.
3. Apply this exact forward repair only after separate explicit production
   schema-mutation authorization.
4. Run the committed read-only verification.
5. Stop on any migration or verification error.

Do not use `psql`, `DATABASE_URL`, `PGSERVICE`, `.env` parsing, application
database pools, Node database wrappers, new database clients, or credential
discovery for the production workflow.
