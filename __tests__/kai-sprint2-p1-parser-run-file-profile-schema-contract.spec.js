import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_p1_parser_run_and_file_profile.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_p1_parser_run_and_file_profile.rollback.sql", "utf8");

test("P1-02 parser-run table matches the contract-quoted status vocabulary and required fields", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.intake_parser_runs/);
  assert.match(migrationSource, /UNIQUE \(organization_id, intake_file_id, parser_name, parser_version, checksum\)/);
  assert.match(migrationSource, /CONSTRAINT intake_parser_runs_p1_identity_unique/);
  assert.match(migrationSource, /CONSTRAINT intake_parser_runs_p1_run_identity_unique/);
  assert.match(migrationSource, /UNIQUE \(parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum\)/);
  assert.match(migrationSource, /FOREIGN KEY \(organization_id, intake_file_id\)\s+REFERENCES kai\.intake_files \(organization_id, intake_file_id\)/);
  assert.match(migrationSource, /parser_status text NOT NULL DEFAULT 'queued'/);
  assert.match(migrationSource, /CHECK \(parser_status IN \('queued', 'running', 'completed', 'failed', 'cancelled'\)\)/);
  assert.match(migrationSource, /retry_count integer NOT NULL DEFAULT 0/);
  assert.match(migrationSource, /CHECK \(retry_count BETWEEN 0 AND 3\)/);
  assert.match(migrationSource, /error_code text/);
  assert.match(migrationSource, /error_message_safe text/);
  assert.match(migrationSource, /output_profile_id uuid/);
  assert.match(migrationSource, /CONSTRAINT intake_parser_runs_p1_state_fact_consistency_check/);
  assert.match(migrationSource, /checksum ~ '\^\[a-f0-9\]\{64\}\$'/);
  assert.doesNotMatch(migrationSource, /\brun_state\b/);
  assert.doesNotMatch(migrationSource, /\bfailure_reason\b/);
});

test("P1-02 parser-run state/fact consistency check matches the fail-closed lifecycle rules", () => {
  assert.match(migrationSource, /parser_status = 'queued' AND completed_at IS NULL AND output_profile_id IS NULL AND error_code IS NULL AND error_message_safe IS NULL/);
  assert.match(migrationSource, /parser_status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL AND output_profile_id IS NULL AND error_code IS NULL AND error_message_safe IS NULL/);
  assert.match(migrationSource, /parser_status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND output_profile_id IS NOT NULL AND error_code IS NULL AND error_message_safe IS NULL/);
  assert.match(migrationSource, /parser_status = 'failed' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND error_code IS NOT NULL AND error_message_safe IS NOT NULL AND output_profile_id IS NULL/);
  assert.match(migrationSource, /parser_status = 'cancelled' AND completed_at IS NOT NULL AND output_profile_id IS NULL/);
});

test("P1-02 safe error fields reject raw/unsafe content by construction", () => {
  assert.match(migrationSource, /CONSTRAINT intake_parser_runs_p1_error_code_check/);
  assert.match(migrationSource, /CONSTRAINT intake_parser_runs_p1_error_message_safe_check/);
  assert.match(migrationSource, /error_message_safe !~\* '\(https\?:\/\/\|\/Users\/\|\/private\/\|\/var\/\|\/etc\/\|password\|secret\|api\[_-\]\?key\|token\|credential\|Bearer\\s\|stack \?trace\|traceback\|  at \[A-Za-z\]\)'/);
});

test("P1-02 file-profile table is redacted-only and bound to its producing parser run by composite lineage", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.intake_file_profiles/);
  assert.match(migrationSource, /CONSTRAINT intake_file_profiles_p1_identity_unique/);
  assert.match(migrationSource, /CONSTRAINT intake_file_profiles_p1_run_identity_unique/);
  assert.match(migrationSource, /UNIQUE \(file_profile_id, organization_id, intake_file_id, parser_name, parser_version, checksum\)/);
  assert.match(
    migrationSource,
    /FOREIGN KEY \(parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum\)\s+REFERENCES kai\.intake_parser_runs \(parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum\)/
  );
  assert.match(migrationSource, /CHECK \(jsonb_typeof\(profile\) = 'object'\)/);
  assert.match(migrationSource, /CHECK \(kai\.gate_a_p0_jsonb_metadata_only\(profile\)\)/);
  assert.match(migrationSource, /profile_canonical_sha256 text NOT NULL/);
  assert.doesNotMatch(migrationSource, /\b(?:raw_bytes|raw_text|raw_content|full_text|extracted_text|parsed_rows)\s+(?:text|jsonb|bytea)\b/i);
});

test("P1-02 output-profile back-reference is added after both tables exist and binds to the exact run identity", () => {
  const runsTableIndex = migrationSource.indexOf("CREATE TABLE IF NOT EXISTS kai.intake_parser_runs");
  const profilesTableIndex = migrationSource.indexOf("CREATE TABLE IF NOT EXISTS kai.intake_file_profiles");
  const outputFkIndex = migrationSource.indexOf("intake_parser_runs_p1_output_profile_fk");
  assert.ok(runsTableIndex >= 0 && profilesTableIndex > runsTableIndex, "profiles table must be created after the parser-run table");
  assert.ok(outputFkIndex > profilesTableIndex, "output-profile foreign key must be added after both tables exist");
  assert.match(
    migrationSource,
    /ALTER TABLE kai\.intake_parser_runs\s+ADD CONSTRAINT intake_parser_runs_p1_output_profile_fk\s+FOREIGN KEY \(output_profile_id, organization_id, intake_file_id, parser_name, parser_version, checksum\)\s+REFERENCES kai\.intake_file_profiles \(file_profile_id, organization_id, intake_file_id, parser_name, parser_version, checksum\)\s+ON DELETE RESTRICT/
  );
});

test("P1-02 migration amends only the existing lifecycle audit vocabulary, not the audit table shape", () => {
  assert.match(migrationSource, /ALTER TABLE kai\.upload_lifecycle_audit/);
  assert.match(migrationSource, /parser_run_recorded/);
  assert.match(migrationSource, /file_profile_persisted/);
  assert.match(migrationSource, /metadata \? 'parser_status'/);
  assert.match(migrationSource, /metadata \? 'retry_count'/);
  assert.match(migrationSource, /metadata \? 'error_code'/);
  assert.match(migrationSource, /metadata \? 'error_message_safe'/);
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

test("P1-02 rollback draft drops the output-profile FK before the profile table and targets only the new objects", () => {
  const dropOutputFkIndex = rollbackSource.indexOf("intake_parser_runs_p1_output_profile_fk");
  const dropProfilesTableIndex = rollbackSource.indexOf("DROP TABLE IF EXISTS kai.intake_file_profiles");
  assert.ok(dropOutputFkIndex >= 0 && dropOutputFkIndex < dropProfilesTableIndex, "output-profile FK must be dropped before the profile table");
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.intake_file_profiles/);
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.intake_parser_runs/);
  assert.match(rollbackSource, /DELETE FROM kai\.upload_lifecycle_audit\s+WHERE operation IN \('parser_run_recorded', 'file_profile_persisted'\)/);
  assert.doesNotMatch(rollbackSource, /CHECK \(operation IN \([^)]*parser_run_recorded/);
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.upload_lifecycle_audit/);
  assert.doesNotMatch(rollbackSource, /DROP TABLE IF EXISTS kai\.upload_policy_decision_replay/);
  assert.doesNotMatch(rollbackSource, /DROP COLUMN IF EXISTS upload_state/);
  assert.doesNotMatch(rollbackSource, /DROP TRIGGER IF EXISTS trg_gate_a_p0_upload_lifecycle/);
});
