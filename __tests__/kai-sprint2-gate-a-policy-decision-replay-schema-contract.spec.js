import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const inMemoryRepositorySource = readFileSync("Backend/kai/upload/inMemoryUploadLifecycleRepository.js", "utf8");
const followUpMigrationSource = readFileSync("migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql", "utf8");
const followUpRollbackSource = readFileSync("migrations/kai_sprint2_gate_a_p0_policy_decision_replay.rollback.sql", "utf8");

test("Gate A durable policy replay schema maps to accepted synthetic compareAndSetPolicyDecision facts", () => {
  assert.match(inMemoryRepositorySource, /compareAndSetPolicyDecision\(input\)/);
  assert.match(inMemoryRepositorySource, /const allowedKeys = new Set\(\[\s+"confirmedFileFacts",\s+"expectedFilePolicyStatus",\s+"policyDecisionOutcome",\s+"sanitizedResult",\s+"metadataOnlyAudit",\s+"now",\s+\]\)/);
  assert.match(inMemoryRepositorySource, /function policyReplayFromInput\(input\)/);
  assert.match(inMemoryRepositorySource, /function samePolicyReplay\(left, right\)/);
  assert.match(inMemoryRepositorySource, /stableJson\(left\?\.sanitized_result\) === stableJson\(right\.sanitized_result\)/);

  for (const replayFact of [
    "organization_id",
    "intake_file_id",
    "object_version_id",
    "verified_checksum",
    "verified_size_bytes",
    "declared_mime",
    "extension",
    "file_policy_status",
    "sanitized_result",
  ]) {
    assert.match(followUpMigrationSource, new RegExp(`\\b${replayFact}\\b`), replayFact);
  }

  assert.match(followUpMigrationSource, /sanitized_result_canonical_sha256 text NOT NULL/);
  assert.match(followUpMigrationSource, /replay_contract_version text NOT NULL DEFAULT 'in_memory_policy_replay_v1'/);
  assert.match(followUpMigrationSource, /PRIMARY KEY \(organization_id, intake_file_id\)/);
  assert.match(followUpMigrationSource, /FOREIGN KEY \(organization_id, intake_file_id\)\s+REFERENCES kai\.intake_files \(organization_id, intake_file_id\)/);
});

test("Gate A durable policy replay schema amends only existing lifecycle audit vocabulary for policy CAS", () => {
  assert.match(inMemoryRepositorySource, /attempted_operation: "policy_decision_compare_and_set"/);
  assert.match(inMemoryRepositorySource, /preparedAudit = input\.metadataOnlyAudit\.prepareMetadataOnlyAudit/);
  assert.match(inMemoryRepositorySource, /stateHolder\.state\.records\.set\(key, next\);\s+preparedAudit\.publish\(\);/);
  assert.match(inMemoryRepositorySource, /return uploadLifecycleSuccess\(\{ record: copyRecord\(next\), replayed: false \}\)/);
  assert.match(inMemoryRepositorySource, /return uploadLifecycleSuccess\(\{ record: copyRecord\(record\), replayed: true \}\)/);

  assert.match(followUpMigrationSource, /ALTER TABLE kai\.upload_lifecycle_audit/);
  assert.match(followUpMigrationSource, /policy_decision_compare_and_set/);
  assert.doesNotMatch(followUpMigrationSource, /CREATE TABLE IF NOT EXISTS kai\.(?!upload_policy_decision_replay\b)/);
  assert.doesNotMatch(followUpMigrationSource, /\bkai\.audit_events\b/);
  assert.doesNotMatch(followUpMigrationSource, /\b(?:raw_bytes|raw_text|prompt_text|signed_url|credentials|private_path)\s+(?:text|jsonb|bytea)\b/i);
});

test("Gate A policy replay rollback draft targets only the follow-up amendment", () => {
  assert.match(followUpRollbackSource, /DROP TABLE IF EXISTS kai\.upload_policy_decision_replay/);
  assert.match(followUpRollbackSource, /DROP FUNCTION IF EXISTS kai\.gate_a_p0_jsonb_metadata_only\(jsonb\)/);
  assert.match(followUpRollbackSource, /DELETE FROM kai\.upload_lifecycle_audit\s+WHERE operation = 'policy_decision_compare_and_set'/);
  assert.doesNotMatch(followUpRollbackSource, /CHECK \(operation IN \([^)]*policy_decision_compare_and_set/);
  assert.doesNotMatch(followUpRollbackSource, /DROP COLUMN IF EXISTS upload_state/);
  assert.doesNotMatch(followUpRollbackSource, /DROP TABLE IF EXISTS kai\.upload_lifecycle_audit/);
  assert.doesNotMatch(followUpRollbackSource, /DROP TRIGGER IF EXISTS trg_gate_a_p0_upload_lifecycle/);
});
