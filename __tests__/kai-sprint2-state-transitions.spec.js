import test from "node:test";
import assert from "node:assert/strict";

import {
  MALWARE_SCAN_PRODUCTION_DEFAULT,
  claim_creation_blocked_from_intake_in_p0,
  evidence_extraction_blocked_from_raw_file_in_p0,
  public_funder_gate_opening_blocked_in_p0,
  report_export_generation_blocked_in_p0,
  source_promotion_blocked_in_p0,
  validateP0IntakeStateTransitionAttempt,
  validateMalwareScanStatusDbValue,
  validateFilePolicyStatusTransition,
  validateStorageProviderDbValue,
} from "../Backend/kai/validators/stateTransitionValidators.js";

test("malware_scan_status production default is not_configured", () => {
  assert.equal(MALWARE_SCAN_PRODUCTION_DEFAULT, "not_configured");
});

test("file policy transitions allow P0 statuses and block invalid values", () => {
  assert.equal(validateFilePolicyStatusTransition({ from: "pending", to: "blocked" }).severity, "pass");
  assert.equal(validateFilePolicyStatusTransition({ from: "pending", to: "policy_blocked" }).severity, "blocker");
  assert.equal(validateFilePolicyStatusTransition({ from: "passed", to: "blocked" }).severity, "blocker");
});

test("app-level DB vocabulary blocks invalid storage provider and malware values", () => {
  assert.equal(validateStorageProviderDbValue({ storageProvider: "gcs" }).severity, "pass");
  assert.equal(validateStorageProviderDbValue({ storageProvider: "google_cloud_storage" }).severity, "blocker");
  assert.equal(validateStorageProviderDbValue({ storageProvider: "manual" }).severity, "blocker");
  assert.equal(validateStorageProviderDbValue({ storageProvider: "stub" }).severity, "blocker");

  for (const malwareScanStatus of ["not_configured", "queued", "running", "passed", "failed", "skipped"]) {
    assert.equal(validateMalwareScanStatusDbValue({ malwareScanStatus }).severity, "pass");
  }
  assert.equal(validateMalwareScanStatusDbValue({ malwareScanStatus: "manual" }).severity, "blocker");
  assert.equal(validateMalwareScanStatusDbValue({ malwareScanStatus: "stub" }).severity, "blocker");
});

test("P0 state-transition validators block unsafe intake promotions and generated artifacts", () => {
  const blocked = [
    [source_promotion_blocked_in_p0(), "source_promotion_blocked_in_p0"],
    [claim_creation_blocked_from_intake_in_p0(), "claim_creation_blocked_from_intake_in_p0"],
    [evidence_extraction_blocked_from_raw_file_in_p0(), "evidence_extraction_blocked_from_raw_file_in_p0"],
    [report_export_generation_blocked_in_p0(), "report_export_generation_blocked_in_p0"],
    [public_funder_gate_opening_blocked_in_p0(), "public_funder_gate_opening_blocked_in_p0"],
  ];

  for (const [result, reason] of blocked) {
    assert.equal(result.severity, "blocker");
    assert.equal(result.blocking_reason, reason);
  }
});

test("P0 state-transition validators block unknown transitions and remain pure", () => {
  const result = validateP0IntakeStateTransitionAttempt({
    objectType: "source",
    operation: "unlisted_transition",
  });

  assert.equal(result.severity, "blocker");
  assert.equal(result.blocking_reason, "unknown_state_transition_blocked");
});
