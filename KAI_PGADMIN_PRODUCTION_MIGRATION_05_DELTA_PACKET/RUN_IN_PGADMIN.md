# Run in pgAdmin: KAI migration 05 delta packet

**For:** the owner, running each file by hand in pgAdmin's Query Tool on the established, already-authorized production connection. No one else connects to the database.

**What it does:** adds migration 05, `kai_sprint2_plan_a_organization_internal_factual_review_authority`, to a production database that already has the accepted migrations 01–04. It runs at most one source-controlled migration, unchanged from the repository (commit `1c10b87`). It does not rerun 01–04.

**Order with the application:** finish Step 5 with `99` = `PASS` **before** anything is pushed or deployed. Pushing `main` is observed to start a deployment. See `ROLLOUT_AND_ACCEPTANCE.md`.

**Production authorization:** running `05_MIGRATION_…` changes the production schema. Run it only under your separate, explicit authorization. Every other file in Steps 1–5 is read-only.

## Files

| File | Kind | Changes production? |
| --- | --- | --- |
| `00_MIGRATION_05_PREFLIGHT_READ_ONLY.sql` | one `SELECT` | No |
| `05_MIGRATION_kai_sprint2_plan_a_organization_internal_factual_review_authority.sql` | migration (verbatim) | **Yes** |
| `05V_VERIFY_AFTER_plan_a_organization_internal_factual_review_authority_READ_ONLY.sql` | one `SELECT` | No |
| `99_MIGRATION_05_FINAL_SCHEMA_VERIFICATION_READ_ONLY.sql` | one `SELECT` | No |
| `RP05_ROLLBACK_PRECHECK_READ_ONLY.sql` | one `SELECT` | No |
| `rollback/R05_ROLLBACK_kai_sprint2_plan_a_organization_internal_factual_review_authority.rollback.sql` | rollback (verbatim) | **Yes**. Only under "Rollback" below. |

Source paths and SHA-256 checksums are in `SOURCE_MANIFEST.md`. The migration file opens its own `BEGIN;` and ends with its own `COMMIT;`, so it applies completely or not at all.

**Do not use the 01–04 packet's `99_FINAL_SCHEMA_VERIFICATION_READ_ONLY.sql` after migration 05.** It compares the three decision tables with the 2026-09-16 capture, so once 05 is applied it reports `FAIL` on exactly `B_TABLE kai.evidence_review_decisions`, `B_TABLE kai.claim_review_decisions` and `B_TABLE kai.coverage_review_decisions`. That is expected. This packet's `99_MIGRATION_05_…` replaces it. It re-checks the 01–04 objects and those three tables, allowing only migration 05's own objects.

## How to run any file in pgAdmin

1. In the Object Explorer, select the production database through the established connection, then open **Tools → Query Tool**. Use this one Query Tool tab for the whole run.
2. Open the file with the **Open File** (folder) button. Do not paste fragments or edit the text.
3. Run the whole file with **Execute script** (F5), with nothing selected in the editor.
4. **Read-only files** (`00`, `05V`, `99`, `RP05`): read the **Data Output** grid. The last row is `OVERALL`. Save every grid with the **Save results to file** button in Data Output, as CSV.
5. **The migration file** (`05_MIGRATION_…`): open the **Messages** tab. Success means no `ERROR` line and a completed `COMMIT`. The exact wording varies by pgAdmin version, so judge success by the absence of an `ERROR` line. Copy the Messages text into a file and keep it.

**If the migration file shows any `ERROR`**, or you press **Stop**: in the same tab, run `ROLLBACK;` on its own (F5). This ends the aborted transaction. If no transaction is open, PostgreSQL prints a harmless warning instead. Then **STOP**. Nothing from the failed file has been applied. Save the Messages text and send it to me.

**Optional lock guard:** the migration briefly takes an exclusive lock on the three decision tables. Before running it you may run `SET lock_timeout = '10s';` in the same tab. If the application holds a lock, the migration then fails cleanly with a lock-timeout error instead of waiting, and you follow the `ERROR` rule above. This is a session setting, not a schema change.

---

## Step 1: preflight (read-only)

| | |
| --- | --- |
| Open | `00_MIGRATION_05_PREFLIGHT_READ_ONLY.sql` |
| Action | Execute script (F5) |
| Expected | Data Output: 27 rows (25 checks, then `M05`, then `OVERALL`) |
| Save | the grid as CSV (`step1_preflight.csv`) |

Read `OVERALL.status`. It has exactly one of three values:

| `OVERALL.status` | Meaning | Next |
| --- | --- | --- |
| `REQUIRED` | 01–04 are exactly as accepted, the dependent tables are unchanged, and none of migration 05's objects exist | Step 2 |
| `ALREADY_APPLIED` | every migration 05 object exists exactly as the migration creates it, enabled and validated | **Skip Step 2.** Go to Step 3. |
| `STOP_INCOMPATIBLE` | a prerequisite differs, migration 05 is partly applied or different, or a check could not run | **STOP. Run no migration.** Send the CSV. |

If the file errors, or the grid has no `OVERALL` row, treat it as `STOP_INCOMPATIBLE`.

What the rows mean:
- **A01–A04** must be `PASS`.
  - A02 shows the server version.
  - A03 confirms that the connected role owns, or is a member of the owner role of, the three decision tables.
  - A04 confirms `CREATE` on schema `kai`.
- **B01.1–B01.4** must be `PASS`. Each confirms that migration 01, 02, 03 or 04 is exactly in its accepted state. Nothing is rerun.
- **B02** must be `PASS`. Every column, key and foreign key that migration 05 reads exists.
- **B03** must be `PASS`. The four append-only and CHECK helper functions are unchanged.
- **`B_TABLE kai.<table>`** must be `PASS`, for six tables: `evidence_review_decisions`, `claim_review_decisions`, `coverage_review_decisions`, `claims`, `evidence_items`, `gap_log_items`. Each compares columns, constraints, unique indexes and triggers with the 2026-09-16 capture. Only migration 05's own objects (and, on `evidence_items`, the three CHECKs that 03 changed, checked in B01.3) are excluded.
- **C01–C08** are migration 05's eight objects: four constraints, one helper function, and three trigger-plus-function pairs. Each row is `REQUIRED`, `ALREADY_APPLIED` or `STOP_INCOMPATIBLE`, and `observed` shows the live definition.
- **C09** is `NONE` unless an unexpected `organization_factual_review_*` function or trigger exists.
- **M05** is the migration's state. `observed` says `uniform` or names a `mixed` (partial) state.

## Step 2: migration 05 (only if Step 1 `OVERALL` = `REQUIRED`)

| | |
| --- | --- |
| Open | `05_MIGRATION_kai_sprint2_plan_a_organization_internal_factual_review_authority.sql` |
| Prerequisite | Step 1 `OVERALL` = `REQUIRED`, and your separate authorization for this production change |
| Action | Execute script (F5) |
| Expected | Messages: no `ERROR`; the transaction commits. The migration's own guard raises an error and changes nothing if any of the three role constraints or `kai.evidence_measurements` is missing. |
| Save | the Messages text (`step2_migration_messages.txt`) |
| STOP if | any `ERROR` (run `ROLLBACK;` as above) |

What it changes, all inside one transaction:
- It widens `evidence_review_decisions_p2_12_role_check` and `claim_review_decisions_p2_12_role_check` to `gk_reviewer, gk_admin, client_admin`. The names are kept.
- It adds `claim_review_decisions_organization_internal_audience_check`: a `client_admin` claim approval may name only the `internal` audience.
- It widens `coverage_review_decisions_p2_10_decided_by_role_check` to `gk_reviewer`, or `client_admin` only for `accepted_internal_with_limitation` on `small_cell_risk`, `conflicting_source_indicators` or `requirement_alignment`.
- It adds one helper function and three `BEFORE INSERT` triggers with their functions. Together they pin every `client_admin` decision to P2-01M source-record-count measurement evidence, and refuse a `client_admin` evidence or claim decision that supersedes a Get Kinder decision.

No existing row is read, rewritten or deleted. The append-only triggers are unchanged.

## Step 3: post-migration verification (read-only)

| | |
| --- | --- |
| Open | `05V_VERIFY_AFTER_plan_a_organization_internal_factual_review_authority_READ_ONLY.sql` |
| Expected | Data Output: 14 rows (V05.1–V05.13, then `OVERALL`) |
| Required | every row `PASS` except V05.13, which is `INFO`; `OVERALL` = `PASS` |
| Save | the grid as CSV (`step3_05V.csv`) |
| STOP if | any `FAIL`, or `OVERALL` is not `PASS` |

What each row checks:
- **V05.1–V05.4:** the four constraints at their exact definitions, validated.
- **V05.5:** the helper function's exact body and attributes: `sql`, `STABLE`, returns `boolean`, not `SECURITY DEFINER`.
- **V05.6–V05.8:** each trigger on its expected table, `BEFORE INSERT FOR EACH ROW`, **enabled**, with its function's exact body.
- **V05.9:** no other object of the same family exists.
- **V05.10:** evidence roles. `gk_reviewer`, `gk_admin` and `client_admin` are accepted; every other role is rejected.
- **V05.11:** 192 claim role × outcome × audience combinations. The GK roles keep every combination they had. `client_admin` may approve `{internal}` only. Every funder or public combination is rejected for `client_admin`.
- **V05.12:** 180 coverage role × decision × dimension combinations. `gk_reviewer` keeps all 30. `client_admin` has only the three internal acceptances. `gk_admin`, `gk_operator`, `client_reviewer` and `client_contributor` are rejected, as before.
- **V05.13:** `INFO` only. Trigger behavior (unsupported evidence, Get Kinder supersession) was proven by local insert tests, because this file inserts nothing.

The combination rows evaluate the live CHECK expressions against literal values. No row is inserted.

## Step 4: re-run the preflight (read-only)

Run `00_MIGRATION_05_PREFLIGHT_READ_ONLY.sql` again and save it (`step4_preflight.csv`). **Required:** `OVERALL` = `ALREADY_APPLIED`, with `M05.observed` = `uniform: ALREADY_APPLIED`. If it says anything else, STOP and send the grid.

## Step 5: final verification (read-only)

| | |
| --- | --- |
| Open | `99_MIGRATION_05_FINAL_SCHEMA_VERIFICATION_READ_ONLY.sql` |
| Expected | Data Output: 37 rows (36 checks, then `OVERALL`) |
| Required | every row `PASS` except V05.13 (`INFO`); `OVERALL` = `PASS` |
| Save | the grid as CSV (`step5_99.csv`) |
| STOP if | any `FAIL`, or `OVERALL` is not `PASS` |

This covers:
- A01–A02;
- 01–04 still exactly as accepted;
- every dependency of 05;
- the append-only helpers and the six tables unchanged apart from 05's own objects;
- every 05 object exactly as created, with no partial state;
- all of 05V again.

**Send me the five saved results** (Steps 1–5). The `99` CSV is the evidence that unblocks the separately authorized application rollout.

**PASS / STOP summary:** continue past a step only when its required result is shown. The run is complete only when Step 3 = `PASS`, Step 4 = `ALREADY_APPLIED` and Step 5 = `PASS`. Any other result means STOP: run nothing further and send the grids.

---

## Rollback (only if you decide to withdraw the capability)

Five rules:
1. **Never run R05 while protected customer decisions exist.** `RP05` reports them. R05 also refuses on its own.
2. **Never delete, reclassify or discard an organization's decision to make a rollback possible.** These rows are the organization's own append-only record of a human decision.
3. **Application rollback and database rollback are different operations.** Rolling the application back does not touch the schema. Rolling the schema back does not change the application.
4. **Before any schema rollback, the application must already be on a revision that never records a `client_admin` review decision** (one before `e0022aa`, such as `96653f8`). Otherwise the organization's review fails with SQLSTATE 23514. The previous revision was tested against the new schema; see `ROLLOUT_AND_ACCEPTANCE.md` §3.
5. **Once any organization decision exists, migration 05 is not reversible.** R05 is a guarded rollback that works only while no `client_admin` decision exists. After the first organization decision, the only way back is forward:
   - the schema still lets a Get Kinder reviewer supersede an organization's evidence or claim decision;
   - the current application's evidence-review route doing this passed in the local assembled acceptance;
   - claim supersession was tested only by direct insert;
   - coverage acceptances have no supersession at all.

Procedure:
1. Run `RP05_ROLLBACK_PRECHECK_READ_ONLY.sql`. It reports counts only, no row contents.

   | `R05` status | Meaning | Action |
   | --- | --- | --- |
   | `NOT_APPLIED` | none of migration 05's objects exist | nothing to roll back |
   | `SAFE_TO_ROLL_BACK` | 05 objects exist, no `client_admin` decision | R05 may run (rule 4 first) |
   | `UNSAFE_ROLLBACK_REFUSES` | `client_admin` evidence, claim or coverage decisions exist; `observed` shows each count | **Do not run R05** |
   | `STOP_TABLE_MISSING` | a decision table is missing | STOP and send the grid |

2. Only when `R05` = `SAFE_TO_ROLL_BACK`, and the application has already moved off `e0022aa` or later, run `rollback/R05_ROLLBACK_…rollback.sql` (F5) and check Messages for `ERROR` as above.
3. Then run `00_MIGRATION_05_PREFLIGHT_READ_ONLY.sql`. It must report `REQUIRED`, which is the exact post-04 state.

If R05 is run while decisions exist, it raises `organization internal factual review authority rollback refused: client_admin review decisions exist` and changes nothing. Run `ROLLBACK;` in the tab and stop.

## How this packet was proven (local only)

See `SOURCE_MANIFEST.md` → "Local proof". Production itself is not proven: only your Step 1 output establishes production's actual state.
