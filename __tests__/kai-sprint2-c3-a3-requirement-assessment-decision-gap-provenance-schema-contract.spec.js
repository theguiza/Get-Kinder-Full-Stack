import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync(
  "migrations/kai_sprint2_c3_a3_requirement_assessment_decision_gap_provenance.sql",
  "utf8",
);
const rollbackSource = readFileSync(
  "migrations/kai_sprint2_c3_a3_requirement_assessment_decision_gap_provenance.rollback.sql",
  "utf8",
);

const migrationDdlOnly = migrationSource
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

test("C3.A3 migration is wrapped in a transaction and guards on its prerequisites existing", () => {
  assert.match(migrationSource, /^BEGIN;/);
  assert.match(migrationSource, /COMMIT;\s*$/);
  for (const guard of [
    /RAISE EXCEPTION 'kai\.requirement_assessments \(C2\.1\) is required/,
    /RAISE EXCEPTION 'kai\.evidence_review_decisions \(P2-12\) is required/,
    /RAISE EXCEPTION 'kai\.claim_review_decisions \(P2-12\) is required/,
    /RAISE EXCEPTION 'kai\.gap_log_items \(P2-04\) is required/,
  ]) {
    assert.match(migrationSource, guard);
  }
});

test("C3.A3 does not alter the four locked objects it builds provenance for", () => {
  for (const forbidden of [
    /ALTER TABLE kai\.requirement_assessments\b/,
    /ALTER TABLE kai\.evidence_review_decisions\b/,
    /ALTER TABLE kai\.claim_review_decisions\b/,
    /ALTER TABLE kai\.gap_log_items\b/,
  ]) {
    assert.doesNotMatch(migrationDdlOnly, forbidden);
  }
});

test("C3.A3 creates exactly three new tables and no others", () => {
  const createdTables = [...migrationSource.matchAll(/CREATE TABLE kai\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(
    createdTables.sort(),
    [
      "ra_evidence_review_decision_links",
      "ra_claim_review_decision_links",
      "ra_gap_links",
    ].sort(),
  );
});

test("C3.A3 evidence-decision link cites the exact append-only decision_id identity, tenant-safe and subject-pinned", () => {
  const body = migrationSource.match(
    /CREATE TABLE kai\.ra_evidence_review_decision_links \(([\s\S]*?)\);/,
  );
  assert.ok(body);
  assert.match(body[1], /decision_id uuid NOT NULL/);
  assert.match(
    body[1],
    /ra_evidence_review_decision_links_c3_a3_identity_unique\s+UNIQUE \(requirement_assessment_id, decision_id\)/,
  );
  assert.match(
    body[1],
    /ra_evidence_review_decision_links_c3_a3_decision_fk\s+FOREIGN KEY \(decision_id, organization_id, evidence_item_id\)\s+REFERENCES kai\.evidence_review_decisions \(decision_id, organization_id, evidence_item_id\)/,
  );
  for (const forbidden of [/decision_outcome/i, /limitation_notes/i, /approved_audiences/i]) {
    assert.doesNotMatch(body[1], forbidden);
  }
});

test("C3.A3 claim-decision link cites the exact append-only decision_id identity, tenant-safe and subject-pinned", () => {
  const body = migrationSource.match(
    /CREATE TABLE kai\.ra_claim_review_decision_links \(([\s\S]*?)\);/,
  );
  assert.ok(body);
  assert.match(body[1], /decision_id uuid NOT NULL/);
  assert.match(
    body[1],
    /ra_claim_review_decision_links_c3_a3_identity_unique\s+UNIQUE \(requirement_assessment_id, decision_id\)/,
  );
  assert.match(
    body[1],
    /ra_claim_review_decision_links_c3_a3_decision_fk\s+FOREIGN KEY \(decision_id, organization_id, claim_id\)\s+REFERENCES kai\.claim_review_decisions \(decision_id, organization_id, claim_id\)/,
  );
});

test("C3.A3 gap link pins gap_log_item_id plus the full existing immutable snapshot (claim/evidence/source_version/dimension/assessment_status), duplicate-safe and tenant-safe", () => {
  const body = migrationSource.match(/CREATE TABLE kai\.ra_gap_links \(([\s\S]*?)\);/);
  assert.ok(body);
  for (const column of [
    "gap_log_item_id",
    "claim_id",
    "evidence_item_id",
    "source_version_id",
    "dimension_key",
    "assessment_status",
  ]) {
    assert.match(body[1], new RegExp(`\\b${column}\\b`), `expected gap link column ${column}`);
  }
  assert.match(
    body[1],
    /ra_gap_links_c3_a3_identity_unique\s+UNIQUE \(requirement_assessment_id, gap_log_item_id\)/,
  );
  assert.match(
    body[1],
    /ra_gap_links_c3_a3_gap_fk\s+FOREIGN KEY \(gap_log_item_id, organization_id\)\s+REFERENCES kai\.gap_log_items \(gap_log_item_id, organization_id\)/,
  );
});

test("C3.A3 gap link snapshot is verified against the live gap_log_items row at insert time and is then append-only", () => {
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION kai\.c3_a3_verify_gap_link_snapshot_matches_source\(\)/);
  assert.match(
    migrationSource,
    /CREATE TRIGGER trg_c3_a3_gap_links_verify_snapshot\s+BEFORE INSERT ON kai\.ra_gap_links/,
  );
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION kai\.c3_a3_reject_gap_link_mutation\(\)/);
  assert.match(
    migrationSource,
    /CREATE TRIGGER trg_c3_a3_gap_links_append_only\s+BEFORE UPDATE OR DELETE ON kai\.ra_gap_links/,
  );
});

test("C3.A3 does not invent a new gap relationship beyond the one gap-link table (no second gap table, no generic subject/object link)", () => {
  for (const forbidden of [/subject_type/i, /object_type/i, /target_object_type/i, /gap_log_item_snapshot/i, /gap_fingerprint/i]) {
    assert.doesNotMatch(migrationDdlOnly, forbidden);
  }
});

test("C3.A3 rollback removes exactly the three new tables plus their triggers/functions, in dependency-safe order, and touches nothing else", () => {
  assert.match(rollbackSource, /^BEGIN;/);
  assert.match(rollbackSource, /COMMIT;\s*$/);
  for (const table of [
    "ra_gap_links",
    "ra_claim_review_decision_links",
    "ra_evidence_review_decision_links",
  ]) {
    assert.match(rollbackSource, new RegExp(`DROP TABLE IF EXISTS kai\\.${table}\\b`));
  }
  assert.match(rollbackSource, /DROP FUNCTION IF EXISTS kai\.c3_a3_reject_gap_link_mutation\(\)/);
  assert.match(rollbackSource, /DROP FUNCTION IF EXISTS kai\.c3_a3_verify_gap_link_snapshot_matches_source\(\)/);
  assert.doesNotMatch(rollbackSource, /kai\.requirement_assessments\b(?!_)/);
  assert.doesNotMatch(rollbackSource, /kai\.evidence_review_decisions\b/);
  assert.doesNotMatch(rollbackSource, /kai\.claim_review_decisions\b/);
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.gap_log_items\b/);
});
