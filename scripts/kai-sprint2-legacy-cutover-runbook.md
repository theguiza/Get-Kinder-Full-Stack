# KAI legacy-generation cutover - production runbook (corrected, 2026-08-17)

Do **not** execute this runbook as part of any repository task. It is the
authorized operator procedure, and every step below is a deliberate production
action.

## What this cutover is for

Production's `kai.intake_source_candidates` - and twelve of its lineage
neighbours - are an older data-model generation than the current repository's
canonical P1 contract requires. Review Cockpit source-candidate detail therefore
fails in production with `column "file_profile_id" does not exist` (SQLSTATE
42703), because the deployed read model selects the canonical P1-07 lineage
columns (`file_profile_id`, `data_dictionary_id`,
`intake_sensitivity_profile_id`, `profile_canonical_sha256`) that the legacy
table does not have.

The cutover relocates the proven-legacy tables **intact** into
`kai_legacy_20260817` and installs the canonical tables at the freed `kai.*`
names. It never translates a legacy row into a canonical row and never fabricates
a hash, a lineage tuple, a promotion decision or a review decision. Genuine
canonical records are produced afterwards, only by the real current producer
chain, as a separate authorized operation.

## Objects and treatment

| Treatment | Objects |
| --- | --- |
| `RELOCATE_LEGACY` (moved intact into `kai_legacy_20260817`) | `intake_parser_runs`, `intake_file_profiles`, `data_dictionaries`, `data_dictionary_fields`, `data_dictionary_mappings`, `data_quality_findings`, `intake_sensitivity_profiles`, `intake_source_candidates`, `intake_promotion_decisions`, `sources`, `source_versions`, `source_locators`, `evidence_items` |
| `KEEP_SHARED_IN_KAI` (never moved, never replaced; only the additive changes in the bundle's section 4) | `intake_files`, `review_queue_items`, `upload_lifecycle_audit`, `organizations`, `engagements`, `users` |
| `NOT_REQUIRED_FOR_CURRENT_CUTOVER` (left in `kai`; their foreign keys follow their parent into the preserved schema by OID and keep referencing exactly the same rows) | `claim_evidence_links`, `funder_requirements`, `funders` |
| `REPLACE_WITH_CANONICAL` | none - no object is replaced in place; the canonical tables are created at names the relocation has just freed |
| `UNRESOLVED_CONFLICT` | none |

**P2-01 decision: `P2_01_REQUIRED_FOR_REACHABLE_OPERATION`.** The legacy
`kai.source_locators` and `kai.evidence_items` rows are preserved intact under
`kai_legacy_20260817`, and empty canonical P2-01 tables are installed at
`kai.source_locators` and `kai.evidence_items`. Repository proof at current
HEAD: Review Cockpit itself does not read these tables, but the accepted P2-01
and P2-02 routes are mounted behind only `KAI_SPRINT2_ENABLED`, and the admin
Impact Evidence Library UI exposes those calls. Because production
`KAI_SPRINT2_ENABLED` is owner-confirmed enabled, leaving these canonical tables
absent would leave a currently reachable human-authorized operation
structurally broken. The cutover still never translates, copies, relabels, or
fabricates legacy P2 rows into the canonical generation.

## Steps

1. **Open an authenticated pgAdmin Query Tool session** against the production
   database, as a role that owns the `kai` schema and the thirteen relocation
   candidates. No `psql`, no `\i`, no `DATABASE_URL`, no migration runner.

2. **Run the read-only preflight**, in full, in one Query Tool tab:
   `scripts/kai-sprint2-legacy-cutover-preflight.sql`.
   It mutates nothing. It emits one result set of
   `result_type, check_name, object_name, status, detail`, containing catalog
   metadata, structural classifications and aggregate counts only - no PII, no
   filenames, no storage locations, no raw business content, no queue-row
   contents and no target object identifiers.

3. **Require every preflight row to be `PASS`.** Stop on any `FAIL`. In
   particular:
   - `SHAPE_CLASSIFICATION / STRUCTURAL_SIGNATURE` must be `LEGACY_EXPECTED` for
     all thirteen objects, and `STARTING_STATE_IS_COHERENT` must pass. An
     `UNRECOGNIZED` classification means production has a third shape this
     package has never seen; do not proceed and do not guess.
   - `PREREQUISITE / AUDIT_OPERATION_STARTING_OR_CONVERGED` must pass. A
     Gate-A-only `upload_lifecycle_audit` operation CHECK is a supported
     starting state; the bundle widens it atomically to the cumulative P1
     producer vocabulary. An already-cumulative CHECK is accepted for rerun.
   - `PREREQUISITE / QUEUE_PRIORITY_PRODUCTION_NATIVE` must pass.
     Production evidence shows `review_queue_items.priority` starts as
     `kai.priority_enum` with default `'medium'` and no `'normal'`; the bundle
     preserves that shared enum/default/label contract and current producers
     write `'medium'`.
   - `DEPENDENCY / *` must pass. A view, materialized view, unexpected trigger,
     unexpected trigger function/timing/event/relation, or `kai` function body
     that references a relocation candidate is a dependency this bundle does
     not model, and it fails closed. The exact production-supported
     `BEFORE UPDATE FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at()` trigger
     set is allowed and verified by relation OID during relocation.

4. **Establish and prove quiescence** for every writer of the thirteen
   relocation candidates and of `kai.review_queue_items`. From current HEAD, the
   writers are: the mounted `/api/kai/sprint2/intake` router
   (`Backend/kai/routes/sprint2IntakeApi.js`), the P2/P3 services it lazily
   imports, and the P1 parser/profile worker registered by
   `registerKaiP1WorkerCron()` (`Backend/kai/parsing/p1WorkerCron.js`). Quiesce
   them by the deployment's own operational means - **do not change
   `KAI_SPRINT2_ENABLED` or any other feature flag as part of this cutover.**
   Confirm no in-flight request or worker tick remains before step 5.

   `NOT_CONFIRMED`: this repository defines no `lock_timeout` /
   `statement_timeout` convention anywhere in `migrations/` or `scripts/`, so the
   bundle invents none. Choosing whether to set a session-level
   `lock_timeout`/`statement_timeout` in the Query Tool before step 5, and to
   what value, is an operational decision that has not been made. The bundle
   takes only the locks `ALTER TABLE ... SET SCHEMA`, `ALTER TABLE ... ADD
   CONSTRAINT`, `CREATE TABLE`, `CREATE INDEX` and one narrow `UPDATE` require;
   without a timeout, an unquiesced writer can block it for as long as it holds
   its own lock.

5. **Execute the ONE atomic forward bundle**, whole, in a single Query Tool
   execution: `migrations/kai_sprint2_legacy_generation_cutover_20260817.sql`.
   It is one `BEGIN` ... `COMMIT` with no nested transaction boundaries. It
   revalidates the expected starting state inside its own transaction before
   mutating anything, and runs structural assertions before `COMMIT`. Any error
   rolls the entire cutover back; there is no committed state in which legacy
   names have moved but canonical replacements are missing. Do **not** run any
   historical migration file before, during or after this step.

6. **Run the post-cutover verifier**, read-only:
   `scripts/kai-sprint2-legacy-cutover-verifier.sql`.

7. **Require every verifier row to be `PASS`.** It proves the canonical P1/P2-01
   objects and the exact column/constraint contracts the current code reads,
   schema-only empty canonical P2-01 installation, legacy preservation and row
   counts, allowed legacy `updated_at` triggers still attached to the preserved
   relations, no inherited triggers on canonical replacements, material
   foreign-key preservation, retained-dependent edges still pointing at the
   preserved objects, shared-object contracts unnarrowed, that no legacy queue
   target can be misread as canonical work, that no legacy identity appears in a
   canonical table, and that the exact current source-candidate,
   promotion-decision and cockpit-queue projections compile and execute.

   If a check fails, use `migrations/kai_sprint2_legacy_generation_cutover_20260817.rollback.sql`
   - but only while step 9 has not yet run. See "Rollback" below.

8. **Release quiescence** by the same operational means used in step 4, in
   reverse. No feature-flag change.

9. **Separately, and under its own authorization, run one synthetic canonical
   reprocessing operation** using `scripts/kai-sprint2-legacy-cutover-synthetic-reprocessor.js`.
   It drives the real current producer chain
   (`activateParserProfileWorkForIntakeFile` -> `createDraftDataDictionary` ->
   `persistIntakeSensitivityProfile` -> `createSensitivityReviewQueueItem` ->
   `createSourceCandidateStub`). The real `profile_canonical_sha256` comes from
   the authoritative profile producer; the executor does not accept it as input.
   The new canonical candidate will normally have a **new** UUID - that is
   expected and correct, not a defect.

10. **Test the new canonical candidate through Review Cockpit** in the
    application. Its source-candidate detail must return successfully. The
    preserved legacy candidate must not appear as canonical cockpit work.

## Rollback

`migrations/kai_sprint2_legacy_generation_cutover_20260817.rollback.sql` is a
**`PRE_REPROCESSING_ROLLBACK` only**. It is valid between step 5 and step 9,
while the canonical tables are still empty. It removes the additive
`review_queue_items` changes and the legacy-generation queue markers, restores
`review_queue_items.priority` to the pre-cutover enum/default when no
post-cutover-only priority value has been written, restores the Gate-A audit
constraints, drops the empty canonical tables, and moves every preserved legacy
table back to `kai`, restoring names, locations, rows, identities, constraints,
indexes and dependency edges. It refuses to run if any canonical row exists or
if priority values outside the pre-cutover enum vocabulary exist.

`POST_REPROCESSING_RECOVERY` - recovery after step 9 has produced genuine
canonical records - is **not implemented**. Dropping the canonical tables then
would destroy authentic producer- and human-generated records with no legacy
equivalent. If that recovery is ever needed it must be designed, reviewed and
proved as its own package. Do not approximate it with the rollback file.

## Known deferred follow-up

`kai.claim_evidence_links` is deliberately retained in `kai`, and after the
cutover its foreign key references `kai_legacy_20260817.evidence_items`. A future
P2-01/P2-03 package **must** handle it explicitly: the
`CREATE TABLE IF NOT EXISTS kai.claim_evidence_links` in
`migrations/kai_sprint2_p2_03_claim_proposal.sql` would silently skip over the
retained legacy table and reproduce exactly this class of incident. The
post-cutover verifier reports this as a `DEFERRED` row so it cannot be forgotten.

## Local proof behind this runbook

`node scripts/kai-sprint2-legacy-cutover-local-postgres.js` stands up its own
ephemeral, loopback-only PostgreSQL 16 instance, builds the production-shaped
legacy fixture from the four owner-supplied production captures, and proves, in
order: the fixture matches every captured structure; the real 42703 failure
reproduces pre-cutover; the preflight is fully green on the expected legacy state
and fails closed on an unrecognized variation, unexpected trigger, unsupported
priority shape, incompatible audit vocabulary, and unsatisfiable audit column; a
forced mid-cutover failure leaves the database byte-identical; the bundle
applies; priority `medium` and the cumulative audit producer operations
are writable; the verifier is fully green; legacy rows, relationships, retained
dependents, updated_at triggers and shared contracts all survive; the
pre-reprocessing rollback restores the exact fixture; re-applying and re-running
the bundle are convergent no-ops; the real producer chain yields a working
Review Cockpit detail with tenant isolation and convergent replay; and the
rollback refuses once canonical rows exist. It never touches a real database.
