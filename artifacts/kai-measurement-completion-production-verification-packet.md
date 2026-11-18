# Measurement completion production verification packet

Production PostgreSQL schema: **NOT_CONFIRMED**. The owner executes production SQL personally through the existing authenticated pgAdmin connection. Local proof establishes the classifier's behavior, not the production schema.

## A Inspected source and boundary

Repository: `/Users/mikewoz/Get-Kinder-Full-Stack-Deploy`; branch `main`; inspected HEAD `ed37dddd167a5ce4543ca6ed841be090060b1242`; working tree initially clean. This matches the owner-supplied GitHub revision. The owner supplied live Render deployment `dep-dbusr42jnfac73c2iqcg`; no remote verification, fetch, push, deployment, production connection or configuration change was performed in this package.

Inspected: root `AGENTS.md` (only repository instruction file); living ExecPlan Active execution contract and measurement completion evidence; both calculation-completion/target forward migrations and refusing rollbacks; source-derived, cross-source reach and reconciliation-jobs prerequisites; the Cedar Bridge preflight and disposable Python runner; Plan A migration chain and bootstrap schemas; all four requested verifiers; the application repository, service and validator call sites below. The accepted implementation and migrations remain unchanged.

## B Preflight and local proof

Open `scripts/kai-measurement-completion-production-preflight-read-only.sql`. Its exact executable contents are reproduced at the end of this packet. It returns 26 catalog check rows, one environment row, two independent migration rows and one OVERALL row: **30 rows**. No application tables are queried; function definitions are hashed, not executed. Only catalog-derived fingerprints and classifications appear in the production grid.

The signatures are MD5 comparison identifiers, not security attestations. They are generated from exact PostgreSQL catalog definitions, never guessed or accepted from an incompatible database. `artifacts/kai-measurement-completion-catalog-evidence.json` contains all underlying prerequisite/completed object definitions and source migration SHA256s. Definitions are sorted with C collation and contain no OIDs, owners, connection details or application rows. Physical column order and dropped-column tombstones are deliberately irrelevant; all live columns, names, types, defaults, nullability, generated/identity/collation properties are checked. All table constraints, indexes and user triggers are included, so missing or extra objects fail closed. Referenced FK relation and constraint-function identities are captured, together with the normalized binding, event, timing and enabled state of internal FK enforcement triggers (generated OID-based trigger names are excluded). Index expressions, predicates, uniqueness and valid/ready/live state; trigger binding, event, timing and enabled state; and function bodies, return types, security and configuration properties are checked. Reserved relation/index names and target composite-type collisions are checked even when the target table is absent.

Validated rendering: **PostgreSQL 16.14 (Homebrew)**. Server major 16 is required. Other majors return STOP_INCOMPATIBLE; that result means rendering support must be rehearsed on a newly created disposable cluster of that major before interpreting definitions. It never authorizes migration replay or relaxed fingerprints. No production version is presumed. The unsupported-major decision was also tested with a simulated major 17 environment row on PG16, yielding STOP_INCOMPATIBLE; this is not a claim of testing PG17 rendering.

Reproduce locally:

```sh
python3 scripts/kai-measurement-completion-production-preflight-local-postgres.py
```

The runner whitelists its environment, sets a non-listening DATABASE_URL sentinel, creates its own new loopback cluster/database, applies the committed synthetic bootstrap/migration chain, and stops/removes only its own cluster. It accepts no database URL. The existing two history-only migration refusals are asserted exactly, as in the established runner. No Node/npm command is required.

| Synthetic state | Calculation | Targets | Overall |
| --- | --- | --- | --- |
| A exact prerequisite | REQUIRED | REQUIRED | SCHEMA_DELTA_REQUIRED |
| B first migration only | ALREADY_APPLIED | REQUIRED | SCHEMA_DELTA_REQUIRED |
| C both migrations | ALREADY_APPLIED | ALREADY_APPLIED | SCHEMA_COMPATIBLE |
| Targets independently present | REQUIRED | ALREADY_APPLIED | SCHEMA_DELTA_REQUIRED |
| D incompatible variants | STOP for affected migration/prerequisite | STOP for affected migration/prerequisite | STOP_INCOMPATIBLE |

Nineteen negative states passed: calculation partial worksheet column; calculation reserved index collision; incomplete same-named target table; target reserved index collision; target composite-type collision; missing rate CHECK; missing version/worksheet unique index; changed job default; reference nullability drift; disabled admission trigger; changed admission function; missing target unit/value CHECK; disabled target FK enforcement trigger; missing measurement FK; missing self-supersession FK; missing single-successor index; target nullability drift; missing target append-only trigger; changed shared append-only function. Each restored state matches every original completed signature. The two refusing rollbacks were used only on empty runner-owned synthetic tables to prove A/B transitions.

Eight literal evaluations of the live committed rate CHECK passed: valid/invalid record arithmetic; NULL method with invalid record arithmetic is FALSE; valid identifier arithmetic with different record counts is TRUE; invalid identifier arithmetic is FALSE; identifiers exceeding records is FALSE; wrong distinct unit is FALSE; missing JSON operands yields SQL NULL. The IS DISTINCT FROM / IS NOT DISTINCT FROM selectors are definite. This does **not** claim every missing JSON operand is rejected by the migration: PostgreSQL CHECK accepts NULL, and calculation_method itself is NOT NULL in the table. These exact existing semantics are preserved.

## C Migration compatibility matrix

Order: (1) `migrations/kai_sprint2_measurement_calculation_completion.sql`, then (2) `migrations/kai_sprint2_measurement_targets.sql`, only after actual owner preflight evidence has been assessed. These are references, not instructions to execute migrations now.

REQUIRED means the entire prerequisite definition matches and every change is absent. ALREADY_APPLIED means the entire completed definition matches. Mixtures and drift stop, including objects IF NOT EXISTS would silently preserve. The target migration's prerequisites accept the derived table in either exact known state; an unrelated jobs-only defect need not change the target classification. A changed derived prerequisite or append-only function stops dependent targets as well. The overall result stops if either migration stops. NOT_CONFIRMED is the current evidence status before the owner supplies a production grid, not a result inferred from local proof.

| Material behavior | Exact prerequisite | Exact completed definition |
| --- | --- | --- |
| Method/family CHECK | Paired XLSX; tabular record/distinct counts; record rate; cross-source reach without primary worksheet | All existing branches retained; distinct-key rate; both tabular bases include verified bytes; linked reach permits primary worksheet |
| Rate-count CHECK | Record population/numerator/other arithmetic | Record branch selected by IS DISTINCT FROM; identifier branch selected by IS NOT DISTINCT FROM, distinct_key unit, identifier population/numerator/other arithmetic, identifiers bounded by corresponding records |
| Contributing worksheet | Absent | Nullable text, no default; sheet_1 through sheet_9999 pattern |
| Contributing uniqueness | UNIQUE(measurement_id, source_version_id) | Old constraint/index removed; unique expression index (measurement_id, source_version_id, COALESCE(worksheet_key, '')) |
| Admission function and trigger | Primary is own version/profile; reference a different version | Primary matches own version/profile/worksheet; reference another version or a nonnull different worksheet of same version; cross-source family and organization lookup retained; BEFORE INSERT row trigger remains enabled O |
| Job kind | Absent | text NOT NULL DEFAULT 'cross_source_reach'::text |
| Job worksheet/interpretation columns | Absent | primary_worksheet_key text NULL; reference_worksheet_key text NULL; interpretation jsonb NULL; no defaults |
| Reference job fields | reference_source_version_id uuid NOT NULL; reference_profile_canonical_sha256 text NOT NULL | Same types, now nullable, no defaults |
| Distinct-source job CHECK | Different source versions required | Removed; kind CHECK permits cross-source different versions or different nonnull sheets of same version; exact-period job has null reference fields |
| Job profile/worksheet/interpretation CHECKs | Both profile SHA values required; no worksheet/interpretation checks | Primary SHA pattern retained, optional reference SHA pattern; worksheet patterns; interpretation NULL or JSON object; cross-source interpretation NULL |
| Existing cross-source jobs | Different versions, both profiles, no worksheets | Default cross_source_reach and NULL worksheets/interpretation preserve that branch; all original state/claim/retry checks and indexes retained |
| Targets relation | Table, associated types and reserved indexes absent | Ordinary persistent table; all exact columns, constraints, indexes and enabled trigger below |
| Target identity keys | Absent | PK(target_id); UNIQUE(target_id, organization_id) |
| Target measurement FK | Absent | (set_on_measurement_id, organization_id) -> kai.source_derived_measurements(source_derived_measurement_id, organization_id), ON DELETE RESTRICT, ON UPDATE NO ACTION, MATCH SIMPLE, validated and nondeferrable |
| Target supersedes FK | Absent | (supersedes_target_id, organization_id) -> kai.measurement_targets(measurement_target_id, organization_id), ON DELETE RESTRICT, ON UPDATE NO ACTION, MATCH SIMPLE, validated and nondeferrable |
| Target CHECKs | Absent | Worksheet pattern; 64 lowercase hex measurement key; integral nonnegative count for tabular_count/cross_source_reach or 0..100 percent for tabular_rate/paired_outcome_change; at_least/at_most; no self-supersession; human creator |
| Target indexes | Absent | Unique identity root WHERE supersedes_target_id IS NULL; unique org/supersedes WHERE NOT NULL; organization/source/measurement key lookup; expressions and ordering below |
| Target append-only | Existing shared function raises check_violation on UPDATE/DELETE | BEFORE UPDATE OR DELETE FOR EACH ROW trigger enabled O, bound to unchanged kai.source_derived_measurement_append_only(); no engagement/source/creator FK invented |

All target columns (no others are defined by the migration):

| Column | Type | NOT NULL | Default |
| --- | --- | --- | --- |
| `comparison` | `text` | yes | none |
| `created_at` | `timestamp with time zone` | yes | `now()` |
| `created_by` | `uuid` | yes | none |
| `created_by_type` | `text` | yes | none |
| `engagement_id` | `uuid` | yes | none |
| `measurement_family` | `text` | yes | none |
| `measurement_key` | `text` | yes | none |
| `measurement_target_id` | `uuid` | yes | `gen_random_uuid()` |
| `organization_id` | `uuid` | yes | none |
| `set_on_measurement_id` | `uuid` | yes | none |
| `source_id` | `uuid` | yes | none |
| `supersedes_target_id` | `uuid` | no | none |
| `target_unit` | `text` | yes | none |
| `target_value` | `numeric(14,2)` | yes | none |
| `worksheet_key` | `text` | no | none |

The following object matrix enumerates the live columns, constraints, indexes and trigger definitions of all four directly affected tables. `unchanged` means the completed definition equals the exact prerequisite shown. All constraints are validated/nondeferrable, all indexes valid/ready/live, and user triggers enabled O unless the precise catalog record in the companion JSON says otherwise. No extra object is accepted. Function bodies follow the matrix.

### kai.source_derived_measurements

| Object | Prerequisite | Completed |
| --- | --- | --- |
| column `basis_version` | text; NOT NULL; default none | unchanged |
| column `calculation_method` | text; NOT NULL; default none | unchanged |
| column `component_counts` | jsonb; NOT NULL; default none | unchanged |
| column `created_at` | timestamp with time zone; NOT NULL; default now() | unchanged |
| column `created_by` | uuid; NOT NULL; default none | unchanged |
| column `created_by_type` | text; NOT NULL; default none | unchanged |
| column `definition` | jsonb; NOT NULL; default none | unchanged |
| column `denominator` | bigint; NULL; default none | unchanged |
| column `exclusions` | jsonb; NOT NULL; default none | unchanged |
| column `field_keys` | jsonb; NOT NULL; default none | unchanged |
| column `measured_value` | bigint; NOT NULL; default none | unchanged |
| column `measurement_family` | text; NOT NULL; default none | unchanged |
| column `measurement_key` | text; NOT NULL; default none | unchanged |
| column `numerator` | bigint; NOT NULL; default none | unchanged |
| column `organization_id` | uuid; NOT NULL; default none | unchanged |
| column `percentage` | numeric(5,2); NULL; default none | unchanged |
| column `profile_canonical_sha256` | text; NOT NULL; default none | unchanged |
| column `row_locators` | jsonb; NULL; default none | unchanged |
| column `source_derived_measurement_id` | uuid; NOT NULL; default gen_random_uuid() | unchanged |
| column `source_version_id` | uuid; NOT NULL; default none | unchanged |
| column `worksheet_key` | text; NULL; default none | unchanged |
| constraint `source_derived_measurements_arithmetic_check` | CHECK (((measured_value >= 0) AND (numerator = measured_value) AND (((measurement_family = 'tabular_count'::text) AND (denominator IS NULL) AND (percentage IS NULL) AND (measured_value <= ((component_counts ->> 'matching_record_count'::text))::bigint)) OR ((measurement_family = ANY (ARRAY['paired_outcome_change'::text, 'tabular_rate'::text])) AND (denominator > 0) AND (numerator <= denominator) AND (percentage = round((((numerator)::numeric * 100.0) / (denominator)::numeric), 2))) OR ((measurement_family = 'cross_source_reach'::text) AND (denominator IS NULL) AND (percentage IS NULL) AND (jsonb_typeof((definition -> 'measured_component'::text)) = 'string'::text) AND (measured_value = ((component_counts ->> (definition ->> 'measured_component'::text)))::bigint) AND (((component_counts ->> 'excess_copy_record_count'::text))::bigint = (((component_counts ->> 'duplicate_member_record_count'::text))::bigint - ((component_counts ->> 'duplicate_group_count'::text))::bigint)) AND (((component_counts ->> 'distinct_event_count'::text))::bigint = ((((component_counts ->> 'physical_record_count'::text))::bigint - ((component_counts ->> 'blank_event_identifier_record_count'::text))::bigint) - ((component_counts ->> 'excess_copy_record_count'::text))::bigint)) AND (((component_counts ->> 'consistent_event_count'::text))::bigint = (((component_counts ->> 'distinct_event_count'::text))::bigint - ((component_counts ->> 'conflicting_event_identity_count'::text))::bigint)) AND (((component_counts ->> 'completed_event_count'::text))::bigint <= ((component_counts ->> 'consistent_event_count'::text))::bigint) AND (((component_counts ->> 'in_period_completed_event_count'::text))::bigint = ((((component_counts ->> 'completed_event_count'::text))::bigint - ((component_counts ->> 'completed_without_date_count'::text))::bigint) - ((component_counts ->> 'completed_outside_period_count'::text))::bigint)) AND (((component_counts ->> 'eligible_encounter_count'::text))::bigint = ((((component_counts ->> 'in_period_completed_event_count'::text))::bigint - ((component_counts ->> 'blank_participant_identifier_event_count'::text))::bigint) - ((component_counts ->> 'unmatched_event_count'::text))::bigint)) AND (((component_counts ->> 'distinct_person_count'::text))::bigint <= ((component_counts ->> 'eligible_encounter_count'::text))::bigint) AND (((component_counts ->> 'multi_group_person_count'::text))::bigint <= ((component_counts ->> 'distinct_person_count'::text))::bigint))))) | unchanged |
| constraint `source_derived_measurements_created_by_type_check` | CHECK ((created_by_type = 'human'::text)) | unchanged |
| constraint `source_derived_measurements_id_org_unique` | UNIQUE (source_derived_measurement_id, organization_id) | unchanged |
| constraint `source_derived_measurements_key_check` | CHECK ((measurement_key ~ '^[a-f0-9]{64}$'::text)) | unchanged |
| constraint `source_derived_measurements_method_family_check` | CHECK ((((measurement_family = 'paired_outcome_change'::text) AND (calculation_method = 'p1_xlsx_paired_baseline_followup_numeric_change_v1'::text) AND (basis_version = 'kai_xlsx_paired_outcome_basis_v1'::text) AND (worksheet_key IS NOT NULL)) OR ((measurement_family = 'tabular_count'::text) AND (calculation_method = ANY (ARRAY['kai_tabular_conditional_record_count_v1'::text, 'kai_tabular_conditional_distinct_key_count_v1'::text])) AND (basis_version = 'kai_tabular_measurement_basis_v1'::text)) OR ((measurement_family = 'tabular_rate'::text) AND (calculation_method = 'kai_tabular_conditional_record_rate_v1'::text) AND (basis_version = 'kai_tabular_measurement_basis_v1'::text)) OR ((measurement_family = 'cross_source_reach'::text) AND (calculation_method = 'kai_cross_source_linked_reach_v1'::text) AND (basis_version = 'kai_cross_source_reconciliation_v1'::text) AND (worksheet_key IS NULL)))) | CHECK ((((measurement_family = 'paired_outcome_change'::text) AND (calculation_method = 'p1_xlsx_paired_baseline_followup_numeric_change_v1'::text) AND (basis_version = 'kai_xlsx_paired_outcome_basis_v1'::text) AND (worksheet_key IS NOT NULL)) OR ((measurement_family = 'tabular_count'::text) AND (calculation_method = ANY (ARRAY['kai_tabular_conditional_record_count_v1'::text, 'kai_tabular_conditional_distinct_key_count_v1'::text])) AND (basis_version = ANY (ARRAY['kai_tabular_measurement_basis_v1'::text, 'kai_tabular_verified_bytes_v1'::text]))) OR ((measurement_family = 'tabular_rate'::text) AND (calculation_method = ANY (ARRAY['kai_tabular_conditional_record_rate_v1'::text, 'kai_tabular_conditional_distinct_key_rate_v1'::text])) AND (basis_version = ANY (ARRAY['kai_tabular_measurement_basis_v1'::text, 'kai_tabular_verified_bytes_v1'::text]))) OR ((measurement_family = 'cross_source_reach'::text) AND (calculation_method = 'kai_cross_source_linked_reach_v1'::text) AND (basis_version = 'kai_cross_source_reconciliation_v1'::text)))) |
| constraint `source_derived_measurements_paired_counts_check` | CHECK (((measurement_family <> 'paired_outcome_change'::text) OR ((((component_counts ->> 'increased_count'::text))::bigint = numerator) AND (((component_counts ->> 'comparable_pair_count'::text))::bigint = denominator) AND (((((component_counts ->> 'increased_count'::text))::bigint + ((component_counts ->> 'unchanged_count'::text))::bigint) + ((component_counts ->> 'decreased_count'::text))::bigint) = denominator) AND (((component_counts ->> 'participant_count'::text))::bigint = (denominator + ((component_counts ->> 'excluded_participant_count'::text))::bigint))))) | unchanged |
| constraint `source_derived_measurements_pkey` | PRIMARY KEY (source_derived_measurement_id) | unchanged |
| constraint `source_derived_measurements_profile_sha_check` | CHECK ((profile_canonical_sha256 ~ '^[a-f0-9]{64}$'::text)) | unchanged |
| constraint `source_derived_measurements_rate_counts_check` | CHECK (((measurement_family <> 'tabular_rate'::text) OR ((((component_counts ->> 'population_record_count'::text))::bigint = denominator) AND (((component_counts ->> 'numerator_record_count'::text))::bigint = numerator) AND (((component_counts ->> 'other_population_record_count'::text))::bigint = (denominator - numerator))))) | CHECK (((measurement_family <> 'tabular_rate'::text) OR ((calculation_method IS DISTINCT FROM 'kai_tabular_conditional_distinct_key_rate_v1'::text) AND (((component_counts ->> 'population_record_count'::text))::bigint = denominator) AND (((component_counts ->> 'numerator_record_count'::text))::bigint = numerator) AND (((component_counts ->> 'other_population_record_count'::text))::bigint = (denominator - numerator))) OR ((NOT (calculation_method IS DISTINCT FROM 'kai_tabular_conditional_distinct_key_rate_v1'::text)) AND (((definition -> 'unit'::text) ->> 'kind'::text) = 'distinct_key'::text) AND (((component_counts ->> 'population_distinct_key_count'::text))::bigint = denominator) AND (((component_counts ->> 'numerator_distinct_key_count'::text))::bigint = numerator) AND (((component_counts ->> 'other_population_distinct_key_count'::text))::bigint = (denominator - numerator)) AND (numerator <= ((component_counts ->> 'numerator_record_count'::text))::bigint) AND (denominator <= ((component_counts ->> 'population_record_count'::text))::bigint)))) |
| constraint `source_derived_measurements_shape_check` | CHECK (((jsonb_typeof(definition) = 'object'::text) AND (jsonb_typeof(field_keys) = 'array'::text) AND ((jsonb_array_length(field_keys) >= 0) AND (jsonb_array_length(field_keys) <= 8)) AND (jsonb_typeof(component_counts) = 'object'::text) AND (jsonb_typeof(exclusions) = 'object'::text) AND ((row_locators IS NULL) OR (jsonb_typeof(row_locators) = 'object'::text)))) | unchanged |
| constraint `source_derived_measurements_source_version_fk` | FOREIGN KEY (source_version_id, organization_id) REFERENCES source_versions(source_version_id, organization_id) ON DELETE RESTRICT | unchanged |
| constraint `source_derived_measurements_worksheet_key_check` | CHECK (((worksheet_key IS NULL) OR (worksheet_key ~ '^sheet_[1-9][0-9]{0,3}$'::text))) | unchanged |
| index `source_derived_measurements_id_org_unique` | CREATE UNIQUE INDEX source_derived_measurements_id_org_unique ON kai.source_derived_measurements USING btree (source_derived_measurement_id, organization_id) | unchanged |
| index `source_derived_measurements_identity_unique` | CREATE UNIQUE INDEX source_derived_measurements_identity_unique ON kai.source_derived_measurements USING btree (organization_id, source_version_id, COALESCE(worksheet_key, ''::text), measurement_key) | unchanged |
| index `source_derived_measurements_pkey` | CREATE UNIQUE INDEX source_derived_measurements_pkey ON kai.source_derived_measurements USING btree (source_derived_measurement_id) | unchanged |
| table `source_derived_measurements` | ["r", "p", false, false, false, "d", null, 0, 0, 0] | unchanged |
| trigger `trg_source_derived_measurements_append_only` | CREATE TRIGGER trg_source_derived_measurements_append_only BEFORE DELETE OR UPDATE ON kai.source_derived_measurements FOR EACH ROW EXECUTE FUNCTION source_derived_measurement_append_only(); enabled=O | unchanged |

### kai.source_derived_measurement_sources

| Object | Prerequisite | Completed |
| --- | --- | --- |
| column `created_at` | timestamp with time zone; NOT NULL; default now() | unchanged |
| column `field_keys` | jsonb; NOT NULL; default none | unchanged |
| column `organization_id` | uuid; NOT NULL; default none | unchanged |
| column `profile_canonical_sha256` | text; NOT NULL; default none | unchanged |
| column `source_derived_measurement_id` | uuid; NOT NULL; default none | unchanged |
| column `source_role` | text; NOT NULL; default none | unchanged |
| column `source_version_id` | uuid; NOT NULL; default none | unchanged |
| column `worksheet_key` | absent | text; NULL; default none |
| constraint `source_derived_measurement_sources_field_keys_check` | CHECK (((jsonb_typeof(field_keys) = 'array'::text) AND ((jsonb_array_length(field_keys) >= 1) AND (jsonb_array_length(field_keys) <= 8)))) | unchanged |
| constraint `source_derived_measurement_sources_measurement_fk` | FOREIGN KEY (source_derived_measurement_id, organization_id) REFERENCES source_derived_measurements(source_derived_measurement_id, organization_id) ON DELETE RESTRICT | unchanged |
| constraint `source_derived_measurement_sources_pkey` | PRIMARY KEY (source_derived_measurement_id, source_role) | unchanged |
| constraint `source_derived_measurement_sources_profile_sha_check` | CHECK ((profile_canonical_sha256 ~ '^[a-f0-9]{64}$'::text)) | unchanged |
| constraint `source_derived_measurement_sources_role_check` | CHECK ((source_role = ANY (ARRAY['primary'::text, 'reference'::text]))) | unchanged |
| constraint `source_derived_measurement_sources_source_version_fk` | FOREIGN KEY (source_version_id, organization_id) REFERENCES source_versions(source_version_id, organization_id) ON DELETE RESTRICT | unchanged |
| constraint `source_derived_measurement_sources_version_unique` | UNIQUE (source_derived_measurement_id, source_version_id) | absent |
| constraint `source_derived_measurement_sources_worksheet_key_check` | absent | CHECK (((worksheet_key IS NULL) OR (worksheet_key ~ '^sheet_[1-9][0-9]{0,3}$'::text))) |
| index `idx_source_derived_measurement_sources_version` | CREATE INDEX idx_source_derived_measurement_sources_version ON kai.source_derived_measurement_sources USING btree (organization_id, source_version_id) | unchanged |
| index `source_derived_measurement_sources_pkey` | CREATE UNIQUE INDEX source_derived_measurement_sources_pkey ON kai.source_derived_measurement_sources USING btree (source_derived_measurement_id, source_role) | unchanged |
| index `source_derived_measurement_sources_version_unique` | CREATE UNIQUE INDEX source_derived_measurement_sources_version_unique ON kai.source_derived_measurement_sources USING btree (source_derived_measurement_id, source_version_id) | absent |
| index `source_derived_measurement_sources_version_worksheet_unique` | absent | CREATE UNIQUE INDEX source_derived_measurement_sources_version_worksheet_unique ON kai.source_derived_measurement_sources USING btree (source_derived_measurement_id, source_version_id, COALESCE(worksheet_key, ''::text)) |
| table `source_derived_measurement_sources` | ["r", "p", false, false, false, "d", null, 0, 0, 0] | unchanged |
| trigger `trg_source_derived_measurement_sources_admitted` | CREATE TRIGGER trg_source_derived_measurement_sources_admitted BEFORE INSERT ON kai.source_derived_measurement_sources FOR EACH ROW EXECUTE FUNCTION source_derived_measurement_source_admitted(); enabled=O | unchanged |
| trigger `trg_source_derived_measurement_sources_append_only` | CREATE TRIGGER trg_source_derived_measurement_sources_append_only BEFORE DELETE OR UPDATE ON kai.source_derived_measurement_sources FOR EACH ROW EXECUTE FUNCTION source_derived_measurement_append_only(); enabled=O | unchanged |

### kai.cross_source_reconciliation_jobs

| Object | Prerequisite | Completed |
| --- | --- | --- |
| column `attempt_count` | integer; NOT NULL; default 0 | unchanged |
| column `claim_expires_at` | timestamp with time zone; NULL; default none | unchanged |
| column `claim_token` | uuid; NULL; default none | unchanged |
| column `completed_at` | timestamp with time zone; NULL; default none | unchanged |
| column `created_at` | timestamp with time zone; NOT NULL; default now() | unchanged |
| column `interpretation` | absent | jsonb; NULL; default none |
| column `job_kind` | absent | text; NOT NULL; default 'cross_source_reach'::text |
| column `job_state` | text; NOT NULL; default none | unchanged |
| column `last_attempt_at` | timestamp with time zone; NULL; default none | unchanged |
| column `last_error_code` | text; NULL; default none | unchanged |
| column `mapping` | jsonb; NOT NULL; default none | unchanged |
| column `measurement_ids` | uuid[]; NULL; default none | unchanged |
| column `next_eligible_at` | timestamp with time zone; NULL; default none | unchanged |
| column `organization_id` | uuid; NOT NULL; default none | unchanged |
| column `primary_profile_canonical_sha256` | text; NOT NULL; default none | unchanged |
| column `primary_source_version_id` | uuid; NOT NULL; default none | unchanged |
| column `primary_worksheet_key` | absent | text; NULL; default none |
| column `reconciliation_job_id` | uuid; NOT NULL; default gen_random_uuid() | unchanged |
| column `reference_profile_canonical_sha256` | text; NOT NULL; default none | text; NULL; default none |
| column `reference_source_version_id` | uuid; NOT NULL; default none | uuid; NULL; default none |
| column `reference_worksheet_key` | absent | text; NULL; default none |
| column `request_fingerprint` | text; NOT NULL; default none | unchanged |
| column `requested_by` | uuid; NOT NULL; default none | unchanged |
| column `updated_at` | timestamp with time zone; NOT NULL; default now() | unchanged |
| constraint `cross_source_reconciliation_jobs_attempt_count_check` | CHECK (((attempt_count >= 0) AND (attempt_count <= 3))) | unchanged |
| constraint `cross_source_reconciliation_jobs_distinct_versions_check` | CHECK ((primary_source_version_id <> reference_source_version_id)) | absent |
| constraint `cross_source_reconciliation_jobs_error_code_check` | CHECK (((last_error_code IS NULL) OR (last_error_code ~ '^[a-z0-9_]{1,64}$'::text))) | unchanged |
| constraint `cross_source_reconciliation_jobs_fingerprint_check` | CHECK ((request_fingerprint ~ '^[a-f0-9]{64}$'::text)) | unchanged |
| constraint `cross_source_reconciliation_jobs_id_org_unique` | UNIQUE (reconciliation_job_id, organization_id) | unchanged |
| constraint `cross_source_reconciliation_jobs_interpretation_check` | absent | CHECK (((interpretation IS NULL) OR (jsonb_typeof(interpretation) = 'object'::text))) |
| constraint `cross_source_reconciliation_jobs_kind_check` | absent | CHECK ((((job_kind = 'cross_source_reach'::text) AND (reference_source_version_id IS NOT NULL) AND (reference_profile_canonical_sha256 IS NOT NULL) AND (interpretation IS NULL) AND ((primary_source_version_id <> reference_source_version_id) OR ((primary_worksheet_key IS NOT NULL) AND (reference_worksheet_key IS NOT NULL) AND (primary_worksheet_key <> reference_worksheet_key)))) OR ((job_kind = 'tabular_exact_period'::text) AND (reference_source_version_id IS NULL) AND (reference_profile_canonical_sha256 IS NULL) AND (reference_worksheet_key IS NULL)))) |
| constraint `cross_source_reconciliation_jobs_mapping_check` | CHECK (((jsonb_typeof(mapping) = 'object'::text) AND gate_a_p0_jsonb_metadata_only(mapping))) | unchanged |
| constraint `cross_source_reconciliation_jobs_measurement_ids_check` | CHECK (((measurement_ids IS NULL) OR ((cardinality(measurement_ids) >= 1) AND (cardinality(measurement_ids) <= 64)))) | unchanged |
| constraint `cross_source_reconciliation_jobs_pkey` | PRIMARY KEY (reconciliation_job_id) | unchanged |
| constraint `cross_source_reconciliation_jobs_primary_version_fk` | FOREIGN KEY (primary_source_version_id, organization_id) REFERENCES source_versions(source_version_id, organization_id) ON DELETE RESTRICT | unchanged |
| constraint `cross_source_reconciliation_jobs_profile_sha_check` | CHECK (((primary_profile_canonical_sha256 ~ '^[a-f0-9]{64}$'::text) AND (reference_profile_canonical_sha256 ~ '^[a-f0-9]{64}$'::text))) | CHECK (((primary_profile_canonical_sha256 ~ '^[a-f0-9]{64}$'::text) AND ((reference_profile_canonical_sha256 IS NULL) OR (reference_profile_canonical_sha256 ~ '^[a-f0-9]{64}$'::text)))) |
| constraint `cross_source_reconciliation_jobs_reference_version_fk` | FOREIGN KEY (reference_source_version_id, organization_id) REFERENCES source_versions(source_version_id, organization_id) ON DELETE RESTRICT | unchanged |
| constraint `cross_source_reconciliation_jobs_request_unique` | UNIQUE (organization_id, request_fingerprint) | unchanged |
| constraint `cross_source_reconciliation_jobs_state_check` | CHECK ((job_state = ANY (ARRAY['queued'::text, 'in_progress'::text, 'retry_scheduled'::text, 'succeeded'::text, 'failed'::text, 'exhausted'::text]))) | unchanged |
| constraint `cross_source_reconciliation_jobs_state_fact_consistency_check` | CHECK ((((job_state = 'queued'::text) AND (claim_token IS NULL) AND (claim_expires_at IS NULL) AND (next_eligible_at IS NULL) AND (last_error_code IS NULL) AND (measurement_ids IS NULL) AND (completed_at IS NULL) AND (attempt_count = 0)) OR ((job_state = 'in_progress'::text) AND (claim_token IS NOT NULL) AND (claim_expires_at IS NOT NULL) AND (last_attempt_at IS NOT NULL) AND (next_eligible_at IS NULL) AND (measurement_ids IS NULL) AND (completed_at IS NULL) AND ((attempt_count >= 1) AND (attempt_count <= 3))) OR ((job_state = 'retry_scheduled'::text) AND (claim_token IS NULL) AND (claim_expires_at IS NULL) AND (last_attempt_at IS NOT NULL) AND (next_eligible_at IS NOT NULL) AND (last_error_code IS NOT NULL) AND (measurement_ids IS NULL) AND (completed_at IS NULL) AND ((attempt_count >= 1) AND (attempt_count <= 2))) OR ((job_state = 'succeeded'::text) AND (claim_token IS NULL) AND (claim_expires_at IS NULL) AND (next_eligible_at IS NULL) AND (last_error_code IS NULL) AND (measurement_ids IS NOT NULL) AND (completed_at IS NOT NULL) AND ((attempt_count >= 1) AND (attempt_count <= 3))) OR ((job_state = ANY (ARRAY['failed'::text, 'exhausted'::text])) AND (claim_token IS NULL) AND (claim_expires_at IS NULL) AND (next_eligible_at IS NULL) AND (last_error_code IS NOT NULL) AND (measurement_ids IS NULL) AND (completed_at IS NOT NULL) AND ((attempt_count >= 1) AND (attempt_count <= 3)) AND ((job_state = 'failed'::text) OR (attempt_count = 3))))) | unchanged |
| constraint `cross_source_reconciliation_jobs_worksheet_check` | absent | CHECK ((((primary_worksheet_key IS NULL) OR (primary_worksheet_key ~ '^sheet_[1-9][0-9]{0,3}$'::text)) AND ((reference_worksheet_key IS NULL) OR (reference_worksheet_key ~ '^sheet_[1-9][0-9]{0,3}$'::text)))) |
| index `cross_source_reconciliation_jobs_id_org_unique` | CREATE UNIQUE INDEX cross_source_reconciliation_jobs_id_org_unique ON kai.cross_source_reconciliation_jobs USING btree (reconciliation_job_id, organization_id) | unchanged |
| index `cross_source_reconciliation_jobs_pkey` | CREATE UNIQUE INDEX cross_source_reconciliation_jobs_pkey ON kai.cross_source_reconciliation_jobs USING btree (reconciliation_job_id) | unchanged |
| index `cross_source_reconciliation_jobs_request_unique` | CREATE UNIQUE INDEX cross_source_reconciliation_jobs_request_unique ON kai.cross_source_reconciliation_jobs USING btree (organization_id, request_fingerprint) | unchanged |
| index `ix_cross_source_reconciliation_jobs_due` | CREATE INDEX ix_cross_source_reconciliation_jobs_due ON kai.cross_source_reconciliation_jobs USING btree (job_state, next_eligible_at, claim_expires_at) | unchanged |
| index `ix_cross_source_reconciliation_jobs_tenant_created` | CREATE INDEX ix_cross_source_reconciliation_jobs_tenant_created ON kai.cross_source_reconciliation_jobs USING btree (organization_id, created_at DESC) | unchanged |
| table `cross_source_reconciliation_jobs` | ["r", "p", false, false, false, "d", null, 0, 0, 0] | unchanged |

### kai.measurement_targets

| Object | Prerequisite | Completed |
| --- | --- | --- |
| column `comparison` | absent | text; NOT NULL; default none |
| column `created_at` | absent | timestamp with time zone; NOT NULL; default now() |
| column `created_by` | absent | uuid; NOT NULL; default none |
| column `created_by_type` | absent | text; NOT NULL; default none |
| column `engagement_id` | absent | uuid; NOT NULL; default none |
| column `measurement_family` | absent | text; NOT NULL; default none |
| column `measurement_key` | absent | text; NOT NULL; default none |
| column `measurement_target_id` | absent | uuid; NOT NULL; default gen_random_uuid() |
| column `organization_id` | absent | uuid; NOT NULL; default none |
| column `set_on_measurement_id` | absent | uuid; NOT NULL; default none |
| column `source_id` | absent | uuid; NOT NULL; default none |
| column `supersedes_target_id` | absent | uuid; NULL; default none |
| column `target_unit` | absent | text; NOT NULL; default none |
| column `target_value` | absent | numeric(14,2); NOT NULL; default none |
| column `worksheet_key` | absent | text; NULL; default none |
| constraint `measurement_targets_comparison_check` | absent | CHECK ((comparison = ANY (ARRAY['at_least'::text, 'at_most'::text]))) |
| constraint `measurement_targets_created_by_type_check` | absent | CHECK ((created_by_type = 'human'::text)) |
| constraint `measurement_targets_id_org_unique` | absent | UNIQUE (measurement_target_id, organization_id) |
| constraint `measurement_targets_key_check` | absent | CHECK ((measurement_key ~ '^[a-f0-9]{64}$'::text)) |
| constraint `measurement_targets_measurement_fk` | absent | FOREIGN KEY (set_on_measurement_id, organization_id) REFERENCES source_derived_measurements(source_derived_measurement_id, organization_id) ON DELETE RESTRICT |
| constraint `measurement_targets_not_self_check` | absent | CHECK (((supersedes_target_id IS NULL) OR (supersedes_target_id <> measurement_target_id))) |
| constraint `measurement_targets_pkey` | absent | PRIMARY KEY (measurement_target_id) |
| constraint `measurement_targets_supersedes_fk` | absent | FOREIGN KEY (supersedes_target_id, organization_id) REFERENCES measurement_targets(measurement_target_id, organization_id) ON DELETE RESTRICT |
| constraint `measurement_targets_unit_value_check` | absent | CHECK ((((target_unit = 'count'::text) AND (measurement_family = ANY (ARRAY['tabular_count'::text, 'cross_source_reach'::text])) AND (target_value >= (0)::numeric) AND (target_value = trunc(target_value))) OR ((target_unit = 'percent'::text) AND (measurement_family = ANY (ARRAY['tabular_rate'::text, 'paired_outcome_change'::text])) AND ((target_value >= (0)::numeric) AND (target_value <= (100)::numeric))))) |
| constraint `measurement_targets_worksheet_key_check` | absent | CHECK (((worksheet_key IS NULL) OR (worksheet_key ~ '^sheet_[1-9][0-9]{0,3}$'::text))) |
| index `ix_measurement_targets_identity` | absent | CREATE INDEX ix_measurement_targets_identity ON kai.measurement_targets USING btree (organization_id, source_id, measurement_key) |
| index `measurement_targets_id_org_unique` | absent | CREATE UNIQUE INDEX measurement_targets_id_org_unique ON kai.measurement_targets USING btree (measurement_target_id, organization_id) |
| index `measurement_targets_identity_root_unique` | absent | CREATE UNIQUE INDEX measurement_targets_identity_root_unique ON kai.measurement_targets USING btree (organization_id, engagement_id, source_id, COALESCE(worksheet_key, ''::text), measurement_key) WHERE (supersedes_target_id IS NULL) |
| index `measurement_targets_pkey` | absent | CREATE UNIQUE INDEX measurement_targets_pkey ON kai.measurement_targets USING btree (measurement_target_id) |
| index `measurement_targets_single_successor_unique` | absent | CREATE UNIQUE INDEX measurement_targets_single_successor_unique ON kai.measurement_targets USING btree (organization_id, supersedes_target_id) WHERE (supersedes_target_id IS NOT NULL) |
| table `measurement_targets` | absent | ["r", "p", false, false, false, "d", null, 0, 0, 0] |
| trigger `trg_measurement_targets_append_only` | absent | CREATE TRIGGER trg_measurement_targets_append_only BEFORE DELETE OR UPDATE ON kai.measurement_targets FOR EACH ROW EXECUTE FUNCTION source_derived_measurement_append_only(); enabled=O |

### Exact trigger function bodies

`gate_a_p0_jsonb_metadata_only(jsonb)`

Prerequisite and completed (unchanged):

```sql
CREATE OR REPLACE FUNCTION kai.gate_a_p0_jsonb_metadata_only(value jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT value::text !~* '(raw_bytes|raw_text|raw_content|prompt|signed_url|credential|secret|token|password|private_path|pii|email|phone|address|-----BEGIN|postgres://|postgresql://|mysql://|mongodb://|https?://|/Users/|/private/|/var/|/tmp/|AKIA[0-9A-Z]{16}|[A-Za-z0-9+/]{80,}={0,2})';
$function$

```

`source_derived_measurement_append_only()`

Prerequisite and completed (unchanged):

```sql
CREATE OR REPLACE FUNCTION kai.source_derived_measurement_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'source-derived measurement records are append-only (%)', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$function$

```

`source_derived_measurement_source_admitted()`

Prerequisite:

```sql
CREATE OR REPLACE FUNCTION kai.source_derived_measurement_source_admitted()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  measurement record;
BEGIN
  SELECT measurement_family, source_version_id, profile_canonical_sha256
    INTO measurement
    FROM kai.source_derived_measurements
   WHERE source_derived_measurement_id = NEW.source_derived_measurement_id
     AND organization_id = NEW.organization_id;
  IF NOT FOUND OR measurement.measurement_family <> 'cross_source_reach' THEN
    RAISE EXCEPTION 'a contributing source is recorded only for a cross-source measurement'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.source_role = 'primary') <> (NEW.source_version_id = measurement.source_version_id)
    OR (NEW.source_role = 'primary' AND NEW.profile_canonical_sha256 <> measurement.profile_canonical_sha256) THEN
    RAISE EXCEPTION 'the primary contributing source is the measurement''s own version and profile; a reference source is another version'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$

```

Completed:

```sql
CREATE OR REPLACE FUNCTION kai.source_derived_measurement_source_admitted()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  measurement record;
BEGIN
  SELECT measurement_family, source_version_id, profile_canonical_sha256, worksheet_key
    INTO measurement
    FROM kai.source_derived_measurements
   WHERE source_derived_measurement_id = NEW.source_derived_measurement_id
     AND organization_id = NEW.organization_id;
  IF NOT FOUND OR measurement.measurement_family <> 'cross_source_reach' THEN
    RAISE EXCEPTION 'a contributing source is recorded only for a cross-source measurement'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.source_role = 'primary' THEN
    IF NEW.source_version_id <> measurement.source_version_id
      OR NEW.profile_canonical_sha256 <> measurement.profile_canonical_sha256
      OR NEW.worksheet_key IS DISTINCT FROM measurement.worksheet_key THEN
      RAISE EXCEPTION 'the primary contributing source is the measurement''s own version, profile and worksheet'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.source_version_id = measurement.source_version_id
    AND (NEW.worksheet_key IS NULL OR NEW.worksheet_key IS NOT DISTINCT FROM measurement.worksheet_key) THEN
    RAISE EXCEPTION 'a reference contributing source is another version, or another worksheet of the same version'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$

```

## D Application consequences at inspected revision

| Journey | Exact source references | Consequence of missing schema |
| --- | --- | --- |
| Ordinary measurement-basis read | `Backend/kai/dictionary/postgresDerivedMeasurementRepository.js:558`, `:622`, `:625`; `readCurrentTargets` at `:379` / query `:381` | Any Project-linked source calls measurement_targets even when no target is being set and no measurements are returned; absent table can fail the read |
| Distinct-key-rate calculation and recording | `Backend/kai/validators/kaiDerivedMeasurementValidators.js:789`, `:853`; `Backend/kai/dictionary/postgresDerivedMeasurementRepository.js:692`, `:705`, `:722` | Existing method/family CHECK rejects new distinct-key rate; rate-count CHECK must use identifiers rather than record arithmetic |
| Exact-day jobs and verified-byte results | `Backend/kai/dictionary/postgresDerivedMeasurementRepository.js:708`, `:765`, `:794`; `Backend/kai/services/kaiSourceMeasurementService.js:301`, `:409`; `Backend/kai/parsing/postgresCrossSourceReconciliationJobRepository.js:162` | Missing kind/worksheet/interpretation columns or old NOT NULL reference fields prevent new exact-period jobs; old method CHECK rejects verified-byte basis |
| Worksheet linkage | `Backend/kai/dictionary/postgresDerivedMeasurementRepository.js:407`, `:441`, `:738`, `:817`, `:863` | Contributing-source read/write includes worksheet_key; old uniqueness and admission logic reject same-version worksheet references; old job CHECK rejects those jobs |
| Target writes | `Backend/kai/dictionary/postgresDerivedMeasurementRepository.js:883`, `:902`, `:908` | Target insert/supersession needs the complete target relation and constraints |
| Saved-report targets | `Backend/kai/dictionary/postgresClientInternalReportRepository.js:72`, `:78`, `:83`, `:183`, `:220` | Saved report retrieves the target as of generation time; missing target relation can fail quantitative saved-report retrieval |

These are code dependencies, not production smoke-test results. No application writes or real client data were exercised by this package.

## E Owner pgAdmin procedure

1. Open the existing authenticated **production** pgAdmin connection and its Query Tool.
2. Confirm the intended production database in pgAdmin locally. Do not send the database name, host, connection details or credentials.
3. Start with a clean transaction state. Finish any unrelated transaction separately before starting this task. If this Query Tool has only a prior/failed preflight read-only transaction, execute `ROLLBACK;` separately to clear it. Do not run the script inside an unrelated transaction: BEGIN inside an existing transaction does not establish a fresh read-only boundary.
4. Open or paste the complete `scripts/kai-measurement-completion-production-preflight-read-only.sql`, clear any selection, and execute the complete script with **F5**. It begins READ ONLY, uses local 15-second statement/2-second lock timeouts, and ends at the result SELECT so the grid remains visible.
5. Preserve/export the final **30-row** result grid before closing the transaction.
6. Execute `ROLLBACK;` **separately**, after preserving the grid. If execution fails, execute `ROLLBACK;` separately to clear the failed transaction before retrying the complete file. On a timeout or permission error return the sanitized SQLSTATE/message; do not retry migrations.
7. Return the sanitized grid for interpretation. Return only `seq`, `row_kind`, `capability`, `check_id`, `status`, `expected_prerequisite`, `expected_completed`, `observed`, `detail`. Keep all CHECK, ENVIRONMENT, MIGRATION and OVERALL rows; no connection information, raw client rows or unrelated database information is needed.

Do **not** execute either migration before these actual preflight results are assessed. A clean REQUIRED classification identifies a compatible forward delta, not permission to infer production state before evidence arrives. STOP requires resolving the precise discrepancy, not replaying IF NOT EXISTS or running rollback SQL. No automatic remediation is included.

## F Post migration read only verification sequence

This is the verification packet for after any separately assessed, owner-operated migration step; no migration is instructed by this packet. Run in this order:

| Order | Exact repository SQL file | Required result after both migrations |
| --- | --- | --- |
| 1 | `scripts/kai-measurement-completion-production-preflight-read-only.sql` | calculation ALREADY_APPLIED; targets ALREADY_APPLIED; OVERALL SCHEMA_COMPATIBLE; every CHECK MATCH_COMPLETED or MATCH_BOTH; environment PASS |
| 2 | `scripts/kai-measurement-mvp-derived-measurements-verify-read-only.sql` | OVERALL PASS, all 12 checks PASS; D0 after cross-source reach; completion vectors pass |
| 3 | `scripts/kai-measurement-mvp-cross-source-reconciliation-jobs-verify-read-only.sql` | OVERALL PASS; all exact job columns/constraints/index checks PASS in completed state |
| 4 | `scripts/kai-sprint2-p2-01m-xlsx-worksheet-method-verify-read-only.sql` | OVERALL PASS; all 8 checks PASS |
| 5 | `scripts/kai-reporting-schema-verify-read-only.sql` | OVERALL PASS; broad reporting prerequisites only |

For file 1 use the preflight procedure, preserve the grid, then separately ROLLBACK. For each of files 2–5 start from a clean transaction, execute the following wrapper first, F5 the complete verifier, preserve its grid, then separately ROLLBACK:

```sql
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog, kai, public;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
```

Files 2 and 4 already contain informational aggregate counts over measurement rows (D8 and X4); they return counts only, not raw client rows. These counts are not compatibility evidence. Files 2–5 were reused unchanged. Their gaps are covered additively by file 1, which also serves as the exact completed-state verifier: full target columns/defaults, both actual FKs/delete actions, all CHECKs/index predicates, source worksheet uniqueness, trigger bindings/enabled states and exact function semantics. The generic reporting-schema pass alone proves none of those uninspected details. All five SQL checks passed locally against the completed synthetic schema.

## G Current conclusion

Production PostgreSQL schema: **NOT_CONFIRMED** until the owner returns actual pgAdmin catalog evidence. No migration requirement or production compatibility is asserted. Deployment evidence supplied by the owner does not establish PostgreSQL schema state.

## H Change accounting and local verification

Added: the catalog-only preflight; isolated Python proof runner; exact catalog evidence JSON; sanitized local proof transcript (`artifacts/kai-measurement-completion-local-verification.txt`); this owner packet. Updated once at package end: living ExecPlan status/evidence. No application code, forward migration, rollback, existing verifier, feature flag or Current State file changed. Coherent local commit required by AGENTS.md; no push.

Actual proof: PostgreSQL 16.14; A/B/C correct; 19 incompatible variants STOP; eight literal CHECK cases correct; four existing verifiers OVERALL PASS. Default-mode reproduction compares committed pins/evidence without rewriting them. Final package checks: Python compilation, git diff --check, complete staged diff inspection, local commit and final working-tree status are reported in the execution response.

## Complete executable preflight SQL

```sql
-- Exact measurement completion preflight; source revision ed37dddd167a5ce4543ca6ed841be090060b1242.
-- Catalogs only: no application rows, dynamic SQL, DDL or temporary objects.
-- Pins are reproducible from committed migrations on disposable PostgreSQL 16.
-- Unsupported majors STOP: do not interpret rendering differences as missing migrations.
-- F5 the COMPLETE file from a clean transaction. Preserve the final result grid.
-- AFTER inspecting/exporting that grid, execute ROLLBACK; SEPARATELY.
-- On any error, execute ROLLBACK; separately before retrying the complete file.
-- No production catalog evidence has yet been supplied: NOT_CONFIRMED.
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog, kai, public;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
WITH targets(name, capability) AS (
  VALUES ('source_derived_measurements', 'calculation'),
         ('source_derived_measurement_sources', 'calculation'),
         ('cross_source_reconciliation_jobs', 'calculation'),
         ('measurement_targets', 'targets')
), objects AS (
  SELECT t.name, 'table' AS kind, t.name AS identity,
    jsonb_build_array(c.relkind, c.relpersistence, c.relrowsecurity, c.relforcerowsecurity,
      c.relispartition, c.relreplident, c.reloptions,
      (SELECT count(*) FROM pg_inherits h WHERE h.inhrelid = c.oid OR h.inhparent = c.oid),
      (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid),
      (SELECT count(*) FROM pg_rewrite w WHERE w.ev_class = c.oid))::text AS definition
  FROM targets t JOIN pg_class c ON c.oid = to_regclass('kai.' || t.name)
  UNION ALL
  SELECT t.name, 'column', a.attname,
    jsonb_build_array(a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
      pg_get_expr(d.adbin, d.adrelid), a.attidentity, a.attgenerated,
      a.attcollation::regcollation::text)::text
  FROM targets t JOIN pg_attribute a ON a.attrelid = to_regclass('kai.' || t.name)
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT t.name, 'constraint', c.conname,
    jsonb_build_array(c.conname, c.contype, pg_get_constraintdef(c.oid), c.convalidated,
      c.condeferrable, c.condeferred, c.connoinherit,
      CASE WHEN c.contype = 'f' THEN c.confrelid::regclass::text END,
      (SELECT string_agg(p.oid::regprocedure::text, ',' ORDER BY p.oid::regprocedure::text COLLATE "C")
       FROM pg_depend dep JOIN pg_proc p ON p.oid = dep.refobjid
       WHERE dep.classid = 'pg_constraint'::regclass AND dep.objid = c.oid
         AND dep.refclassid = 'pg_proc'::regclass),
      (SELECT string_agg(jsonb_build_array(tr.tgrelid::regclass::text, tr.tgfoid::regprocedure::text,
          tr.tgtype, tr.tgenabled, tr.tgdeferrable, tr.tginitdeferred)::text, E'\n'
          ORDER BY tr.tgrelid::regclass::text COLLATE "C", tr.tgfoid::regprocedure::text COLLATE "C")
       FROM pg_trigger tr WHERE tr.tgconstraint = c.oid AND tr.tgisinternal))::text
  FROM targets t JOIN pg_constraint c ON c.conrelid = to_regclass('kai.' || t.name)
  UNION ALL
  SELECT t.name, 'index', c.relname,
    jsonb_build_array(c.relname, pg_get_indexdef(c.oid), i.indisvalid, i.indisready,
      i.indislive, i.indisunique, i.indimmediate, c.reloptions)::text
  FROM targets t JOIN pg_index i ON i.indrelid = to_regclass('kai.' || t.name)
  JOIN pg_class c ON c.oid = i.indexrelid
  UNION ALL
  SELECT t.name, 'trigger', tr.tgname,
    jsonb_build_array(tr.tgname, pg_get_triggerdef(tr.oid), tr.tgenabled,
      tr.tgfoid::regprocedure::text, tr.tgdeferrable, tr.tginitdeferred)::text
  FROM targets t JOIN pg_trigger tr ON tr.tgrelid = to_regclass('kai.' || t.name)
  WHERE NOT tr.tgisinternal
), facts AS (
  SELECT t.name || '.' || k.kind AS check_id,
    CASE WHEN to_regclass('kai.' || t.name) IS NULL THEN 'ABSENT'
         ELSE coalesce(md5(string_agg(o.definition, E'\n' ORDER BY o.identity COLLATE "C")), 'EMPTY') END AS signature
  FROM targets t CROSS JOIN (VALUES ('table'), ('column'), ('constraint'), ('index'), ('trigger')) k(kind)
  LEFT JOIN objects o ON o.name = t.name AND o.kind = k.kind
  GROUP BY t.name, k.kind
  UNION ALL
  SELECT 'function.' || v.name,
    coalesce(md5(pg_get_functiondef(p.oid) || jsonb_build_array(p.provolatile, p.prosecdef,
      p.proisstrict, p.proleakproof, p.proparallel, p.proconfig)::text), 'ABSENT')
  FROM (VALUES ('source_derived_measurement_source_admitted()'),
               ('source_derived_measurement_append_only()'),
               ('gate_a_p0_jsonb_metadata_only(jsonb)')) v(name)
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure('kai.' || v.name)
  UNION ALL
  -- Guard IF NOT EXISTS against a reserved index name bound to another table.
  SELECT 'namespace.' || v.capability,
    coalesce(md5(string_agg(jsonb_build_array(c.relname, c.relkind,
      i.indrelid::regclass::text)::text, E'\n' ORDER BY c.relname COLLATE "C") FILTER (WHERE c.oid IS NOT NULL)), 'ABSENT')
  FROM (VALUES ('calculation', 'source_derived_measurement_sources_version_worksheet_unique'),
               ('targets', 'measurement_targets_pkey'),
               ('targets', 'measurement_targets_id_org_unique'),
               ('targets', 'measurement_targets_identity_root_unique'),
               ('targets', 'measurement_targets_single_successor_unique'),
               ('targets', 'ix_measurement_targets_identity')) v(capability, name)
  LEFT JOIN pg_class c ON c.relnamespace = to_regnamespace('kai') AND c.relname = v.name
  LEFT JOIN pg_index i ON i.indexrelid = c.oid
  GROUP BY v.capability
  UNION ALL
  SELECT 'type.measurement_targets',
    coalesce(md5(string_agg(jsonb_build_array(y.typname, y.typtype, y.typrelid::regclass::text)::text, E'\n'
      ORDER BY y.typname COLLATE "C")), 'ABSENT')
  FROM pg_type y WHERE y.typnamespace = to_regnamespace('kai')
    AND y.typname IN ('measurement_targets', '_measurement_targets')
), pins(check_id, pre_signature, post_signature, capability) AS (
  VALUES
-- BEGIN GENERATED PINS
    ('cross_source_reconciliation_jobs.column', '290521ad923bf4eee9f4139577341926', '619285957aad9d54d4bc7d5609d4b0a8', 'calculation'),
    ('cross_source_reconciliation_jobs.constraint', 'a3306714a4465c6a974d8623bd68b2ad', '03a92bd2495f88c95f3cad8b95cfd346', 'calculation'),
    ('cross_source_reconciliation_jobs.index', '8c3191b307567581852b80e9f002d8cf', '8c3191b307567581852b80e9f002d8cf', 'calculation'),
    ('cross_source_reconciliation_jobs.table', '090c1d0c464674ce48dac41eb7697c7a', '090c1d0c464674ce48dac41eb7697c7a', 'calculation'),
    ('cross_source_reconciliation_jobs.trigger', 'EMPTY', 'EMPTY', 'calculation'),
    ('function.gate_a_p0_jsonb_metadata_only(jsonb)', '23aa61b014feed8e38486cae014078e7', '23aa61b014feed8e38486cae014078e7', 'calculation'),
    ('function.source_derived_measurement_append_only()', '280e770348d8e059ac3b74e5001b4c3b', '280e770348d8e059ac3b74e5001b4c3b', 'shared'),
    ('function.source_derived_measurement_source_admitted()', 'ae5f729177d3d764bb8bc413a84bf592', '8839b1a9c8e73b07d48bb6ae4cdb83b3', 'calculation'),
    ('measurement_targets.column', 'ABSENT', 'a2ef86cd324a566fab601c71713aa53d', 'targets'),
    ('measurement_targets.constraint', 'ABSENT', 'cfa172e001ffcd0058155232937dfac1', 'targets'),
    ('measurement_targets.index', 'ABSENT', '02ac62eda2384a81bc6c6a8fa312e1ee', 'targets'),
    ('measurement_targets.table', 'ABSENT', '090c1d0c464674ce48dac41eb7697c7a', 'targets'),
    ('measurement_targets.trigger', 'ABSENT', '01e1be33ad5aa9442b1c5fc9400b1a86', 'targets'),
    ('namespace.calculation', 'ABSENT', 'e3a4c89299c8c92a67ccf46bc088b7ca', 'calculation'),
    ('namespace.targets', 'ABSENT', '32f832b6ea840da80ae49e500979137a', 'targets'),
    ('source_derived_measurement_sources.column', 'df8e7d4fa37d8ad9d2db0dea8e8efbb7', '5c792069b18b8198878035146ab402ba', 'calculation'),
    ('source_derived_measurement_sources.constraint', '97e1d423fe536d83df441d52a6776b3f', 'f353f0a283498b318aee82813a6dee72', 'calculation'),
    ('source_derived_measurement_sources.index', '80896faf6eee166f5fbc2dc2184f3cb3', 'e8bea896abd3befc66d07fa6f807887c', 'calculation'),
    ('source_derived_measurement_sources.table', '090c1d0c464674ce48dac41eb7697c7a', '090c1d0c464674ce48dac41eb7697c7a', 'calculation'),
    ('source_derived_measurement_sources.trigger', '8db8977cadf62171ea0dae5e1be79211', '8db8977cadf62171ea0dae5e1be79211', 'calculation'),
    ('source_derived_measurements.column', 'd1b21bf656f781afc95f9d2d4034a3b7', 'd1b21bf656f781afc95f9d2d4034a3b7', 'calculation'),
    ('source_derived_measurements.constraint', '3120652f8ee12ccd2ef2263004c909ac', '03d4d4a2971d8c8c0e642d5ba803d87d', 'calculation'),
    ('source_derived_measurements.index', 'daee8c76099b2dade317cd59a020f539', 'daee8c76099b2dade317cd59a020f539', 'calculation'),
    ('source_derived_measurements.table', '090c1d0c464674ce48dac41eb7697c7a', '090c1d0c464674ce48dac41eb7697c7a', 'calculation'),
    ('source_derived_measurements.trigger', '256837dc1dce349ef1e28cc83ad21f81', '256837dc1dce349ef1e28cc83ad21f81', 'calculation'),
    ('type.measurement_targets', 'ABSENT', '036d340669cec74ca34a1b52ca4f92c5', 'targets')
-- END GENERATED PINS
), checks AS (
  SELECT p.*, coalesce(f.signature, 'ABSENT') AS observed,
         coalesce(f.signature, 'ABSENT') = p.pre_signature AS pre_ok,
         coalesce(f.signature, 'ABSENT') = p.post_signature AS post_ok
  FROM pins p LEFT JOIN facts f USING (check_id)
), environment AS (
  SELECT current_setting('server_version_num')::integer / 10000 AS server_major,
    current_setting('transaction_read_only') = 'on' AS read_only
), decisions AS (
  SELECT 'calculation' AS capability,
    CASE WHEN NOT (SELECT server_major = 16 AND read_only FROM environment) THEN 'STOP_INCOMPATIBLE'
         WHEN bool_and(post_ok) THEN 'ALREADY_APPLIED'
         WHEN bool_and(pre_ok) THEN 'REQUIRED' ELSE 'STOP_INCOMPATIBLE' END AS status
  FROM checks WHERE capability IN ('calculation', 'shared')
  UNION ALL
  SELECT 'targets',
    CASE WHEN NOT (SELECT server_major = 16 AND read_only FROM environment) THEN 'STOP_INCOMPATIBLE'
         -- Target FK/append-only prerequisites: exact derived table in either known state.
         WHEN NOT (SELECT bool_and(pre_ok OR post_ok) FROM checks
                    WHERE check_id LIKE 'source_derived_measurements.%' OR capability = 'shared') THEN 'STOP_INCOMPATIBLE'
         WHEN bool_and(post_ok) THEN 'ALREADY_APPLIED'
         WHEN bool_and(pre_ok) THEN 'REQUIRED' ELSE 'STOP_INCOMPATIBLE' END
  FROM checks WHERE capability = 'targets'
), results AS (
  SELECT 10 AS seq, 'CHECK' AS row_kind, capability, check_id,
    CASE WHEN pre_ok AND post_ok THEN 'MATCH_BOTH' WHEN post_ok THEN 'MATCH_COMPLETED'
         WHEN pre_ok THEN 'MATCH_PREREQUISITE' ELSE 'MISMATCH' END AS status,
    pre_signature AS expected_prerequisite, post_signature AS expected_completed, observed,
    'Exact catalog signature; definitions in companion catalog evidence JSON.' AS detail
  FROM checks
  UNION ALL
  SELECT 20, 'ENVIRONMENT', 'shared', 'postgresql_major',
    CASE WHEN server_major = 16 AND read_only THEN 'PASS' ELSE 'STOP_INCOMPATIBLE' END,
    '16; read_only=on', '16; read_only=on', server_major::text || '; read_only=' || read_only::text,
    'PG16 rendering validated. Other majors require a disposable-major rehearsal; never replay on a hash mismatch.'
  FROM environment
  UNION ALL
  SELECT 30, 'MIGRATION', capability, capability, status, 'REQUIRED', 'ALREADY_APPLIED', status,
    CASE capability WHEN 'calculation' THEN 'Order 1: calculation completion; requires committed derived + cross-source reach + jobs schema.'
         ELSE 'Order 2: numerical targets; requires derived identity unique key, gen_random_uuid and preserved append-only function.' END
  FROM decisions
  UNION ALL
  SELECT 99, 'OVERALL', 'both', 'OVERALL',
    CASE WHEN bool_or(status = 'STOP_INCOMPATIBLE') THEN 'STOP_INCOMPATIBLE'
         WHEN bool_and(status = 'ALREADY_APPLIED') THEN 'SCHEMA_COMPATIBLE' ELSE 'SCHEMA_DELTA_REQUIRED' END,
    'NOT_CONFIRMED until owner executes', 'SCHEMA_COMPATIBLE', string_agg(capability || '=' || status, '; ' ORDER BY capability),
    'Return ALL rows. Assess preflight before any migration. Preserve grid, then separately execute ROLLBACK;.'
  FROM decisions
)
SELECT seq, row_kind, capability, check_id, status, expected_prerequisite, expected_completed, observed, detail
FROM results ORDER BY seq, capability, check_id;
```
