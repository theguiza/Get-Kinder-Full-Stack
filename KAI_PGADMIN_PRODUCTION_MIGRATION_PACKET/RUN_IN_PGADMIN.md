# Run in pgAdmin: KAI production migration packet

**For:** the owner, running each file by hand in pgAdmin's Query Tool on the established production connection. No one else connects to the database.

**What it does:** brings the production `kai` schema up to what the application at `637a9ca` needs for the customer file-to-report workflow. It applies at most four source-controlled migrations, unchanged from the repository. The preflight decides which of the four production actually needs.

**Order with the application:** finish this file through step 6 with `99` = PASS **before** anything is pushed or deployed. See `ROLLOUT_AND_ACCEPTANCE.md`.

## Files

| File | Kind | Changes production? |
| --- | --- | --- |
| `00_RECONCILED_PRODUCTION_PREFLIGHT_READ_ONLY.sql` | one `SELECT` (recommended reconciled preflight) | No |
| `00_PRODUCTION_PREFLIGHT_READ_ONLY.sql` | same corrected query under the original packet name | No |
| `01_MIGRATION_kai_sprint2_p1_downstream_recovery_state.sql` | migration (verbatim) | **Yes** |
| `01V_VERIFY_AFTER_p1_downstream_recovery_state_READ_ONLY.sql` | one `SELECT` | No |
| `02_MIGRATION_kai_sprint2_b1a_02_client_admin_sensitivity_review.sql` | migration (verbatim) | **Yes** |
| `02V_VERIFY_AFTER_b1a_02_client_admin_sensitivity_review_READ_ONLY.sql` | one `SELECT` | No |
| `03_MIGRATION_kai_sprint2_p2_01m_source_record_count_measurement.sql` | migration (verbatim) | **Yes** |
| `03V_VERIFY_AFTER_p2_01m_source_record_count_measurement_READ_ONLY.sql` | one `SELECT` | No |
| `04_MIGRATION_kai_sprint2_plan_a_organization_internal_release_authority.sql` | migration (verbatim) | **Yes** |
| `04V_VERIFY_AFTER_plan_a_organization_internal_release_authority_READ_ONLY.sql` | one `SELECT` | No |
| `99_FINAL_SCHEMA_VERIFICATION_READ_ONLY.sql` | one `SELECT` | No |
| `RP_ROLLBACK_PRECHECK_READ_ONLY.sql` | one `SELECT` | No |
| `rollback/R01`…`R04` | rollback (verbatim) | **Yes**. Only under "Rollback" below. |

Source paths and SHA-256 checksums are listed in `SOURCE_MANIFEST.md`. Each migration file is byte-for-byte the repository file, comments included. Each one opens its own `BEGIN;` and ends with its own `COMMIT;`, so it applies completely or not at all.

## How to run any file in pgAdmin

1. In the Object Explorer, select the production database through the established connection, then open **Tools → Query Tool**. Use this one Query Tool tab for the whole run.
2. Open the file with the **Open File** (folder) button. Do not paste fragments or edit the text.
3. Run the whole file with **Execute script** (F5), with nothing selected in the editor.
4. **Read-only files** (`00`, `NNV`, `99`, `RP`): read the **Data Output** grid. The last row is `OVERALL`. To send me a result, use the **Save results to file** button in Data Output to save the grid as CSV.
5. **Migration files** (`01`–`04`): open the **Messages** tab. Success means no `ERROR` line and a completed `COMMIT`. pgAdmin reports this as "Query returned successfully…". The exact wording varies by pgAdmin version, so judge success by the absence of an `ERROR` line.

**If a migration file shows any `ERROR`**, or you press **Stop**: in the same tab, run `ROLLBACK;` on its own (F5). This ends the aborted transaction. If no transaction is open, PostgreSQL prints a harmless warning instead. Then **STOP**. Nothing from the failed file has been applied. Save the Messages text and send it to me.

**Optional lock guard:** each migration briefly takes an exclusive table lock on the tables it alters. Before each migration file, you may run `SET lock_timeout = '10s';` in the same tab. If the application is holding a lock, the migration then fails cleanly with a lock-timeout error instead of waiting, and you follow the `ERROR` rule above. This is a session setting, not a schema change.

---

## Step 0: preflight (read-only)

| | |
| --- | --- |
| Open | `00_RECONCILED_PRODUCTION_PREFLIGHT_READ_ONLY.sql` |
| Prerequisite | none |
| Action | Execute script (F5) |
| Expected | Data Output: 60 rows (59 checks, then `OVERALL`); it runs in well under a second locally |
| Required result | `OVERALL.status` = `READY` or `NOTHING_TO_RUN` |
| STOP if | `OVERALL.status` = `STOP`, or the file errors |

What the rows mean:
- **A01–A04** must be `PASS`.
  - A02 shows the production PostgreSQL version.
  - A03 and A04 confirm that the connected role can `ALTER` the five altered tables, create in schema `kai`, and reference the foreign-key targets.
  - A05 is `INFO`: any migration-ledger table that exists. The repository defines none, so expect "(none found)".
- **B01–B05** must be `PASS`. They cover:
  - the foreign-key and trigger dependencies;
  - 16 helper/guard functions unchanged;
  - `evidence_summary` admitted by the three content-type CHECKs;
  - all 35 audit operations admitted;
  - the enum labels.
- **`B_TABLE kai.<table>`**, one row per workflow table: a comparison of columns, constraints, unique indexes and triggers with your 2026-09-16 pgAdmin capture. Row 324 also accepts the exact named and defined P2-01 evidence-review required-action CHECK documented in the repository; every other extra, missing or changed constraint still blocks.
  - `FAIL` (repository-owned table) means production changed after that capture in a way these files were not built for: STOP.
  - `WARN` appears only for production-owned tables (`users`, `organizations`, `engagements`, `audit_events`, `intake_files`, `organization_memberships`, `user_roles`, `roles`). It does not block, because no migration here touches them. Still include WARN rows when you report back.
- **M01–M04**: one of `REQUIRED`, `ALREADY_APPLIED`, or `STOP_INCOMPATIBLE` (a partial or different state).
- **OVERALL**:
  - `READY`: its `observed` column lists exactly which files to run, in order. For example, `run in order: 01, 02, 03, 04` or `run in order: 03, 04`.
  - `NOTHING_TO_RUN`: go to Step 6.
  - `STOP`: its `observed` column names the blocking rows. **Run no migration.** Save the grid as CSV and send it to me.

**Run only the migrations listed in OVERALL, in the listed order.** Skip the steps below for any migration whose M row is `ALREADY_APPLIED`.

## Step 1: `01` P1 downstream recovery state (only if M01 = `REQUIRED`)

| | |
| --- | --- |
| Open | `01_MIGRATION_kai_sprint2_p1_downstream_recovery_state.sql` |
| Prerequisite | Step 0 `OVERALL` = `READY` with `01` listed |
| Action | Execute script (F5) |
| Expected | Messages: no `ERROR`; the transaction commits |
| Then run | `01V_VERIFY_AFTER_p1_downstream_recovery_state_READ_ONLY.sql` |
| Required | every row `PASS`; `OVERALL` = `PASS` |
| STOP if | any `ERROR` (run `ROLLBACK;`), or any 01V row `FAIL` |
| Rollback | `R01` drops the table and its attempt budgets. Run it only after the application no longer uses the table (see "Rollback"). |

Creates `kai.intake_p1_downstream_attempts`: 16 columns, 9 constraints, and the tenant/file index. This is the P1 worker's bounded retry budget and claim fence. The application revision reported deployed (`3b99a90`) already reads and writes this table.

## Step 2: `02` organization-administrator sensitivity review (only if M02 = `REQUIRED`)

| | |
| --- | --- |
| Open | `02_MIGRATION_kai_sprint2_b1a_02_client_admin_sensitivity_review.sql` |
| Prerequisite | Step 0 lists `02`; Step 1 verified, if it ran |
| Action | Execute script (F5) |
| Expected | Messages: no `ERROR`; the transaction commits |
| Then run | `02V_VERIFY_AFTER_b1a_02_client_admin_sensitivity_review_READ_ONLY.sql` |
| Required | V02.1 `PASS`: the role CHECK is exactly `gk_admin, gk_operator, gk_reviewer, client_admin`. V02.2 `PASS`: those four roles are accepted, and `client_reviewer` and `client_contributor` are rejected. `OVERALL` = `PASS`. |
| STOP if | any `ERROR` (run `ROLLBACK;`), or any 02V row `FAIL` |
| Rollback | `R02` has no guard. If any `client_admin` sensitivity decision exists, re-adding the narrower CHECK fails validation, the transaction aborts, and nothing changes. |

Widens one CHECK on `kai.intake_sensitivity_review_decisions` so that an organization administrator can record the file sensitivity decision. Why this is needed even though the repository chain already allows it: commit `4191684` also edited the older `kai_sprint2_b1a_02_phase5_allowed_use_decision_ledger.sql`. A fresh database therefore already admits `client_admin`, but your 2026-09-16 capture shows production does not, unless you applied this file after that date.

## Step 3: `03` P2-01M record-count measurement (only if M03 = `REQUIRED`)

| | |
| --- | --- |
| Open | `03_MIGRATION_kai_sprint2_p2_01m_source_record_count_measurement.sql` |
| Prerequisite | Step 0 lists `03`; earlier listed steps verified |
| Action | Execute script (F5) |
| Expected | Messages: no `ERROR`; the transaction commits. Its own guard raises an error and nothing changes if `kai.evidence_items`, `kai.source_locators`, `kai.source_versions` or `evidence_items_p2_01_id_org_unique` is missing. |
| Then run | `03V_VERIFY_AFTER_p2_01m_source_record_count_measurement_READ_ONLY.sql` |
| Required | V03.1–V03.5: the five evidence/locator CHECKs at their exact new definitions. V03.6–V03.7: both new tables exact. V03.8: field-presence/metadata and measurement/aggregate accepted, cross-pairings rejected. V03.9: column/`{"column_name":…}` and `source_data_records`/`{"scope":"data_records_after_header"}` accepted, other pairings rejected. `OVERALL` = `PASS`. |
| STOP if | any `ERROR` (run `ROLLBACK;`), or any 03V row `FAIL` |
| Rollback | `R03` refuses while any measurement evidence or record locator exists. Otherwise it drops both new tables and restores the five CHECKs. |

Additive only. Existing evidence, locator and claim rows are not read or rewritten. Every value the old CHECKs allowed is still allowed.

## Step 4: `04` organization internal release authority

| | |
| --- | --- |
| Open | `04_MIGRATION_kai_sprint2_plan_a_organization_internal_release_authority.sql` |
| Prerequisite | Step 0 lists `04`; earlier listed steps verified |
| Action | Execute script (F5) |
| Expected | Messages: no `ERROR`; the transaction commits. Its own guard raises an error and nothing changes if either P3-16 or P3-17 role constraint is missing. |
| Then run | `04V_VERIFY_AFTER_plan_a_organization_internal_release_authority_READ_ONLY.sql` |
| Required | All rows `PASS`, and `OVERALL` = `PASS`. Row by row: |
| STOP if | any `ERROR` (run `ROLLBACK;`), or any 04V row `FAIL` |
| Rollback | `R04` **refuses** while any `client_admin` snapshot or decision exists. See "Rollback". |

What each 04V row checks:
- **V04.1:** the snapshot CHECK is `gk_reviewer, gk_admin, client_admin`.
- **V04.2:** the decision CHECK keeps the two GK clauses and adds exactly `export_authority_granted` + `client_admin` + `grant`.
- **V04.3–V04.4:** both `BEFORE INSERT` scope triggers are enabled, with the migration's exact function bodies.
- **V04.5:** all 32 type/role/action combinations behave as intended:
  - `client_reviewed` is allowed only for `client_reviewer`;
  - every other type is allowed for `gk_admin`, with grant or revoke;
  - `client_admin` is allowed only for an `export_authority_granted` grant;
  - everything else, including any `client_admin` revoke and `gk_reviewer` decisions, is rejected.
- **V04.6:** the snapshot accepts `gk_reviewer`, `gk_admin` and `client_admin`, and rejects `client_reviewer`, `client_contributor` and `gk_operator`.
- **V04.7:** the P3-17 audience trigger is unchanged, so `funder_ready` still binds only funder candidates and `public_ready` only public ones.

The combination rows evaluate the live CHECK expressions against literal values. No row is inserted.

## Step 5: re-run the preflight

Run `00_PRODUCTION_PREFLIGHT_READ_ONLY.sql` again. **Required:** M01–M04 are all `ALREADY_APPLIED`, and `OVERALL` = `NOTHING_TO_RUN`. If it says anything else, STOP and send the grid.

## Step 6: final verification (read-only)

| | |
| --- | --- |
| Open | `99_FINAL_SCHEMA_VERIFICATION_READ_ONLY.sql` |
| Required | `OVERALL` = `PASS`. Every row is `PASS`, apart from the `INFO` row and any production-owned `WARN` rows already seen in Step 0. |
| STOP if | any `FAIL` |

This covers everything in 01V–04V, plus the whole Step 0 baseline (now expecting the migrated state): helper functions, the audit vocabulary, content types, enums, and every workflow table. **Save this grid as CSV and send it to me.** It is the evidence that unblocks the application rollout.

---

## Rollback (only if you decide to abandon the rollout)

A verified migration never needs rolling back for the database's sake. All four are additive and compatible with the application revision reported deployed. Roll back only to withdraw the capability, and only the migrations you applied, in reverse order: `R04`, `R03`, `R02`, `R01`.

1. Run `RP_ROLLBACK_PRECHECK_READ_ONLY.sql`. It reports counts only, no row contents.
2. Run `rollback/R0N…` only where its row says `SAFE_TO_ROLL_BACK`. Each rollback file is the repository's own rollback, verbatim, in its own transaction.

| Row | When it is not safe | What happens if you run it anyway |
| --- | --- | --- |
| R04 | `UNSAFE_ROLLBACK_REFUSES`: an organization has recorded a release (a `client_admin` snapshot or decision) | It raises `organization internal release authority rollback refused: client_admin release decisions exist`, changes nothing, and you run `ROLLBACK;`. **Never delete organization decisions to make it pass.** They are the organization's append-only record. To withdraw a release, Get Kinder records a `gk_admin` revoke through the application. |
| R03 | `UNSAFE_ROLLBACK_REFUSES`: measurement evidence or a record locator exists | It refuses with `P2-01M rollback refused: …` and changes nothing |
| R02 | `UNSAFE_ROLLBACK_FAILS`: an organization administrator has recorded a sensitivity decision | Validation of the restored CHECK fails, the transaction aborts, nothing changes, and you run `ROLLBACK;` |
| R01 | `DESTRUCTIVE_APP_ROLLBACK_FIRST`: attempt rows exist | It drops the table and its attempt budgets. Run it only after the application is on a revision that never references `kai.intake_p1_downstream_attempts`, which predates `dfe7e31`. **`3b99a90` uses this table.** |

## How this packet was proven (local only)

**Rehearsal:** `scripts/kai-sprint2-pgadmin-production-packet-rehearsal-local-postgres.js rehearse` passed 26/26 assertions on a disposable loopback PostgreSQL 16.14. Every read-only file ran in a read-only session. The replica was built from your 2026-09-16 capture: the same tables, columns, constraints, indexes, triggers, functions and enums.

Results on that replica:
- The preflight reported `READY` with `01, 02, 03, 04`.
- Each verifier failed before its migration and passed after it.
- `99` passed.
- A second preflight reported `NOTHING_TO_RUN`.
- R04 refused with recorded `client_admin` rows.
- A full reverse rollback restored the captured state.

STOP and selective-run cases:
- a replica that already had 01 and 02 asked only for `03, 04`;
- a half-applied 04 gave `STOP_INCOMPATIBLE`;
- an unexpected CHECK on a workflow table gave `STOP`;
- an audit vocabulary missing two operations gave `STOP`.

**Normal-chain runner:** `scripts/kai-sprint2-plan-a-normal-migration-chain-local-postgres.js` passed 2 + 30 / 0. On the repository's full chain, 04 went forward, a replay changed nothing, rollback restored the definitions exactly, and forward converged again. It also refused rollback with real `client_admin` decisions present.

Not proven: production itself. Only your Step 0 output establishes production's actual state. The capture these files compare against is from 2026-09-16.
