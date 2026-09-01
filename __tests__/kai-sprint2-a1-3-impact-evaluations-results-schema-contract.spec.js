import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_a1_3_impact_evaluations_and_results.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_a1_3_impact_evaluations_and_results.rollback.sql", "utf8");
const a1_1MigrationSource = readFileSync("migrations/kai_sprint2_a1_1_impact_outcome_context.sql", "utf8");
const a1_2MigrationSource = readFileSync("migrations/kai_sprint2_a1_2_impact_evaluation_framework_and_criteria.sql", "utf8");

const ASSESSMENT_STATES = [
  "supported",
  "supported_with_limitation",
  "not_supported",
  "needs_more_information",
  "not_applicable",
];

test("A1.3 migration is wrapped in a transaction and guards on A1.1/A1.2 objects already existing", () => {
  assert.match(migrationSource, /^BEGIN;/);
  assert.match(migrationSource, /COMMIT;\s*$/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.impact_outcome_contexts is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.impact_evaluation_framework_versions is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.impact_evaluation_criteria is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.impact_outcome_contexts_a1_1_id_org_unique is required/);
});

test("A1.1 semantics are unchanged: the A1.1 migration file itself is untouched by this package", () => {
  assert.match(a1_1MigrationSource, /CREATE TABLE IF NOT EXISTS kai\.impact_outcome_contexts/);
  assert.doesNotMatch(a1_1MigrationSource, /impact_evaluations\b|impact_evaluation_results\b/);
});

test("A1.2 semantics are unchanged: the A1.2 migration file itself is untouched, and A1.3 makes only the one documented additive compatibility change", () => {
  assert.doesNotMatch(a1_2MigrationSource, /impact_evaluation_criteria_a1_3_id_framework_version_unique/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.impact_evaluation_framework_versions/);
  assert.doesNotMatch(migrationSource, /DROP\s+(?:TABLE|CONSTRAINT)[\s\S]{0,80}impact_evaluation_framework_versions_a1_2/);
  assert.doesNotMatch(migrationSource, /DROP\s+(?:TABLE|CONSTRAINT)[\s\S]{0,80}impact_evaluation_criteria_a1_2/);
});

test("A1.3 adds only the smallest A1.2 compatibility constraint: a redundant UNIQUE(criterion_id, framework_version_id) on kai.impact_evaluation_criteria", () => {
  assert.match(
    migrationSource,
    /ALTER TABLE kai\.impact_evaluation_criteria\s+ADD CONSTRAINT impact_evaluation_criteria_a1_3_id_framework_version_unique\s+UNIQUE \(criterion_id, framework_version_id\)/,
  );
  const alterStatements = [...migrationSource.matchAll(/ALTER TABLE kai\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(alterStatements, ["impact_evaluation_criteria"]);
});

test("A1.3 creates only impact_evaluations and impact_evaluation_results", () => {
  const createdTables = [...migrationSource.matchAll(/CREATE TABLE IF NOT EXISTS kai\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(createdTables.sort(), ["impact_evaluation_results", "impact_evaluations"]);
});

test("A1.3 impact_evaluations declares the minimum snapshot column list, never duplicating engagement_id", () => {
  for (const column of [
    "impact_evaluation_id",
    "organization_id",
    "impact_outcome_context_id",
    "framework_version_id",
    "created_by_type",
    "created_at",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected impact_evaluations column ${column}`);
  }
  const evaluationsTableBody = migrationSource.match(
    /CREATE TABLE IF NOT EXISTS kai\.impact_evaluations \(([\s\S]*?)\n\);/,
  );
  assert.ok(evaluationsTableBody);
  assert.doesNotMatch(evaluationsTableBody[1], /\bengagement_id\b/);
});

test("A1.3 evaluation is bound to its outcome context via a tenant-safe composite FK (cross-organization binding rejected at the database level)", () => {
  assert.match(
    migrationSource,
    /impact_evaluations_a1_3_outcome_context_fk\s+FOREIGN KEY \(impact_outcome_context_id, organization_id\)\s+REFERENCES kai\.impact_outcome_contexts \(impact_outcome_context_id, organization_id\)/,
  );
});

test("A1.3 evaluation is pinned to exactly one framework_version_id via a NOT NULL column and a plain FK", () => {
  assert.match(migrationSource, /framework_version_id uuid NOT NULL/);
  assert.match(
    migrationSource,
    /impact_evaluations_a1_3_framework_version_fk\s+FOREIGN KEY \(framework_version_id\)\s+REFERENCES kai\.impact_evaluation_framework_versions \(framework_version_id\)/,
  );
});

test("A1.3 allows multiple historical evaluations of the same outcome context/framework version: no uniqueness constraint blocks repetition", () => {
  assert.doesNotMatch(migrationSource, /UNIQUE \(impact_outcome_context_id, framework_version_id\)/);
  assert.doesNotMatch(migrationSource, /UNIQUE \(organization_id, impact_outcome_context_id, framework_version_id\)/);
});

test("A1.3 exposes the exact downstream tenant/framework-safe identity for impact_evaluations", () => {
  assert.match(
    migrationSource,
    /impact_evaluations_a1_3_id_org_framework_unique\s+UNIQUE \(impact_evaluation_id, organization_id, framework_version_id\)/,
  );
});

test("A1.3 impact_evaluation_results declares the minimum result column list", () => {
  for (const column of [
    "impact_evaluation_result_id",
    "organization_id",
    "impact_evaluation_id",
    "framework_version_id",
    "criterion_id",
    "assessment_state",
    "safe_explanation",
    "limitation_notes",
    "created_at",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected impact_evaluation_results column ${column}`);
  }
});

test("A1.3 duplicate criterion result within one evaluation is rejected by UNIQUE (impact_evaluation_id, criterion_id)", () => {
  assert.match(
    migrationSource,
    /impact_evaluation_results_a1_3_identity_unique\s+UNIQUE \(impact_evaluation_id, criterion_id\)/,
  );
});

test("A1.3 enforces result.organization_id = evaluation.organization_id AND result.framework_version_id = evaluation.framework_version_id via one composite FK to the A1.3 evaluation identity", () => {
  assert.match(
    migrationSource,
    /impact_evaluation_results_a1_3_evaluation_fk\s+FOREIGN KEY \(impact_evaluation_id, organization_id, framework_version_id\)\s+REFERENCES kai\.impact_evaluations \(impact_evaluation_id, organization_id, framework_version_id\)/,
  );
});

test("A1.3 enforces criterion_id belongs to result.framework_version_id via a composite FK to the new criteria compatibility constraint", () => {
  assert.match(
    migrationSource,
    /impact_evaluation_results_a1_3_criterion_fk\s+FOREIGN KEY \(criterion_id, framework_version_id\)\s+REFERENCES kai\.impact_evaluation_criteria \(criterion_id, framework_version_id\)/,
  );
});

test("A1.3 pins assessment_state to exactly the five analytical Impact Evaluation states, with no numerical score column anywhere", () => {
  const check = migrationSource.match(
    /impact_evaluation_results_a1_3_assessment_state_check\s+CHECK \(assessment_state IN \(([\s\S]*?)\)\)/,
  );
  assert.ok(check, "expected assessment_state CHECK");
  for (const state of ASSESSMENT_STATES) {
    assert.match(check[1], new RegExp(`'${state}'`), state);
  }
  const stateValues = [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(stateValues.sort(), [...ASSESSMENT_STATES].sort());
  assert.doesNotMatch(migrationSource, /\bscore\b/i);
  assert.doesNotMatch(migrationSource, /numeric|decimal\(/i);
});

test("A1.3 requires non-empty limitation_notes exactly when assessment_state is supported_with_limitation, and forbids it for every other state", () => {
  assert.match(
    migrationSource,
    /impact_evaluation_results_a1_3_limitation_notes_pairing_check\s+CHECK \(\s*\(assessment_state = 'supported_with_limitation' AND limitation_notes IS NOT NULL AND btrim\(limitation_notes\) <> ''\)\s*OR \(assessment_state <> 'supported_with_limitation' AND limitation_notes IS NULL\)\s*\)/,
  );
});

test("A1.3 supported_with_limitation is a valid, non-terminal analytical state with no causal/counterfactual proof claim encoded", () => {
  assert.match(migrationSource, /'supported_with_limitation'/);
  assert.doesNotMatch(migrationSource, /causal proof|counterfactual proof|proves? causation/i);
});

test("A1.3 rejects blank safe_explanation via a nonblank bounded-text CHECK", () => {
  assert.match(
    migrationSource,
    /impact_evaluation_results_a1_3_safe_explanation_check\s+CHECK \(btrim\(safe_explanation\) <> '' AND char_length\(safe_explanation\) <= 2000\)/,
  );
});

test("A1.3 does not introduce provenance, requirement, funder, gap, or review-queue functionality, and adds no route/service/UI file", () => {
  for (const forbidden of [
    /kai\.provenance\b/i,
    /kai\.requirements?\b/i,
    /kai\.funders?\b/i,
    /kai\.impact_gaps?\b/i,
    /kai\.review_queue_items\b/i,
    /kai\.recommendations?\b/i,
  ]) {
    assert.doesNotMatch(migrationSource, forbidden);
  }
});

test("A1.3 rollback removes exactly what the forward migration created, in dependency-safe order, and drops only the added compatibility constraint from A1.2's table", () => {
  assert.match(rollbackSource, /^BEGIN;/);
  assert.match(rollbackSource, /COMMIT;\s*$/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.impact_evaluation_results/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.impact_evaluations/);
  assert.match(
    rollbackSource,
    /ALTER TABLE IF EXISTS kai\.impact_evaluation_criteria\s+DROP CONSTRAINT IF EXISTS impact_evaluation_criteria_a1_3_id_framework_version_unique/,
  );
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.impact_evaluation_criteria\b/);
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.impact_evaluation_framework_versions\b/);
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.impact_outcome_contexts\b/);

  const resultsDropIndex = rollbackSource.indexOf("DROP TABLE IF EXISTS kai.impact_evaluation_results");
  const evaluationsDropIndex = rollbackSource.indexOf("DROP TABLE IF EXISTS kai.impact_evaluations");
  assert.ok(
    resultsDropIndex >= 0 && evaluationsDropIndex >= 0 && resultsDropIndex < evaluationsDropIndex,
    "results (the referencing child table) must be dropped before impact_evaluations (the referenced parent)",
  );
});
