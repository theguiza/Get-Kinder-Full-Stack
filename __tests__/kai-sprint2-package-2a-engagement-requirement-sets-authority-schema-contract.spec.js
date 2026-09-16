import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertConstraintCatalogMatch,
} from "../scripts/kai-sprint2-package-2a-constraint-verifier.js";

const migrationSource = readFileSync("migrations/kai_sprint2_package_2a_engagement_requirement_sets_authority.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_package_2a_engagement_requirement_sets_authority.rollback.sql", "utf8");

test("Package 2A migration is transaction-wrapped and alters only kai.engagement_requirement_sets", () => {
  assert.match(migrationSource, /^BEGIN;/);
  assert.match(migrationSource, /COMMIT;\s*$/);
  assert.match(migrationSource, /to_regclass\('kai\.engagement_requirement_sets'\)/);
  assert.match(migrationSource, /ALTER TABLE kai\.engagement_requirement_sets/);
  assert.doesNotMatch(migrationSource, /CREATE TABLE/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.(?!engagement_requirement_sets\b)\w+/);
  assert.doesNotMatch(migrationSource, /INSERT INTO|UPDATE kai\.|DELETE FROM/);
});

test("Package 2A adds reviewed authority, effective state, supersession, and approved target-context columns", () => {
  for (const column of [
    "reviewed_by",
    "reviewed_by_role",
    "reviewed_at",
    "applicability_effective_state",
    "supersedes_engagement_requirement_set_id",
    "target_context_identity",
  ]) {
    assert.match(migrationSource, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`));
  }
});

test("Package 2A reviewed authority and effective applicability checks are bounded", () => {
  assert.match(
    migrationSource,
    /engagement_requirement_sets_package_2a_reviewed_authority_check[\s\S]*reviewed_by_role IN \('gk_admin', 'gk_operator', 'gk_reviewer', 'client_admin'\)[\s\S]*reviewed_at IS NOT NULL/,
  );
  assert.match(
    migrationSource,
    /engagement_requirement_sets_package_2a_effective_state_check\s+CHECK \(applicability_effective_state IN \('pending_review', 'applicable', 'not_applicable', 'retired'\)\)/,
  );
  assert.match(
    migrationSource,
    /engagement_requirement_sets_package_2a_reviewed_effective_consistency_check[\s\S]*applicability_status = 'confirmed'[\s\S]*reviewed_by IS NOT NULL[\s\S]*target_context_identity IS NOT NULL/,
  );
  assert.match(
    migrationSource,
    /engagement_requirement_sets_package_2a_approved_target_check[\s\S]*jsonb_typeof\(target_context_identity\) = 'object'[\s\S]*target_context_identity \? 'target_funder_id'[\s\S]*target_context_identity \? 'target_framework'/,
  );
});

test("Package 2A replaces the old singleton identity with append-only lineage constraints", () => {
  assert.match(migrationSource, /DROP CONSTRAINT IF EXISTS engagement_requirement_sets_b1_1_identity_unique/);
  assert.match(
    migrationSource,
    /engagement_requirement_sets_package_2a_id_org_engagement_set_unique\s+UNIQUE \(engagement_requirement_set_id, organization_id, engagement_id, requirement_set_id\)/,
  );
  assert.match(
    migrationSource,
    /engagement_requirement_sets_package_2a_supersedes_fk[\s\S]*FOREIGN KEY \(supersedes_engagement_requirement_set_id, organization_id, engagement_id, requirement_set_id\)[\s\S]*REFERENCES kai\.engagement_requirement_sets \(engagement_requirement_set_id, organization_id, engagement_id, requirement_set_id\)/,
  );
  assert.match(migrationSource, /engagement_requirement_sets_package_2a_not_self_superseding/);
  assert.match(
    migrationSource,
    /ux_engagement_requirement_sets_package_2a_current_identity[\s\S]*ON kai\.engagement_requirement_sets \(organization_id, engagement_id, requirement_set_id\)[\s\S]*WHERE supersedes_engagement_requirement_set_id IS NULL/,
  );
  assert.match(
    migrationSource,
    /ux_engagement_requirement_sets_package_2a_single_successor[\s\S]*ON kai\.engagement_requirement_sets \(supersedes_engagement_requirement_set_id\)[\s\S]*WHERE supersedes_engagement_requirement_set_id IS NOT NULL/,
  );
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION kai\.package_2a_reject_engagement_requirement_set_mutation/);
  assert.match(
    migrationSource,
    /CREATE TRIGGER trg_package_2a_engagement_requirement_sets_append_only\s+BEFORE UPDATE OR DELETE ON kai\.engagement_requirement_sets/,
  );
});

test("Package 2A rollback removes only Package 2A additions and restores B1.1 identity", () => {
  assert.match(rollbackSource, /^BEGIN;/);
  assert.match(rollbackSource, /COMMIT;\s*$/);
  assert.match(rollbackSource, /ADD CONSTRAINT engagement_requirement_sets_b1_1_identity_unique\s+UNIQUE \(organization_id, engagement_id, requirement_set_id\)/);
  for (const column of [
    "target_context_identity",
    "supersedes_engagement_requirement_set_id",
    "applicability_effective_state",
    "reviewed_at",
    "reviewed_by_role",
    "reviewed_by",
  ]) {
    assert.match(rollbackSource, new RegExp(`DROP COLUMN IF EXISTS ${column}\\b`));
  }
  assert.match(rollbackSource, /DROP TRIGGER IF EXISTS trg_package_2a_engagement_requirement_sets_append_only/);
  assert.match(rollbackSource, /DROP FUNCTION IF EXISTS kai\.package_2a_reject_engagement_requirement_set_mutation/);
  assert.doesNotMatch(rollbackSource, /DROP TABLE/);
});

test("Package 2A final-two verifier rejects ambiguous or wrong truncated constraint catalog matches", () => {
  const spec = {
    label: "reviewed/effective consistency check",
    identifierPrefix: "engagement_requirement_sets_package_2a_reviewed_effective_consi",
    contype: "c",
    definition:
      "CHECK (((applicability_effective_state = 'pending_review'::text) OR ((applicability_status = 'confirmed'::text) AND (reviewed_by IS NOT NULL) AND (reviewed_by_role IS NOT NULL) AND (reviewed_at IS NOT NULL) AND (target_context_identity IS NOT NULL))))",
  };
  const validRow = {
    conname: "engagement_requirement_sets_package_2a_reviewed_effective_consi",
    contype: "c",
    convalidated: true,
    definition: spec.definition,
  };

  assert.doesNotThrow(() => assertConstraintCatalogMatch([validRow], spec));
  assert.throws(() => assertConstraintCatalogMatch([], spec), /expected exactly one catalog match/);
  assert.throws(() => assertConstraintCatalogMatch([validRow, { ...validRow }], spec), /expected exactly one catalog match/);
  assert.throws(() => assertConstraintCatalogMatch([{ ...validRow, definition: "CHECK (false)" }], spec), /wrong definition/);
  assert.throws(() => assertConstraintCatalogMatch([{ ...validRow, convalidated: false }], spec), /not validated/);
});
