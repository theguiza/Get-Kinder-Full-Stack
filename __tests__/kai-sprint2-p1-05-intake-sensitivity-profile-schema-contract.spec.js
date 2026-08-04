import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_p1_05_intake_sensitivity_profile.rollback.sql", "utf8");

test("P1-05 migration guards on prerequisite P1-02/P1-04 objects and does not modify earlier migrations", () => {
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.intake_files is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.intake_file_profiles is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.data_dictionaries is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.upload_lifecycle_audit is required/);
  assert.match(migrationSource, /gate_a_p0_jsonb_metadata_only/);
  assert.match(migrationSource, /intake_file_profiles_p1_04_lineage_unique/);
  assert.match(migrationSource, /data_dictionaries_p1_04_lineage_unique/);
  assert.doesNotMatch(
    migrationSource,
    /DROP TABLE IF EXISTS kai\.(intake_files|intake_parser_runs|intake_file_profiles|data_dictionaries|data_dictionary_fields|data_dictionary_mappings|data_quality_findings|upload_lifecycle_audit)/,
  );
});

test("P1-05 creates exactly one authorized table with one profile per organization_id + file_profile_id + data_dictionary_id", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.intake_sensitivity_profiles/);
  assert.match(
    migrationSource,
    /CONSTRAINT intake_sensitivity_profiles_p1_05_identity_unique\s+UNIQUE \(organization_id, file_profile_id, data_dictionary_id\)/,
  );
});

test("P1-05 binds immutably to the exact stored profile identity/hash and the exact stored dictionary lineage", () => {
  assert.match(
    migrationSource,
    /FOREIGN KEY \(file_profile_id, organization_id, intake_file_id, profile_canonical_sha256\)\s+REFERENCES kai\.intake_file_profiles \(file_profile_id, organization_id, intake_file_id, profile_canonical_sha256\)/,
  );
  assert.match(
    migrationSource,
    /FOREIGN KEY \(data_dictionary_id, organization_id, intake_file_id, file_profile_id\)\s+REFERENCES kai\.data_dictionaries \(data_dictionary_id, organization_id, intake_file_id, file_profile_id\)/,
  );
  assert.match(migrationSource, /CONSTRAINT intake_sensitivity_profiles_p1_05_canonical_sha_check\s+CHECK \(profile_canonical_sha256 ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.data_dictionaries/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.intake_file_profiles/);
});

test("P1-05 defines every Phase 5 semantic dimension as its own distinct, CHECK-enforced column", () => {
  const threeStateDimensions = [
    ["pii_status", "intake_sensitivity_profiles_p1_05_pii_status_check"],
    ["minor_data_status", "intake_sensitivity_profiles_p1_05_minor_data_status_check"],
    ["health_housing_justice_immigration_status", "intake_sensitivity_profiles_p1_05_hhji_status_check"],
    ["indigenous_governance_status", "intake_sensitivity_profiles_p1_05_indigenous_governance_status_check"],
    ["staff_notes_status", "intake_sensitivity_profiles_p1_05_staff_notes_status_check"],
    ["story_testimonial_status", "intake_sensitivity_profiles_p1_05_story_testimonial_status_check"],
    ["small_cell_risk_status", "intake_sensitivity_profiles_p1_05_small_cell_risk_status_check"],
    ["financial_records_status", "intake_sensitivity_profiles_p1_05_financial_records_status_check"],
    ["consent_basis_status", "intake_sensitivity_profiles_p1_05_consent_basis_status_check"],
  ];
  for (const [column, constraint] of threeStateDimensions) {
    assert.match(migrationSource, new RegExp(`${column} text NOT NULL DEFAULT 'unknown'`));
    assert.match(
      migrationSource,
      new RegExp(`CONSTRAINT ${constraint}\\s+CHECK \\(${column} IN \\('unknown', 'present', 'absent'\\)\\)`),
    );
  }
  assert.match(migrationSource, /allowed_use_status text NOT NULL DEFAULT 'unknown'/);
  assert.match(
    migrationSource,
    /CONSTRAINT intake_sensitivity_profiles_p1_05_allowed_use_status_check\s+CHECK \(allowed_use_status IN \('unknown', 'allowed', 'not_allowed'\)\)/,
  );
});

test("P1-05 pins every fail-closed restriction by CHECK constraint, not merely a default value", () => {
  assert.match(migrationSource, /CONSTRAINT intake_sensitivity_profiles_p1_05_llm_processing_check\s+CHECK \(llm_processing_allowed = false\)/);
  assert.match(migrationSource, /CONSTRAINT intake_sensitivity_profiles_p1_05_product_learning_check\s+CHECK \(product_learning_allowed = false\)/);
  assert.match(migrationSource, /CONSTRAINT intake_sensitivity_profiles_p1_05_public_use_check\s+CHECK \(public_use_allowed = false\)/);
  assert.match(migrationSource, /CONSTRAINT intake_sensitivity_profiles_p1_05_funder_use_check\s+CHECK \(funder_use_allowed = false\)/);
  assert.match(migrationSource, /CONSTRAINT intake_sensitivity_profiles_p1_05_human_review_check\s+CHECK \(human_review_required = true\)/);
  assert.match(migrationSource, /CONSTRAINT intake_sensitivity_profiles_p1_05_retention_posture_check\s+CHECK \(retention_posture = 'restricted_pending_review'\)/);
});

test("P1-05 never persists review_status or review_requirements as a persisted column", () => {
  assert.doesNotMatch(migrationSource, /^\s*review_status\s+text\b/m);
  assert.doesNotMatch(migrationSource, /^\s*review_requirements\b/m);
});

test("P1-05 never introduces retention execution, deletion, lifecycle, or job-activation columns", () => {
  assert.doesNotMatch(migrationSource, /\b(?:retention_executed_at|purge_scheduled_at|deleted_at|retention_job_id)\b/);
  assert.doesNotMatch(migrationSource, /\bDELETE FROM\b/i);
});

test("P1-05 carries no raw/unredacted content columns", () => {
  assert.doesNotMatch(
    migrationSource,
    /\b(?:raw_bytes|raw_text|raw_content|full_text|extracted_text|parsed_rows|sample_value|sample_values|field_label|excerpt)\s+(?:text|jsonb|bytea)\b/i,
  );
});

test("P1-05 migration extends only the P1-05 audit operation and metadata branch, preserving all earlier branches", () => {
  assert.match(migrationSource, /intake_sensitivity_profile_persisted/);
  assert.match(migrationSource, /operation <> 'policy_decision_compare_and_set'/);
  assert.match(migrationSource, /operation <> 'parser_run_recorded'/);
  assert.match(migrationSource, /operation <> 'file_profile_persisted'/);
  assert.match(migrationSource, /operation <> 'data_dictionary_draft_persisted'/);
  assert.match(migrationSource, /operation <> 'intake_sensitivity_profile_persisted'/);
  assert.doesNotMatch(migrationSource, /\bkai\.(?:review_queue_items|intake_source_candidates|intake_promotion_decisions|sources|source_versions|evidence|claims)\b/);
});

test("P1-05 audit metadata branch requires exactly the seven allowlisted keys", () => {
  const branchMatch = migrationSource.match(
    /operation <> 'intake_sensitivity_profile_persisted'\s+OR \(([\s\S]*?)\)\s*\)\s*\)\s*;/,
  );
  assert.ok(branchMatch, "expected to find the intake_sensitivity_profile_persisted metadata branch");
  const branch = branchMatch[1];
  for (const key of [
    "metadata_only",
    "contract",
    "file_profile_id",
    "data_dictionary_id",
    "profile_canonical_sha256",
    "human_review_required",
    "validator_key",
  ]) {
    assert.match(branch, new RegExp(`metadata \\? '${key}'`));
  }
  assert.match(branch, /metadata - ARRAY\[/);
});

test("P1-05 rollback removes only P1-05 objects and restores the exact prior audit constraints", () => {
  assert.match(rollbackSource, /DELETE FROM kai\.upload_lifecycle_audit\s+WHERE operation = 'intake_sensitivity_profile_persisted'/);
  assert.doesNotMatch(rollbackSource, /CHECK \(operation IN \([^)]*intake_sensitivity_profile_persisted/);
  assert.match(rollbackSource, /data_dictionary_draft_persisted/);
  assert.match(rollbackSource, /file_profile_persisted/);
  assert.match(rollbackSource, /parser_run_recorded/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.intake_sensitivity_profiles/);
  assert.doesNotMatch(
    rollbackSource,
    /DROP TABLE IF EXISTS kai\.(?:intake_files|intake_parser_runs|intake_file_profiles|data_dictionaries|data_dictionary_fields|data_dictionary_mappings|data_quality_findings|upload_lifecycle_audit)\b/,
  );
  assert.doesNotMatch(rollbackSource, /ALTER TABLE.*kai\.(?:data_dictionaries|intake_file_profiles)\b/);
});
