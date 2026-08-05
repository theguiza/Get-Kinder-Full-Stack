import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_p1_07_intake_source_candidate.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_p1_07_intake_source_candidate.rollback.sql", "utf8");
const verifierSource = readFileSync("scripts/kai-sprint2-p1-07-source-candidate-verifier.sql", "utf8");
const p106MigrationSource = readFileSync("migrations/kai_sprint2_p1_06_review_queue.sql", "utf8");
const p105MigrationSource = readFileSync("migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql", "utf8");

test("P1-07 migration guards on prerequisite P1-05/P1-06/Gate A objects and does not edit earlier migration files", () => {
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.intake_sensitivity_profiles is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.review_queue_items is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.upload_lifecycle_audit is required/);
  assert.match(migrationSource, /intake_sensitivity_profiles_p1_05_identity_unique/);
  assert.match(migrationSource, /review_queue_items_p1_06_queue_type_check/);
  // The accepted P1-05 and P1-06 migration files themselves are never touched by
  // this test suite reading them - this asserts the *shipped* P1-05/P1-06 files
  // still contain no P1-07 marker, proving P1-07 was added as its own migration.
  assert.doesNotMatch(p105MigrationSource, /intake_source_candidate/);
  assert.doesNotMatch(p106MigrationSource, /intake_source_candidate/);
});

test("P1-07 creates the canonical kai.intake_source_candidates table with its full column list", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.intake_source_candidates/);
  for (const column of [
    "intake_source_candidate_id",
    "organization_id",
    "intake_file_id",
    "file_profile_id",
    "data_dictionary_id",
    "intake_sensitivity_profile_id",
    "profile_canonical_sha256",
    "proposed_source_type",
    "candidate_status",
    "created_by",
    "created_by_type",
    "created_at",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected column ${column}`);
  }
});

test("P1-07 adds no raw-content, sample-value, or unrestricted free-text column", () => {
  for (const forbidden of ["raw_content", "sample_values", "safe_description", "permission_restrictions", "filename", "storage_location"]) {
    assert.doesNotMatch(migrationSource, new RegExp(`\\b${forbidden}\\b`));
  }
});

test("P1-07 pins proposed_source_type to 'unknown' only, never fabricating a classification", () => {
  assert.match(
    migrationSource,
    /intake_source_candidates_p1_07_proposed_source_type_check\s+CHECK \(proposed_source_type = 'unknown'\)/,
  );
});

test("P1-07 pins candidate_status to 'needs_gk_review' only: no promoted/approved/finalized/export-ready state exists", () => {
  assert.match(
    migrationSource,
    /intake_source_candidates_p1_07_candidate_status_check\s+CHECK \(candidate_status = 'needs_gk_review'\)/,
  );
  for (const forbidden of ["'promoted'", "'approved'", "'finalized'", "'export_ready'"]) {
    assert.doesNotMatch(migrationSource, new RegExp(forbidden));
  }
});

test("P1-07 uses composite tenant-safe lineage foreign keys, chaining file -> profile -> dictionary -> sensitivity profile", () => {
  assert.match(
    migrationSource,
    /intake_source_candidates_p1_07_file_fk\s+FOREIGN KEY \(organization_id, intake_file_id\)\s+REFERENCES kai\.intake_files \(organization_id, intake_file_id\)/,
  );
  assert.match(
    migrationSource,
    /intake_source_candidates_p1_07_profile_lineage_fk\s+FOREIGN KEY \(file_profile_id, organization_id, intake_file_id, profile_canonical_sha256\)/,
  );
  assert.match(
    migrationSource,
    /intake_source_candidates_p1_07_dictionary_lineage_fk\s+FOREIGN KEY \(data_dictionary_id, organization_id, intake_file_id, file_profile_id\)/,
  );
  assert.match(
    migrationSource,
    /intake_source_candidates_p1_07_sensitivity_lineage_fk\s+FOREIGN KEY \(intake_sensitivity_profile_id, organization_id, file_profile_id, data_dictionary_id\)/,
  );
});

test("P1-07 adds a new sensitivity-profile candidate-lineage unique constraint through its own migration, not by editing P1-05's file", () => {
  assert.match(
    migrationSource,
    /ALTER TABLE kai\.intake_sensitivity_profiles\s+ADD CONSTRAINT intake_sensitivity_profiles_p1_07_candidate_lineage_unique\s+UNIQUE \(intake_sensitivity_profile_id, organization_id, file_profile_id, data_dictionary_id\)/,
  );
  assert.doesNotMatch(p105MigrationSource, /intake_sensitivity_profiles_p1_07_candidate_lineage_unique/);
});

test("P1-07 idempotency identity is organization_id + intake_sensitivity_profile_id", () => {
  assert.match(
    migrationSource,
    /intake_source_candidates_p1_07_identity_unique\s+UNIQUE \(organization_id, intake_sensitivity_profile_id\)/,
  );
});

test("P1-07 scopes the source_candidate_review idempotency identity to a partial unique index, not a table-wide constraint, and does not edit the accepted P1-06 migration", () => {
  assert.match(
    migrationSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS ux_review_queue_items_p1_07_source_candidate_review_identity\s+ON kai\.review_queue_items \(organization_id, queue_type, target_object_type, target_object_id\)\s+WHERE queue_type = 'source_candidate_review'/,
  );
  assert.doesNotMatch(p106MigrationSource, /ux_review_queue_items_p1_07_source_candidate_review_identity/);
});

test("P1-07 migration extends only the P1-07 audit operation and metadata branch, preserving all earlier branches", () => {
  assert.match(migrationSource, /intake_source_candidate_persisted/);
  assert.match(migrationSource, /operation <> 'policy_decision_compare_and_set'/);
  assert.match(migrationSource, /operation <> 'parser_run_recorded'/);
  assert.match(migrationSource, /operation <> 'file_profile_persisted'/);
  assert.match(migrationSource, /operation <> 'data_dictionary_draft_persisted'/);
  assert.match(migrationSource, /operation <> 'intake_sensitivity_profile_persisted'/);
  assert.match(migrationSource, /operation <> 'sensitivity_review_queue_item_created'/);
  assert.match(migrationSource, /operation <> 'intake_source_candidate_persisted'/);
});

test("P1-07 audit metadata branch requires exactly the eleven allowlisted keys and no raw content", () => {
  const branchMatch = migrationSource.match(
    /operation <> 'intake_source_candidate_persisted'\s+OR \(([\s\S]*?)\)\s*\)\s*\)\s*;/,
  );
  assert.ok(branchMatch, "expected to find the intake_source_candidate_persisted metadata branch");
  const branch = branchMatch[1];
  for (const key of [
    "metadata_only",
    "contract",
    "intake_sensitivity_profile_id",
    "profile_canonical_sha256",
    "proposed_source_type",
    "candidate_status",
    "queue_type",
    "target_object_type",
    "target_object_id",
    "queue_status",
    "validator_key",
  ]) {
    assert.match(branch, new RegExp(`metadata \\? '${key}'`));
  }
  assert.match(branch, /metadata - ARRAY\[/);
});

test("P1-07 catalog verifier totality: every check embeds its PASS/FAIL in the CASE, with no outer WHERE EXISTS filter", () => {
  assert.doesNotMatch(verifierSource, /\]\)\s*AS \w+\s*\n\s*WHERE EXISTS/);
  assert.match(verifierSource, /AUDIT_METADATA_BRANCH/);
  assert.match(verifierSource, /NO_TABLE_WIDE_FK_ON_SHARED_TARGET/);
  assert.match(verifierSource, /NO_PROMOTION_OR_SOURCE_OBJECTS/);
});

test("P1-07 rollback removes only P1-07 objects and restores the exact prior audit constraints and sensitivity-profile shape", () => {
  assert.match(rollbackSource, /DELETE FROM kai\.upload_lifecycle_audit\s+WHERE operation = 'intake_source_candidate_persisted'/);
  assert.doesNotMatch(rollbackSource, /CHECK \(operation IN \([^)]*intake_source_candidate_persisted/);
  assert.match(rollbackSource, /sensitivity_review_queue_item_created/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.intake_source_candidates/);
  assert.match(rollbackSource, /DROP CONSTRAINT IF EXISTS intake_sensitivity_profiles_p1_07_candidate_lineage_unique/);
  assert.doesNotMatch(
    rollbackSource,
    /DROP TABLE IF EXISTS kai\.(?:intake_files|intake_parser_runs|intake_file_profiles|data_dictionaries|data_dictionary_fields|data_dictionary_mappings|data_quality_findings|upload_lifecycle_audit|intake_sensitivity_profiles|review_queue_items)\b/,
  );
});

test("P1-07 does not create or reference kai.sources, kai.source_versions, or kai.intake_promotion_decisions", () => {
  for (const source of [migrationSource, rollbackSource]) {
    assert.doesNotMatch(source, /kai\.sources\b/);
    assert.doesNotMatch(source, /kai\.source_versions\b/);
    assert.doesNotMatch(source, /kai\.intake_promotion_decisions\b/);
  }
});
