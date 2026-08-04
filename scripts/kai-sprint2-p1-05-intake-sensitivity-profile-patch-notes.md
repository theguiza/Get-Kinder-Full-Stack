# KAI P1-05 Patch Notes — Intake Sensitivity and Allowed-Use Profile Foundation

## Added

- `migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql` — forward migration creating `kai.intake_sensitivity_profiles`, immutably bound by composite foreign key to the existing `kai.intake_file_profiles` lineage (`intake_file_profiles_p1_04_lineage_unique`) and the existing `kai.data_dictionaries` lineage (`data_dictionaries_p1_04_lineage_unique`), and the new `intake_sensitivity_profile_persisted` audit operation/metadata branch on the existing `kai.upload_lifecycle_audit`.
- `migrations/kai_sprint2_p1_05_intake_sensitivity_profile.rollback.sql` — rollback draft that removes only the P1-05 table and the P1-05 audit rows/branch, restoring the exact prior audit constraints.
- `scripts/kai-sprint2-p1-05-intake-sensitivity-profile-verifier.sql`, `-failure-checks.sql`, `-smoke-seed.sql`, `-smoke-verifier.sql` — catalog verification, read-only negative-scope checks, synthetic smoke seed, and smoke verification.
- `scripts/kai-sprint2-p1-05-intake-sensitivity-profile-local-postgres.js` — ephemeral loopback PostgreSQL 16 runner (`npm run verify:kai-sprint2-p1-05-intake-sensitivity-profile`).
- `scripts/kai-sprint2-p1-05-intake-sensitivity-profile-runbook.md` — package runbook.
- `Backend/kai/dictionary/postgresIntakeSensitivityProfileRepository.js` — new repository: the only authorized location for this package's SQL and row locking; consumes only the tenant-scoped committed `kai.intake_file_profiles` and `kai.data_dictionaries` rows; derives every classification dimension purely and deterministically from an explicit committed profile-stage fact, defaulting to `unknown` otherwise.
- `Backend/kai/services/kaiIntakeSensitivityProfileService.js` — new dormant service seam: validates its input allowlist (`organizationId`, `fileProfileId`, `dataDictionaryId`, `now` only), checks `KAI_SPRINT2_ENABLED`, and delegates to the injected P1-05 repository. Contains no SQL and imports no database pool.
- `__tests__/kai-sprint2-p1-05-intake-sensitivity-profile-schema-contract.spec.js`, `-boundary.spec.js`, `.integration.spec.js` — focused schema, boundary, and PostgreSQL-backed integration tests.

## Changed (additive only)

- `package.json` — added the `verify:kai-sprint2-p1-05-intake-sensitivity-profile` script.
- The active ExecPlan (`KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md`) — one additions-only evidence block appended at the literal EOF.

## Not changed

No P1-02, P1-03, or P1-04 migration, rollback, runner, verifier, smoke, or runbook artifact was edited. No route, listener, scheduler, timer, startup hook, public barrel export, production composition, feature-flag default, or cloud configuration was added. No review queue item, source candidate, promotion decision, source, source version, evidence, claim, or assistant tool was created. No retention execution, deletion, storage-lifecycle change, job activation, approval, or external-release authority was implemented anywhere.

## Behavior summary

One authoritative sensitivity/allowed-use profile row per `organization_id` + `file_profile_id` + `data_dictionary_id`. Same identity and stored profile hash: replay. Same identity, different bound profile hash: `conflict_current_state_changed`. Every applicable classification dimension - PII, minor data, health/housing/justice/immigration data, Indigenous/OCAP-like governance data (distinct from PII), staff notes, story/testimonial content, small-cell risk (distinct), consent basis, allowed use, and financial records (distinct from PII) - is its own CHECK-enforced 3-state column defaulting to `unknown`, which is a real, distinct, queryable value, never coerced to false/absent/safe/permitted. LLM processing, product learning, public use, and funder use are each pinned `not allowed`; human review is pinned `required`; retention posture is a single pinned labeled restriction, never an execution. Persisting the row and the required metadata-only `intake_sensitivity_profile_persisted` audit write happen inside one transaction; any audit rejection or publish failure rolls back the write. Dormant, tenant-scoped, and behind `KAI_SPRINT2_ENABLED` throughout.
