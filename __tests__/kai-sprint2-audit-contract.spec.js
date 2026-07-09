import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { recordBlockedAttemptAudit } from "../Backend/kai/services/auditService.js";
import {
  BLOCKED_ATTEMPT_AUDIT_METADATA_ALLOWLIST,
  sanitizeBlockedAttemptAuditMetadata,
  validateBlockedAttemptAuditPayload,
} from "../Backend/kai/validators/auditValidators.js";

const auditValidatorSource = readFileSync("Backend/kai/validators/auditValidators.js", "utf8");
const auditServiceSource = readFileSync("Backend/kai/services/auditService.js", "utf8");
const pass1eTestSources = [
  readFileSync("__tests__/kai-sprint2-state-transitions.spec.js", "utf8"),
  readFileSync("__tests__/kai-sprint2-assistant-boundary.spec.js", "utf8"),
  readFileSync("__tests__/kai-sprint2-audit-contract.spec.js", "utf8"),
  readFileSync("__tests__/kai-sprint2-intake-service-contract.spec.js", "utf8"),
  readFileSync("__tests__/kai-sprint2-api-contract.spec.js", "utf8"),
].join("\n");

const safeMetadata = Object.freeze({
  contract: "p0_pass1e_state_assistant_audit_contract",
  sprint_phase: "p0_pass1e",
  attempted_operation: "promote_intake_source",
  object_type: "state_transition",
  blocked_reason_code: "source_promotion_blocked_in_p0",
  actor_type: "assistant",
  storage_provider: "gcs",
  storage_region_classification: "configured_region_only",
  storage_residency_classification: "tenant_region_classified",
  file_policy_status: "blocked",
  request_scope: "metadata_only",
  route_contract: "p0_pass1d_intake_validator_service_contract",
  validator_key: "VAL-STA-P0-001",
});

const enabled = Object.freeze({ env: Object.freeze({ KAI_SPRINT2_ENABLED: "true" }) });

test("audit validators define and accept metadata-only allowlisted blocked-attempt payloads", () => {
  assert.ok(BLOCKED_ATTEMPT_AUDIT_METADATA_ALLOWLIST.includes("blocked_reason_code"));
  assert.ok(BLOCKED_ATTEMPT_AUDIT_METADATA_ALLOWLIST.includes("storage_provider"));

  const result = sanitizeBlockedAttemptAuditMetadata(safeMetadata);
  assert.equal(result.ok, true);
  assert.deepEqual(result.sanitized, safeMetadata);
  assert.equal(validateBlockedAttemptAuditPayload({ payload: safeMetadata }).severity, "pass");
});

test("audit validators reject raw content, parsed rows, client PII, prompt text, and unsafe generated text", () => {
  for (const [key, reason] of [
    ["raw_file_content", "raw_file_content_rejected"],
    ["raw_parsed_rows", "raw_parsed_rows_rejected"],
    ["client_email", "client_pii_rejected"],
    ["prompt_text", "prompt_text_rejected"],
    ["generated_text", "unsafe_generated_text_rejected"],
  ]) {
    const result = sanitizeBlockedAttemptAuditMetadata({ ...safeMetadata, [key]: "blocked" });
    assert.equal(result.ok, false);
    assert.equal(result.blockers[0].blocking_reason, reason);
  }
});

test("audit validators reject signed URLs, storage credentials, full storage_uri, and private layout keys", () => {
  for (const [key, value, reason] of [
    ["signed_read_url", "https://example.invalid/private", "signed_urls_rejected"],
    ["storage_credentials", "secret", "storage_credentials_rejected"],
    ["storage_uri", "gs://private-bucket/object", "full_private_storage_uri_rejected_by_default"],
    ["storage_object_key", "tenant/private/object.csv", "unsafe_private_storage_layout_rejected"],
  ]) {
    const result = sanitizeBlockedAttemptAuditMetadata({ ...safeMetadata, [key]: value });
    assert.equal(result.ok, false);
    assert.equal(result.blockers[0].blocking_reason, reason);
  }
});

test("audit service contract is feature-flag gated", async () => {
  const result = await recordBlockedAttemptAudit({ payload: safeMetadata }, { env: { KAI_SPRINT2_ENABLED: "false" } });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
});

test("audit service contract remains non-mutating and returns only metadata-safe payload shape", async () => {
  const result = await recordBlockedAttemptAudit({ payload: safeMetadata }, enabled);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_implemented");
  assert.equal(result.data.audit_write_enabled, false);
  assert.equal(result.data.kai_audit_events_write_enabled, false);
  assert.deepEqual(result.data.sanitized_payload, safeMetadata);
  assert.equal(result.blockers[0].blocking_reason, "audit_write_not_implemented_in_pass1e");
});

test("audit service rejects unsafe payload before persistence and contains no audit table write path", async () => {
  const result = await recordBlockedAttemptAudit(
    {
      payload: {
        ...safeMetadata,
        storage_uri: "gs://private-bucket/object",
      },
    },
    enabled,
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.data.kai_audit_events_write_enabled, false);
  assert.equal(result.blockers[0].blocking_reason, "full_private_storage_uri_rejected_by_default");
  assert.doesNotMatch(auditServiceSource, /\bkai\.audit_events\b/i);
  assert.doesNotMatch(auditServiceSource, /\b(?:INSERT|UPDATE|DELETE|UPSERT|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/i);
  assert.doesNotMatch(auditServiceSource, /from\s+["'][^"']*(?:db\/pg|kaiDb)[^"']*["']/);
});

test("Pass 1E validators and tests do not import live DB wiring or initialize a pool", () => {
  const pass1eSources = `${auditValidatorSource}\n${auditServiceSource}\n${pass1eTestSources}`;
  assert.doesNotMatch(pass1eSources, /^import[^\n]*Backend\/db\/pg\.js[^\n]*$/m);
  assert.doesNotMatch(pass1eSources, /^import[^\n]*Backend\/kai\/db\/kaiDb\.js[^\n]*$/m);
  assert.doesNotMatch(pass1eSources, /\bnew\s+Pool\b|\bpool\.query\b|\bconnect\s*\(/);
});
