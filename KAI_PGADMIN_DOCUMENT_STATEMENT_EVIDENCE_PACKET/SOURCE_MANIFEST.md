# Source manifest: KAI document-statement evidence packet

## Files and checksums (SHA-256)

| Packet file | Source | SHA-256 |
| --- | --- | --- |
| `01_MIGRATION_kai_sprint2_document_statement_evidence.sql` | `migrations/kai_sprint2_document_statement_evidence.sql` (verbatim; committed in `6aa00ea2`) | `9b908cfe87976aa400884d423422eac8e7951fb6586e70039378bd6a424d7412` |
| `rollback/R01_ROLLBACK_kai_sprint2_document_statement_evidence.rollback.sql` | `migrations/kai_sprint2_document_statement_evidence.rollback.sql` (verbatim) | `554acab6787bcef70226588cd43b9a9e7074a806108bf576cb1a3f30815fe4b0` |
| `00_DOCUMENT_EVIDENCE_PREFLIGHT_READ_ONLY.sql` | written for this packet | `8f865deb054226fdbf0926b26629dfb43dfcf2293ee17053b74eb6ad43b53204` |
| `01V_VERIFY_AFTER_document_statement_evidence_READ_ONLY.sql` | written for this packet | `ae60edc9fe62863cf662dc9cad5ed444dece917ee04fbae1cd526e177929836d` |
| `RP01_ROLLBACK_PRECHECK_READ_ONLY.sql` | written for this packet | `b59373240266e2f7d155709ef48c9e089d8045581dd1d7af7fe56f479ebc6879` |

The migration is the last entry of `scripts/kai-sprint2-plan-a-migration-chain.js`. It follows `kai_sprint2_measurement_mvp_source_derived_measurements`, `…_cross_source_reach` and `…_cross_source_reconciliation_jobs`.

## Pinned definitions

`md5(pg_get_constraintdef(oid))` observed on PostgreSQL 16 (Homebrew `postgresql@16`), after the full Plan A chain:

| Constraint | PRE (before) | POST (after) |
| --- | --- | --- |
| `evidence_items_p2_01_evidence_type_check` | `4d7dd56888442bab5e53c22385c935c7` | `aea45899884478a1fbdf6b870103d2f0` |
| `evidence_items_p2_01_data_class_check` | `f313e70db87270d5e6c45b614115fe03` | `ddb26bb785cf6c4adf30a5e229e4f0f4` |
| `evidence_items_p2_01m_type_class_pairing_check` | `e5f45a9ad2b05109c8585d2bb3724e44` | `fa3cc6ef6bfcc0f8218978fca9051299` |
| `source_locators_p2_01_locator_type_check` | `bd2c76628ed9cb4c2cddb1ce0a1bdcc4` | `20a79952e407a69bf7d7d46b6cc2bc45` |
| `source_locators_p2_01_coordinates_check` | `d29ebf39f86552deec2e4e9f0a1b74a3` | `d5265a33039490287a63225d0c246401` |

## Local proof (TOOL_VERIFIED, disposable loopback PostgreSQL only)

`scripts/kai-document-statement-evidence-local-postgres.js` creates a disposable PostgreSQL 16 cluster listening on 127.0.0.1 and applies the Plan A chain: 86 of the 88 migrations, with the two production-history migrations refused as designed. It then runs this packet's files exactly as written, with `psql -f`:

1. Migration rolled back (the production-before state): preflight `REQUIRED`; `RP01` `NOT_APPLIED`; `01V` `FAIL`.
2. `01_MIGRATION_…`: the schema fingerprint equals the repository migration's; preflight `ALREADY_APPLIED` (12 rows); `01V` `PASS`; `RP01` `SAFE_TO_ROLL_BACK`.
3. `rollback/R01_…`: the prior schema fingerprint is restored; preflight `REQUIRED`.
4. Prerequisite missing (`kai.cross_source_reconciliation_jobs` hidden inside a transaction that is then rolled back): `P03` `FAIL`, `OVERALL` `STOP_INCOMPATIBLE`.
5. After the acceptance spec persisted 71 document statements through the application: `01V` `PASS`; preflight `ALREADY_APPLIED`; `RP01` `UNSAFE_ROLLBACK_REFUSES` (71 evidence items, 71 locators). The rollback itself refuses with evidence present (spec test B7).

Production is not proven. Its state of the three prerequisite migrations and of these five CHECKs is NOT_CONFIRMED until Step 1 is run there.
