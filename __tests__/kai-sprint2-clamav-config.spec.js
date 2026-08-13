import test from "node:test";
import assert from "node:assert/strict";

import {
  isKaiGateCClamavScannerConfigured,
  readKaiGateCClamavConfig,
} from "../Backend/kai/config/kaiSprint2ClamavConfig.js";

const VALID_ENV = Object.freeze({
  KAI_GATE_C_CLAMAV_SCANNER_URL: "https://clamav-scanner.example.run.app",
  KAI_GATE_C_CLAMAV_SCANNER_INVOKER_TARGET_PRINCIPAL: "kai-clamav-invoker@example-project.iam.gserviceaccount.com",
});

test("complete config resolves ok with the configured scanner URL and dedicated invoker principal", () => {
  const config = readKaiGateCClamavConfig(VALID_ENV);
  assert.equal(config.ok, true);
  assert.equal(config.scannerUrl, VALID_ENV.KAI_GATE_C_CLAMAV_SCANNER_URL);
  assert.equal(config.scannerInvokerTargetPrincipal, VALID_ENV.KAI_GATE_C_CLAMAV_SCANNER_INVOKER_TARGET_PRINCIPAL);
  assert.equal(isKaiGateCClamavScannerConfigured(VALID_ENV), true);
});

test("missing scanner URL fails closed", () => {
  const config = readKaiGateCClamavConfig({
    KAI_GATE_C_CLAMAV_SCANNER_INVOKER_TARGET_PRINCIPAL: VALID_ENV.KAI_GATE_C_CLAMAV_SCANNER_INVOKER_TARGET_PRINCIPAL,
  });
  assert.equal(config.ok, false);
  assert.equal(config.reason, "missing_or_malformed_scanner_url");
});

test("non-https scanner URL fails closed", () => {
  const config = readKaiGateCClamavConfig({
    ...VALID_ENV,
    KAI_GATE_C_CLAMAV_SCANNER_URL: "http://clamav-scanner.example.run.app",
  });
  assert.equal(config.ok, false);
});

test("missing scanner-invoker target principal fails closed", () => {
  const config = readKaiGateCClamavConfig({
    KAI_GATE_C_CLAMAV_SCANNER_URL: VALID_ENV.KAI_GATE_C_CLAMAV_SCANNER_URL,
  });
  assert.equal(config.ok, false);
  assert.equal(config.reason, "missing_or_malformed_scanner_invoker_target_principal");
});

test("scanner-invoker target principal is a dedicated identity, not the GCS upload-signer or parser-reader env vars", () => {
  const config = readKaiGateCClamavConfig(VALID_ENV);
  assert.equal(config.ok, true);
  assert.notEqual(config.scannerInvokerTargetPrincipal, undefined);
  assert.equal(Object.hasOwn(VALID_ENV, "KAI_GATE_B1_GCS_UPLOAD_SIGNER_TARGET_PRINCIPAL"), false);
  assert.equal(Object.hasOwn(VALID_ENV, "KAI_GATE_B1_GCS_PARSER_READER_TARGET_PRINCIPAL"), false);
});

test("out-of-range scan timeout falls back to the default", () => {
  const config = readKaiGateCClamavConfig({
    ...VALID_ENV,
    KAI_GATE_C_CLAMAV_SCAN_TIMEOUT_MS: "999999",
  });
  assert.equal(config.ok, true);
  assert.equal(config.timeoutMs, 8000);
});

test("valid scan timeout override is respected within bounds", () => {
  const config = readKaiGateCClamavConfig({
    ...VALID_ENV,
    KAI_GATE_C_CLAMAV_SCAN_TIMEOUT_MS: "3000",
  });
  assert.equal(config.ok, true);
  assert.equal(config.timeoutMs, 3000);
});
