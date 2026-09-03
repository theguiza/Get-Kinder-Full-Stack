import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync(
  "migrations/kai_sprint2_c3_a4_requirement_assessment_provenance_extension.sql",
  "utf8",
);
const rollbackSource = readFileSync(
  "migrations/kai_sprint2_c3_a4_requirement_assessment_provenance_extension.rollback.sql",
  "utf8",
);

const migrationDdlOnly = migrationSource
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

test("C3.A4 migration is wrapped in a transaction and guards on its prerequisites existing", () => {
  assert.match(migrationSource, /^BEGIN;/);
  assert.match(migrationSource, /COMMIT;\s*$/);
  for (const guard of [
    /RAISE EXCEPTION 'kai\.requirement_assessments \(C2\.1\) is required/,
    /RAISE EXCEPTION 'kai\.impact_outcome_contexts \(A1\.1\) is required/,
    /RAISE EXCEPTION 'kai\.evidence_items \(P2-01\) is required/,
    /RAISE EXCEPTION 'kai\.source_versions \(P1-08\) is required/,
    /RAISE EXCEPTION 'kai\.intake_promotion_decisions \(P1-08\) is required/,
    /RAISE EXCEPTION 'kai\.claims \(P2-03\) is required/,
    /RAISE EXCEPTION 'kai\.conflict_groups \(P2-05\) is required/,
    /RAISE EXCEPTION 'kai\.review_queue_items \(P1-06\) is required/,
  ]) {
    assert.match(migrationSource, guard);
  }
});

test("C3.A4 does not alter any of the eight locked objects it builds provenance for", () => {
  for (const forbidden of [
    /ALTER TABLE kai\.requirement_assessments\b/,
    /ALTER TABLE kai\.impact_outcome_contexts\b/,
    /ALTER TABLE kai\.evidence_items\b/,
    /ALTER TABLE kai\.source_versions\b/,
    /ALTER TABLE kai\.intake_promotion_decisions\b/,
    /ALTER TABLE kai\.claims\b/,
    /ALTER TABLE kai\.conflict_groups\b/,
    /ALTER TABLE kai\.review_queue_items\b/,
  ]) {
    assert.doesNotMatch(migrationDdlOnly, forbidden);
  }
});

test("C3.A4 creates exactly three new tables and no others", () => {
  const createdTables = [...migrationSource.matchAll(/CREATE TABLE kai\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(
    createdTables.sort(),
    [
      "ra_outcome_context_links",
      "ra_source_promotion_links",
      "ra_conflict_resolution_links",
    ].sort(),
  );
});

test("C3.A4 does not add a requirement_id column to any pre-existing P1/P2/A1 table", () => {
  assert.doesNotMatch(migrationDdlOnly, /ADD COLUMN\s+requirement_id/i);
});

test("C3.A4 does not invent a generic provenance blob or parallel assessment ledger", () => {
  for (const forbidden of [
    /subject_type/i,
    /object_type/i,
    /provenance_metadata/i,
    /provenance_blob/i,
    /CREATE TABLE kai\.requirement_assessments_v2/i,
    /jsonb NOT NULL DEFAULT '\{\}'/i,
  ]) {
    assert.doesNotMatch(migrationDdlOnly, forbidden);
  }
});

test("ra_outcome_context_links pins the exact governed columns as a verified snapshot, tenant-safe and duplicate-safe", () => {
  const body = migrationSource.match(/CREATE TABLE kai\.ra_outcome_context_links \(([\s\S]*?)\);/);
  assert.ok(body);
  for (const column of ["outcome_key", "outcome_statement", "stakeholder_key", "stakeholder_label"]) {
    assert.match(body[1], new RegExp(`\\b${column}\\b`));
  }
  assert.match(
    body[1],
    /ra_outcome_context_links_c3_a4_identity_unique\s+UNIQUE \(requirement_assessment_id, impact_outcome_context_id\)/,
  );
  assert.match(
    body[1],
    /ra_outcome_context_links_c3_a4_context_fk\s+FOREIGN KEY \(impact_outcome_context_id, organization_id\)\s+REFERENCES kai\.impact_outcome_contexts \(impact_outcome_context_id, organization_id\)/,
  );
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION kai\.c3_a4_verify_outcome_context_link_snapshot\(\)/);
  assert.match(migrationSource, /CREATE TRIGGER trg_c3_a4_outcome_context_links_verify_snapshot\s+BEFORE INSERT ON kai\.ra_outcome_context_links/);
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION kai\.c3_a4_reject_outcome_context_link_mutation\(\)/);
  assert.match(migrationSource, /CREATE TRIGGER trg_c3_a4_outcome_context_links_append_only\s+BEFORE UPDATE OR DELETE ON kai\.ra_outcome_context_links/);
});

test("ra_source_promotion_links pins evidence_item/source/source_version/promotion_decision as real foreign keys and snapshots only the mutable fields", () => {
  const body = migrationSource.match(/CREATE TABLE kai\.ra_source_promotion_links \(([\s\S]*?)\);/);
  assert.ok(body);
  assert.match(
    body[1],
    /ra_source_promotion_links_c3_a4_evidence_fk\s+FOREIGN KEY \(evidence_item_id, organization_id\)\s+REFERENCES kai\.evidence_items \(evidence_item_id, organization_id\)/,
  );
  assert.match(
    body[1],
    /ra_source_promotion_links_c3_a4_source_version_fk\s+FOREIGN KEY \(source_version_id, organization_id\)\s+REFERENCES kai\.source_versions \(source_version_id, organization_id\)/,
  );
  assert.match(
    body[1],
    /ra_source_promotion_links_c3_a4_decision_fk\s+FOREIGN KEY \(intake_source_candidate_id, organization_id\)\s+REFERENCES kai\.intake_promotion_decisions \(intake_source_candidate_id, organization_id\)/,
  );
  assert.match(body[1], /ra_source_promotion_links_c3_a4_identity_unique\s+UNIQUE \(requirement_assessment_id, evidence_item_id\)/);
  for (const column of ["is_current", "decision_status", "reviewed_source_type"]) {
    assert.match(body[1], new RegExp(`\\b${column}\\b`));
  }
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION kai\.c3_a4_verify_source_promotion_link_snapshot\(\)/);
  assert.match(migrationSource, /CREATE TRIGGER trg_c3_a4_source_promotion_links_verify_snapshot\s+BEFORE INSERT ON kai\.ra_source_promotion_links/);
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION kai\.c3_a4_reject_source_promotion_link_mutation\(\)/);
  assert.match(migrationSource, /CREATE TRIGGER trg_c3_a4_source_promotion_links_append_only\s+BEFORE UPDATE OR DELETE ON kai\.ra_source_promotion_links/);
});

test("ra_conflict_resolution_links pins conflict_group/claim as bare identity links and verifies claim participation only (no snapshot, no review_queue_item, no append-only trigger)", () => {
  const body = migrationSource.match(/CREATE TABLE kai\.ra_conflict_resolution_links \(([\s\S]*?)\);/);
  assert.ok(body);
  assert.match(
    body[1],
    /ra_conflict_resolution_links_c3_a4_conflict_fk\s+FOREIGN KEY \(conflict_group_id, organization_id\)\s+REFERENCES kai\.conflict_groups \(conflict_group_id, organization_id\)/,
  );
  assert.match(
    body[1],
    /ra_conflict_resolution_links_c3_a4_claim_fk\s+FOREIGN KEY \(claim_id, organization_id\)\s+REFERENCES kai\.claims \(claim_id, organization_id\)/,
  );
  assert.match(body[1], /ra_conflict_resolution_links_c3_a4_identity_unique\s+UNIQUE \(requirement_assessment_id, conflict_group_id, claim_id\)/);
  for (const forbidden of [/queue_status/, /review_status/, /review_queue_item_id/]) {
    assert.doesNotMatch(body[1], forbidden);
  }
  assert.match(migrationSource, /IS DISTINCT FROM conflict_row\.lower_claim_id[\s\S]*?IS DISTINCT FROM conflict_row\.higher_claim_id/);
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION kai\.c3_a4_verify_conflict_resolution_link_participation\(\)/);
  assert.match(migrationSource, /CREATE TRIGGER trg_c3_a4_conflict_resolution_links_verify_participation\s+BEFORE INSERT ON kai\.ra_conflict_resolution_links/);
  assert.doesNotMatch(migrationSource, /trg_c3_a4_conflict_resolution_links_append_only/);
});

test("C3.A4 rollback removes exactly the three new tables plus their triggers/functions, in dependency-safe order, and touches nothing else", () => {
  assert.match(rollbackSource, /^BEGIN;/);
  assert.match(rollbackSource, /COMMIT;\s*$/);
  for (const table of [
    "ra_conflict_resolution_links",
    "ra_source_promotion_links",
    "ra_outcome_context_links",
  ]) {
    assert.match(rollbackSource, new RegExp(`DROP TABLE IF EXISTS kai\\.${table}\\b`));
  }
  for (const fn of [
    "c3_a4_verify_conflict_resolution_link_participation",
    "c3_a4_reject_source_promotion_link_mutation",
    "c3_a4_verify_source_promotion_link_snapshot",
    "c3_a4_reject_outcome_context_link_mutation",
    "c3_a4_verify_outcome_context_link_snapshot",
  ]) {
    assert.match(rollbackSource, new RegExp(`DROP FUNCTION IF EXISTS kai\\.${fn}\\(\\)`));
  }
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.requirement_assessments\b/);
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.impact_outcome_contexts\b/);
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.evidence_items\b/);
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.source_versions\b/);
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.intake_promotion_decisions\b/);
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.claims\b/);
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.conflict_groups\b/);
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.review_queue_items\b/);
});
