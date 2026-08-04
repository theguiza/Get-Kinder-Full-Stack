import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_p1_04_data_dictionary_and_quality.rollback.sql", "utf8");

test("P1-04 migration guards on prerequisite P1-02 objects and does not modify earlier migrations", () => {
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.intake_files is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.intake_file_profiles is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.upload_lifecycle_audit is required/);
  assert.match(migrationSource, /gate_a_p0_jsonb_metadata_only/);
  assert.doesNotMatch(migrationSource, /DROP TABLE IF EXISTS kai\.(intake_files|intake_parser_runs|intake_file_profiles|upload_lifecycle_audit)/);
});

test("P1-04 extends kai.intake_file_profiles only with a backward-compatible additive unique constraint", () => {
  assert.match(
    migrationSource,
    /ALTER TABLE kai\.intake_file_profiles\s+ADD CONSTRAINT intake_file_profiles_p1_04_lineage_unique\s+UNIQUE \(file_profile_id, organization_id, intake_file_id, profile_canonical_sha256\)/,
  );
  assert.doesNotMatch(migrationSource, /DROP CONSTRAINT[^;]*intake_file_profiles_p1_(?:identity_unique|run_identity_unique|profile_object_check|profile_metadata_only_check|canonical_sha_check)/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.intake_parser_runs/);
});

test("P1-04 creates exactly the four authorized tables with one bundle per organization_id + file_profile_id", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.data_dictionaries/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.data_dictionary_fields/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.data_dictionary_mappings/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.data_quality_findings/);
  assert.match(migrationSource, /CONSTRAINT data_dictionaries_p1_04_bundle_identity_unique\s+UNIQUE \(organization_id, file_profile_id\)/);
  assert.doesNotMatch(migrationSource, /\brevision_number\b/);
  assert.doesNotMatch(migrationSource, /\bpredecessor_id\b/);
  assert.doesNotMatch(migrationSource, /\bsupersedes_id\b/);
  assert.doesNotMatch(migrationSource, /\bsuperseded_by_id\b/);
});

test("P1-04 dictionary lineage FK binds to the exact stored profile identity and immutable hash", () => {
  assert.match(
    migrationSource,
    /FOREIGN KEY \(file_profile_id, organization_id, intake_file_id, profile_canonical_sha256\)\s+REFERENCES kai\.intake_file_profiles \(file_profile_id, organization_id, intake_file_id, profile_canonical_sha256\)/,
  );
  assert.match(migrationSource, /CONSTRAINT data_dictionaries_p1_04_canonical_sha_check\s+CHECK \(profile_canonical_sha256 ~ '\^\[a-f0-9\]\{64\}\$'\)/);
});

test("P1-04 fields, mappings, and findings carry only fail-closed provisional defaults", () => {
  assert.match(migrationSource, /CONSTRAINT data_dictionaries_p1_04_status_check\s+CHECK \(dictionary_status = 'draft'\)/);
  assert.match(migrationSource, /review_status text NOT NULL DEFAULT 'needs_gk_review'/);
  assert.match(migrationSource, /CONSTRAINT data_dictionary_fields_p1_04_review_status_check\s+CHECK \(review_status = 'needs_gk_review'\)/);
  assert.match(migrationSource, /CONSTRAINT data_dictionary_fields_p1_04_sensitivity_check\s+CHECK \(sensitivity = 'unknown'\)/);
  assert.match(migrationSource, /CONSTRAINT data_dictionary_fields_p1_04_allowed_use_check\s+CHECK \(allowed_use = 'internal'\)/);
  assert.match(migrationSource, /CONSTRAINT data_dictionary_fields_p1_04_consent_status_check\s+CHECK \(consent_status = 'unknown'\)/);
  assert.match(migrationSource, /CONSTRAINT data_dictionary_fields_p1_04_consent_scope_check\s+CHECK \(consent_scope = 'none'\)/);
  assert.match(migrationSource, /CONSTRAINT data_dictionary_fields_p1_04_llm_use_check\s+CHECK \(llm_use_allowed = false\)/);
  assert.match(migrationSource, /CONSTRAINT data_dictionary_fields_p1_04_public_use_check\s+CHECK \(public_use_allowed = false\)/);
  assert.match(migrationSource, /CONSTRAINT data_dictionary_fields_p1_04_funder_use_check\s+CHECK \(funder_use_allowed = false\)/);
  assert.match(migrationSource, /CONSTRAINT data_dictionary_fields_p1_04_human_review_check\s+CHECK \(human_review_required = true\)/);
  assert.match(migrationSource, /CONSTRAINT data_quality_findings_p1_04_status_check\s+CHECK \(finding_status = 'open'\)/);
});

test("P1-04 business meaning and entity level default to unknown but may carry a copied safe value", () => {
  assert.match(migrationSource, /business_meaning text NOT NULL DEFAULT 'unknown'/);
  assert.match(migrationSource, /entity_level text NOT NULL DEFAULT 'unknown'/);
  assert.match(migrationSource, /CONSTRAINT data_dictionary_fields_p1_04_business_meaning_check\s+CHECK \(\s*business_meaning = 'unknown'/);
  assert.match(migrationSource, /CONSTRAINT data_dictionary_fields_p1_04_entity_level_check\s+CHECK \(\s*entity_level = 'unknown'/);
});

test("P1-04 mapping_confidence is nullable, carries no fabricated default, and is range-checked", () => {
  assert.match(migrationSource, /^\s*mapping_confidence numeric\(3,2\),$/m);
  assert.doesNotMatch(migrationSource, /mapping_confidence numeric\(3,2\)[^,\n]*NOT NULL/);
  assert.doesNotMatch(migrationSource, /mapping_confidence[^,\n]*DEFAULT/);
  assert.doesNotMatch(migrationSource, /DEFAULT 1\.00/);
  assert.match(
    migrationSource,
    /CONSTRAINT data_dictionary_fields_p1_04_mapping_confidence_check\s+CHECK \(\s*mapping_confidence IS NULL\s+OR \(mapping_confidence >= 0 AND mapping_confidence <= 1\)\s*\)/,
  );
});

test("P1-04 quality findings are constrained to the accepted profile-stage-fact vocabulary only", () => {
  assert.match(
    migrationSource,
    /CHECK \(finding_type IN \(\s*'missingness',\s*'duplicate_rows',\s*'type_inconsistency',\s*'invalid_date',\s*'formula_like_content',\s*'safe_profiler_warning'\s*\)\)/,
  );
  assert.doesNotMatch(migrationSource, /'denominator/i);
  assert.doesNotMatch(migrationSource, /'coverage_gap'/);
  assert.doesNotMatch(migrationSource, /'funder_requirement/i);
});

test("P1-04 tables carry no raw/unredacted content columns", () => {
  assert.doesNotMatch(migrationSource, /\b(?:raw_bytes|raw_text|raw_content|full_text|extracted_text|parsed_rows|sample_value|sample_values)\s+(?:text|jsonb|bytea)\b/i);
});

test("P1-04 mapping binds a field to organization_id + file_profile_id + stable profile field key", () => {
  assert.match(
    migrationSource,
    /FOREIGN KEY \(data_dictionary_field_id, data_dictionary_id, organization_id, file_profile_id, profile_field_key\)\s+REFERENCES kai\.data_dictionary_fields \(data_dictionary_field_id, data_dictionary_id, organization_id, file_profile_id, profile_field_key\)/,
  );
});

test("P1-04 migration extends only the P1-04 audit operation and metadata branch, preserving all earlier branches", () => {
  assert.match(migrationSource, /data_dictionary_draft_persisted/);
  assert.match(migrationSource, /metadata \? 'contract'/);
  assert.match(migrationSource, /metadata \? 'validator_key'/);
  assert.match(migrationSource, /operation <> 'policy_decision_compare_and_set'/);
  assert.match(migrationSource, /operation <> 'parser_run_recorded'/);
  assert.match(migrationSource, /operation <> 'file_profile_persisted'/);
  assert.match(migrationSource, /operation <> 'data_dictionary_draft_persisted'/);
  assert.match(migrationSource, /NOT metadata \? 'profile'/);
  assert.doesNotMatch(migrationSource, /\bkai\.(?:sensitivity_records|review_workflow|source_candidates|promotion_decisions|sources|source_versions|evidence|claims)\b/);
  assert.doesNotMatch(migrationSource, /\bsource_version\b/);
});

test("P1-04 rollback removes only P1-04 objects and restores the exact prior audit constraints", () => {
  assert.match(rollbackSource, /DELETE FROM kai\.upload_lifecycle_audit\s+WHERE operation = 'data_dictionary_draft_persisted'/);
  assert.doesNotMatch(rollbackSource, /CHECK \(operation IN \([^)]*data_dictionary_draft_persisted/);
  assert.match(rollbackSource, /parser_run_recorded/);
  assert.match(rollbackSource, /file_profile_persisted/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.data_quality_findings/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.data_dictionary_mappings/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.data_dictionary_fields/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.data_dictionaries/);
  assert.match(rollbackSource, /DROP CONSTRAINT IF EXISTS intake_file_profiles_p1_04_lineage_unique/);
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.(?:intake_files|intake_parser_runs|intake_file_profiles|upload_lifecycle_audit)\b/);
});

test("P1-04 rollback drops child tables before the dictionary parent table", () => {
  const dropFindingsIndex = rollbackSource.indexOf("DROP TABLE IF EXISTS kai.data_quality_findings");
  const dropMappingsIndex = rollbackSource.indexOf("DROP TABLE IF EXISTS kai.data_dictionary_mappings");
  const dropFieldsIndex = rollbackSource.indexOf("DROP TABLE IF EXISTS kai.data_dictionary_fields");
  const dropDictionariesIndex = rollbackSource.indexOf("DROP TABLE IF EXISTS kai.data_dictionaries");
  assert.ok(dropFindingsIndex >= 0 && dropFindingsIndex < dropDictionariesIndex, "findings must be dropped before dictionaries");
  assert.ok(dropMappingsIndex >= 0 && dropMappingsIndex < dropDictionariesIndex, "mappings must be dropped before dictionaries");
  assert.ok(dropFieldsIndex >= 0 && dropFieldsIndex < dropDictionariesIndex, "fields must be dropped before dictionaries");
});
