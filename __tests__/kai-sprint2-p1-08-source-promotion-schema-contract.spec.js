import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_p1_08_source_promotion.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_p1_08_source_promotion.rollback.sql", "utf8");
const verifierSource = readFileSync("scripts/kai-sprint2-p1-08-source-promotion-verifier.sql", "utf8");
const p107MigrationSource = readFileSync("migrations/kai_sprint2_p1_07_intake_source_candidate.sql", "utf8");
const p106MigrationSource = readFileSync("migrations/kai_sprint2_p1_06_review_queue.sql", "utf8");

test("P1-08 migration guards on prerequisite P1-07/P1-06/Gate A objects and does not edit earlier migration files", () => {
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.intake_source_candidates is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.review_queue_items is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.upload_lifecycle_audit is required/);
  assert.match(migrationSource, /intake_source_candidates_p1_07_identity_unique/);
  assert.match(migrationSource, /review_queue_items_p1_06_queue_status_check/);
  // The accepted P1-06/P1-07 migration files themselves are never touched by this
  // test suite reading them - this asserts the *shipped* files still contain no
  // P1-08 marker, proving P1-08 was added as its own migration.
  assert.doesNotMatch(p107MigrationSource, /intake_promotion_decisions|kai\.sources\b|kai\.source_versions\b/);
  assert.doesNotMatch(p106MigrationSource, /intake_promotion_decisions|kai\.sources\b|kai\.source_versions\b/);
});

test("P1-08 creates the three canonical tables with their full column lists", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.intake_promotion_decisions/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.sources/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.source_versions/);
  for (const column of [
    "intake_promotion_decision_id",
    "intake_source_candidate_id",
    "review_queue_item_id",
    "reviewed_source_type",
    "decision_status",
    "source_id",
    "source_version_id",
    "decided_at",
    "promoted_at",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected column ${column}`);
  }
  for (const column of ["source_code", "is_current"]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected column ${column}`);
  }
});

test("P1-08 adds no raw-content, sample-value, storage-pointer, or unrestricted free-text column", () => {
  for (const forbidden of [
    "raw_content", "sample_values", "safe_description", "permission_restrictions", "storage_location",
  ]) {
    assert.doesNotMatch(migrationSource, new RegExp(`\\b${forbidden}\\b`));
  }
  // storage_uri/signed_url are intentionally referenced in the migration's own
  // NOT metadata ? 'storage_uri' / NOT metadata ? 'signed_url' forbidden-key
  // checks, so they are asserted absent as *columns* instead, not as substrings.
  for (const forbiddenColumn of ["storage_uri", "signed_url"]) {
    assert.doesNotMatch(migrationSource, new RegExp(`\\b${forbiddenColumn} (?:text|uuid|jsonb|boolean|timestamptz)\\b`));
  }
});

test("P1-08 pins reviewed_source_type to a fixed, disclosed, non-'unknown' vocabulary on both kai.intake_promotion_decisions and kai.sources", () => {
  const vocabulary = ["organization_primary_record", "organization_secondary_record", "third_party_provided_record", "public_record"];
  for (const value of vocabulary) {
    assert.match(migrationSource, new RegExp(`'${value}'`));
  }
  assert.doesNotMatch(migrationSource, /reviewed_source_type IN \([^)]*'unknown'/);
});

test("P1-08 pins decision_status to 'needs_more_information'/'rejected'/'promoted' only and enforces the promoted-binding invariant", () => {
  assert.match(
    migrationSource,
    /intake_promotion_decisions_p1_08_decision_status_check\s+CHECK \(decision_status IN \('needs_more_information', 'rejected', 'promoted'\)\)/,
  );
  assert.match(migrationSource, /intake_promotion_decisions_p1_08_promoted_binding_check/);
  assert.match(migrationSource, /decision_status IN \('needs_more_information', 'rejected'\)[\s\S]*?AND reviewed_source_type IS NULL AND source_id IS NULL AND source_version_id IS NULL/);
  assert.match(migrationSource, /decision_status = 'promoted'[\s\S]*?AND reviewed_source_type IS NOT NULL AND source_id IS NOT NULL AND source_version_id IS NOT NULL/);
  assert.doesNotMatch(migrationSource, /decision_status IN \('decided', 'promoted'\)/);
});

test("P1-08 widens kai.intake_source_candidates.candidate_status to accept 'promoted' and 'rejected' without adding any other value", () => {
  assert.match(
    migrationSource,
    /intake_source_candidates_p1_07_candidate_status_check\s+CHECK \(candidate_status IN \('needs_gk_review', 'promoted', 'rejected'\)\)/,
  );
  for (const forbidden of ["'approved'", "'finalized'", "'export_ready'"]) {
    assert.doesNotMatch(migrationSource, new RegExp(forbidden));
  }
});

test("P1-08 uses tenant-safe composite lineage foreign keys for both the candidate/review-item link and the source_versions candidate-lineage link", () => {
  assert.match(
    migrationSource,
    /intake_promotion_decisions_p1_08_candidate_fk\s+FOREIGN KEY \(intake_source_candidate_id, organization_id\)\s+REFERENCES kai\.intake_source_candidates \(intake_source_candidate_id, organization_id\)/,
  );
  assert.match(
    migrationSource,
    /intake_promotion_decisions_p1_08_review_queue_item_fk\s+FOREIGN KEY \(review_queue_item_id, organization_id\)\s+REFERENCES kai\.review_queue_items \(review_queue_item_id, organization_id\)/,
  );
  assert.match(
    migrationSource,
    /source_versions_p1_08_candidate_lineage_fk\s+FOREIGN KEY \(intake_source_candidate_id, organization_id, intake_sensitivity_profile_id, profile_canonical_sha256\)/,
  );
  assert.match(
    migrationSource,
    /source_versions_p1_08_source_fk\s+FOREIGN KEY \(source_id, organization_id\)\s+REFERENCES kai\.sources \(source_id, organization_id\)/,
  );
});

test("P1-08 adds its new unique constraints through its own migration only, never editing the accepted P1-06/P1-07 migration files", () => {
  assert.match(migrationSource, /intake_source_candidates_p1_08_identity_unique\s+UNIQUE \(intake_source_candidate_id, organization_id\)/);
  assert.match(migrationSource, /intake_source_candidates_p1_08_promotion_lineage_unique/);
  assert.match(migrationSource, /review_queue_items_p1_08_identity_unique\s+UNIQUE \(review_queue_item_id, organization_id\)/);
  assert.doesNotMatch(p107MigrationSource, /intake_source_candidates_p1_08_identity_unique|intake_source_candidates_p1_08_promotion_lineage_unique/);
  assert.doesNotMatch(p106MigrationSource, /review_queue_items_p1_08_identity_unique/);
});

test("P1-08 idempotency identity is organization_id + intake_source_candidate_id for the promotion decision, and organization_id + intake_source_candidate_id for the source_version", () => {
  assert.match(migrationSource, /intake_promotion_decisions_p1_08_identity_unique\s+UNIQUE \(organization_id, intake_source_candidate_id\)/);
  assert.match(migrationSource, /source_versions_p1_08_candidate_identity_unique\s+UNIQUE \(organization_id, intake_source_candidate_id\)/);
});

test("P1-08 enforces source_code as a sha256 hex digest and enforces at most one current source_version per source", () => {
  assert.match(migrationSource, /sources_p1_08_source_code_check\s+CHECK \(source_code ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  assert.match(
    migrationSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS ux_source_versions_p1_08_current_per_source\s+ON kai\.source_versions \(source_id\)\s+WHERE is_current = true/,
  );
});

test("P1-08 migration extends only the P1-08 audit operation and metadata branch, preserving all earlier branches", () => {
  assert.match(migrationSource, /source_promotion_decision_persisted/);
  for (const earlier of [
    "policy_decision_compare_and_set", "parser_run_recorded", "file_profile_persisted",
    "data_dictionary_draft_persisted", "intake_sensitivity_profile_persisted",
    "sensitivity_review_queue_item_created", "intake_source_candidate_persisted",
  ]) {
    assert.match(migrationSource, new RegExp(`operation <> '${earlier}'`));
  }
});

test("P1-08 audit metadata branch requires exactly the twelve allowlisted keys, forbids storage pointers, and no raw content", () => {
  const branchMatch = migrationSource.match(
    /operation <> 'source_promotion_decision_persisted'\s+OR \(([\s\S]*?)\)\s*\)\s*\)\s*;/,
  );
  assert.ok(branchMatch, "expected to find the source_promotion_decision_persisted metadata branch");
  const branch = branchMatch[1];
  for (const key of [
    "metadata_only", "contract", "intake_source_candidate_id", "intake_sensitivity_profile_id",
    "profile_canonical_sha256", "reviewed_source_type", "decision_status", "candidate_status",
    "queue_status", "source_id", "source_version_id", "validator_key",
  ]) {
    assert.match(branch, new RegExp(`metadata \\? '${key}'`));
  }
  assert.match(branch, /NOT metadata \? 'storage_uri'/);
  assert.match(branch, /NOT metadata \? 'signed_url'/);
  assert.match(branch, /metadata - ARRAY\[/);
});

test("P1-08 catalog verifier totality: every check embeds its PASS/FAIL in the CASE, with no outer WHERE EXISTS filter", () => {
  assert.doesNotMatch(verifierSource, /\]\)\s*AS \w+\s*\n\s*WHERE EXISTS/);
  assert.match(verifierSource, /AUDIT_METADATA_BRANCH/);
  assert.match(verifierSource, /REVIEWED_SOURCE_TYPE_NEVER_UNKNOWN/);
  assert.match(verifierSource, /CANDIDATE_STATUS_WIDENED/);
});

test("P1-08 rollback removes only P1-08 objects and restores the exact prior audit constraints and candidate_status shape", () => {
  assert.match(rollbackSource, /DELETE FROM kai\.upload_lifecycle_audit\s+WHERE operation = 'source_promotion_decision_persisted'/);
  assert.doesNotMatch(rollbackSource, /CHECK \(operation IN \([^)]*source_promotion_decision_persisted/);
  assert.match(rollbackSource, /intake_source_candidate_persisted/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.intake_promotion_decisions/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.sources/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.source_versions/);
  assert.match(
    rollbackSource,
    /ADD CONSTRAINT intake_source_candidates_p1_07_candidate_status_check\s+CHECK \(candidate_status = 'needs_gk_review'\)/,
  );
  assert.doesNotMatch(
    rollbackSource,
    /DROP TABLE IF EXISTS kai\.(?:intake_files|intake_parser_runs|intake_file_profiles|data_dictionaries|data_dictionary_fields|data_dictionary_mappings|data_quality_findings|upload_lifecycle_audit|intake_sensitivity_profiles|review_queue_items|intake_source_candidates)\b/,
  );
});
