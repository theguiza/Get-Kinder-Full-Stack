import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_p2_01_evidence_lineage.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_p2_01_evidence_lineage.rollback.sql", "utf8");
const p108MigrationSource = readFileSync("migrations/kai_sprint2_p1_08_source_promotion.sql", "utf8");
const p106MigrationSource = readFileSync("migrations/kai_sprint2_p1_06_review_queue.sql", "utf8");

test("P2-01 migration guards on prerequisite P1-04 through P1-08/Gate A objects and does not edit earlier migration files", () => {
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.source_versions is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.sources is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.intake_source_candidates is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.intake_promotion_decisions is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.intake_sensitivity_profiles is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.data_dictionaries is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.data_dictionary_fields is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.review_queue_items is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.upload_lifecycle_audit is required/);
  assert.match(migrationSource, /source_versions_p1_08_id_org_unique/);
  assert.doesNotMatch(p108MigrationSource, /kai\.source_locators\b|kai\.evidence_items\b/);
  assert.doesNotMatch(p106MigrationSource, /kai\.source_locators\b|kai\.evidence_items\b/);
});

test("P2-01 creates kai.source_locators and kai.evidence_items with their full column lists", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.source_locators/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.evidence_items/);
  for (const column of [
    "source_locator_id",
    "organization_id",
    "source_version_id",
    "locator_type",
    "coordinates",
    "locator_fingerprint",
    "created_by_type",
    "created_at",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected source_locators column ${column}`);
  }
  for (const column of [
    "evidence_item_id",
    "source_id",
    "source_locator_id",
    "evidence_type",
    "data_class",
    "sensitivity_level",
    "support_strength",
    "statement",
    "statement_fingerprint",
    "evidence_review_status",
    "internal_only",
    "public_use_allowed",
    "funder_use_allowed",
    "llm_processing_allowed",
    "product_learning_allowed",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected evidence_items column ${column}`);
  }
});

test("P2-01C correction: source_id and source_locator_id are NOT NULL - no unlocated evidence item is permitted", () => {
  assert.match(migrationSource, /source_id uuid NOT NULL,\s*\n\s*source_version_id uuid NOT NULL,\s*\n\s*source_locator_id uuid NOT NULL,/);
});

test("P2-01 pins locator_type to the single 'column' value only", () => {
  assert.match(migrationSource, /source_locators_p2_01_locator_type_check\s+CHECK \(locator_type = 'column'\)/);
  for (const forbidden of ["'record_id'", "'redacted_extract'", "'sheet'", "'row'", "'paragraph'", "'section'", "'page'", "'cell_range'"]) {
    assert.doesNotMatch(migrationSource, new RegExp(forbidden));
  }
});

test("P2-01 enforces the coordinates shape as exactly one string column_name key", () => {
  assert.match(migrationSource, /source_locators_p2_01_coordinates_check/);
  assert.match(migrationSource, /coordinates \? 'column_name'/);
  assert.match(migrationSource, /coordinates - ARRAY\['column_name'\] = '\{\}'::jsonb/);
});

test("P2-01C correction: evidence_type is pinned to the single dictionary_field_presence_fact value - the unlocated dictionary_field_count_fact aggregate type is removed, with no locator-binding CHECK needed since source_locator_id is now unconditionally NOT NULL", () => {
  assert.match(
    migrationSource,
    /evidence_items_p2_01_evidence_type_check\s+CHECK \(evidence_type = 'dictionary_field_presence_fact'\)/,
  );
  assert.doesNotMatch(migrationSource, /CHECK \([^)]*dictionary_field_count_fact/);
  assert.doesNotMatch(migrationSource, /evidence_items_p2_01_locator_binding_check/);
});

test("P2-01C correction: sensitivity_level and support_strength are pinned to their fail-closed values", () => {
  assert.match(migrationSource, /evidence_items_p2_01_sensitivity_level_check\s+CHECK \(sensitivity_level = 'unknown'\)/);
  assert.match(migrationSource, /evidence_items_p2_01_support_strength_check\s+CHECK \(support_strength = 'unassessed'\)/);
});

test("P2-01 pins data_class and every governance/allowed-use boolean to their fail-closed values", () => {
  assert.match(migrationSource, /evidence_items_p2_01_data_class_check\s+CHECK \(data_class = 'organization_committed_metadata'\)/);
  assert.match(migrationSource, /evidence_items_p2_01_review_status_check\s+CHECK \(evidence_review_status = 'needs_gk_review'\)/);
  assert.match(migrationSource, /evidence_items_p2_01_internal_only_check\s+CHECK \(internal_only = true\)/);
  assert.match(migrationSource, /evidence_items_p2_01_public_use_check\s+CHECK \(public_use_allowed = false\)/);
  assert.match(migrationSource, /evidence_items_p2_01_funder_use_check\s+CHECK \(funder_use_allowed = false\)/);
  assert.match(migrationSource, /evidence_items_p2_01_llm_processing_check\s+CHECK \(llm_processing_allowed = false\)/);
  assert.match(migrationSource, /evidence_items_p2_01_product_learning_check\s+CHECK \(product_learning_allowed = false\)/);
});

test("P2-01C correction: organization_id + source_id + source_version_id is enforced as one tenant-safe composite foreign key, not independent single-purpose foreign keys", () => {
  assert.match(
    migrationSource,
    /evidence_items_p2_01_source_version_fk\s+FOREIGN KEY \(source_version_id, source_id, organization_id\)\s+REFERENCES kai\.source_versions \(source_version_id, source_id, organization_id\)/,
  );
  assert.match(
    migrationSource,
    /ALTER TABLE kai\.source_versions\s+DROP CONSTRAINT IF EXISTS source_versions_p2_01_id_source_org_unique,\s+ADD CONSTRAINT source_versions_p2_01_id_source_org_unique\s+UNIQUE \(source_version_id, source_id, organization_id\);/,
  );
});

test("P2-01C correction: an evidence_review queue item's required_action must be present and non-blank, mirroring the P1-06 sensitivity_review precedent for that queue_type only", () => {
  assert.match(
    migrationSource,
    /ALTER TABLE kai\.review_queue_items\s+DROP CONSTRAINT IF EXISTS review_queue_items_p2_01_evidence_review_required_action_check,\s+ADD CONSTRAINT review_queue_items_p2_01_evidence_review_required_action_check\s+CHECK \(\s+queue_type <> 'evidence_review'\s+OR \(\s+required_action IS NOT NULL\s+AND length\(btrim\(required_action\)\) BETWEEN 1 AND 2000\s+\)\s+\);/,
  );
});

test("P2-01 enforces sha256 hex fingerprint shapes and the statement safe-content exclusion", () => {
  assert.match(migrationSource, /source_locators_p2_01_fingerprint_check\s+CHECK \(locator_fingerprint ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  assert.match(migrationSource, /evidence_items_p2_01_statement_fingerprint_check\s+CHECK \(statement_fingerprint ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  assert.match(migrationSource, /evidence_items_p2_01_statement_check/);
  assert.match(migrationSource, /length\(statement\) BETWEEN 1 AND 500/);
  assert.match(migrationSource, /statement !~\* '\(https\?:\/\//);
});

test("P2-01 uses tenant-safe composite foreign keys for both source_locators and evidence_items; evidence_items' own lineage foreign key is the three-column organization_id/source_id/source_version_id tuple", () => {
  assert.match(
    migrationSource,
    /source_locators_p2_01_source_version_fk\s+FOREIGN KEY \(source_version_id, organization_id\)\s+REFERENCES kai\.source_versions \(source_version_id, organization_id\)/,
  );
  assert.match(
    migrationSource,
    /evidence_items_p2_01_source_version_fk\s+FOREIGN KEY \(source_version_id, source_id, organization_id\)\s+REFERENCES kai\.source_versions \(source_version_id, source_id, organization_id\)/,
  );
  assert.match(
    migrationSource,
    /evidence_items_p2_01_source_locator_fk\s+FOREIGN KEY \(source_locator_id, organization_id\)\s+REFERENCES kai\.source_locators \(source_locator_id, organization_id\)/,
  );
});

test("P2-01 idempotency identity is organization_id + source_version_id + fingerprint for both tables", () => {
  assert.match(
    migrationSource,
    /source_locators_p2_01_identity_unique\s+UNIQUE \(organization_id, source_version_id, locator_fingerprint\)/,
  );
  assert.match(
    migrationSource,
    /evidence_items_p2_01_identity_unique\s+UNIQUE \(organization_id, source_version_id, statement_fingerprint\)/,
  );
});

test("P2-01 adds a partial unique index on kai.review_queue_items for queue_type = 'evidence_review' only, never editing the accepted P1-06 migration file", () => {
  assert.match(
    migrationSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS ux_review_queue_items_p2_01_evidence_review_identity\s+ON kai\.review_queue_items \(organization_id, queue_type, target_object_type, target_object_id\)\s+WHERE queue_type = 'evidence_review'/,
  );
  assert.doesNotMatch(p106MigrationSource, /ux_review_queue_items_p2_01_evidence_review_identity/);
  assert.doesNotMatch(migrationSource, /review_queue_items_p1_06_sensrev_required_action_check/);
});

test("P2-01 migration extends only the P2-01 audit operation and metadata branch, preserving all earlier branches", () => {
  assert.match(migrationSource, /evidence_lineage_extracted/);
  for (const earlier of [
    "policy_decision_compare_and_set", "parser_run_recorded", "file_profile_persisted",
    "data_dictionary_draft_persisted", "intake_sensitivity_profile_persisted",
    "sensitivity_review_queue_item_created", "intake_source_candidate_persisted",
    "source_promotion_decision_persisted",
  ]) {
    assert.match(migrationSource, new RegExp(`operation <> '${earlier}'`));
  }
});

test("P2-01 audit metadata branch requires exactly the ten allowlisted keys and forbids raw statement content", () => {
  const branchMatch = migrationSource.match(
    /operation <> 'evidence_lineage_extracted'\s+OR \(([\s\S]*?)\)\s*\)\s*\)\s*;/,
  );
  assert.ok(branchMatch, "expected to find the evidence_lineage_extracted metadata branch");
  const branch = branchMatch[1];
  for (const key of [
    "metadata_only", "contract", "source_version_id", "intake_sensitivity_profile_id",
    "profile_canonical_sha256", "evidence_item_count", "source_locator_count",
    "review_queue_item_count", "fresh_write_count", "validator_key",
  ]) {
    assert.match(branch, new RegExp(`metadata \\? '${key}'`));
  }
  assert.match(branch, /NOT metadata \? 'statement'/);
  assert.match(branch, /NOT metadata \? 'statement_fingerprint'/);
  assert.match(branch, /metadata - ARRAY\[/);
});

test("P2-01 rollback removes only P2-01 objects and restores the exact prior audit constraint", () => {
  assert.match(rollbackSource, /DELETE FROM kai\.upload_lifecycle_audit\s+WHERE operation = 'evidence_lineage_extracted'/);
  assert.doesNotMatch(rollbackSource, /CHECK \(operation IN \([^)]*evidence_lineage_extracted/);
  assert.match(rollbackSource, /source_promotion_decision_persisted/);
  assert.match(rollbackSource, /DROP INDEX IF EXISTS kai\.ux_review_queue_items_p2_01_evidence_review_identity/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.evidence_items/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.source_locators/);
  assert.doesNotMatch(
    rollbackSource,
    /DROP TABLE IF EXISTS kai\.(?:intake_files|intake_parser_runs|intake_file_profiles|data_dictionaries|data_dictionary_fields|data_dictionary_mappings|data_quality_findings|upload_lifecycle_audit|intake_sensitivity_profiles|review_queue_items|intake_source_candidates|intake_promotion_decisions|sources|source_versions)\b/,
  );
});
