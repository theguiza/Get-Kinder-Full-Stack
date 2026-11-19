# Source-backed planned targets

The source plan is an independent fact. Accepting it does not record an achieved outcome or approve a claim. Existing `kai.measurement_targets` rows and their measurement identities remain unchanged.

`kai.source_planned_targets` preserves the organization, Project, source/version, exact worksheet row locator, file/profile hashes, screened indicator/unit/programme, planned value and dates. Accepted facts are immutable. A successor source version may supersede the earlier plan only at the same row and unchanged metric, unit, programme and period; both records remain. Changed or moved metrics require a separate accepted plan.

`kai.planned_target_decisions` holds a linear, append-only relationship history. A plan begins unresolved, with no actual and only a source-established direction (possibly null). Suggestions are read from Project measurements and do not accept a relationship. An authorized person can reject a proposed relationship, or explicitly confirm the metric/unit meaning, population/programme and date basis. Project, source currentness, arithmetic, unit kind and exact period must also pass mechanical checks. No human answer overrides a mechanical mismatch. Direction can remain unknown after confirmation. Attainment is calculated only with a confirmed compatible actual and direction; zero targets do not require division.

`kai.evidence_planned_targets` binds each immutable decision snapshot to its evidence item. Evidence and claim statements are composed from the persisted plan and decision, with an exact row locator. They say that a plan is not an achieved outcome. Generation admits intact, authorized plan findings under the existing reporting policy. Saved reports retain their cited decision snapshot after later decisions. The existing current-source 409 rule still applies, including confirmed actual contributors. Ordinary evidence-quality reviews are not new prerequisites.

The service uses the same feature flag, membership authorization, allowed-use resolver, source-candidate lock, transactions and required audit as source measurements. Requests select original row numbers and expected hashes; they cannot supply replacement source facts or approvals. Saves and decision retries are idempotent. A partial reporting handoff can be retried using **Add plan to reports**. A lost save response is recovered by rereading the accepted rows; it does not require recalculation or a fake measurement.

In Delivery_Targets, use **Save plan for reports** for one row or **Save all available plans for reports**. Each row has its own saved state. Relationship and direction controls remain collapsed. Survey and referral result cards retain their existing save actions and all-date scope.

## Local schema verification and recovery

Only the project owner's separately authorized disposable local databases were used for this implementation. This document grants no authority to run migrations against an existing database.

- Forward: `migrations/kai_sprint2_source_planned_targets.sql`, registered after `kai_sprint2_measurement_targets` in the canonical chain.
- Catalog verification: `scripts/kai-source-planned-targets-verify-read-only.sql`; the reporting verifier recognizes the widened PostgreSQL 16 CHECK definitions.
- Disposable fresh/upgrade/rollback verification: `python3 scripts/kai-source-planned-targets-local-postgres.py`.
- Guarded rollback: `migrations/kai_sprint2_source_planned_targets.rollback.sql`. It locks affected tables and refuses if any plan, decision, evidence link, planning evidence or planning locator exists. On an unused schema it restores the preceding document/measurement CHECKs exactly. Persisted plans are never deleted as recovery.
- Browser acceptance: set the non-listening `DATABASE_URL` sentinel, `KAI_WILLOW_QUAY_PACKAGE` and `KAI_CEDAR_BRIDGE_PACKAGE` to the authorized synthetic packages, and run `node scripts/kai-customer-xlsx-file-to-report-local-postgres.js`. Set `KAI_MEASUREMENT_SCREENSHOTS=artifacts/kai-measurement-ui` for 1280px and 390px captures. The Willow workbook is mandatory. `KAI_XLSX_TEST_NAME_PATTERN` is an optional debugging filter; unset it for complete acceptance.

For source changes, use the existing source-version workflow. Do not edit an accepted plan, invent a comparator, rewrite historical evidence, or weaken a rollback refusal. Missing source bytes affect new candidate discovery; previously saved report facts retain their persisted provenance and remain subject to currentness and data-use rules.
