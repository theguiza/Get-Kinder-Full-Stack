import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_p1_06_review_queue.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_p1_06_review_queue.rollback.sql", "utf8");
const verifierSource = readFileSync("scripts/kai-sprint2-p1-06-review-queue-verifier.sql", "utf8");

test("P1-06 migration guards on prerequisite P1-05/Gate A objects and does not modify earlier migrations", () => {
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.intake_sensitivity_profiles is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.upload_lifecycle_audit is required/);
  assert.match(migrationSource, /gate_a_p0_jsonb_metadata_only/);
  assert.match(migrationSource, /intake_sensitivity_profiles_p1_05_identity_unique/);
  assert.doesNotMatch(
    migrationSource,
    /DROP TABLE IF EXISTS kai\.(intake_files|intake_parser_runs|intake_file_profiles|data_dictionaries|data_dictionary_fields|data_dictionary_mappings|data_quality_findings|upload_lifecycle_audit|intake_sensitivity_profiles)/,
  );
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.intake_sensitivity_profiles/);
});

test("P1-06 creates the canonical kai.review_queue_items table with every column already assumed by kaiIntakeQueries.js/kaiReviewQueueService.js", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.review_queue_items/);
  for (const column of [
    "review_queue_item_id",
    "organization_id",
    "engagement_id",
    "queue_type",
    "target_object_type",
    "target_object_id",
    "priority",
    "queue_status",
    "review_status",
    "blocked_reason",
    "assigned_to",
    "due_at",
    "summary",
    "required_action",
    "queue_metadata",
    "created_by",
    "created_by_type",
    "created_at",
    "updated_at",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected column ${column}`);
  }
});

test("P1-06 queue_type and queue_status CHECK vocabularies match scripts/kai-sprint2-ddl-vocabulary-status-check.sql exactly", () => {
  const ddlVocabularySource = readFileSync("scripts/kai-sprint2-ddl-vocabulary-status-check.sql", "utf8");
  const queueTypeValues = [...ddlVocabularySource.matchAll(/'check','kai','review_queue_items','queue_type',NULL,'([a-z_]+)'/g)].map(
    (match) => match[1],
  );
  const queueStatusValues = [...ddlVocabularySource.matchAll(/'check','kai','review_queue_items','queue_status',NULL,'([a-z_]+)'/g)].map(
    (match) => match[1],
  );
  assert.ok(queueTypeValues.length > 0 && queueStatusValues.length > 0);
  for (const value of queueTypeValues) {
    assert.match(migrationSource, new RegExp(`review_queue_items_p1_06_queue_type_check[\\s\\S]*?'${value}'`));
  }
  for (const value of queueStatusValues) {
    assert.match(migrationSource, new RegExp(`review_queue_items_p1_06_queue_status_check[\\s\\S]*?'${value}'`));
  }
});

test("P1-06 scopes the sensitivity_review idempotency identity to a partial unique index, not a table-wide constraint", () => {
  assert.match(
    migrationSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS ux_review_queue_items_p1_06_sensitivity_review_identity\s+ON kai\.review_queue_items \(organization_id, queue_type, target_object_type, target_object_id\)\s+WHERE queue_type = 'sensitivity_review'/,
  );
});

test("P1-06 adds no table-wide foreign key on the shared target_object_id column", () => {
  assert.doesNotMatch(migrationSource, /FOREIGN KEY \(target_object_id\)/);
  assert.doesNotMatch(migrationSource, /FOREIGN KEY \(organization_id, target_object_id\)/);
});

test("P1-06 bounds summary/required_action/blocked_reason and enforces non-empty summary", () => {
  assert.match(migrationSource, /review_queue_items_p1_06_summary_check\s+CHECK \(length\(summary\) BETWEEN 1 AND 2000\)/);
  assert.match(
    migrationSource,
    /review_queue_items_p1_06_required_action_check\s+CHECK \(required_action IS NULL OR length\(required_action\) BETWEEN 1 AND 2000\)/,
  );
});

test("P1-06 migration extends only the P1-06 audit operation and metadata branch, preserving all earlier branches", () => {
  assert.match(migrationSource, /sensitivity_review_queue_item_created/);
  assert.match(migrationSource, /operation <> 'policy_decision_compare_and_set'/);
  assert.match(migrationSource, /operation <> 'parser_run_recorded'/);
  assert.match(migrationSource, /operation <> 'file_profile_persisted'/);
  assert.match(migrationSource, /operation <> 'data_dictionary_draft_persisted'/);
  assert.match(migrationSource, /operation <> 'intake_sensitivity_profile_persisted'/);
  assert.match(migrationSource, /operation <> 'sensitivity_review_queue_item_created'/);
});

test("P1-06 audit metadata branch requires exactly the seven allowlisted keys, including the owner-authorized metadata_only key", () => {
  const branchMatch = migrationSource.match(
    /operation <> 'sensitivity_review_queue_item_created'\s+OR \(([\s\S]*?)\)\s*\)\s*\)\s*;/,
  );
  assert.ok(branchMatch, "expected to find the sensitivity_review_queue_item_created metadata branch");
  const branch = branchMatch[1];
  for (const key of ["metadata_only", "contract", "queue_type", "target_object_type", "target_object_id", "queue_status", "validator_key"]) {
    assert.match(branch, new RegExp(`metadata \\? '${key}'`));
  }
  assert.match(branch, /metadata - ARRAY\[/);
});

test("P1-06 enforces a required, non-blank required_action for sensitivity_review rows only", () => {
  assert.match(
    migrationSource,
    /review_queue_items_p1_06_sensrev_required_action_check\s+CHECK \(\s*queue_type <> 'sensitivity_review'\s+OR \(\s*required_action IS NOT NULL\s+AND length\(btrim\(required_action\)\) BETWEEN 1 AND 2000\s*\)\s*\)/,
  );
});

test("P1-06 catalog verifier totality: every check embeds its PASS/FAIL in the CASE, with no outer WHERE EXISTS filter", () => {
  assert.doesNotMatch(verifierSource, /\]\)\s*AS \w+\s*\n\s*WHERE EXISTS/);
  assert.match(verifierSource, /AUDIT_METADATA_BRANCH/);
  assert.match(verifierSource, /NO_POLYMORPHIC_FK/);
});

test("P1-06 rollback removes only P1-06 objects and restores the exact prior audit constraints", () => {
  assert.match(rollbackSource, /DELETE FROM kai\.upload_lifecycle_audit\s+WHERE operation = 'sensitivity_review_queue_item_created'/);
  assert.doesNotMatch(rollbackSource, /CHECK \(operation IN \([^)]*sensitivity_review_queue_item_created/);
  assert.match(rollbackSource, /intake_sensitivity_profile_persisted/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.review_queue_items/);
  assert.doesNotMatch(
    rollbackSource,
    /DROP TABLE IF EXISTS kai\.(?:intake_files|intake_parser_runs|intake_file_profiles|data_dictionaries|data_dictionary_fields|data_dictionary_mappings|data_quality_findings|upload_lifecycle_audit|intake_sensitivity_profiles)\b/,
  );
  assert.doesNotMatch(rollbackSource, /ALTER TABLE.*kai\.intake_sensitivity_profiles\b/);
});
