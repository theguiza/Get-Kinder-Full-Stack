import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_p2_03_claim_proposal.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_p2_03_claim_proposal.rollback.sql", "utf8");
const p106MigrationSource = readFileSync("migrations/kai_sprint2_p1_06_review_queue.sql", "utf8");
const p201MigrationSource = readFileSync("migrations/kai_sprint2_p2_01_evidence_lineage.sql", "utf8");

test("P2-03 migration guards on prerequisite P2-01/P1-06/Gate A objects and does not edit earlier migration files", () => {
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.evidence_items is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.source_locators is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.intake_source_candidates is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.intake_promotion_decisions is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.review_queue_items is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.upload_lifecycle_audit is required/);
  assert.match(migrationSource, /evidence_items_p2_01_id_org_unique/);
  assert.doesNotMatch(p106MigrationSource, /kai\.claims\b|kai\.claim_evidence_links\b/);
  assert.doesNotMatch(p201MigrationSource, /kai\.claims\b|kai\.claim_evidence_links\b/);
});

test("P2-03 creates kai.claims and kai.claim_evidence_links with their full column lists", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.claims/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.claim_evidence_links/);
  for (const column of [
    "claim_id",
    "organization_id",
    "evidence_item_id",
    "claim_type",
    "claim_status",
    "claim_review_status",
    "claim_strength",
    "statement",
    "statement_fingerprint",
    "internal_only",
    "public_use_allowed",
    "funder_use_allowed",
    "llm_processing_allowed",
    "product_learning_allowed",
    "export_ready",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected claims column ${column}`);
  }
  for (const column of ["claim_evidence_link_id", "organization_id", "claim_id", "evidence_item_id"]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected claim_evidence_links column ${column}`);
  }
});

test("P2-03 pins claim_type, claim_status, claim_review_status, and claim_strength to their single fail-closed values", () => {
  assert.match(migrationSource, /claims_p2_03_claim_type_check\s+CHECK \(claim_type = 'finding'\)/);
  assert.match(migrationSource, /claims_p2_03_claim_status_check\s+CHECK \(claim_status = 'proposed'\)/);
  assert.match(migrationSource, /claims_p2_03_claim_review_status_check\s+CHECK \(claim_review_status = 'needs_gk_review'\)/);
  assert.match(migrationSource, /claims_p2_03_claim_strength_check\s+CHECK \(claim_strength = 'unassessed'\)/);
});

test("P2-03 pins every audience-gate boolean, including export_ready, to its fail-closed value", () => {
  assert.match(migrationSource, /claims_p2_03_internal_only_check\s+CHECK \(internal_only = true\)/);
  assert.match(migrationSource, /claims_p2_03_public_use_check\s+CHECK \(public_use_allowed = false\)/);
  assert.match(migrationSource, /claims_p2_03_funder_use_check\s+CHECK \(funder_use_allowed = false\)/);
  assert.match(migrationSource, /claims_p2_03_llm_processing_check\s+CHECK \(llm_processing_allowed = false\)/);
  assert.match(migrationSource, /claims_p2_03_product_learning_check\s+CHECK \(product_learning_allowed = false\)/);
  assert.match(migrationSource, /claims_p2_03_export_ready_check\s+CHECK \(export_ready = false\)/);
});

test("P2-03 enforces the claim statement length bound and the safe-content denylist", () => {
  assert.match(migrationSource, /claims_p2_03_statement_check/);
  assert.match(migrationSource, /length\(statement\) BETWEEN 1 AND 500/);
  assert.match(migrationSource, /statement !~\* '\(https\?:\/\//);
  assert.match(migrationSource, /claims_p2_03_statement_fingerprint_check\s+CHECK \(statement_fingerprint ~ '\^\[a-f0-9\]\{64\}\$'\)/);
});

test("P2-03 uses a tenant-safe composite foreign key from kai.claims to kai.evidence_items", () => {
  assert.match(
    migrationSource,
    /claims_p2_03_evidence_item_fk\s+FOREIGN KEY \(evidence_item_id, organization_id\)\s+REFERENCES kai\.evidence_items \(evidence_item_id, organization_id\)/,
  );
});

test("P2-03 idempotency identity is organization_id + evidence_item_id + claim_type", () => {
  assert.match(
    migrationSource,
    /claims_p2_03_identity_unique\s+UNIQUE \(organization_id, evidence_item_id, claim_type\)/,
  );
});

test("P2-03 claim_evidence_links has a tenant-safe composite FK to both kai.claims and kai.evidence_items, and pins today's cardinality to exactly one link per claim", () => {
  assert.match(
    migrationSource,
    /claim_evidence_links_p2_03_claim_fk\s+FOREIGN KEY \(claim_id, organization_id\)\s+REFERENCES kai\.claims \(claim_id, organization_id\)/,
  );
  assert.match(
    migrationSource,
    /claim_evidence_links_p2_03_evidence_item_fk\s+FOREIGN KEY \(evidence_item_id, organization_id\)\s+REFERENCES kai\.evidence_items \(evidence_item_id, organization_id\)/,
  );
  assert.match(
    migrationSource,
    /claim_evidence_links_p2_03_one_link_per_claim_unique\s+UNIQUE \(organization_id, claim_id\)/,
  );
  assert.match(
    migrationSource,
    /claim_evidence_links_p2_03_identity_unique\s+UNIQUE \(organization_id, claim_id, evidence_item_id\)/,
  );
});

test("P2-03 adds a partial unique index on kai.review_queue_items for queue_type = 'claim_review' only, never editing the accepted P1-06 migration file", () => {
  assert.match(
    migrationSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS ux_review_queue_items_p2_03_claim_review_identity\s+ON kai\.review_queue_items \(organization_id, queue_type, target_object_type, target_object_id\)\s+WHERE queue_type = 'claim_review'/,
  );
  assert.doesNotMatch(p106MigrationSource, /ux_review_queue_items_p2_03_claim_review_identity/);
});

test("P2-03 requires a non-blank required_action for claim_review queue items only", () => {
  assert.match(
    migrationSource,
    /ALTER TABLE kai\.review_queue_items\s+DROP CONSTRAINT IF EXISTS review_queue_items_p2_03_claim_review_required_action_check,\s+ADD CONSTRAINT review_queue_items_p2_03_claim_review_required_action_check\s+CHECK \(\s+queue_type <> 'claim_review'\s+OR \(\s+required_action IS NOT NULL\s+AND length\(btrim\(required_action\)\) BETWEEN 1 AND 2000\s+\)\s+\);/,
  );
});

test("P2-03 migration extends only the P2-03 audit operation and metadata branch, preserving all earlier branches including evidence_lineage_extracted", () => {
  assert.match(migrationSource, /claim_proposed/);
  for (const earlier of [
    "policy_decision_compare_and_set", "parser_run_recorded", "file_profile_persisted",
    "data_dictionary_draft_persisted", "intake_sensitivity_profile_persisted",
    "sensitivity_review_queue_item_created", "intake_source_candidate_persisted",
    "source_promotion_decision_persisted", "evidence_lineage_extracted",
  ]) {
    assert.match(migrationSource, new RegExp(`operation <> '${earlier}'`));
  }
});

test("P2-03 audit metadata branch requires exactly the twelve allowlisted keys and forbids claim_statement content", () => {
  const branchMatch = migrationSource.match(
    /operation <> 'claim_proposed'\s+OR \(([\s\S]*?)\)\s*\)\s*\)\s*;/,
  );
  assert.ok(branchMatch, "expected to find the claim_proposed metadata branch");
  const branch = branchMatch[1];
  for (const key of [
    "metadata_only", "contract", "evidence_item_id", "claim_id", "claim_type", "claim_status",
    "claim_review_status", "requirement_coverage_status", "warning_count",
    "review_queue_item_count", "fresh_write_count", "validator_key",
  ]) {
    assert.match(branch, new RegExp(`metadata \\? '${key}'`));
  }
  assert.match(branch, /NOT metadata \? 'claim_statement'/);
  assert.match(branch, /metadata - ARRAY\[/);
});

test("P2-03 rollback removes only P2-03 objects and restores the exact prior audit constraint", () => {
  assert.match(rollbackSource, /DELETE FROM kai\.upload_lifecycle_audit\s+WHERE operation = 'claim_proposed'/);
  assert.doesNotMatch(rollbackSource, /CHECK \(operation IN \([^)]*claim_proposed/);
  assert.match(rollbackSource, /evidence_lineage_extracted/);
  assert.match(rollbackSource, /DROP INDEX IF EXISTS kai\.ux_review_queue_items_p2_03_claim_review_identity/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.claim_evidence_links/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.claims/);
  assert.doesNotMatch(
    rollbackSource,
    /DROP TABLE IF EXISTS kai\.(?:intake_files|intake_parser_runs|intake_file_profiles|data_dictionaries|data_dictionary_fields|data_dictionary_mappings|data_quality_findings|upload_lifecycle_audit|intake_sensitivity_profiles|review_queue_items|intake_source_candidates|intake_promotion_decisions|sources|source_versions|source_locators|evidence_items)\b/,
  );
});

test("P2-03 does not widen the P1-06 queue_type vocabulary - claim_review is already accepted", () => {
  assert.match(p106MigrationSource, /'claim_review'/);
  assert.doesNotMatch(migrationSource, /review_queue_items_p1_06_queue_type_check/);
});
