# KAI legacy-generation cutover — production runbook

Operator surface: authenticated pgAdmin against the production PostgreSQL
instance. Do not use `psql`, `DATABASE_URL`, or any other transport. Nothing in
this runbook is executed by this task — it is prepared for separate,
explicit operator authorization and execution.

## Background

`GET /api/kai/sprint2/intake/admin/review-cockpit/source-candidates/:id` fails
with `column "file_profile_id" does not exist` because production's
`kai.intake_source_candidates` (and its P1-04/P1-05/P1-08 lineage neighbors)
are a different, older data-model generation than the current repository's P1
migrations and code require — confirmed against a real, read-only production
catalog dump on 2026-08-17. This cutover relocates the incompatible legacy
tables intact into a preserved schema and installs the canonical P1 tables at
their expected names, then a separate, explicitly-authorized reprocessing step
regenerates real canonical records for any file the operator chooses.

## Order of operations

1. **Read-only preflight.** Run `scripts/kai-sprint2-legacy-cutover-preflight.sql`
   in pgAdmin against production. Every row's `status` column must be `PASS`.
   If any row is `FAIL`, STOP — do not proceed. The most likely `FAIL` causes:
   - A table already exists in a shape this migration doesn't recognize
     (neither the supplied-catalog legacy shape nor the canonical shape).
   - `kai.source_locators`/`kai.evidence_items`/`kai.gap_log_items` already
     exist against a still-legacy `kai.source_versions` (would indicate this
     preflight's premises are stale and need re-verification against a fresh
     catalog dump).

2. **Cutover migration.** With every preflight check `PASS`, run
   `migrations/kai_sprint2_legacy_generation_cutover_20260817.sql` as one
   transaction in pgAdmin. It:
   - Relocates `kai.intake_file_profiles`, `kai.data_dictionaries`,
     `kai.intake_sensitivity_profiles`, `kai.intake_source_candidates`,
     `kai.intake_promotion_decisions`, `kai.sources`, `kai.source_versions` —
     each byte-for-byte, all rows and identities preserved — into schema
     `kai_legacy_20260817`, only for tables it can prove are the exact legacy
     shape from the supplied catalog.
   - Leaves `kai.intake_files`, `kai.upload_lifecycle_audit`, and
     `kai.review_queue_items` in place (proven canonical/shared-live; never
     relocated). Adds two named CHECK constraints and two partial unique
     indexes to `kai.review_queue_items` — additive only, scoped to
     `queue_type` values no legacy or currently-wired code writes.
   - Fails the whole transaction (`RAISE EXCEPTION`, automatic rollback) if any
     table doesn't match a recognized shape. Nothing partial is ever left
     behind.
   - Is safe to re-run: a prior successful run is detected and treated as a
     no-op.

3. **Install the canonical P1 tables.** Run each of the following, in this
   exact order, unmodified, exactly as already accepted (none of these files
   are changed by this cutover):
   - `migrations/kai_sprint2_p1_parser_run_and_file_profile.sql`
   - `migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql`
   - `migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql`
   - `migrations/kai_sprint2_p1_06_review_queue.sql`
   - `migrations/kai_sprint2_p1_07_intake_source_candidate.sql`
   - `migrations/kai_sprint2_p1_08_source_promotion.sql`

4. **Post-migration verifier.** Run
   `scripts/kai-sprint2-legacy-cutover-verifier.sql`. Every row's `status`
   must be `PASS`.

5. **Retest the production request.** Re-issue the original failing request:
   `GET /api/kai/sprint2/intake/admin/review-cockpit/source-candidates/<id>?organization_id=<org>`.
   It will now return `not_found` for any existing (legacy) candidate id — the
   legacy candidate was never translated into a canonical one — rather than a
   `system_error`. This confirms the schema-level 500 is resolved.

6. **Separately authorized: reprocess real files.** No candidate exists yet
   for any real intake file until it is reprocessed through the real P1
   producer chain. For each file the operator selects (separately authorized,
   one at a time), run
   `scripts/kai-sprint2-legacy-cutover-synthetic-reprocessor.js
   --organization-id=<uuid> --intake-file-id=<uuid> --actor-user-id=<uuid>`
   against the target database. It composes the existing
   `activateParserProfileWorkForIntakeFile` → `createDraftDataDictionary` →
   `persistIntakeSensitivityProfile` → `createSensitivityReviewQueueItem` →
   `createSourceCandidateStub` seam, unmodified, producing a genuinely new
   candidate id with real lineage. Only after this step will the Review
   Cockpit detail read return data for that file.

## Rollback

- **Before step 3 (canonical install) has run:** run
  `migrations/kai_sprint2_legacy_generation_cutover_20260817.rollback.sql`.
  This is lossless — it only reverses the schema relocation.
- **After step 3 has run:** the cutover's own rollback file refuses to run
  (by design). A rollback at this point requires first running each of the P1
  migrations' own accepted `.rollback.sql` files, in reverse order (P1-08 →
  P1-07 → P1-06 → P1-05 → P1-04 → parser-run), to remove the canonical tables
  those migrations installed, and only then running the cutover's rollback
  file. This is NOT a single-command operation and has not been exercised
  end-to-end by this task's tests — treat it as a documented procedure, not a
  proven one, until it is separately verified.
- **After step 6 (reprocessing) has produced real canonical rows:** no
  automated rollback is provided or safe to assume. Any rollback at this point
  requires a manually reviewed data-preservation plan.

## What this runbook does not do

- Does not translate, backfill, or relabel any legacy row as canonical.
- Does not fabricate `profile_canonical_sha256` or any other lineage value.
- Does not alter Review Cockpit routes, services, or read models.
- Does not touch `kai.sources`/`kai.source_versions` unless step 2 proves they
  are in the exact legacy shape — if some other, third shape is present, the
  migration refuses to run rather than guess.
