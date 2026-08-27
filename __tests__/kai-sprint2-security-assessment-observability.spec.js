import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  __testables as intakeServiceTestables,
} from "../Backend/kai/services/kaiIntakeService.js";
import { casSecurityAssessmentFilePolicyDecision } from "../Backend/kai/db/kaiIntakeQueries.js";
import { sanitizeAuditMetadataForStorage } from "../Backend/kai/db/kaiAuditQueries.js";

const { assessmentCategoryFromResult, malwareScanStatusForAssessment, securityAssessmentProjection } = intakeServiceTestables;

const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const intakeFileId = "9fe568b1-5c05-4c42-bb1f-6e20de216c7b";
const objectVersionId = "ov_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const verifiedChecksum = "b".repeat(64);
const verifiedSizeBytes = 42;

// --- assessmentCategoryFromResult: server-derived only, never trusts arbitrary shapes ---

test("assessmentCategoryFromResult returns the assessor's own category string", () => {
  assert.equal(assessmentCategoryFromResult({ status: "failed", category: "malware_scan_not_configured" }), "malware_scan_not_configured");
  assert.equal(assessmentCategoryFromResult({ policy: "block", category: "malware_failed" }), "malware_failed");
});

test("assessmentCategoryFromResult returns null for a clean pass and for malformed shapes", () => {
  assert.equal(assessmentCategoryFromResult({ policy: "pass" }), null);
  assert.equal(assessmentCategoryFromResult(null), null);
  assert.equal(assessmentCategoryFromResult(undefined), null);
  assert.equal(assessmentCategoryFromResult({ category: 12345 }), null);
});

// --- malwareScanStatusForAssessment: CASE 1-5 semantics ---

test("CASE 4: a passed outcome always proves a clean malware scan", () => {
  assert.equal(malwareScanStatusForAssessment("passed", { policy: "pass" }), "passed");
});

test("CASE 2: malware_scan_failed maps malware_scan_status to failed", () => {
  assert.equal(malwareScanStatusForAssessment("failed", { status: "failed", category: "malware_scan_failed" }), "failed");
});

test("CASE 5: a blocked malware-detected result maps malware_scan_status to failed (existing vocabulary, no invented enum)", () => {
  assert.equal(malwareScanStatusForAssessment("blocked", { policy: "block", category: "malware_failed" }), "failed");
});

test("CASE 3: security_assessment_timeout never falsely converts malware_scan_status", () => {
  assert.equal(malwareScanStatusForAssessment("failed", { status: "failed", category: "security_assessment_timeout" }), null);
});

test("non-malware block categories never touch malware_scan_status", () => {
  assert.equal(malwareScanStatusForAssessment("blocked", { policy: "block", category: "csv_row_limit_exceeded" }), null);
  assert.equal(malwareScanStatusForAssessment("blocked", { policy: "block", category: "declared_type_mismatch" }), null);
});

test("non-malware failed categories never touch malware_scan_status", () => {
  assert.equal(malwareScanStatusForAssessment("failed", { status: "failed", category: "input_size_exceeds_pre_parse_gate" }), null);
});

// --- securityAssessmentProjection: bounded, explicit-column response shape ---

test("securityAssessmentProjection maps a persisted policy-decision audit row to category + policy_outcome", () => {
  assert.deepEqual(
    securityAssessmentProjection({ action: "apply_security_assessment_policy_decision", reason_code: "blocked", assessment_category: "malware_failed" }),
    { category: "malware_failed", policy_outcome: "blocked" },
  );
});

test("securityAssessmentProjection never fabricates a policy_outcome for a diagnostic-only (non-mutating) audit row", () => {
  assert.deepEqual(
    securityAssessmentProjection({ action: "record_security_assessment_diagnostic", reason_code: "no_policy_decision", assessment_category: "malware_scan_not_configured" }),
    { category: "malware_scan_not_configured", policy_outcome: null },
  );
});

test("securityAssessmentProjection defaults to null/null when no assessment has been persisted yet", () => {
  assert.deepEqual(securityAssessmentProjection(null), { category: null, policy_outcome: null });
  assert.deepEqual(securityAssessmentProjection(undefined), { category: null, policy_outcome: null });
});

test("securityAssessmentProjection ignores an unrecognized action/reason_code rather than trusting it as a policy outcome", () => {
  assert.deepEqual(
    securityAssessmentProjection({ action: "some_other_action", reason_code: "blocked", assessment_category: "malware_failed" }),
    { category: "malware_failed", policy_outcome: null },
  );
});

// --- casSecurityAssessmentFilePolicyDecision: malware_scan_status write is coherent with file_policy_status ---

function capturingDb(row) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: row ? [row] : [] };
    },
  };
}

test("CAS mutation SQL sets malware_scan_status via COALESCE so a non-malware decision leaves it untouched", async () => {
  const db = capturingDb({ intake_file_id: intakeFileId, file_policy_status: "blocked", malware_scan_status: "not_configured" });
  await casSecurityAssessmentFilePolicyDecision(
    { organizationId, intakeFileId, objectVersionId, verifiedChecksum, verifiedSizeBytes, newFilePolicyStatus: "blocked", newMalwareScanStatus: null },
    db,
  );

  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /malware_scan_status = COALESCE\(\$7::text, malware_scan_status\)/);
  assert.deepEqual(db.calls[0].params, [organizationId, intakeFileId, objectVersionId, verifiedChecksum, verifiedSizeBytes, "blocked", null]);
});

test("CAS mutation SQL passes the derived malware_scan_status through as the exact bound parameter", async () => {
  const db = capturingDb({ intake_file_id: intakeFileId, file_policy_status: "passed", malware_scan_status: "passed" });
  await casSecurityAssessmentFilePolicyDecision(
    { organizationId, intakeFileId, objectVersionId, verifiedChecksum, verifiedSizeBytes, newFilePolicyStatus: "passed", newMalwareScanStatus: "passed" },
    db,
  );

  assert.deepEqual(db.calls[0].params, [organizationId, intakeFileId, objectVersionId, verifiedChecksum, verifiedSizeBytes, "passed", "passed"]);
});

test("CAS mutation SQL is still bound to the exact organization, file, and immutable confirmed facts (unchanged CAS guard)", async () => {
  const db = capturingDb(null);
  await casSecurityAssessmentFilePolicyDecision(
    { organizationId, intakeFileId, objectVersionId, verifiedChecksum, verifiedSizeBytes, newFilePolicyStatus: "failed", newMalwareScanStatus: "failed" },
    db,
  );

  assert.match(db.calls[0].sql, /WHERE organization_id = \$1/);
  assert.match(db.calls[0].sql, /AND intake_file_id = \$2/);
  assert.match(db.calls[0].sql, /AND file_policy_status = 'pending'/);
  assert.match(db.calls[0].sql, /AND object_version_id = \$3/);
  assert.match(db.calls[0].sql, /AND verified_checksum = \$4/);
  assert.match(db.calls[0].sql, /AND verified_size_bytes = \$5::bigint/);
});

// --- assessment_category is a bounded, allowlisted metadata field, not arbitrary caller text ---
//
// The kaiMutationOrchestration.js sanitizer (REQUIRED_AUDIT_METADATA_ALLOWLIST /
// sanitizeRequiredAuditMetadata) is exercised end-to-end through
// applyConfirmedSecurityAssessment in kai-sprint2-gate-c-security-handoff.spec.js
// rather than imported directly here: that internal core module is
// intentionally restricted to its one production caller (kaiIntakeService.js)
// plus the dedicated test harness (see kai-sprint2-orchestration-boundary.spec.js).

test("sanitizeAuditMetadataForStorage keeps a well-shaped assessment_category and drops sensitive/oversized text", () => {
  assert.equal(sanitizeAuditMetadataForStorage({ assessment_category: "input_size_exceeds_pre_parse_gate" }).assessment_category, "input_size_exceeds_pre_parse_gate");
  assert.equal(sanitizeAuditMetadataForStorage({ assessment_category: "token=abc123secret" }).assessment_category, undefined);
  assert.equal(sanitizeAuditMetadataForStorage({ assessment_category: "a".repeat(200) }).assessment_category, undefined);
});

// --- KaiWebIntake UI: a clean pass must not render as "none" ---
//
// security_assessment.category is null on a clean pass (see
// assessmentCategoryFromResult above); the UI must fall back to
// policy_outcome ("passed") instead of rendering the ValueRow default of
// "none" for a file that was actually successfully assessed.

test("KaiWebIntake renders security_assessment.category, falling back to policy_outcome for a clean pass", () => {
  const uiSource = readFileSync("frontend/KaiWebIntake.jsx", "utf8");
  assert.match(
    uiSource,
    /<ValueRow label="Security assessment" value=\{fileStatus\.security_assessment\?\.category \?\? fileStatus\.security_assessment\?\.policy_outcome\} \/>/,
  );
});
