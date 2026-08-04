# KAI P1-05 Intake Sensitivity and Allowed-Use Profile Foundation Runbook

This package adds one new dormant table — `kai.intake_sensitivity_profiles` — and its PostgreSQL repository/service adapter, verified in an isolated local PostgreSQL 16 instance created by the runner. It binds immutably to the existing, unmodified P1-04 `kai.data_dictionaries` lineage and the existing, unmodified P1-02 `kai.intake_file_profiles` lineage by composite foreign key, and extends the existing Gate A audit table's operation/metadata vocabulary with one new operation. It changes no P1-02, P1-03, or P1-04 migration, rollback, runner, verifier, smoke, or runbook artifact.

Run:

```sh
npm run verify:kai-sprint2-p1-05-intake-sensitivity-profile
```

The runner:

- creates a temporary data directory under the OS temp directory;
- starts PostgreSQL 16 bound only to `127.0.0.1` on a runner-chosen port;
- creates the synthetic database `kai_p1_05_intake_sensitivity_profile_synthetic`;
- applies the existing synthetic bootstrap schema and the existing frozen Gate A P0 upload-lifecycle, Gate A P0 policy-decision-replay, P1-02 parser-run/file-profile, and P1-04 data-dictionary/quality migrations, all unmodified, then the new P1-05 forward migration;
- runs the P1-05 catalog verifier and read-only failure checks, then the existing Gate A and P1-04 smoke seeds followed by the new P1-05 smoke seed and smoke verifier;
- runs `__tests__/kai-sprint2-p1-05-intake-sensitivity-profile.integration.spec.js` against that runner-owned target only;
- stops PostgreSQL and removes the temporary directory.

The runner fails closed unless it proves the target database name, loopback address, port, `listen_addresses`, and PostgreSQL 16 version. It must not be pointed at a shared, quarantined, cloud, production, or real-client-data database. The integration spec skips itself unless `KAI_P1_05_SENSITIVITY_PROFILE_DATABASE_URL` is set by that runner.

The non-database schema-contract and boundary specs (`__tests__/kai-sprint2-p1-05-intake-sensitivity-profile-schema-contract.spec.js`, `__tests__/kai-sprint2-p1-05-intake-sensitivity-profile-boundary.spec.js`) run in the normal suites and need no database.

## Scope

`Backend/kai/dictionary/postgresIntakeSensitivityProfileRepository.js` is the only authorized location for this package's SQL and row locking. `Backend/kai/services/kaiIntakeSensitivityProfileService.js` contains no SQL and imports no database pool: it validates its input allowlist, checks `KAI_SPRINT2_ENABLED`, and delegates persistence to the injected repository.

The repository consumes only the tenant-scoped, already-committed `kai.intake_file_profiles` row identified by `organization_id` + `file_profile_id`, and the already-committed `kai.data_dictionaries` bundle identified by `organization_id` + `file_profile_id` + `data_dictionary_id` (the caller's only lookup keys). `intake_file_id` and `profile_canonical_sha256` are always re-read from the committed profile row inside the same transaction; the caller cannot provide or override the intake-file identity, profile identity, profile hash, dictionary lineage, classification, consent, permission, retention, or allowed-use fact. It never reads raw bytes, calls storage, invokes a parser or profiler, uses an LLM, performs an external lookup, or infers facts from a filename or field name.

Identity and replay (owner decision for P1-05): one authoritative sensitivity/allowed-use profile row per `organization_id` + `file_profile_id` + `data_dictionary_id`, enforced by `intake_sensitivity_profiles_p1_05_identity_unique`. The same identity with the same stored profile hash replays the existing row without a second audit write. The same identity with a different bound profile hash returns `conflict_current_state_changed`. Concurrent identical creation is resolved by PostgreSQL conflict handling (`ON CONFLICT ... DO NOTHING` plus an authoritative re-read inside the same transaction), never by an in-process lock, mutex, in-flight map, or advisory lock.

Every applicable classification dimension - PII, minor data, health/housing/justice/immigration data, Indigenous/OCAP-like governance-sensitive data (kept distinct from generic PII), staff notes, story/testimonial content, small-cell risk (kept distinct), consent basis, allowed use, and financial records (kept distinct from generic PII as its own Data Protection special category) - is its own column with its own CHECK-enforced `unknown` / `present` / `absent` (or `unknown` / `allowed` / `not_allowed`) enum. `unknown` is a real, distinct, queryable value: it never collapses into false/absent/clear/safe/permitted/not-applicable. Every dimension defaults to `unknown` and is replaced only when the repository-loaded committed `kai.intake_file_profiles.profile` states an explicit safe fact for that exact dimension under `profile.sensitivity_committed_facts` (`deriveSensitivityFacts`, exported as `__intakeSensitivityProfileRepositoryTestables` for boundary testing); there is no per-dimension inference from file content, filenames, or field names anywhere in this package, so every dimension loads as `unknown` today because no current committed profile producer states any of these facts - that is the correct, expected behavior for this foundation package.

`review requirements` is never persisted as a classification value; the only committed fact about review is the fail-closed `human_review_required` boolean, pinned `true` by `intake_sensitivity_profiles_p1_05_human_review_check` exactly like P1-04's own per-field pinned booleans. LLM processing, product learning, public use, and funder use are each their own pinned-`false` boolean column, enforced by CHECK, not merely by column default. `retention_posture` is a single pinned labeled restriction (`restricted_pending_review`) describing an unresolved state only - it is never a retention execution, deletion, storage-lifecycle change, or job activation.

Persisting a sensitivity profile and writing the required metadata-only `intake_sensitivity_profile_persisted` audit row happen inside one transaction. Rejection of the required audit prepare, a synchronous publish failure, or a rejected publish promise rolls back the sensitivity-profile write in that transaction. The audit metadata carries exactly `metadata_only`, `contract`, `file_profile_id`, `data_dictionary_id`, `profile_canonical_sha256`, `human_review_required`, and `validator_key`, and no profile content, label, sample, PII, path, URL, prompt, or credential.

When `KAI_SPRINT2_ENABLED` is disabled, the service returns the canonical `feature_disabled` result with zero profile reads, dictionary reads, writes, locks, audit preparation, or publication.

This package does not add a route, listener, scheduler, timer, polling loop, startup hook, public barrel export, production composition, application repository selection, feature-flag default, or cloud configuration. Review queue items, source candidates, promotion decisions, sources, source versions, evidence, claims, assistant tools, retention execution, deletion, and external-release approval are out of scope and are not created.

## Rollback

`migrations/kai_sprint2_p1_05_intake_sensitivity_profile.rollback.sql` removes only the P1-05 audit rows/branch (restoring the exact prior audit constraints) and the `kai.intake_sensitivity_profiles` table and its indexes. It alters no P1-02, P1-03, or P1-04 table, column, or constraint.
