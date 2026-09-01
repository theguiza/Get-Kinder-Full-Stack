import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_a1_2_impact_evaluation_framework_and_criteria.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_a1_2_impact_evaluation_framework_and_criteria.rollback.sql", "utf8");
const a1_1MigrationSource = readFileSync("migrations/kai_sprint2_a1_1_impact_outcome_context.sql", "utf8");

const PACKAGE_A_CRITERION_KEYS = ["what", "who", "how_much", "contribution", "risk", "how"];

test("A1.2 migration is wrapped in a transaction, guards on kai.impact_outcome_contexts existing, and never touches it", () => {
  assert.match(migrationSource, /^BEGIN;/);
  assert.match(migrationSource, /COMMIT;\s*$/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.impact_outcome_contexts is required/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.impact_outcome_contexts/);
  assert.doesNotMatch(migrationSource, /DROP TABLE[\s\S]*?kai\.impact_outcome_contexts\b/);
});

test("A1.1 impact_outcome_contexts is unchanged by this package (A1.1 migration file itself is untouched)", () => {
  assert.match(a1_1MigrationSource, /CREATE TABLE IF NOT EXISTS kai\.impact_outcome_contexts/);
  assert.doesNotMatch(a1_1MigrationSource, /impact_evaluation_framework_versions|impact_evaluation_criteria/);
});

test("A1.2 creates only impact_evaluation_framework_versions and impact_evaluation_criteria", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.impact_evaluation_framework_versions/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.impact_evaluation_criteria/);
  const createdTables = [...migrationSource.matchAll(/CREATE TABLE IF NOT EXISTS kai\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(createdTables.sort(), ["impact_evaluation_criteria", "impact_evaluation_framework_versions"]);
});

test("A1.2 framework_versions declares the minimum durable column list", () => {
  for (const column of [
    "framework_version_id",
    "framework_code",
    "framework_name",
    "version_label",
    "framework_status",
    "created_by_type",
    "created_at",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected framework_versions column ${column}`);
  }
});

test("A1.2 criteria declares the minimum durable column list", () => {
  for (const column of [
    "criterion_id",
    "framework_version_id",
    "criterion_key",
    "criterion_label",
    "description",
    "evaluation_guidance",
    "display_order",
    "created_at",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected criteria column ${column}`);
  }
});

test("A1.2 framework_code + version_label identity is unique, so one framework_code can have multiple versions but never a duplicate version", () => {
  assert.match(
    migrationSource,
    /impact_evaluation_framework_versions_a1_2_identity_unique\s+UNIQUE \(framework_code, version_label\)/,
  );
  assert.doesNotMatch(migrationSource, /UNIQUE \(framework_code\)[^,)]/);
});

test("A1.2 rejects blank/invalid framework identity fields via nonblank/shape CHECKs", () => {
  const codeCheck = migrationSource.match(
    /impact_evaluation_framework_versions_a1_2_framework_code_check\s+CHECK \(framework_code ~ '([^']+)'\)/,
  );
  const labelCheck = migrationSource.match(
    /impact_evaluation_framework_versions_a1_2_version_label_check\s+CHECK \(version_label ~ '([^']+)'\)/,
  );
  assert.ok(codeCheck, "expected framework_code shape CHECK");
  assert.ok(labelCheck, "expected version_label shape CHECK");
  assert.equal(new RegExp(codeCheck[1]).test(""), false, "empty framework_code must fail the shape CHECK");
  assert.equal(new RegExp(labelCheck[1]).test(""), false, "empty version_label must fail the shape CHECK");
  assert.match(
    migrationSource,
    /impact_evaluation_framework_versions_a1_2_framework_name_check\s+CHECK \(btrim\(framework_name\) <> '' AND char_length\(framework_name\) <= 200\)/,
  );
});

test("A1.2 framework_status vocabulary is bounded to draft/active/retired, defaulted to draft", () => {
  assert.match(migrationSource, /framework_status text NOT NULL DEFAULT 'draft'/);
  assert.match(
    migrationSource,
    /impact_evaluation_framework_versions_a1_2_framework_status_check\s+CHECK \(framework_status IN \('draft', 'active', 'retired'\)\)/,
  );
});

test("A1.2 does not encode the six Package-A criterion keys as a global CHECK constraint", () => {
  assert.doesNotMatch(migrationSource, /criterion_key IN \(/);
  const criterionKeyCheckBlock = migrationSource.match(
    /impact_evaluation_criteria_a1_2_criterion_key_check\s+CHECK \([^)]*\)/,
  );
  assert.ok(criterionKeyCheckBlock, "expected the criterion_key CHECK constraint");
  for (const key of PACKAGE_A_CRITERION_KEYS) {
    assert.doesNotMatch(criterionKeyCheckBlock[0], new RegExp(`'${key}'`));
  }
});

test("A1.2 all six Package-A criterion keys are representable under the general criterion_key shape CHECK", () => {
  const keyCheck = migrationSource.match(
    /impact_evaluation_criteria_a1_2_criterion_key_check\s+CHECK \(criterion_key ~ '([^']+)'\)/,
  );
  assert.ok(keyCheck, "expected criterion_key shape CHECK");
  const pattern = new RegExp(keyCheck[1]);
  for (const key of PACKAGE_A_CRITERION_KEYS) {
    assert.equal(pattern.test(key), true, `expected '${key}' to satisfy the criterion_key shape CHECK`);
  }
  assert.equal(pattern.test(""), false, "empty criterion_key must still fail");
});

test("A1.2 criteria belong to an exact framework version via a non-composite FK to impact_evaluation_framework_versions", () => {
  assert.match(
    migrationSource,
    /impact_evaluation_criteria_a1_2_framework_version_fk\s+FOREIGN KEY \(framework_version_id\)\s+REFERENCES kai\.impact_evaluation_framework_versions \(framework_version_id\)/,
  );
});

test("A1.2 prevents a duplicate criterion_key inside one framework version, but the same criterion_key may exist across different versions", () => {
  assert.match(
    migrationSource,
    /impact_evaluation_criteria_a1_2_key_unique\s+UNIQUE \(framework_version_id, criterion_key\)/,
  );
  assert.doesNotMatch(migrationSource, /UNIQUE \(criterion_key\)[^,)]/);
});

test("A1.2 prevents a duplicate display_order inside one framework version and requires non-negative ordering", () => {
  assert.match(
    migrationSource,
    /impact_evaluation_criteria_a1_2_display_order_unique\s+UNIQUE \(framework_version_id, display_order\)/,
  );
  assert.match(
    migrationSource,
    /impact_evaluation_criteria_a1_2_display_order_check\s+CHECK \(display_order >= 0\)/,
  );
});

test("A1.2 criterion definitions persist nonblank, bounded description and evaluation_guidance data (not a code-only stub)", () => {
  assert.match(
    migrationSource,
    /impact_evaluation_criteria_a1_2_description_check\s+CHECK \(btrim\(description\) <> '' AND char_length\(description\) <= 4000\)/,
  );
  assert.match(
    migrationSource,
    /impact_evaluation_criteria_a1_2_evaluation_guidance_check\s+CHECK \(btrim\(evaluation_guidance\) <> '' AND char_length\(evaluation_guidance\) <= 4000\)/,
  );
  assert.match(
    migrationSource,
    /impact_evaluation_criteria_a1_2_criterion_label_check\s+CHECK \(btrim\(criterion_label\) <> '' AND char_length\(criterion_label\) <= 200\)/,
  );
});

test("A1.2 does not introduce evaluation, criterion-result, provenance, requirement, funder, or gap tables, and makes no formal external-alignment claim", () => {
  for (const forbidden of [
    /kai\.impact_evaluations?\b/i,
    /kai\.criterion_results?\b/i,
    /kai\.evaluation_results?\b/i,
    /kai\.provenance\b/i,
    /kai\.requirements?\b/i,
    /kai\.funders?\b/i,
    /kai\.impact_gaps?\b/i,
    /common[_ ]approach/i,
    /\bcids\b/i,
    /aligned_with/i,
  ]) {
    assert.doesNotMatch(migrationSource, forbidden);
  }
});

test("A1.2 does not create a separate framework-identity table beyond the version-scoped framework_versions relation", () => {
  assert.doesNotMatch(migrationSource, /kai\.impact_evaluation_frameworks\b/);
  assert.doesNotMatch(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.(?!impact_evaluation_framework_versions\b|impact_evaluation_criteria\b)/);
});

test("A1.2 rollback removes exactly what the forward migration created, in dependency-safe order, and never touches A1.1", () => {
  assert.match(rollbackSource, /^BEGIN;/);
  assert.match(rollbackSource, /COMMIT;\s*$/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.impact_evaluation_criteria/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.impact_evaluation_framework_versions/);
  assert.match(rollbackSource, /DROP INDEX IF EXISTS kai\.ix_impact_evaluation_criteria_a1_2_framework_version/);
  assert.match(rollbackSource, /DROP INDEX IF EXISTS kai\.ux_impact_evaluation_framework_versions_a1_2_active_per_code/);
  assert.doesNotMatch(rollbackSource, /kai\.impact_outcome_contexts/);

  const criteriaDropIndex = rollbackSource.indexOf("DROP TABLE IF EXISTS kai.impact_evaluation_criteria");
  const frameworkDropIndex = rollbackSource.indexOf("DROP TABLE IF EXISTS kai.impact_evaluation_framework_versions");
  assert.ok(
    criteriaDropIndex >= 0 && frameworkDropIndex >= 0 && criteriaDropIndex < frameworkDropIndex,
    "criteria (the referencing child table) must be dropped before framework_versions (the referenced parent)",
  );
});
