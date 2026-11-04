# Run in pgAdmin: KAI document-statement evidence packet

**For:** the owner, running each file by hand in pgAdmin's Query Tool on the established, already-authorized production connection.

**What it does:** applies one source-controlled migration, `kai_sprint2_document_statement_evidence`, unchanged from the repository. It widens five existing CHECKs on `kai.evidence_items` and `kai.source_locators` by one value or branch each, so that a promoted PDF or plain-text source can hold evidence quoting one of its own statements. It adds no table, column, row, index, trigger, review step, approval or allowed-use change.

**Production authorization:** running `01_MIGRATION_…` changes the production schema. Run it only under your separate, explicit authorization. Every other file in Steps 1–4 is read-only.

## Order (required)

1. **The three Measurement MVP migrations come first**, in this order, each under its own authorization and verified with its existing read-only verifier:
   1. `migrations/kai_sprint2_measurement_mvp_source_derived_measurements.sql` (`scripts/kai-measurement-mvp-derived-measurements-verify-read-only.sql`);
   2. `migrations/kai_sprint2_measurement_mvp_cross_source_reach.sql`;
   3. `migrations/kai_sprint2_measurement_mvp_cross_source_reconciliation_jobs.sql` (`scripts/kai-measurement-mvp-cross-source-reconciliation-jobs-verify-read-only.sql`).

   Their production state is **not known** to this packet. Step 1's rows `P01`–`P03` report it, and `OVERALL` is `STOP_INCOMPATIBLE` until all three are present. The migration itself also refuses without the first one.
2. **This packet** (Steps 1–4 below) must reach `01V` = `PASS`.
3. **Only then push or deploy the application.** Pushing `main` is observed to start a deployment. The application revision that contains this packet also needs the three Measurement MVP migrations.

**If the application is deployed before this migration:** the application's capability probe reads the old CHECKs. PDF and TXT sources show "Evidence from document text is not yet available in this KAI installation", and nothing is read or written. This degraded state is safe, but it is not the intended rollout.

## Files

| File | Kind | Changes production? |
| --- | --- | --- |
| `00_DOCUMENT_EVIDENCE_PREFLIGHT_READ_ONLY.sql` | one `SELECT` | No |
| `01_MIGRATION_kai_sprint2_document_statement_evidence.sql` | migration (verbatim) | **Yes** |
| `01V_VERIFY_AFTER_document_statement_evidence_READ_ONLY.sql` | one `SELECT` | No |
| `RP01_ROLLBACK_PRECHECK_READ_ONLY.sql` | one `SELECT`, counts only | No |
| `rollback/R01_ROLLBACK_kai_sprint2_document_statement_evidence.rollback.sql` | rollback (verbatim) | **Yes**. Only under "Rollback" below. |

Source paths and SHA-256 checksums are in `SOURCE_MANIFEST.md`. The migration opens its own `BEGIN;` and ends with its own `COMMIT;`, so it applies completely or not at all.

## How to run any file

1. Select the production database through the established connection and open **Tools → Query Tool**. Use one Query Tool tab for the whole run.
2. Open the file with **Open File**. Do not paste fragments or edit the text.
3. Run the whole file with **Execute script** (F5), with nothing selected.
4. **Read-only files:** read the **Data Output** grid; the last row is `OVERALL` (or `R01`). Save each grid as CSV.
5. **The migration file:** open **Messages**. Success means no `ERROR` line and a completed `COMMIT`. Copy the Messages text into a file.

**If the migration shows any `ERROR`**, or you press Stop: run `ROLLBACK;` on its own in the same tab, then **STOP**. Nothing from the failed file was applied. Send me the Messages text.

**Optional lock guard:** the migration briefly takes an exclusive lock on `kai.evidence_items` and `kai.source_locators`, and validates the new CHECKs against their existing rows. You may first run `SET lock_timeout = '10s';` in the same tab. It is a session setting, not a schema change.

## Step 1: preflight (read-only)

Open `00_DOCUMENT_EVIDENCE_PREFLIGHT_READ_ONLY.sql`. Expected: 12 rows (A01–A02, P01–P03, D01–D05, M01, OVERALL). Save as `step1_preflight.csv`.

| `OVERALL.status` | Meaning | Next |
| --- | --- | --- |
| `REQUIRED` | prerequisites present; all five CHECKs are exactly the pre-migration definitions | Step 2 |
| `ALREADY_APPLIED` | all five CHECKs are exactly the migration's definitions | skip Step 2; go to Step 3 |
| `STOP_INCOMPATIBLE` | a prerequisite is missing (`P01`–`P03` = `FAIL`), the role lacks ownership (`A02`), or a CHECK differs from both definitions (`D0x` = `OTHER`) | **STOP. Run no migration.** Send the CSV. |

`D01`–`D05` compare `md5(pg_get_constraintdef(...))` with the definitions observed on PostgreSQL 16 in the local proof. A different PostgreSQL major version can format a definition differently and read `OTHER` although it is equivalent. That fails closed: stop and send the CSV, and I will compare the definitions.

## Step 2: migration (changes production)

Only when Step 1 is `REQUIRED`: open `01_MIGRATION_kai_sprint2_document_statement_evidence.sql`, Execute script (F5), and check Messages as above.

## Step 3: verify after (read-only)

Open `01V_VERIFY_AFTER_document_statement_evidence_READ_ONLY.sql`. Expected: 9 rows (V01.1–V01.8, OVERALL). **Required:** every row `PASS`, `OVERALL` = `PASS`. Save as `step3_01V.csv`. Any `FAIL` means STOP.

It checks:
- each of the five CHECKs is exactly the migration's definition, validated and not deferrable;
- the application's own capability probe now reads true;
- the three prerequisite tables still exist;
- no document-statement evidence row has lost its internal-only or false use pins.

## Step 4: re-run the preflight (read-only)

Run `00_…` again (`step4_preflight.csv`). **Required:** `OVERALL` = `ALREADY_APPLIED`.

The run is complete only when Step 3 = `PASS` and Step 4 = `ALREADY_APPLIED`. Send me the saved results; Step 3 is the evidence that unblocks the separately authorized application rollout.

## Rollback (only to withdraw the capability)

1. **Application rollback and schema rollback are different operations.** Rolling the application back leaves the schema as it is. An earlier application revision never writes these values, so the widened CHECKs do not affect it.
2. **The schema rollback works only while no document-statement evidence exists.** Run `RP01_ROLLBACK_PRECHECK_READ_ONLY.sql`:

   | `R01` | Meaning | Action |
   | --- | --- | --- |
   | `NOT_APPLIED` | the migration is not installed | nothing to roll back |
   | `SAFE_TO_ROLL_BACK` | installed, no document evidence or locator rows | `rollback/R01_…` may run |
   | `UNSAFE_ROLLBACK_REFUSES` | document evidence exists (`observed` shows counts) | **do not run R01** |

3. **Never delete document evidence, its locators, review items, claims or audits to make a rollback possible.** Once the first statement exists, the way back is forward only. Withdrawing the feature then means the application revision, not the schema.
4. After `R01`, run `00_…`: it must read `REQUIRED`. If `R01` is run while evidence exists, it raises `document-statement evidence rollback refused: …` and changes nothing; run `ROLLBACK;` and stop.

## How this packet was proven (local only)

See `SOURCE_MANIFEST.md`. Production itself is not proven: only your Step 1 output establishes production's actual state.
