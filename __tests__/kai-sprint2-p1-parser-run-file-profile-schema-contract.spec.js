import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_p1_parser_run_and_file_profile.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_p1_parser_run_and_file_profile.rollback.sql", "utf8");

test("P1-02 parser-run table matches the accepted identity and lifecycle contract", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.intake_parser_runs/);
  assert.match(migrationSource, /UNIQUE \(organization_id, intake_file_id, parser_name, parser_version, checksum\)/);
  assert.match(migrationSource, /CONSTRAINT intake_parser_runs_p1_identity_unique/);
  assert.match(migrationSource, /FOREIGN KEY \(organization_id, intake_file_id\)\s+REFERENCES kai\.intake_files \(organization_id, intake_file_id\)/);
  assert.match(migrationSource, /run_state text NOT NULL DEFAULT 'started'/);
  assert.match(migrationSource, /CHECK \(run_state IN \('started', 'succeeded', 'failed'\)\)/);
  assert.match(migrationSource, /CONSTRAINT intake_parser_runs_p1_state_fact_consistency_check/);
  assert.match(migrationSource, /checksum ~ '\^\[a-f0-9\]\{64\}\$'/);
});

test("P1-02 file-profile table is redacted-only and bound to its producing parser run", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.intake_file_profiles/);
  assert.match(migrationSource, /CONSTRAINT intake_file_profiles_p1_identity_unique/);
  assert.match(migrationSource, /FOREIGN KEY \(parser_run_id\)\s+REFERENCES kai\.intake_parser_runs \(parser_run_id\)/);
  assert.match(migrationSource, /CHECK \(jsonb_typeof\(profile\) = 'object'\)/);
  assert.match(migrationSource, /CHECK \(kai\.gate_a_p0_jsonb_metadata_only\(profile\)\)/);
  assert.match(migrationSource, /profile_canonical_sha256 text NOT NULL/);
  assert.doesNotMatch(migrationSource, /\b(?:raw_bytes|raw_text|raw_content|full_text|extracted_text|parsed_rows)\s+(?:text|jsonb|bytea)\b/i);
});

test("P1-02 migration amends only the existing lifecycle audit vocabulary, not the audit table shape", () => {
  assert.match(migrationSource, /ALTER TABLE kai\.upload_lifecycle_audit/);
  assert.match(migrationSource, /parser_run_recorded/);
  assert.match(migrationSource, /file_profile_persisted/);
  assert.match(migrationSource, /NOT metadata \? 'profile'/);
  assert.doesNotMatch(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.(?!intake_parser_runs\b|intake_file_profiles\b)/);
  assert.doesNotMatch(migrationSource, /\bkai\.(?:data_dictionaries|quality_records|sensitivity_records|review_workflow|source_candidates|promotion_decisions|sources|source_versions)\b/);
  assert.doesNotMatch(migrationSource, /\bsource_version\b/);
});

test("P1-02 migration guards on prerequisite Gate A objects and does not modify them", () => {
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.intake_files is required/);
  assert.match(migrationSource, /RAISE EXCEPTION 'kai\.upload_lifecycle_audit is required/);
  assert.match(migrationSource, /gate_a_p0_jsonb_metadata_only/);
  assert.doesNotMatch(migrationSource, /DROP TABLE IF EXISTS kai\.upload_lifecycle_audit/);
  assert.doesNotMatch(migrationSource, /ALTER TABLE kai\.intake_files/);
});

test("P1-02 rollback draft targets only the new tables and reverts only the new audit vocabulary", () => {
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.intake_file_profiles/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.intake_parser_runs/);
  assert.match(rollbackSource, /DELETE FROM kai\.upload_lifecycle_audit\s+WHERE operation IN \('parser_run_recorded', 'file_profile_persisted'\)/);
  assert.doesNotMatch(rollbackSource, /CHECK \(operation IN \([^)]*parser_run_recorded/);
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.upload_lifecycle_audit/);
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.upload_policy_decision_replay/);
  assert.doesNotMatch(rollbackSource, /DROP COLUMN IF EXISTS upload_state/);
  assert.doesNotMatch(rollbackSource, /DROP TRIGGER IF EXISTS trg_gate_a_p0_upload_lifecycle/);
});
