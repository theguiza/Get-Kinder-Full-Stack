import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_p2_04_claim_gap_followup.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_p2_04_claim_gap_followup.rollback.sql", "utf8");
const p106MigrationSource = readFileSync("migrations/kai_sprint2_p1_06_review_queue.sql", "utf8");
const p203MigrationSource = readFileSync("migrations/kai_sprint2_p2_03_claim_proposal.sql", "utf8");

test("P2-04 migration guards on prerequisite P2-03/P2-01/P1-08/P1-06/Gate A objects and does not edit earlier migration files", () => {
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.claims is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.evidence_items is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.source_versions is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.review_queue_items is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.upload_lifecycle_audit is required/);
  assert.match(migrationSource, /claims_p2_03_id_org_unique/);
  assert.match(migrationSource, /evidence_items_p2_01_id_org_unique/);
  assert.match(migrationSource, /source_versions_p1_08_id_org_unique/);
  assert.doesNotMatch(p106MigrationSource, /kai\.gap_log_items\b|kai\.client_followup_items\b/);
  assert.doesNotMatch(p203MigrationSource, /kai\.gap_log_items\b|kai\.client_followup_items\b/);
});

test("P2-04 creates kai.gap_log_items and kai.client_followup_items with their full column lists", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.gap_log_items/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.client_followup_items/);
  for (const column of [
    "gap_log_item_id", "organization_id", "claim_id", "evidence_item_id", "source_version_id",
    "dimension_key", "assessment_status", "validator_key", "safe_summary",
    "open_finding_count", "field_count", "undefined_field_count", "uncovered_field_count",
    "created_by_type", "created_at",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected gap_log_items column ${column}`);
  }
  for (const column of [
    "client_followup_item_id", "organization_id", "claim_id", "gap_log_item_id",
    "dimension_key", "question_text", "created_by_type", "created_at",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected client_followup_items column ${column}`);
  }
});

test("P2-04 pins dimension_key to the exact ten P2-02 dimension keys", () => {
  const check = migrationSource.match(/gap_log_items_p2_04_dimension_key_check\s+CHECK \(dimension_key IN \(([\s\S]*?)\)\)/);
  assert.ok(check, "expected gap_log_items_p2_04_dimension_key_check");
  for (const key of [
    "missingness", "duplicates", "definition_clarity", "denominator_clarity", "time_period_clarity",
    "entity_level_clarity", "small_cell_risk", "conflicting_source_indicators", "requirement_alignment", "coverage_gaps",
  ]) {
    assert.match(check[1], new RegExp(`'${key}'`), key);
  }
});

test("P2-04 pins assessment_status to exclude resolved_clear (a resolved_clear dimension never produces a gap row)", () => {
  assert.match(migrationSource, /gap_log_items_p2_04_assessment_status_check\s+CHECK \(assessment_status IN \('resolved_risk_flagged', 'unresolved'\)\)/);
  assert.doesNotMatch(
    migrationSource.match(/gap_log_items_p2_04_assessment_status_check[\s\S]*?\);/)[0],
    /'resolved_clear'/,
  );
});

test("P2-04 pins safe_summary to the exact deterministic template", () => {
  assert.match(
    migrationSource,
    /gap_log_items_p2_04_safe_summary_check\s+CHECK \(safe_summary = 'Claim gap requires review for dimension: ' \|\| dimension_key \|\| '\.'\)/,
  );
});

test("P2-04 uses tenant-safe composite foreign keys from kai.gap_log_items to kai.claims/kai.evidence_items/kai.source_versions", () => {
  assert.match(
    migrationSource,
    /gap_log_items_p2_04_claim_fk\s+FOREIGN KEY \(claim_id, organization_id\)\s+REFERENCES kai\.claims \(claim_id, organization_id\)/,
  );
  assert.match(
    migrationSource,
    /gap_log_items_p2_04_evidence_item_fk\s+FOREIGN KEY \(evidence_item_id, organization_id\)\s+REFERENCES kai\.evidence_items \(evidence_item_id, organization_id\)/,
  );
  assert.match(
    migrationSource,
    /gap_log_items_p2_04_source_version_fk\s+FOREIGN KEY \(source_version_id, organization_id\)\s+REFERENCES kai\.source_versions \(source_version_id, organization_id\)/,
  );
});

test("P2-04 gap identity is organization_id + claim_id + dimension_key", () => {
  assert.match(migrationSource, /gap_log_items_p2_04_identity_unique\s+UNIQUE \(organization_id, claim_id, dimension_key\)/);
});

test("P2-04 client_followup_items identity is organization_id + claim_id + dimension_key, pinned to the four client-answerable dimensions, and pairs each dimension with its exact fixed question", () => {
  assert.match(migrationSource, /client_followup_items_p2_04_identity_unique\s+UNIQUE \(organization_id, claim_id, dimension_key\)/);
  assert.match(migrationSource, /client_followup_items_p2_04_one_per_gap_unique\s+UNIQUE \(organization_id, gap_log_item_id\)/);
  const dimensionCheck = migrationSource.match(/client_followup_items_p2_04_dimension_key_check\s+CHECK \(dimension_key IN \(([\s\S]*?)\)\)/);
  assert.ok(dimensionCheck);
  for (const key of ["definition_clarity", "denominator_clarity", "time_period_clarity", "entity_level_clarity"]) {
    assert.match(dimensionCheck[1], new RegExp(`'${key}'`));
  }
  for (const key of ["missingness", "duplicates", "small_cell_risk", "conflicting_source_indicators", "requirement_alignment", "coverage_gaps"]) {
    assert.doesNotMatch(dimensionCheck[1], new RegExp(`'${key}'`));
  }
  assert.match(migrationSource, /client_followup_items_p2_04_dimension_question_pairing_check/);
  assert.match(migrationSource, /'Confirm the business meaning of the unresolved field or measure\.'/);
  assert.match(migrationSource, /'Confirm the denominator and how it is calculated\.'/);
  assert.match(migrationSource, /'Confirm the reporting period represented by this source\.'/);
  assert.match(migrationSource, /'Confirm the entity level represented by the unresolved field or measure\.'/);
});

test("P2-04 adds a partial unique index on kai.review_queue_items for queue_type = 'client_followup' only, never editing the accepted P1-06 migration file", () => {
  assert.match(
    migrationSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS ux_review_queue_items_p2_04_client_followup_identity\s+ON kai\.review_queue_items \(organization_id, queue_type, target_object_type, target_object_id\)\s+WHERE queue_type = 'client_followup'/,
  );
  assert.doesNotMatch(p106MigrationSource, /ux_review_queue_items_p2_04_client_followup_identity/);
});

test("P2-04 does not widen the P1-06 queue_type vocabulary - client_followup is already accepted", () => {
  assert.match(p106MigrationSource, /'client_followup'/);
  assert.doesNotMatch(migrationSource, /review_queue_items_p1_06_queue_type_check/);
});

test("P2-04 enforces the complete fixed client_followup queue contract at the database level, scoped to that queue_type only", () => {
  const check = migrationSource.match(
    /review_queue_items_p2_04_client_followup_contract_check\s+CHECK \(([\s\S]*?)\n\s*\);/,
  );
  assert.ok(check, "expected review_queue_items_p2_04_client_followup_contract_check");
  const body = check[1];
  assert.match(body, /queue_type <> 'client_followup'/);
  assert.match(body, /target_object_type = 'client_followup_item'/);
  assert.match(body, /queue_status = 'waiting_on_client'/);
  assert.match(body, /review_status = 'proposed'/);
  assert.match(body, /priority = 'normal'/);
  assert.match(body, /summary = 'Client clarification is required for an unresolved claim gap\.'/);
  assert.match(body, /assigned_to IS NULL/);
  assert.match(body, /due_at IS NULL/);
});

test("P2-04 migration extends only the P2-04 audit operation and metadata branch, preserving all earlier branches including claim_proposed", () => {
  assert.match(migrationSource, /claim_gap_and_followup_generated/);
  for (const earlier of [
    "policy_decision_compare_and_set", "parser_run_recorded", "file_profile_persisted",
    "data_dictionary_draft_persisted", "intake_sensitivity_profile_persisted",
    "sensitivity_review_queue_item_created", "intake_source_candidate_persisted",
    "source_promotion_decision_persisted", "evidence_lineage_extracted", "claim_proposed",
  ]) {
    assert.match(migrationSource, new RegExp(`operation <> '${earlier}'`));
  }
});

test("P2-04 audit metadata branch requires the allowlisted keys and forbids question/summary content", () => {
  const branchMatch = migrationSource.match(
    /operation <> 'claim_gap_and_followup_generated'\s+OR \(([\s\S]*?)\)\s*\)\s*\)\s*;/,
  );
  assert.ok(branchMatch, "expected to find the claim_gap_and_followup_generated metadata branch");
  const branch = branchMatch[1];
  for (const key of [
    "metadata_only", "contract", "claim_id", "evidence_item_id", "source_version_id",
    "gap_dimension_keys", "client_followup_dimension_keys", "gap_count",
    "client_followup_count", "review_queue_item_count", "fresh_write_count", "validator_key",
  ]) {
    assert.match(branch, new RegExp(`metadata \\? '${key}'`));
  }
  assert.match(branch, /NOT metadata \? 'question_text'/);
  assert.match(branch, /NOT metadata \? 'summary'/);
  assert.match(branch, /NOT metadata \? 'safe_summary'/);
  assert.match(branch, /metadata - ARRAY\[/);
});

test("P2-04 rollback removes only P2-04 objects and restores the exact prior audit constraint", () => {
  assert.match(rollbackSource, /DELETE FROM kai\.upload_lifecycle_audit\s+WHERE operation = 'claim_gap_and_followup_generated'/);
  assert.doesNotMatch(rollbackSource, /CHECK \(operation IN \([^)]*claim_gap_and_followup_generated/);
  assert.match(rollbackSource, /claim_proposed/);
  assert.match(rollbackSource, /DROP INDEX IF EXISTS kai\.ux_review_queue_items_p2_04_client_followup_identity/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.client_followup_items/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.gap_log_items/);
  assert.doesNotMatch(
    rollbackSource,
    /DROP TABLE IF EXISTS kai\.(?:intake_files|intake_parser_runs|intake_file_profiles|data_dictionaries|data_dictionary_fields|data_dictionary_mappings|data_quality_findings|upload_lifecycle_audit|intake_sensitivity_profiles|review_queue_items|intake_source_candidates|intake_promotion_decisions|sources|source_versions|source_locators|evidence_items|claims|claim_evidence_links)\b/,
  );
});

test("P2-04 does not create conflict_groups, conflict_resolution queue items, operator_action_items, or an independent coverage-assessment table", () => {
  assert.doesNotMatch(migrationSource, /CREATE TABLE[\s\S]*?conflict_groups/i);
  assert.doesNotMatch(migrationSource, /CREATE TABLE[\s\S]*?operator_action_items/i);
  assert.doesNotMatch(migrationSource, /CREATE TABLE[\s\S]*?coverage_assessment/i);
  assert.doesNotMatch(migrationSource, /queue_type = 'conflict_resolution'/);
});
