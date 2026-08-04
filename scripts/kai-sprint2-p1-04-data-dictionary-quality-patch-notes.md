# KAI P1-04 Patch Notes — Draft Data-Dictionary and Data-Quality Foundation

## Added

- `migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql` — forward migration creating `kai.data_dictionaries`, `kai.data_dictionary_fields`, `kai.data_dictionary_mappings`, `kai.data_quality_findings`, one additive/backward-compatible unique constraint on the existing `kai.intake_file_profiles` (`intake_file_profiles_p1_04_lineage_unique`), and the new `data_dictionary_draft_persisted` audit operation/metadata branch on the existing `kai.upload_lifecycle_audit`.
- `migrations/kai_sprint2_p1_04_data_dictionary_and_quality.rollback.sql` — rollback draft that removes only the P1-04 tables, the additive lineage constraint, and the P1-04 audit rows/branch, restoring the exact prior audit constraints.
- `scripts/kai-sprint2-p1-04-data-dictionary-quality-verifier.sql`, `-failure-checks.sql`, `-smoke-seed.sql`, `-smoke-verifier.sql` — catalog verification, read-only negative-scope checks, synthetic smoke seed, and smoke verification.
- `scripts/kai-sprint2-p1-04-data-dictionary-quality-runner.js` — ephemeral loopback PostgreSQL 16 runner (`npm run verify:kai-sprint2-p1-04-data-dictionary-quality`).
- `scripts/kai-sprint2-p1-04-data-dictionary-quality-runbook.md` — package runbook.
- `Backend/kai/dictionary/postgresDataDictionaryRepository.js` — new repository: the only authorized location for this package's SQL and row locking; consumes only the tenant-scoped committed `kai.intake_file_profiles` row; derives fields and quality findings purely and deterministically from explicit committed profile-stage facts.
- `__tests__/kai-sprint2-p1-04-data-dictionary-quality-schema-contract.spec.js`, `-boundary.spec.js`, `.integration.spec.js` — focused schema, boundary, and PostgreSQL-backed integration tests.

## Changed (extended in place, not duplicated)

- `Backend/kai/services/kaiDataDictionaryService.js` — `createDraftDataDictionary` is no longer a stub; it now validates its input allowlist (`organizationId`, `fileProfileId`, `now` only — no caller-supplied intake-file identity, profile identity, hash, or content), checks `KAI_SPRINT2_ENABLED`, and delegates to the injected P1-04 repository. Contains no SQL and imports no database pool.
- `package.json` — added the `verify:kai-sprint2-p1-04-data-dictionary-quality` script.
- The active ExecPlan (`KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md`) — one additions-only evidence block appended at the literal EOF.

## Not changed

No P1-02 or P1-03 migration, rollback, runner, verifier, smoke, or runbook artifact was edited. No route, listener, scheduler, timer, startup hook, public barrel export, production composition, feature-flag default, or cloud configuration was added. No sensitivity profile, review item, source candidate, promotion decision, source, source version, evidence, claim, or assistant tool was created. No denominator assessment, coverage-gap analysis, funder-requirement alignment, or client/operator follow-up generation was implemented.

## Behavior summary

One dictionary bundle per `organization_id` + `file_profile_id`. Same profile identity and stored hash: replay. Same profile identity, different bound hash: `conflict_current_state_changed`. Different profile identity: a separate bundle, never a revision. Every field, mapping, and finding is created with the exact fail-closed provisional defaults (draft / needs_gk_review / open / unknown / internal / not-allowed / human-review-required) inside one transaction that includes the required metadata-only `data_dictionary_draft_persisted` audit write; any audit rejection or publish failure rolls back every write. Dormant, tenant-scoped, and behind `KAI_SPRINT2_ENABLED` throughout.
