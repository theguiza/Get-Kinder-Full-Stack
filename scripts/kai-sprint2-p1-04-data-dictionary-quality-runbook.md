# KAI P1-04 Draft Data-Dictionary and Data-Quality Foundation Runbook

This package adds four new dormant tables — `kai.data_dictionaries`, `kai.data_dictionary_fields`, `kai.data_dictionary_mappings`, `kai.data_quality_findings` — and their PostgreSQL repository/service adapter, verified in an isolated local PostgreSQL 16 instance created by the runner. It extends the existing, unmodified P1-02 substrate (`kai.intake_file_profiles`) with one additive, backward-compatible unique constraint, and extends the existing Gate A audit table's operation/metadata vocabulary with one new operation. It changes no P1-02 or P1-03 migration, rollback, runner, verifier, smoke, or runbook artifact.

Run:

```sh
npm run verify:kai-sprint2-p1-04-data-dictionary-quality
```

The runner:

- creates a temporary data directory under the OS temp directory;
- starts PostgreSQL 16 bound only to `127.0.0.1` on a runner-chosen port;
- creates the synthetic database `kai_p1_04_data_dictionary_quality_synthetic`;
- applies the existing synthetic bootstrap schema and the existing frozen Gate A P0 upload-lifecycle, Gate A P0 policy-decision-replay, and P1-02 parser-run/file-profile migrations, all unmodified, then the new P1-04 forward migration;
- runs the P1-04 catalog verifier, read-only failure checks, smoke seed, and smoke verifier SQL;
- runs `__tests__/kai-sprint2-p1-04-data-dictionary-quality.integration.spec.js` against that runner-owned target only;
- stops PostgreSQL and removes the temporary directory.

The runner fails closed unless it proves the target database name, loopback address, port, `listen_addresses`, and PostgreSQL 16 version. It must not be pointed at a shared, quarantined, cloud, production, or real-client-data database. The integration spec skips itself unless `KAI_P1_04_DATA_DICTIONARY_DATABASE_URL` is set by that runner.

The non-database schema-contract and boundary specs (`__tests__/kai-sprint2-p1-04-data-dictionary-quality-schema-contract.spec.js`, `__tests__/kai-sprint2-p1-04-data-dictionary-quality-boundary.spec.js`) run in the normal suites and need no database.

## Scope

`Backend/kai/dictionary/postgresDataDictionaryRepository.js` is the only authorized location for this package's SQL and row locking. `Backend/kai/services/kaiDataDictionaryService.js` contains no SQL and imports no database pool: it validates its input allowlist, checks `KAI_SPRINT2_ENABLED`, and delegates persistence to the injected repository. Both were extended in place; neither is a new duplicate abstraction.

The repository consumes only the tenant-scoped, already-committed `kai.intake_file_profiles` row identified by `organization_id` + `file_profile_id`. `intake_file_id`, the committed metadata/redacted `profile`, and `profile_canonical_sha256` are always re-read from that row inside the same transaction; the caller cannot provide or override the intake-file identity, profile identity, profile hash, or profile content. It never reads raw bytes, calls storage, invokes a parser or profiler, uses an LLM, performs an external lookup, or infers facts from a filename or field name.

Identity and replay (owner decision for P1-04): one dictionary bundle per `organization_id` + `file_profile_id`, enforced by `data_dictionaries_p1_04_bundle_identity_unique`. The same profile identity with the same stored hash replays the existing bundle without re-deriving fields or findings and without a second audit write. The same profile identity with a different bound hash returns `conflict_current_state_changed`. A different profile identity always creates a separate bundle. There is no revision number, predecessor link, or supersession link.

Fields, mappings, and findings are derived once, purely and deterministically, from explicit committed profile-stage facts only (`deriveDictionaryFields`, `deriveQualityFindings`, both exported as `__dataDictionaryRepositoryTestables` for boundary testing). Supported findings are `missingness`, `duplicate_rows`, `type_inconsistency`, `invalid_date`, `formula_like_content`, and `safe_profiler_warning`; the absence of a fact in the committed profile never produces a finding, and there is no denominator assessment, coverage-gap analysis, funder-requirement alignment, or client/operator follow-up generation.

Every field and finding is created with the exact fail-closed provisional defaults enforced by CHECK constraints, not merely by column default: dictionary status `draft`; field review status `needs_gk_review`; finding status `open`; sensitivity `unknown`; allowed use `internal`; consent status `unknown`; consent scope `none`; LLM use, public use, and funder use not allowed; human review required. `business_meaning` and `entity_level` default to `unknown` and may only be replaced by an explicit safe committed profile value. Full sensitivity, consent, permission, retention, and audience classification remains deferred to a later, separately authorized package.

Persisting a draft bundle, its fields, mappings, and findings, and writing the required metadata-only `data_dictionary_draft_persisted` audit row all happen inside one transaction. Rejection of the required audit prepare, a synchronous publish failure, or a rejected publish promise rolls back every dictionary, field, mapping, and finding write in that transaction. The audit metadata carries exactly `metadata_only`, `contract`, `file_profile_id`, `profile_canonical_sha256`, `dictionary_status`, `field_count`, `mapping_count`, `finding_count`, and `validator_key`, and no profile content, label, sample, finding text, PII, path, URL, prompt, or credential.

When `KAI_SPRINT2_ENABLED` is disabled, the service returns the canonical `feature_disabled` result with zero profile reads, writes, locks, audit preparation, or publication.

This package does not add a route, listener, scheduler, timer, polling loop, startup hook, public barrel export, production composition, application repository selection, feature-flag default, or cloud configuration. Sensitivity profiles, review items, source candidates, promotion decisions, sources, source versions, evidence, claims, assistant tools, denominator assessment, coverage-gap analysis, and funder-requirement alignment are out of scope and are not created.
