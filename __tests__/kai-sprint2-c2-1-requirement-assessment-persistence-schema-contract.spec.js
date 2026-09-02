import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_c2_1_requirement_assessment_persistence.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_c2_1_requirement_assessment_persistence.rollback.sql", "utf8");

// The migration's own explanatory "-- ..." prose comments legitimately name
// forbidden identifiers/vocabulary as negative documentation (e.g. "never
// touches kai.gap_log_items", "not P2-02's SUPPORTED_INPUT_EXISTS
// vocabulary") to record what C2.1 deliberately does NOT do. The
// doesNotMatch checks below are about actual DDL usage, not prose, so they
// run against the migration source with "-- ..." line comments stripped.
const migrationDdlOnly = migrationSource
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

test("C2.1 migration is wrapped in a transaction and guards on its prerequisites existing, without altering B1/A1/P2 objects", () => {
  assert.match(migrationSource, /^BEGIN;/);
  assert.match(migrationSource, /COMMIT;\s*$/);
  for (const guard of [
    /RAISE EXCEPTION 'kai\.organizations is required/,
    /RAISE EXCEPTION 'kai\.engagements is required/,
    /RAISE EXCEPTION 'kai\.requirements \(B1\.1\) is required/,
    /RAISE EXCEPTION 'kai\.evidence_items is required/,
    /RAISE EXCEPTION 'kai\.claims is required/,
    /RAISE EXCEPTION 'kai\.impact_evaluation_results \(A1\.3\) is required/,
  ]) {
    assert.match(migrationSource, guard);
  }
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.organizations\b/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.engagements\b/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.requirements\b/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.requirement_sources\b/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.requirement_sets\b/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.requirement_framework_versions\b/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.engagement_requirement_sets\b/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.evidence_items\b/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.claims\b/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.impact_evaluation_results\b/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.impact_evaluation_result_evidence_links\b/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.impact_evaluation_result_claim_links\b/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.coverage_review_decisions\b/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.gap_log_items\b/);
});

test("C2.1 creates exactly the four canonical objects and no others", () => {
  const createdTables = [...migrationSource.matchAll(/CREATE TABLE IF NOT EXISTS kai\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(
    createdTables.sort(),
    [
      "requirement_assessments",
      "requirement_assessment_evidence_links",
      "requirement_assessment_claim_links",
      "requirement_assessment_evaluation_result_links",
    ].sort(),
  );
});

test("C2.1 does not add requirement identity to any P2 table and does not create a generic/polymorphic provenance table", () => {
  for (const forbidden of [
    /kai\.gap_log_items\b/,
    /kai\.coverage_review_decisions\b/,
    /subject_type/i,
    /object_type/i,
    /target_object_type/i,
  ]) {
    assert.doesNotMatch(migrationDdlOnly, forbidden);
  }
});

test("C2.1 requirement_assessments declares the required minimum columns and identity/fingerprint uniqueness", () => {
  for (const column of [
    "requirement_assessment_id",
    "organization_id",
    "engagement_id",
    "requirement_id",
    "assessment_state",
    "assessment_explanation",
    "state_fingerprint",
    "created_by",
    "created_by_type",
    "created_at",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected requirement_assessments column ${column}`);
  }
  assert.match(
    migrationSource,
    /requirement_assessments_c2_1_id_org_unique\s+UNIQUE \(requirement_assessment_id, organization_id\)/,
  );
  assert.match(
    migrationSource,
    /requirement_assessments_c2_1_identity_fingerprint_unique\s+UNIQUE \(organization_id, engagement_id, requirement_id, state_fingerprint\)/,
  );
});

test("C2.1 requirement_assessments assessment_state vocabulary is exactly satisfied/not_satisfied - never the excluded P2-02 vocabulary or human-approval encoding", () => {
  const check = migrationSource.match(/requirement_assessments_c2_1_assessment_state_check\s+CHECK \(assessment_state IN \(([^)]+)\)\)/);
  assert.ok(check, "expected assessment_state CHECK constraint");
  const values = check[1].split(",").map((v) => v.trim().replace(/'/g, ""));
  assert.deepEqual(values.sort(), ["not_satisfied", "satisfied"]);
  for (const forbidden of [
    /SUPPORTED_INPUT_EXISTS/,
    /PARTIAL_INPUT_EXISTS/,
    /NO_CURRENT_INPUT/,
    /accepted_internal_with_limitation/,
    /approved/i,
    /readiness/i,
  ]) {
    assert.doesNotMatch(migrationDdlOnly, forbidden);
  }
});

test("C2.1 requirement_assessments is tenant-scoped through the composite engagements FK and a bare requirement_id FK (requirements carries no organization_id)", () => {
  assert.match(
    migrationSource,
    /requirement_assessments_c2_1_engagement_fk\s+FOREIGN KEY \(engagement_id, organization_id\)\s+REFERENCES kai\.engagements \(engagement_id, organization_id\)\s+ON DELETE RESTRICT/,
  );
  assert.match(
    migrationSource,
    /requirement_assessments_c2_1_requirement_fk\s+FOREIGN KEY \(requirement_id\)\s+REFERENCES kai\.requirements \(requirement_id\)\s+ON DELETE RESTRICT/,
  );
});

test("C2.1 requirement_assessments is append-only: a BEFORE UPDATE OR DELETE trigger rejects mutation", () => {
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION kai\.c2_1_reject_requirement_assessment_mutation\(\)/);
  assert.match(
    migrationSource,
    /CREATE TRIGGER trg_c2_1_requirement_assessments_append_only\s+BEFORE UPDATE OR DELETE ON kai\.requirement_assessments/,
  );
});

test("C2.1 declares exactly three typed provenance link tables (evidence, claim, evaluation result), each bare-identity and tenant-safe", () => {
  const linkTables = {
    requirement_assessment_evidence_links: { column: "evidence_item_id", target: "kai.evidence_items" },
    requirement_assessment_claim_links: { column: "claim_id", target: "kai.claims" },
    requirement_assessment_evaluation_result_links: { column: "impact_evaluation_result_id", target: "kai.impact_evaluation_results" },
  };
  for (const [table, { column, target }] of Object.entries(linkTables)) {
    const body = migrationSource.match(new RegExp(`CREATE TABLE IF NOT EXISTS kai\\.${table} \\(([\\s\\S]*?)\\);`));
    assert.ok(body, `expected ${table} table body`);
    assert.match(body[1], new RegExp(`\\b${column}\\b`));
    assert.match(body[1], /requirement_assessment_id uuid NOT NULL/);
    assert.match(body[1], new RegExp(`FOREIGN KEY \\(requirement_assessment_id, organization_id\\)\\s+REFERENCES kai\\.requirement_assessments`));
    assert.match(body[1], new RegExp(`FOREIGN KEY \\(${column}, organization_id\\)\\s+REFERENCES ${target.replace(".", "\\.")}`));
    for (const forbidden of [/statement/i, /status/i, /score/i, /narrative/i, /strength/i]) {
      assert.doesNotMatch(body[1], forbidden);
    }
  }
});

test("C2.1 rollback removes exactly the four C2.1 objects plus the trigger/function, in dependency-safe order, and touches nothing else", () => {
  assert.match(rollbackSource, /^BEGIN;/);
  assert.match(rollbackSource, /COMMIT;\s*$/);
  for (const table of [
    "requirement_assessment_evaluation_result_links",
    "requirement_assessment_claim_links",
    "requirement_assessment_evidence_links",
    "requirement_assessments",
  ]) {
    assert.match(rollbackSource, new RegExp(`DROP TABLE IF EXISTS kai\\.${table}\\b`));
  }
  assert.match(rollbackSource, /DROP TRIGGER IF EXISTS trg_c2_1_requirement_assessments_append_only/);
  assert.match(rollbackSource, /DROP FUNCTION IF EXISTS kai\.c2_1_reject_requirement_assessment_mutation/);
  assert.doesNotMatch(rollbackSource, /kai\.organizations\b/);
  assert.doesNotMatch(rollbackSource, /kai\.engagements\b/);
  assert.doesNotMatch(rollbackSource, /kai\.requirements\b(?!_assessment)/);

  const order = [
    "requirement_assessment_evaluation_result_links",
    "requirement_assessment_claim_links",
    "requirement_assessment_evidence_links",
    "requirement_assessments",
  ].map((table) => rollbackSource.indexOf(`DROP TABLE IF EXISTS kai.${table}`));
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i - 1] < order[i], "children must be dropped before the parent they reference");
  }
});
