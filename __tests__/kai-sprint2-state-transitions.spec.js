import test from "node:test";
import assert from "node:assert/strict";

import {
  MALWARE_SCAN_PRODUCTION_DEFAULT,
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
