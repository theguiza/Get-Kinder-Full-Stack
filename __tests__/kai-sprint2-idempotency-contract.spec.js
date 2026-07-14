import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  canonicalizeSha256Checksum,
  checksum_format_supported,
  checksum_required,
  duplicate_checksum_blocked,
  hash_algorithm_required,
  hash_algorithm_supported,
  idempotencyValidatorGroups,
  idempotency_key_format_supported,
  idempotency_key_required,
  idempotent_replay_checksum_matches,
} from "../Backend/kai/validators/idempotencyValidators.js";

const validatorSource = readFileSync("Backend/kai/validators/idempotencyValidators.js", "utf8");
const testSource = readFileSync("__tests__/kai-sprint2-idempotency-contract.spec.js", "utf8");

const checksum = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

test("idempotency key validators require stable supported keys", () => {
  assert.equal(idempotency_key_required({}).blocking_reason, "missing_idempotency_key");
  assert.equal(idempotency_key_required({ idempotencyKey: "pass1f-idem-001" }).severity, "pass");
  assert.equal(idempotency_key_format_supported({ idempotencyKey: "short" }).blocking_reason, "invalid_idempotency_key");
  assert.equal(idempotency_key_format_supported({ idempotencyKey: "pass1f-idem-001" }).severity, "pass");
});

test("checksum validators accept supplied metadata checksums only", () => {
  assert.equal(checksum_required({}).blocking_reason, "missing_checksum");
  assert.equal(checksum_required({ checksum }).severity, "pass");
  assert.equal(checksum_format_supported({ checksum: "abc" }).blocking_reason, "invalid_checksum");
  assert.equal(checksum_format_supported({ checksum }).severity, "pass");
  assert.equal(canonicalizeSha256Checksum(checksum), "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
  assert.equal(
    canonicalizeSha256Checksum("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
});

test("hash algorithm validators require the exact sha256 contract value", () => {
  assert.equal(hash_algorithm_required({}).blocking_reason, "missing_hash_algorithm");
  assert.equal(hash_algorithm_required({ hashAlgorithm: "sha256" }).severity, "pass");
  assert.equal(hash_algorithm_supported({ hashAlgorithm: "SHA256" }).blocking_reason, "unsupported_hash_algorithm");
  assert.equal(hash_algorithm_supported({ hashAlgorithm: "sha256" }).severity, "pass");
});

test("idempotency checksum conflict and duplicate checksum blockers are pure", () => {
  const input = Object.freeze({
    checksum,
    existingChecksum: checksum,
    duplicateChecksums: Object.freeze([checksum]),
  });

  assert.equal(idempotent_replay_checksum_matches(input).severity, "pass");
  assert.equal(idempotent_replay_checksum_matches({
    checksum,
    existingChecksum: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  }).blocking_reason, "idempotency_checksum_conflict");
  assert.equal(duplicate_checksum_blocked(input).blocking_reason, "duplicate_checksum");
  assert.equal(duplicate_checksum_blocked(input).evidence.duplicate_evaluation, "preliminary_declared_checksum_match");
  assert.equal(duplicate_checksum_blocked(input).evidence.storage_checksum_verified, false);
  assert.deepEqual(input.duplicateChecksums, [checksum]);
});

test("idempotency validator groups expose metadata write contracts", () => {
  assert.ok(idempotencyValidatorGroups.metadata_batch_write.includes(idempotency_key_required));
  assert.ok(idempotencyValidatorGroups.metadata_file_write.includes(checksum_format_supported));
  assert.ok(idempotencyValidatorGroups.metadata_file_write.includes(hash_algorithm_required));
  assert.ok(idempotencyValidatorGroups.metadata_file_write.includes(hash_algorithm_supported));
  assert.ok(idempotencyValidatorGroups.metadata_file_write.includes(duplicate_checksum_blocked));
});

test("idempotency validators are pure and do not read files or hash file content", () => {
  assert.doesNotMatch(validatorSource, /from\s+["'](?:node:fs|fs)["']|readFile|createReadStream/i);
  assert.doesNotMatch(validatorSource, /from\s+["'](?:node:crypto|crypto)["']|createHash|subtle\.digest/i);
  assert.doesNotMatch(validatorSource, /from\s+["'][^"']*(?:kaiDb|db\/pg|pg|kaiQueries|kaiIntakeQueries)\.js["']/);
  assert.doesNotMatch(testSource, /^import[^\n]*Backend\/db\/pg\.js[^\n]*$/m);
  assert.doesNotMatch(testSource, /\bnew\s+Pool\b|\bpool\.query\b|\bconnect\s*\(/);
});
