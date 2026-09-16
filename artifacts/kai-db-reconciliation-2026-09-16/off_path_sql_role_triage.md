# KAI off-path SQL role triage

Candidate files: 63

Rollback candidate files: 60

Non-rollback candidate files: 3

## Rollback classifications

- ROLLBACK_FOR_ACTIVE_MIGRATION: 57
- ROLLBACK_FOR_OFF_PATH_SQL: 3

## Off-path non-rollback candidates

---

### `migrations/kai_sprint2_legacy_generation_cutover_20260817.sql`

SHA256: `733795b189f742895ee1ce67bf4fb0bf5779ef00e470969c1d1219c69e7312df`

Paired rollback exists: True

Dynamic SQL candidate: True

Affected tables:

- `data_dictionaries`
- `data_dictionary_fields`
- `data_dictionary_mappings`
- `data_quality_findings`
- `evidence_items`
- `intake_file_profiles`
- `intake_parser_runs`
- `intake_promotion_decisions`
- `intake_sensitivity_profiles`
- `intake_source_candidates`
- `review_queue_items`
- `source_locators`
- `source_versions`
- `sources`
- `upload_lifecycle_audit`

Repository references:

```text
Backend/kai/db/kaiReviewCockpitReadModels.js:47: * (migrations/kai_sprint2_legacy_generation_cutover_20260817.sql, section 6). Rows
KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.6.md:18298:  - `migrations/kai_sprint2_legacy_generation_cutover_20260817.sql`: rebuilt as
KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.6.md:18472:  - `migrations/kai_sprint2_legacy_generation_cutover_20260817.sql` preserves
KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.6.md:19592:**Preflight:** read root `AGENTS.md` (package-boundary/testing/DATABASE_URL-sentinel conventions), confirmed branch `main` at a clean `f982017`, and inspected the closest prior conventions for this exact shape: `migrations/kai_sprint2_p2_04_claim_gap_followup.sql` (composite tenant-safe FK pattern, `_id_org_unique` shadow constraint, partial-unique idempotency index style) and `migrations/kai_sprint2_gk_organization_tenant_binding.sql` (minimal additive table + `updated_at` touch-trigger pattern). Confirmed via `migrations/kai_sprint2_legacy_generation_cutover_20260817.sql` that `kai.organizations` and `kai.engagements` are pre-existing, shared (`KEEP_SHARED_IN_KAI`) production objects never created or altered by any migration in this repository - consistent with the owner's instruction not to touch them. Confirmed the repository's schema-contract test convention is static regex assertion against migration SQL source text (no live database execution), matching `__tests__/kai-sprint2-p2-04-claim-gap-followup-schema-contract.spec.js` and `__tests__/kai-sprint2-gk-organization-binding-schema-contract.spec.js`. Proceeded directly; no blocker required a stop.
migrations/kai_sprint2_legacy_generation_cutover_20260817.rollback.sql:3:-- (migrations/kai_sprint2_legacy_generation_cutover_20260817.sql).
migrations/kai_sprint2_p14_12_review_queue_type_check_legacy_repair.sql:23:-- (migrations/kai_sprint2_legacy_generation_cutover_20260817.sql section 4
scripts/kai-sprint2-legacy-cutover-local-postgres.js:35:const CUTOVER_SQL = "migrations/kai_sprint2_legacy_generation_cutover_20260817.sql";
scripts/kai-sprint2-legacy-cutover-preflight.sql:3:-- (migrations/kai_sprint2_legacy_generation_cutover_20260817.sql).
scripts/kai-sprint2-legacy-cutover-runbook.md:104:   execution: `migrations/kai_sprint2_legacy_generation_cutover_20260817.sql`.
```

Last commit touching file:

```text
21b731a726983fd331a872d80c1815014e65eb49	2026-08-17T16:28:54-07:00	Keep shared KAI contracts production-native during cutover
```

First 100 source lines:

```sql
-- ==========================================================================
-- KAI legacy-generation cutover - CORRECTED forward-only bundle (2026-08-17)
--
-- ONE atomic, pgAdmin-Query-Tool-executable transaction. No psql meta-commands,
-- no \i, no DATABASE_URL, no external transaction wrapper, no nested
-- historical-migration transaction boundaries. Any error before COMMIT rolls
-- back the complete cutover; there is no reachable committed state in which
-- legacy names have moved but the required canonical replacements are missing.
--
-- WHY THIS FILE WAS CORRECTED
-- The first pass of this cutover assumed only seven tables were legacy-shaped
-- and that kai.intake_parser_runs, kai.data_dictionary_fields,
-- kai.data_dictionary_mappings, kai.data_quality_findings,
-- kai.source_locators and kai.evidence_items were absent or already canonical.
-- Run read-only against the real production catalog, that preflight returned
-- four FAILs. Four further owner-supplied production captures then proved the
-- assumption wrong: all thirteen objects below are the same older
-- data-model generation, and the two tables the first pass believed had
-- "passed" (data_dictionary_mappings, data_quality_findings) had only passed
-- because the first pass classified shapes by a SINGLE marker column. Their
-- production shapes carry that marker column while carrying none of the
-- canonical P1-04 lineage columns. This file replaces single-column guessing
-- with a multi-factor structural signature (columns + column type classes +
-- primary key + named unique/check/foreign-key constraints + named indexes) and
-- fails closed on any shape it does not recognise.
--
-- EVIDENCE (owner-supplied, read-only production captures, 2026-08-17)
--   capture 1  full catalog: data_dictionaries, intake_file_profiles,
--              intake_files, intake_promotion_decisions,
--              intake_sensitivity_profiles, intake_source_candidates,
--              review_queue_items, source_versions, sources
--   capture 2  the production run of the first-pass preflight (29 checks, 4 FAIL)
--   capture 3  full catalog: intake_parser_runs, data_dictionary_fields,
--              source_locators, evidence_items, plus the incoming edges
--              claim_evidence_links -> evidence_items,
--              funder_requirements -> source_locators,
--              funders -> source_locators
--   capture 4  full catalog: data_dictionary_mappings, data_quality_findings
--
-- PER-OBJECT TREATMENT (classified from the captures plus current-HEAD code,
-- never from the fact that an object appeared in a foreign-key edge)
--
--   RELOCATE_LEGACY (13) - proven legacy shape sitting on a name the current
--   canonical P1 contract owns; moved intact into kai_legacy_20260817:
--     kai.intake_parser_runs           kai.intake_file_profiles
--     kai.data_dictionaries            kai.data_dictionary_fields
--     kai.data_dictionary_mappings     kai.data_quality_findings
--     kai.intake_sensitivity_profiles  kai.intake_source_candidates
--     kai.intake_promotion_decisions   kai.sources
--     kai.source_versions              kai.source_locators
--     kai.evidence_items
--
--   KEEP_SHARED_IN_KAI (never relocated, never replaced, only additively
--   extended by the narrowly-scoped changes in section 4):
--     kai.intake_files  kai.review_queue_items  kai.upload_lifecycle_audit
--     kai.organizations kai.engagements         kai.users
--
--   NOT_REQUIRED_FOR_CURRENT_CUTOVER (dependent tables whose foreign keys point
--   at relocated objects; deliberately left in kai so their rows keep
--   referencing the preserved legacy object, which is the truthful current
--   meaning of those rows). ALTER TABLE ... SET SCHEMA moves a table without
--   dropping or recreating any constraint, and a foreign key binds to the
--   referenced table's OID, not to its schema-qualified name - so each of these
--   keeps pointing at exactly the same rows after the move, now addressed as
--   kai_legacy_20260817.*:
--     kai.claim_evidence_links -> evidence_items
--     kai.funder_requirements  -> source_locators
--     kai.funders              -> source_locators
--   No currently-mounted repository caller requires a canonical object at these
--   three names right now. This is recorded, not silently ignored: the
--   post-cutover verifier reports each of these edges, and the runbook records
--   that a future P2-01/P2-03 package must handle kai.claim_evidence_links
--   explicitly (its CREATE TABLE IF NOT EXISTS in
--   migrations/kai_sprint2_p2_03_claim_proposal.sql would otherwise silently
--   skip over the retained legacy table, reproducing this same class of
--   incident).
--
--   P2-01 DECISION: P2_01_REQUIRED_FOR_REACHABLE_OPERATION.
--   Repository proof at current HEAD: the Review Cockpit source-candidate detail
--   itself still does not read source_locators or evidence_items, but the
--   authenticated Sprint 2 intake router mounts the accepted P2-01
--   evidence-extraction route and P2-02 evidence-coverage route behind only
--   KAI_SPRINT2_ENABLED. The admin Impact Evidence Library UI also exposes those
--   calls. Because KAI_SPRINT2_ENABLED is owner-confirmed enabled in production,
--   leaving kai.source_locators/kai.evidence_items absent after this cutover
--   would leave a currently mounted, human-authorized operation structurally
--   broken. This bundle therefore preserves the legacy P2 graph intact under
--   kai_legacy_20260817 and installs EMPTY canonical P2-01 source_locators and
--   evidence_items tables. It still never translates, copies, relabels, or
--   fabricates any legacy row into the canonical P2 generation.
--
-- WHAT THIS BUNDLE NEVER DOES
--   * never translates a legacy row into a canonical row
--   * never fabricates profile_canonical_sha256, file-profile / dictionary /
--     sensitivity / candidate lineage, promotion decisions, source or
--     source-version lineage, source locators, or evidence items
--   * never fabricates a queue approval, rejection, resolution or cancellation
--   * never relocates, replaces or narrows a shared object
--   * never replays a historical migration file as a production step, and never
--     edits one
```

---

### `migrations/kai_sprint2_p14_12_review_queue_type_check_legacy_repair.sql`

SHA256: `09c38a18ef8699c2a6c4d6652bb5fc7579f3a15441c3b8d70b58c47e144937f6`

Paired rollback exists: True

Dynamic SQL candidate: False

Affected tables:

- `review_queue_items`

Repository references:

```text
scripts/kai-sprint2-p14-12-review-queue-type-check-legacy-repair-local-postgres.js:168:  psqlFile("migrations/kai_sprint2_p14_12_review_queue_type_check_legacy_repair.sql");
scripts/kai-sprint2-p14-12-review-queue-type-check-legacy-repair-local-postgres.js:171:  psqlFile("migrations/kai_sprint2_p14_12_review_queue_type_check_legacy_repair.sql");
```

Last commit touching file:

```text
c219fdbe0a2bf06eda7d9100c67213eb7b2d7c55	2026-09-14T10:44:43-07:00	Fix legacy review queue type constraint drift
```

First 100 source lines:

```sql
BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P14-12 review-queue queue_type legacy-constraint repair migration';
  END IF;
END $$;

-- P14-12 scope (bounded schema-drift repair only): a USER_CONFIRMED
-- production snapshot showed kai.review_queue_items simultaneously carrying
-- an obsolete, pre-P1-06 review_queue_items_queue_type_check fixed allowlist
-- alongside the canonical, validated P1-06 review_queue_items_p1_06_queue_type_check
-- contract (already widened by BR-03A to admit board_reporting_candidate_review)
-- and the validated BR-03B Board review lifecycle contract. PostgreSQL CHECK
-- constraints are cumulative (ANDed), so the obsolete allowlist - which does
-- not include board_reporting_candidate_review - blocks every Board
-- candidate review-queue insert even though the newer, named contracts
-- already admit it. This is the same class of proven production drift P14-10
-- repaired for review_queue_items_target_object_type_check: an unnamed-by-the-
-- application, pre-P1-06 CHECK left in place when the canonical P1-06 table
-- contract was introduced onto the pre-existing shared production table
-- (migrations/kai_sprint2_legacy_generation_cutover_20260817.sql section 4
-- only ever adds the canonical P1-06 constraints by name; it never asserts
-- anything about, and never drops, this older constraint). No committed
-- migration in this repository has ever dropped
-- review_queue_items_queue_type_check.
--
-- This migration repairs that one proven, named drift only. It does not
-- widen any vocabulary beyond what review_queue_items_p1_06_queue_type_check
-- (as BR-03A last defined it) already authorizes, does not touch any other
-- constraint, and does not modify data rows.

-- Fail closed unless the canonical, validated P1-06 queue_type contract is
-- present and already admits board_reporting_candidate_review - proving the
-- Board-aware schema prerequisite by inspection of the live predicate, the
-- same discipline BR-03B established for this same constraint.
DO $$
DECLARE
  existing_predicate text;
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO existing_predicate
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'review_queue_items'
     AND c.conname = 'review_queue_items_p1_06_queue_type_check'
     AND c.convalidated;

  IF existing_predicate IS NULL THEN
    RAISE EXCEPTION 'validated kai.review_queue_items_p1_06_queue_type_check is required before P14-12';
  END IF;

  IF position('''board_reporting_candidate_review''' IN existing_predicate) = 0 THEN
    RAISE EXCEPTION 'kai.review_queue_items_p1_06_queue_type_check does not admit board_reporting_candidate_review; refusing P14-12';
  END IF;
END $$;

-- Fail closed unless the validated BR-03B Board review lifecycle contract is
-- present, detected structurally (predicate shape), not by name, because the
-- BR-03B verifier already established this constraint's catalog name may be
-- truncated by PostgreSQL's 63-byte identifier limit.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'kai.review_queue_items'::regclass
       AND c.contype = 'c'
       AND c.convalidated
       AND pg_get_constraintdef(c.oid) LIKE '%board_reporting_candidate_review%'
       AND pg_get_constraintdef(c.oid) LIKE '%target_object_type = ''board_reporting_candidate''%'
       AND pg_get_constraintdef(c.oid) LIKE '%queue_status = ''open''%'
       AND pg_get_constraintdef(c.oid) LIKE '%queue_status = ''in_progress''%'
       AND pg_get_constraintdef(c.oid) LIKE '%queue_status = ''resolved''%'
       AND pg_get_constraintdef(c.oid) LIKE '%review_status = ''resolved''%'
  ) THEN
    RAISE EXCEPTION 'the validated BR-03B Board review lifecycle contract check is required before P14-12';
  END IF;
END $$;

-- The repair itself: remove ONLY the obsolete legacy allowlist. Safe and a
-- no-op if already absent (a database that never carried it, or a second run
-- of this migration).
ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_queue_type_check;

COMMIT;
```

---

### `migrations/kai_sprint2_p1_06_review_status_column_repair.sql`

SHA256: `9b4cdb6674a5f9091695550c0223cea16705a1ae10f7bae0d43c4489b5ff8571`

Paired rollback exists: True

Dynamic SQL candidate: True

Affected tables:

- `review_queue_items`

Repository references:

```text
__tests__/kai-sprint2-p1-06-review-status-column-repair-schema-contract.spec.js:5:const migrationSource = readFileSync("migrations/kai_sprint2_p1_06_review_status_column_repair.sql", "utf8");
scripts/kai-sprint2-p1-06-review-status-repair-local-postgres.js:24:const FORWARD_MIGRATION = "migrations/kai_sprint2_p1_06_review_status_column_repair.sql";
```

Last commit touching file:

```text
801675bbc24f5a94e198bf4173fae349b4fe2e3d	2026-08-19T09:41:18-07:00	KAI finalize source promotion review cockpit and schema repair
```

First 100 source lines:

```sql
BEGIN;

-- P1-06 corrective repair: some already-existing kai.review_queue_items rows
-- were created (outside this repository's own CREATE TABLE IF NOT EXISTS path)
-- while review_status was still kai.review_status_enum-backed. The shared
-- kai.review_status_enum never gained a 'resolved' label, so the P1-08
-- resolved/resolved terminal write (postgresSourcePromotionRepository.js
-- resolveReviewQueueItemIfCurrent) fails with 22P02 against that starting
-- shape. This migration converts review_status to a column-local text type
-- with its own CHECK vocabulary, exactly mirroring the already-reviewed
-- column definition this repository's own P1-06 migration creates for a
-- fresh table. It does not touch the shared kai.review_status_enum and does
-- not alter any other column, table, or review-status semantics.
--
-- Fail-fast locking: refuse rather than wait indefinitely for the DDL lock
-- if a concurrent session already holds one on this table.
LOCK TABLE ONLY kai.review_queue_items
  IN ACCESS EXCLUSIVE MODE NOWAIT;

-- This migration recognizes exactly two starting states and fails closed on
-- any other: (A) the diagnosed legacy enum-backed contract, which it repairs,
-- and (B) the exact already-repaired text contract, which it leaves
-- untouched and validates as a converged no-op. Because the mutation itself
-- must be conditional on which state is found, it runs via EXECUTE inside
-- this single guarded DO block rather than as bare top-level DDL.
DO $review_status_repair$
DECLARE
  v_relkind "char";
  v_ispartition boolean;
  v_attnum smallint;
  v_atttypid oid;
  v_atttypname text;
  v_atttypnamespace text;
  v_atttyptype "char";
  v_attnotnull boolean;
  v_attidentity "char";
  v_attgenerated "char";
  v_defexpr text;
  v_enum_type_oid oid;
  v_has_resolved_label boolean;
  v_non_vocab_count bigint;
  v_conflicting_check_count integer;
  v_name_collision_count integer;
  v_invalid_index_count integer;
  v_governing_check_count integer;
  v_check_name text;
  v_check_validated boolean;
  v_vocab_ok boolean;
  v_state text;
BEGIN
  -- Guard 1 (common to both recognized states): kai.review_queue_items
  -- exists as an ordinary, non-partition table.
  SELECT r.relkind, r.relispartition
    INTO v_relkind, v_ispartition
    FROM pg_class r
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items';

  IF v_relkind IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items does not exist; refusing the P1-06 review_status repair';
  END IF;
  IF v_relkind <> 'r' OR v_ispartition THEN
    RAISE EXCEPTION 'kai.review_queue_items is not an ordinary non-partition table (relkind=%, relispartition=%); refusing the P1-06 review_status repair', v_relkind, v_ispartition;
  END IF;

  SELECT a.attnum, a.atttypid, ty.typname, tn.nspname, ty.typtype,
         a.attnotnull, a.attidentity, a.attgenerated,
         pg_get_expr(d.adbin, d.adrelid)
    INTO v_attnum, v_atttypid, v_atttypname, v_atttypnamespace, v_atttyptype,
         v_attnotnull, v_attidentity, v_attgenerated, v_defexpr
    FROM pg_attribute a
    JOIN pg_class r ON r.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    JOIN pg_type ty ON ty.oid = a.atttypid
    JOIN pg_namespace tn ON tn.oid = ty.typnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum
   WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
     AND a.attname = 'review_status' AND NOT a.attisdropped;

  IF v_attnum IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items.review_status does not exist; refusing the P1-06 review_status repair';
  END IF;

  -- Classify the starting state by the column's actual type. Anything that
  -- is neither the diagnosed legacy enum contract nor the exact repaired
  -- text contract fails closed rather than being treated as convergence.
  IF v_atttypname = 'review_status_enum' AND v_atttypnamespace = 'kai' AND v_atttyptype = 'e' THEN
    v_state := 'legacy';
  ELSIF v_atttypname = 'text' AND v_atttypnamespace = 'pg_catalog' THEN
    v_state := 'repaired';
  ELSE
    RAISE EXCEPTION 'kai.review_queue_items.review_status is neither the diagnosed legacy enum contract (kai.review_status_enum) nor the exact repaired text contract (found %.%, typtype=%); refusing the P1-06 review_status repair', v_atttypnamespace, v_atttypname, v_atttyptype;
  END IF;

  IF v_state = 'legacy' THEN
    -- ================================================================
    -- STATE A: LEGACY-COMPATIBLE. Apply the already-accepted
    -- column-local forward repair.
    -- ================================================================
    IF NOT v_attnotnull THEN
```
