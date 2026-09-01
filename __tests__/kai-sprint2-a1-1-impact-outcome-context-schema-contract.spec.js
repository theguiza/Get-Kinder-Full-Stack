import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_a1_1_impact_outcome_context.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_a1_1_impact_outcome_context.rollback.sql", "utf8");

test("A1.1 migration is wrapped in a transaction and guards on kai.organizations/kai.engagements already existing", () => {
  assert.match(migrationSource, /^BEGIN;/);
  assert.match(migrationSource, /COMMIT;\s*$/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.organizations is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.engagements is required/);
});

test("A1.1 migration never modifies kai.organizations or kai.engagements and creates only the impact_outcome_contexts relation", () => {
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.organizations/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.engagements/);
  assert.doesNotMatch(migrationSource, /DROP TABLE[\s\S]*?kai\.(?:organizations|engagements)\b/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.impact_outcome_contexts/);
  assert.doesNotMatch(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.(?!impact_outcome_contexts\b)/);
});

test("A1.1 impact_outcome_contexts declares the minimum canonical-subject column list", () => {
  for (const column of [
    "impact_outcome_context_id",
    "organization_id",
    "engagement_id",
    "outcome_key",
    "outcome_statement",
    "stakeholder_key",
    "stakeholder_label",
    "created_by",
    "created_by_type",
    "created_at",
    "updated_at",
  ]) {
    assert.match(migrationSource, new RegExp(`\\b${column}\\b`), `expected column ${column}`);
  }
});

test("A1.1 organization_id is NOT NULL and engagement_id is nullable (organization-level knowledge)", () => {
  assert.match(migrationSource, /organization_id uuid NOT NULL/);
  assert.match(migrationSource, /engagement_id uuid,\s*$/m);
  assert.doesNotMatch(migrationSource, /engagement_id uuid NOT NULL/);
});

test("A1.1 binds organization_id to kai.organizations and (engagement_id, organization_id) to kai.engagements", () => {
  assert.match(
    migrationSource,
    /impact_outcome_contexts_a1_1_organization_fk\s+FOREIGN KEY \(organization_id\)\s+REFERENCES kai\.organizations \(organization_id\)/,
  );
  assert.match(
    migrationSource,
    /impact_outcome_contexts_a1_1_engagement_fk\s+FOREIGN KEY \(engagement_id, organization_id\)\s+REFERENCES kai\.engagements \(engagement_id, organization_id\)/,
  );
});

test("A1.1 rejects blank outcome_statement/stakeholder_label via nonblank bounded-text CHECKs", () => {
  assert.match(
    migrationSource,
    /impact_outcome_contexts_a1_1_outcome_statement_check\s+CHECK \(btrim\(outcome_statement\) <> '' AND char_length\(outcome_statement\) <= 2000\)/,
  );
  assert.match(
    migrationSource,
    /impact_outcome_contexts_a1_1_stakeholder_label_check\s+CHECK \(btrim\(stakeholder_label\) <> '' AND char_length\(stakeholder_label\) <= 200\)/,
  );
});

test("A1.1 rejects blank outcome_key/stakeholder_key via a bounded identifier-shape CHECK (empty string never matches)", () => {
  const outcomeKeyCheck = migrationSource.match(
    /impact_outcome_contexts_a1_1_outcome_key_check\s+CHECK \(outcome_key ~ '([^']+)'\)/,
  );
  const stakeholderKeyCheck = migrationSource.match(
    /impact_outcome_contexts_a1_1_stakeholder_key_check\s+CHECK \(stakeholder_key ~ '([^']+)'\)/,
  );
  assert.ok(outcomeKeyCheck, "expected outcome_key shape CHECK");
  assert.ok(stakeholderKeyCheck, "expected stakeholder_key shape CHECK");
  assert.doesNotMatch(new RegExp(outcomeKeyCheck[1]).source, /\^\$|\*\)?\$/);
  assert.equal(new RegExp(outcomeKeyCheck[1]).test(""), false, "empty outcome_key must fail the shape CHECK");
  assert.equal(new RegExp(stakeholderKeyCheck[1]).test(""), false, "empty stakeholder_key must fail the shape CHECK");
});

test("A1.1 same outcome_key may repeat for different stakeholder_key values: identity is (organization, engagement, outcome, stakeholder), not outcome alone", () => {
  assert.match(
    migrationSource,
    /impact_outcome_contexts_a1_1_identity_unique\s+UNIQUE \(organization_id, engagement_id, outcome_key, stakeholder_key\)/,
  );
  assert.doesNotMatch(migrationSource, /UNIQUE \(organization_id, engagement_id, outcome_key\)[^,]/);
});

test("A1.1 closes the NULL-engagement uniqueness gap with a partial unique index scoped to engagement_id IS NULL", () => {
  assert.match(
    migrationSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS ux_impact_outcome_contexts_a1_1_org_level_identity\s+ON kai\.impact_outcome_contexts \(organization_id, outcome_key, stakeholder_key\)\s+WHERE engagement_id IS NULL/,
  );
});

test("A1.1 pins created_by_type to the human/system vocabulary and defaults it to human", () => {
  assert.match(migrationSource, /created_by_type text NOT NULL DEFAULT 'human'/);
  assert.match(migrationSource, /impact_outcome_contexts_a1_1_created_by_type_check\s+CHECK \(created_by_type IN \('human', 'system'\)\)/);
});

test("A1.1 maintains updated_at via a dedicated BEFORE UPDATE trigger, mirroring the gk_organization_bindings precedent", () => {
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION kai\.touch_impact_outcome_contexts_updated_at\(\)/);
  assert.match(migrationSource, /NEW\.updated_at := now\(\);/);
  assert.match(
    migrationSource,
    /CREATE TRIGGER trg_impact_outcome_contexts_touch_updated_at\s*\nBEFORE UPDATE ON kai\.impact_outcome_contexts/,
  );
});

test("A1.1 does not build framework, evaluation, criterion-result, provenance, requirement, funder, gap, or AI-evaluation objects", () => {
  for (const forbidden of [
    /kai\.impact_frameworks\b/i,
    /kai\.impact_evaluations\b/i,
    /kai\.criterion_results?\b/i,
    /kai\.provenance\b/i,
    /kai\.requirements?\b/i,
    /kai\.funders?\b/i,
    /kai\.impact_gaps?\b/i,
    /kai\.ai_evaluations?\b/i,
    /kai\.populations?\b/i,
    /kai\.programs?\b/i,
    /kai\.indicators?\b/i,
    /kai\.impact_models?\b/i,
  ]) {
    assert.doesNotMatch(migrationSource, forbidden);
  }
});

test("A1.1 rollback removes exactly what the forward migration created, in dependency-safe order, and never touches kai.organizations/kai.engagements", () => {
  assert.match(rollbackSource, /^BEGIN;/);
  assert.match(rollbackSource, /COMMIT;\s*$/);
  assert.match(rollbackSource, /DROP TRIGGER IF EXISTS trg_impact_outcome_contexts_touch_updated_at ON kai\.impact_outcome_contexts/);
  assert.match(rollbackSource, /DROP FUNCTION IF EXISTS kai\.touch_impact_outcome_contexts_updated_at\(\)/);
  assert.match(rollbackSource, /DROP INDEX IF EXISTS kai\.ux_impact_outcome_contexts_a1_1_org_level_identity/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.impact_outcome_contexts/);
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.(?:organizations|engagements)\b/);

  const triggerDropIndex = rollbackSource.indexOf("DROP TRIGGER IF EXISTS trg_impact_outcome_contexts_touch_updated_at");
  const tableDropIndex = rollbackSource.indexOf("DROP TABLE IF EXISTS kai.impact_outcome_contexts");
  assert.ok(triggerDropIndex >= 0 && tableDropIndex >= 0 && triggerDropIndex < tableDropIndex);
});
