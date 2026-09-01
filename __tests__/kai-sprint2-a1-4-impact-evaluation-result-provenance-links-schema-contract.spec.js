import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_a1_4_impact_evaluation_result_provenance_links.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_a1_4_impact_evaluation_result_provenance_links.rollback.sql", "utf8");
const a1_1MigrationSource = readFileSync("migrations/kai_sprint2_a1_1_impact_outcome_context.sql", "utf8");
const a1_2MigrationSource = readFileSync("migrations/kai_sprint2_a1_2_impact_evaluation_framework_and_criteria.sql", "utf8");
const a1_3MigrationSource = readFileSync("migrations/kai_sprint2_a1_3_impact_evaluations_and_results.sql", "utf8");
const p2_04MigrationSource = readFileSync("migrations/kai_sprint2_p2_04_claim_gap_followup.sql", "utf8");

test("A1.4 migration is wrapped in a transaction and guards on A1.3/evidence/claim objects and their tenant identities already existing", () => {
  assert.match(migrationSource, /^BEGIN;/);
  assert.match(migrationSource, /COMMIT;\s*$/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.impact_evaluation_results is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.evidence_items is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.claims is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.evidence_items_p2_01_id_org_unique is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.claims_p2_03_id_org_unique is required/);
});

test("A1.1-A1.3 semantics are unchanged: their migration files are byte-identical in intent, untouched by this package", () => {
  assert.match(a1_1MigrationSource, /CREATE TABLE IF NOT EXISTS kai\.impact_outcome_contexts/);
  assert.match(a1_2MigrationSource, /CREATE TABLE IF NOT EXISTS kai\.impact_evaluation_framework_versions/);
  assert.match(a1_2MigrationSource, /CREATE TABLE IF NOT EXISTS kai\.impact_evaluation_criteria/);
  assert.match(a1_3MigrationSource, /CREATE TABLE IF NOT EXISTS kai\.impact_evaluations/);
  assert.match(a1_3MigrationSource, /CREATE TABLE IF NOT EXISTS kai\.impact_evaluation_results/);
  for (const source of [a1_1MigrationSource, a1_2MigrationSource, a1_3MigrationSource]) {
    assert.doesNotMatch(source, /impact_evaluation_result_evidence_links|impact_evaluation_result_claim_links/);
  }
});

test("A1.4 adds only the smallest A1.3 compatibility constraint: a redundant UNIQUE(impact_evaluation_result_id, organization_id)", () => {
  assert.match(
    migrationSource,
    /ALTER TABLE kai\.impact_evaluation_results\s+ADD CONSTRAINT impact_evaluation_results_a1_4_id_org_unique\s+UNIQUE \(impact_evaluation_result_id, organization_id\)/,
  );
  const alterStatements = [...migrationSource.matchAll(/ALTER TABLE kai\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(alterStatements, ["impact_evaluation_results"]);
});

test("A1.4 creates only the two provenance link tables - no polymorphic target table", () => {
  const createdTables = [...migrationSource.matchAll(/CREATE TABLE IF NOT EXISTS kai\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(createdTables.sort(), [
    "impact_evaluation_result_claim_links",
    "impact_evaluation_result_evidence_links",
  ]);
  assert.doesNotMatch(migrationSource, /target_type|target_object_type|target_object_id|target_id/);
});

test("A1.4 evidence-link table declares the minimum provenance identity column list, with no evidence content copied", () => {
  for (const column of [
    "impact_evaluation_result_evidence_link_id",
    "organization_id",
    "impact_evaluation_result_id",
    "evidence_item_id",
    "created_at",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected evidence-link column ${column}`);
  }
  const evidenceLinkBody = migrationSource.match(
    /CREATE TABLE IF NOT EXISTS kai\.impact_evaluation_result_evidence_links \(([\s\S]*?)\n\);/,
  );
  assert.ok(evidenceLinkBody);
  for (const forbiddenColumn of [
    "evidence_statement",
    "evidence_value",
    "locator",
    "evidence_status",
    "review_status",
    "confidence_note",
    "strength",
    "audience",
    "allowed_use",
  ]) {
    assert.doesNotMatch(evidenceLinkBody[1], new RegExp(forbiddenColumn, "i"));
  }
});

test("A1.4 claim-link table declares the minimum provenance identity column list, with no claim content copied", () => {
  for (const column of [
    "impact_evaluation_result_claim_link_id",
    "organization_id",
    "impact_evaluation_result_id",
    "claim_id",
    "created_at",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected claim-link column ${column}`);
  }
  const claimLinkBody = migrationSource.match(
    /CREATE TABLE IF NOT EXISTS kai\.impact_evaluation_result_claim_links \(([\s\S]*?)\n\);/,
  );
  assert.ok(claimLinkBody);
  for (const forbiddenColumn of [
    "claim_statement",
    "claim_type",
    "claim_status",
    "claim_review_status",
    "strength",
    "audience",
    "approval",
  ]) {
    assert.doesNotMatch(claimLinkBody[1], new RegExp(forbiddenColumn, "i"));
  }
});

test("A1.4 result-side tenant identity is enforced via composite FK on both link tables (cross-organization result binding rejected)", () => {
  assert.match(
    migrationSource,
    /impact_evaluation_result_evidence_links_a1_4_result_fk\s+FOREIGN KEY \(impact_evaluation_result_id, organization_id\)\s+REFERENCES kai\.impact_evaluation_results \(impact_evaluation_result_id, organization_id\)/,
  );
  assert.match(
    migrationSource,
    /impact_evaluation_result_claim_links_a1_4_result_fk\s+FOREIGN KEY \(impact_evaluation_result_id, organization_id\)\s+REFERENCES kai\.impact_evaluation_results \(impact_evaluation_result_id, organization_id\)/,
  );
});

test("A1.4 reuses the existing evidence tenant identity unchanged (cross-organization evidence link rejected)", () => {
  assert.match(
    migrationSource,
    /impact_evaluation_result_evidence_links_a1_4_evidence_fk\s+FOREIGN KEY \(evidence_item_id, organization_id\)\s+REFERENCES kai\.evidence_items \(evidence_item_id, organization_id\)/,
  );
  assert.doesNotMatch(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.evidence_items\b/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.evidence_items/);
});

test("A1.4 reuses the existing claim tenant identity unchanged (cross-organization claim link rejected)", () => {
  assert.match(
    migrationSource,
    /impact_evaluation_result_claim_links_a1_4_claim_fk\s+FOREIGN KEY \(claim_id, organization_id\)\s+REFERENCES kai\.claims \(claim_id, organization_id\)/,
  );
  assert.doesNotMatch(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.claims\b/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.claims\b/);
});

test("A1.4 prevents a duplicate result->evidence link and a duplicate result->claim link", () => {
  assert.match(
    migrationSource,
    /impact_evaluation_result_evidence_links_a1_4_identity_unique\s+UNIQUE \(impact_evaluation_result_id, evidence_item_id\)/,
  );
  assert.match(
    migrationSource,
    /impact_evaluation_result_claim_links_a1_4_identity_unique\s+UNIQUE \(impact_evaluation_result_id, claim_id\)/,
  );
});

test("A1.4 introduces no role, weight, confidence, score, or arbitrary metadata column on either link table", () => {
  for (const forbidden of [/\brole\b/i, /\bweight\b/i, /\bconfidence\b/i, /\bscore\b/i, /\bmetadata\b/i, /\bjsonb\b/i]) {
    assert.doesNotMatch(migrationSource, forbidden);
  }
});

test("A1.4 adds no trigger, view, or other write path that could mutate evidence/claim review, authority, or audience fields", () => {
  assert.doesNotMatch(migrationSource, /CREATE (?:OR REPLACE )?(?:TRIGGER|FUNCTION|VIEW)/i);
  assert.doesNotMatch(migrationSource, /UPDATE kai\.(?:evidence_items|claims)\b/i);
});

test("A1.4 does not introduce evaluation, gap, funder, or requirement objects, and gap_log_items/funders remain untouched", () => {
  for (const forbidden of [/kai\.gap_log_items\b/, /kai\.funders\b/, /kai\.funder_requirements\b/]) {
    assert.doesNotMatch(migrationSource, forbidden);
  }
  assert.match(p2_04MigrationSource, /CREATE TABLE IF NOT EXISTS kai\.gap_log_items/);
  assert.doesNotMatch(p2_04MigrationSource, /impact_evaluation_result_evidence_links|impact_evaluation_result_claim_links/);
});

test("A1.4 rollback removes exactly what the forward migration created, in dependency-safe order, and drops only the added compatibility constraint from A1.3's table", () => {
  assert.match(rollbackSource, /^BEGIN;/);
  assert.match(rollbackSource, /COMMIT;\s*$/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.impact_evaluation_result_claim_links/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.impact_evaluation_result_evidence_links/);
  assert.match(
    rollbackSource,
    /ALTER TABLE IF EXISTS kai\.impact_evaluation_results\s+DROP CONSTRAINT IF EXISTS impact_evaluation_results_a1_4_id_org_unique/,
  );
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.impact_evaluation_results\b/);
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.(?:evidence_items|claims)\b/);
});
