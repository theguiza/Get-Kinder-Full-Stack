import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  confirmUpload,
  createIntakeBatch,
  parseIntakeRawFile,
  promoteIntakeSource,
  registerIntakeFileMetadata,
  requestUploadUrl,
  requestIntakeFileTransfer,
  reserveIntakeFile,
  validateBlockedAttemptAuditContract,
  validateIntakePreflight,
} from "../Backend/kai/services/intakeService.js";

const serviceSource = readFileSync("Backend/kai/services/intakeService.js", "utf8");
const validatorSource = readFileSync("Backend/kai/validators/intakeValidators.js", "utf8");
const runnerSource = readFileSync("Backend/kai/validators/runValidators.js", "utf8");
const pass1dTestSources = [
  readFileSync("__tests__/kai-sprint2-intake-validators.spec.js", "utf8"),
  readFileSync("__tests__/kai-sprint2-intake-service-contract.spec.js", "utf8"),
  readFileSync("__tests__/kai-sprint2-api-contract.spec.js", "utf8"),
].join("\n");

const validContractInput = Object.freeze({
  actorContext: Object.freeze({ actorUserId: "actor-1", actorType: "human" }),
  tenantContext: Object.freeze({ organizationId: "org-1" }),
  organizationId: "org-1",
  idempotencyKey: "pass1f-intake-001",
  checksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  storageProvider: "gcs",
  filePolicyStatus: "pending",
});

const enabled = Object.freeze({ env: Object.freeze({ KAI_SPRINT2_ENABLED: "true" }) });

function guardedDependencies() {
  return new Proxy(
    { ...enabled },
    {
      get(target, property) {
        if (property in target) return target[property];
        throw new Error(`Unexpected dependency access: ${String(property)}`);
      },
    },
  );
}

test("service contract is feature-flag gated", async () => {
  const result = await createIntakeBatch(validContractInput, { env: { KAI_SPRINT2_ENABLED: "false" } });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
});

test("service contract requires actor context before future intake behavior", async () => {
  const result = await createIntakeBatch(
    {
      organizationId: "org-1",
      tenantContext: { organizationId: "org-1" },
    },
    enabled,
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.blockers[0].blocking_reason, "missing_actor_context");
});

test("service contract requires tenant and organization context", async () => {
  const result = await createIntakeBatch(
    {
      actorContext: { actorUserId: "actor-1" },
    },
    enabled,
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.ok(result.blockers.some((blocker) => blocker.blocking_reason === "missing_organization_id"));
});

test("service contract preflight calls validator groups and returns structured warnings", async () => {
  const result = await validateIntakePreflight(validContractInput, enabled);

  assert.equal(result.ok, true);
  assert.equal(result.data.contract, "p0_pass1d_intake_validator_service_contract");
  assert.equal(result.data.pass1e_contract, "p0_pass1e_state_assistant_audit_contract");
  assert.equal(result.data.pass1f_contract, "p0_pass1f_metadata_write_storage_boundary_contract");
  assert.equal(result.data.raw_upload_enabled, false);
  assert.equal(result.data.audit_write_enabled, false);
  assert.equal(result.warnings.length, 1);
});

test("future mutating service behavior returns not_implemented without calling dependencies", async () => {
  const result = await createIntakeBatch(validContractInput, guardedDependencies());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_implemented");
  assert.equal(result.data.mutating_behavior_enabled, false);
  assert.equal(result.data.metadata_write_enabled, false);
  assert.equal(result.blockers[0].blocking_reason, "not_implemented_in_pass1f");
});

test("file metadata registration stub validates then stays non-mutating", async () => {
  const result = await registerIntakeFileMetadata(validContractInput, guardedDependencies());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_implemented");
  assert.equal(result.data.operation, "register_intake_file_metadata");
  assert.equal(result.data.metadata_write_enabled, false);
});

test("file reservation service stub is non-mutating and structured", async () => {
  const result = await reserveIntakeFile(validContractInput, guardedDependencies());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_implemented");
  assert.equal(result.data.operation, "reserve_intake_file");
  assert.equal(result.data.signed_upload_enabled, false);
  assert.equal(result.data.signed_read_enabled, false);
});

test("upload URL and confirmation service contracts are disabled", async () => {
  const uploadUrlResult = await requestUploadUrl(validContractInput, guardedDependencies());
  assert.equal(uploadUrlResult.ok, false);
  assert.equal(uploadUrlResult.error.code, "operation_not_enabled");
  assert.equal(uploadUrlResult.data.signed_upload_enabled, false);

  const confirmResult = await confirmUpload(validContractInput, guardedDependencies());
  assert.equal(confirmResult.ok, false);
  assert.equal(confirmResult.error.code, "not_implemented");
  assert.equal(confirmResult.data.upload_confirmation_enabled, false);
});

test("raw upload and signed transfer behavior are blocked in P0", async () => {
  const rawResult = await reserveIntakeFile({ ...validContractInput, rawUploadRequested: true }, enabled);
  assert.equal(rawResult.ok, false);
  assert.equal(rawResult.error.code, "validation_blocker");
  assert.equal(rawResult.blockers[0].blocking_reason, "raw_upload_blocked_in_p0");

  const signedResult = await requestIntakeFileTransfer(validContractInput, guardedDependencies());
  assert.equal(signedResult.ok, false);
  assert.equal(signedResult.error.code, "validation_blocker");
  assert.equal(signedResult.blockers[0].blocking_reason, "signed_url_blocked_in_p0");
});

test("parser raw-file work and source promotion are blocked in P0", async () => {
  const parserResult = await parseIntakeRawFile(validContractInput, guardedDependencies());
  assert.equal(parserResult.ok, false);
  assert.equal(parserResult.error.code, "validation_blocker");
  assert.equal(parserResult.blockers[0].blocking_reason, "parser_raw_file_work_blocked_in_p0");

  const promotionResult = await promoteIntakeSource(validContractInput, guardedDependencies());
  assert.equal(promotionResult.ok, false);
  assert.equal(promotionResult.error.code, "validation_blocker");
  assert.equal(promotionResult.blockers[0].blocking_reason, "source_promotion_blocked_in_p0");
});

test("service contract source contains no kai table access, DB pool, storage adapter, parser, or promotion implementation", () => {
  assert.doesNotMatch(serviceSource, /\bkai\.(?!js\b)[a-z_]+\b/i);
  assert.doesNotMatch(serviceSource, /\b(?:SELECT|INSERT|UPDATE|DELETE|UPSERT|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/i);
  assert.doesNotMatch(serviceSource, /from\s+["'][^"']*(?:kaiDb|db\/pg|pg|kaiQueries|kaiIntakeQueries)\.js["']/);
  assert.doesNotMatch(serviceSource, /\bnew\s+Pool\b|\bpool\.query\b|\bconnect\s*\(/);
  assert.doesNotMatch(serviceSource, /from\s+["'][^"']*storage[^"']*["']/);
  assert.doesNotMatch(serviceSource, /\bStorageAdapter\b|\bgetSignedUrl\b|\bsigned_url\b/i);
});

test("intake service wires Pass 1E audit contract without enabling audit writes", async () => {
  const result = await validateBlockedAttemptAuditContract({
    operation: "promote_intake_source",
    blockedReasonCode: "source_promotion_blocked_in_p0",
  }, enabled);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_implemented");
  assert.equal(result.data.audit_write_enabled, false);
  assert.equal(result.data.kai_audit_events_write_enabled, false);
  assert.equal(result.data.sanitized_payload.blocked_reason_code, "source_promotion_blocked_in_p0");
});

test("Pass 1D tests use static pure assertions and do not import live DB wiring", () => {
  assert.doesNotMatch(pass1dTestSources, /^import[^\n]*Backend\/db\/pg\.js[^\n]*$/m);
  assert.doesNotMatch(pass1dTestSources, /^import[^\n]*Backend\/kai\/db\/kaiDb\.js[^\n]*$/m);
  assert.doesNotMatch(pass1dTestSources, /\bnew\s+Pool\b|\bpool\.query\b|\bconnect\s*\(/);
  assert.doesNotMatch(`${validatorSource}\n${runnerSource}\n${serviceSource}`, /from\s+["'][^"']*neo4j-driver["']/);
});
