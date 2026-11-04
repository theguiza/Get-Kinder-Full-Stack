# Cedar Bridge: remaining production schema procedure

Application baseline: `059e17bae52baf37a7f83a6858800f49fda69d84`.
Prepared and compatibility-tested locally on 2026-11-04. Production execution
remains with the owner, through the existing authenticated pgAdmin connection.

The maximum remaining delta is **two existing migrations, reach then jobs**.
The exact subset is determined by the read-only preflight. Do not repeat the
committed source-derived or document-statement migrations. No forward migration
correction is necessary for the already-committed document schema.

## Compatibility evidence

`python3 scripts/kai-cedar-bridge-remaining-schema-local-postgres.py` creates its
own loopback PostgreSQL 16 cluster, uses the existing synthetic bootstrap and
actual repository migrations, and commits this exact alternative order:

1. `kai_sprint2_measurement_mvp_source_derived_measurements.sql`
2. `kai_sprint2_document_statement_evidence.sql`
3. `kai_sprint2_measurement_mvp_cross_source_reach.sql`
4. `kai_sprint2_measurement_mvp_cross_source_reconciliation_jobs.sql`

The normal migration order is used only for prerequisites before these four;
it is not substituted for this alternative-order proof. The two documented
production-history-only migrations refuse the fresh synthetic schema with
their expected guard messages, as in the existing normal-chain runners.

The document migration widens five CHECKs on `kai.evidence_items` and
`kai.source_locators`. Reach replaces only two CHECKs on
`kai.source_derived_measurements` and adds the contributing-source table,
function, triggers and index. Jobs adds its own table and indexes. Neither
remaining migration replaces any of the five document CHECKs. Their validated,
nondeferrable catalog definitions remain identical after each commit.

Observed locally: derived verifier 12/12 PASS before and after reach (with the
required D0/D7 transition); XLSX verifier 8/8 PASS before and after both remaining
migrations; jobs verifier 17/17 PASS; document 01V 8/8 PASS; document preflight
ALREADY_APPLIED after jobs. No application fixtures or real-client rows are
needed for this schema proof. It does not establish the current production
catalog or execute the Cedar application journey.

The new preflight was tested as REQUIRED/REQUIRED, ALREADY_APPLIED/REQUIRED,
and ALREADY_APPLIED/ALREADY_APPLIED. Deliberately removing a jobs index, a reach
arithmetic CHECK, or a document coordinate CHECK on the disposable cluster
produced STOP_INCOMPATIBLE in each case. The runner restores those test-local
objects, checks the final signatures, stops and removes its cluster.

## Owner instructions in pgAdmin

Open a Query Tool on the intended production database using the existing
authenticated connection. Start with no open or failed transaction. Open each
file from this checkout and execute the **whole file** with F5. The migration
files already contain BEGIN/COMMIT; do not wrap, splice, edit, or combine them.

1. Run **`scripts/kai-cedar-bridge-remaining-schema-preflight-read-only.sql`**.
   This is the exact bounded production preflight: an explicitly read-only
   transaction, a 15-second statement timeout, a 2-second lock timeout, fixed
   local search path and catalog queries only. It reads no application rows.
   Require `document` and `prerequisite` = **ALREADY_APPLIED**. `reach` and
   `jobs` each report **REQUIRED** (cleanly absent) or **ALREADY_APPLIED**
   (matching the tested migration objects); any STOP_INCOMPATIBLE stops work.
   Catalog hashes include the two reach CHECKs, full contributing-source/jobs
   table columns/constraints/indexes/user triggers, relevant function bodies,
   and the five document CHECKs with validation/deferrability. Pins were
   obtained from the actual migrations on PostgreSQL 16; unexpected catalog
   formatting, additional objects or drift require review, never automatic repair.
   Also run the existing derived verifier and XLSX verifier listed below;
   require OVERALL PASS from both. Before reach, D0 may say **before the
   cross-source reach migration** and D7 may say **not applied**; that is the
   baseline state, not completion.
2. If `reach` is REQUIRED, run exactly
   **`migrations/kai_sprint2_measurement_mvp_cross_source_reach.sql`**.
   If ALREADY_APPLIED, skip it. In either case, run
   **`scripts/kai-measurement-mvp-derived-measurements-verify-read-only.sql`**.
   Require **D0.schema_state = after the cross-source reach migration**,
   **D7.contributing_sources = PASS** with actual role/profile/field checks and
   `admission trigger=1`, and **OVERALL PASS (12/12)**. A not-applied or
   not-applicable D7 does not satisfy this step.
3. If `jobs` is REQUIRED, run exactly
   **`migrations/kai_sprint2_measurement_mvp_cross_source_reconciliation_jobs.sql`**,
   only after step 2 passes. If ALREADY_APPLIED, skip it. In either case, run
   **`scripts/kai-measurement-mvp-cross-source-reconciliation-jobs-verify-read-only.sql`**;
   require **all 17 checks PASS and OVERALL PASS**.
4. Run
   **`KAI_PGADMIN_DOCUMENT_STATEMENT_EVIDENCE_PACKET/01V_VERIFY_AFTER_document_statement_evidence_READ_ONLY.sql`**;
   require **all eight checks PASS and OVERALL PASS**, including the five exact,
   validated document constraints. Then run
   **`KAI_PGADMIN_DOCUMENT_STATEMENT_EVIDENCE_PACKET/00_DOCUMENT_EVIDENCE_PREFLIGHT_READ_ONLY.sql`**;
   require **D01–D05 POST, M01 PASS, and OVERALL ALREADY_APPLIED**.
   Do not execute that packet's 01 migration. Before reach/jobs are installed,
   this older packet's preflight is expected to stop at P02/P03 even with all
   five document CHECKs POST. That is a missing-prerequisite result, not a
   reason to repeat the document migration.
5. Rerun
   **`scripts/kai-sprint2-p2-01m-xlsx-worksheet-method-verify-read-only.sql`**;
   require **8/8 and OVERALL PASS**, including the document vocabulary vectors.
   Rerun the derived verifier, requiring the post-reach D0/D7 results above,
   and the new bounded preflight, requiring every capability and OVERALL
   **ALREADY_APPLIED**. These results close this schema prerequisite.

## Stop conditions

- Any STOP_INCOMPATIBLE, mixed/partial state, missing committed document
  CHECK/prerequisite, or jobs installed without reach. Save the catalog-only
  preflight result for review; do not replay migrations to repair drift.
- Any baseline/final verifier FAIL, missing check/result, SQL exception,
  permission error, lock/statement timeout, or failed migration COMMIT.
- D0 still before reach, or D7 not applied/not applicable after step 2.
- Document 01V not all PASS or its final preflight not ALREADY_APPLIED;
  document PRE/OTHER is not authorization to reinstall the document migration.

If an error leaves a transaction aborted, stop and ROLLBACK that failed
transaction before collecting read-only diagnostics. Do not continue to the
next migration, run rollback migration files, change permissions/configuration,
or improvise schema corrections. No source-derived/document migration replay,
push, deployment, production execution by Codex, real-client-data handling,
or application/UI work is part of this procedure.
