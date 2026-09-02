import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_b1_1_baseline_impact_requirements.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_b1_1_baseline_impact_requirements.rollback.sql", "utf8");

const REQUIREMENT_SOURCE_TYPES = ["kai_standard", "standard_framework", "funder", "government_program", "reporting_template", "organization"];

test("B1.1 migration is wrapped in a transaction and guards on kai.organizations/kai.engagements existing", () => {
  assert.match(migrationSource, /^BEGIN;/);
  assert.match(migrationSource, /COMMIT;\s*$/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.organizations is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.engagements is required/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.organizations\b/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.engagements\b/);
});

test("B1.1 creates exactly the five canonical objects and no others", () => {
  const createdTables = [...migrationSource.matchAll(/CREATE TABLE IF NOT EXISTS kai\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(
    createdTables.sort(),
    [
      "engagement_requirement_sets",
      "requirement_framework_versions",
      "requirement_sets",
      "requirement_sources",
      "requirements",
    ].sort(),
  );
  assert.doesNotMatch(migrationSource, /kai\.requirement_frameworks\b/);
  assert.doesNotMatch(migrationSource, /kai\.requirement_set_versions\b/);
});

test("B1.1 requirement_sources declares the required minimum columns", () => {
  for (const column of [
    "requirement_source_id",
    "source_type",
    "source_code",
    "source_name",
    "organization_id",
    "created_by",
    "created_by_type",
    "created_at",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected requirement_sources column ${column}`);
  }
});

test("B1.1 requirement_sources source_type vocabulary is exactly the six required source types", () => {
  const check = migrationSource.match(/requirement_sources_b1_1_source_type_check\s+CHECK \(source_type IN \(([^)]+)\)\)/);
  assert.ok(check, "expected source_type CHECK constraint");
  const values = check[1].split(",").map((v) => v.trim().replace(/'/g, ""));
  assert.deepEqual(values.sort(), [...REQUIREMENT_SOURCE_TYPES].sort());
});

test("B1.1 requirement_sources ties organization_id nullability to source_type = 'organization'", () => {
  assert.match(
    migrationSource,
    /requirement_sources_b1_1_organization_id_by_type_check\s+CHECK \(\s*\(source_type = 'organization' AND organization_id IS NOT NULL\)\s*OR \(source_type <> 'organization' AND organization_id IS NULL\)\s*\)/,
  );
});

test("B1.1 requirement_sources organization_id references kai.organizations with ON DELETE RESTRICT", () => {
  assert.match(
    migrationSource,
    /requirement_sources_b1_1_organization_fk\s+FOREIGN KEY \(organization_id\)\s+REFERENCES kai\.organizations \(organization_id\)\s+ON DELETE RESTRICT/,
  );
});

test("B1.1 requirement_sources uniqueness allows two organizations to share an organization-local source_code", () => {
  assert.match(
    migrationSource,
    /ux_requirement_sources_b1_1_shared_identity\s+ON kai\.requirement_sources \(source_type, source_code\)\s+WHERE organization_id IS NULL/,
  );
  assert.match(
    migrationSource,
    /ux_requirement_sources_b1_1_organization_identity\s+ON kai\.requirement_sources \(organization_id, source_code\)\s+WHERE source_type = 'organization'/,
  );
});

test("B1.1 requirement_framework_versions declares the required minimum columns and identity uniqueness", () => {
  for (const column of [
    "requirement_framework_version_id",
    "requirement_source_id",
    "framework_code",
    "framework_name",
    "version_label",
    "framework_status",
    "created_by",
    "created_by_type",
    "created_at",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected requirement_framework_versions column ${column}`);
  }
  assert.match(
    migrationSource,
    /requirement_framework_versions_b1_1_identity_unique\s+UNIQUE \(requirement_source_id, framework_code, version_label\)/,
  );
  assert.match(
    migrationSource,
    /requirement_framework_versions_b1_1_framework_status_check\s+CHECK \(framework_status IN \('draft', 'active', 'retired'\)\)/,
  );
});

test("B1.1 requirement_framework_versions does not reference any A1 evaluation-framework table", () => {
  assert.doesNotMatch(migrationSource, /impact_evaluation_framework_versions/);
  assert.doesNotMatch(migrationSource, /impact_evaluation_criteria/);
});

test("B1.1 requirement_sets belongs to exactly one framework version with no independent set-version relation", () => {
  for (const column of [
    "requirement_set_id",
    "requirement_framework_version_id",
    "set_key",
    "set_name",
    "created_by",
    "created_by_type",
    "created_at",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected requirement_sets column ${column}`);
  }
  assert.match(
    migrationSource,
    /requirement_sets_b1_1_identity_unique\s+UNIQUE \(requirement_framework_version_id, set_key\)/,
  );
});

test("B1.1 requirements belongs to exactly one requirement set and carries no assessment/coverage/mapping/gap/recommendation/alignment field", () => {
  for (const column of [
    "requirement_id",
    "requirement_set_id",
    "requirement_key",
    "requirement_label",
    "requirement_description",
    "display_order",
    "created_by",
    "created_by_type",
    "created_at",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected requirements column ${column}`);
  }
  assert.match(
    migrationSource,
    /requirements_b1_1_identity_unique\s+UNIQUE \(requirement_set_id, requirement_key\)/,
  );
  const requirementsTableBody = migrationSource.match(
    /CREATE TABLE IF NOT EXISTS kai\.requirements \(([\s\S]*?)\);/,
  );
  assert.ok(requirementsTableBody, "expected the requirements table body");
  for (const forbidden of [
    /assessment_status/i,
    /coverage_status/i,
    /evidence_id/i,
    /claim_id/i,
    /gap_status/i,
    /recommendation/i,
    /alignment/i,
  ]) {
    assert.doesNotMatch(requirementsTableBody[1], forbidden);
  }
});

test("B1.1 engagement_requirement_sets is the tenant-scoped applicability object bound through the composite engagements FK", () => {
  for (const column of [
    "engagement_requirement_set_id",
    "organization_id",
    "engagement_id",
    "requirement_set_id",
    "applicability_status",
    "created_by",
    "created_by_type",
    "created_at",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected engagement_requirement_sets column ${column}`);
  }
  assert.match(
    migrationSource,
    /engagement_requirement_sets_b1_1_engagement_fk\s+FOREIGN KEY \(engagement_id, organization_id\)\s+REFERENCES kai\.engagements \(engagement_id, organization_id\)\s+ON DELETE RESTRICT/,
  );
  assert.match(
    migrationSource,
    /engagement_requirement_sets_b1_1_identity_unique\s+UNIQUE \(organization_id, engagement_id, requirement_set_id\)/,
  );
  assert.match(
    migrationSource,
    /engagement_requirement_sets_b1_1_applicability_status_check\s+CHECK \(applicability_status IN \('proposed', 'confirmed', 'retired'\)\)/,
  );
});

test("B1.1 introduces no A1/A2, coverage, evidence/claim mapping, alignment, funder-ingestion, or gap_log_items reuse", () => {
  for (const forbidden of [
    /kai\.impact_outcome_contexts\b/,
    /kai\.impact_evaluation_framework_versions\b/,
    /kai\.impact_evaluation_criteria\b/,
    /kai\.impact_evaluations?\b/i,
    /kai\.evaluation_results?\b/i,
    /kai\.evaluation_snapshots?\b/i,
    /kai\.criterion_results?\b/i,
    /kai\.gap_log_items\b/,
    /kai\.requirement_coverage\b/i,
    /kai\.requirement_evidence\b/i,
    /kai\.requirement_claims?\b/i,
    /kai\.requirement_gaps?\b/i,
    /kai\.requirement_alignments?\b/i,
    /kai\.funder_overlays?\b/i,
  ]) {
    assert.doesNotMatch(migrationSource, forbidden);
  }
});

test("B1.1 rollback removes exactly the five B1.1 objects, in dependency-safe order, and touches nothing else", () => {
  assert.match(rollbackSource, /^BEGIN;/);
  assert.match(rollbackSource, /COMMIT;\s*$/);
  for (const table of [
    "engagement_requirement_sets",
    "requirements",
    "requirement_sets",
    "requirement_framework_versions",
    "requirement_sources",
  ]) {
    assert.match(rollbackSource, new RegExp(`DROP TABLE IF EXISTS kai\\.${table}\\b`));
  }
  assert.doesNotMatch(rollbackSource, /kai\.organizations\b/);
  assert.doesNotMatch(rollbackSource, /kai\.engagements\b/);

  const order = [
    "engagement_requirement_sets",
    "requirements",
    "requirement_sets",
    "requirement_framework_versions",
    "requirement_sources",
  ].map((table) => rollbackSource.indexOf(`DROP TABLE IF EXISTS kai.${table}`));
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i - 1] < order[i], "children must be dropped before the parents they reference");
  }
});
