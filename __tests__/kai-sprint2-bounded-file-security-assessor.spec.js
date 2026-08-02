import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  __testables,
  assessBoundedFileSecurity,
} from "../Backend/kai/security/boundedFileSecurityAssessor.js";

const SYNTHETIC_PROVENANCE = Object.freeze({
  adapter_id: "kai_synthetic_fixture_adapter",
  signature_set: "v1",
});
const CSV_BYTES = Buffer.from("name,value\nkindness,1\n", "utf8");
const TEXT_BYTES = Buffer.from("Uploaded instruction-like text remains inert data.\n", "utf8");
const XLSX_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const CSV_INPUT = Object.freeze({
  extension: ".csv",
  declaredMime: "text/csv",
  bytes: CSV_BYTES,
  sha256: sha256(CSV_BYTES),
});

const TEXT_INPUT = Object.freeze({
  extension: ".txt",
  declaredMime: "text/plain",
  bytes: TEXT_BYTES,
  sha256: sha256(TEXT_BYTES),
});

const XLSX_INPUT = Object.freeze({
  extension: ".xlsx",
  declaredMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  bytes: XLSX_BYTES,
  sha256: sha256(XLSX_BYTES),
});

function csvTypePass(input) {
  return {
    policy: "allow",
    category: "type_agreement_pass",
    scope: "type_agreement_pass_only",
    evidence: {
      normalized_extension: input.extension,
      normalized_declared_mime: input.declaredMime,
    },
  };
}

function xlsxTypePass() {
  return {
    policy: "allow",
    category: "type_agreement_pass",
    scope: "type_agreement_pass_only",
    evidence: {
      normalized_extension: ".xlsx",
      normalized_declared_mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  };
}

function cleanMalwareAdapter() {
  return Object.freeze({
    async scan() {
      return {
        status: "clean",
        provenance: { ...SYNTHETIC_PROVENANCE },
      };
    },
  });
}

function detectedMalwareAdapter() {
  return Object.freeze({
    async scan() {
      return {
        status: "malware_detected",
        provenance: { ...SYNTHETIC_PROVENANCE },
      };
    },
  });
}

test("bounded assessor returns exact pass and block shapes over committed CSV and type detectors", async () => {
  assert.deepEqual(
    await assessBoundedFileSecurity(TEXT_INPUT, { malwareScanAdapter: cleanMalwareAdapter() }),
    { policy: "pass" },
  );
  assert.deepEqual(
    await assessBoundedFileSecurity(CSV_INPUT, { malwareScanAdapter: cleanMalwareAdapter() }),
    { policy: "pass" },
  );

  const mismatch = await assessBoundedFileSecurity({
    extension: ".pdf",
    declaredMime: "application/pdf",
    bytes: Buffer.from("not a pdf", "utf8"),
  });
  assert.deepEqual(mismatch, {
    policy: "block",
    category: "unknown_binary",
  });

  const binaryText = await assessBoundedFileSecurity({
    extension: ".txt",
    declaredMime: "text/plain",
    bytes: Buffer.from([0x00, 0x01]),
  });
  assert.deepEqual(binaryText, {
    policy: "block",
    category: "nul_rejection",
  });
});

test("bounded assessor delegates XLSX precedence to the terminal OOXML archive detector", async () => {
  const calls = [];
  const result = await assessBoundedFileSecurity(XLSX_INPUT, {
    detectors: {
      detectP0FileTypeAgreement(input) {
        calls.push(["type", input.extension, input.declaredMime]);
        return xlsxTypePass();
      },
      async detectOoxmlArchiveResourceLimitPolicy(input) {
        calls.push(["terminal_xlsx", input.extension, input.declaredMime]);
        return {
          policy: "block",
          category: "ooxml_path_traversal_detected",
        };
      },
      detectCsvRowLimitPolicy() {
        throw new Error("CSV detector must not run for XLSX.");
      },
      runPdfAssessorWorkerBoundary() {
        throw new Error("PDF worker must not run for XLSX.");
      },
    },
  });

  assert.deepEqual(result, {
    policy: "block",
    category: "ooxml_path_traversal_detected",
  });
  assert.deepEqual(calls, [
    ["type", ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["terminal_xlsx", ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ]);
});

test("production malware not_configured cannot produce aggregate policy pass", async () => {
  const result = await assessBoundedFileSecurity(TEXT_INPUT);

  assert.deepEqual(result, {
    status: "failed",
    category: "malware_scan_not_configured",
  });
  assert.deepEqual(Object.keys(result), ["status", "category"]);
  assert.notEqual(result.category, "malware_scan_failed");
  assert.equal(Object.hasOwn(result, "adapter"), false);
  assert.equal(Object.hasOwn(result, "scanner"), false);
  assert.equal(Object.hasOwn(result, "config"), false);
  assert.equal(Object.hasOwn(result, "version"), false);
  assert.equal(Object.hasOwn(result, "bytes"), false);
  assert.equal(Object.hasOwn(result, "sha256"), false);
  assert.equal(Object.hasOwn(result, "detail"), false);
  assert.equal(Object.hasOwn(result, "stack"), false);
});

test("clean, detected, failed, and malformed malware outcomes aggregate through existing results", async () => {
  assert.deepEqual(
    await assessBoundedFileSecurity(TEXT_INPUT, { malwareScanAdapter: cleanMalwareAdapter() }),
    { policy: "pass" },
  );

  assert.deepEqual(
    await assessBoundedFileSecurity(TEXT_INPUT, { malwareScanAdapter: detectedMalwareAdapter() }),
    {
      policy: "block",
      category: "malware_failed",
    },
  );

  assert.deepEqual(
    await assessBoundedFileSecurity(TEXT_INPUT, {
      malwareScanAdapter: {
        async scan() {
          return {
            status: "failed",
            category: "malware_scan_failed",
          };
        },
      },
    }),
    {
      status: "failed",
      category: "malware_scan_failed",
    },
  );

  const thrown = await assessBoundedFileSecurity(TEXT_INPUT, {
    malwareScanAdapter: {
      async scan() {
        throw new Error("scanner host refused connection with private diagnostics");
      },
    },
  });
  assert.deepEqual(thrown, {
    status: "failed",
    category: "malware_scan_failed",
  });
  assert.notEqual(thrown.category, "malware_scan_not_configured");
  assert.doesNotMatch(JSON.stringify(thrown), /scanner host|private diagnostics|adapter|stack|bytes|sha256/i);

  assert.deepEqual(
    await assessBoundedFileSecurity(TEXT_INPUT, {
      malwareScanAdapter: {
        async scan() {
          return { status: "clean" };
        },
      },
    }),
    {
      status: "failed",
      category: "malware_scan_failed",
    },
  );
});

test("bounded assessor failed-category vocabulary records policy classifications", () => {
  assert.deepEqual(__testables.ASSESSOR_FAILED_CATEGORY_CLASSIFICATIONS, {
    security_assessment_timeout: { policyFailureEligible: true },
    input_size_exceeds_pre_parse_gate: { policyFailureEligible: true },
    malware_scan_failed: { policyFailureEligible: true },
    malware_scan_not_configured: { policyFailureEligible: false },
    maximum_concurrent_pdf_assessor_workers_exceeded: { policyFailureEligible: false },
  });
});

test("bounded assessor maps detector failures to the committed safe failure category", async () => {
  const result = await assessBoundedFileSecurity(CSV_INPUT, {
    detectors: {
      detectP0FileTypeAgreement: csvTypePass,
      detectCsvRowLimitPolicy() {
        throw new Error("sanitized detector failure");
      },
    },
  });

  assert.deepEqual(result, {
    status: "failed",
    category: "security_assessment_timeout",
  });
});

test("bounded assessor module does not import persistence, lifecycle, routes, queues, or confirmUpload", () => {
  const source = readFileSync("Backend/kai/security/boundedFileSecurityAssessor.js", "utf8");
  assert.doesNotMatch(source, /confirmUpload|file_policy_status|transitionUploadLifecycle|queue|enqueue|drain|route|router|express|pg|sql/i);
  assert.doesNotMatch(source, /kaiSyntheticMalwareScanAdapter|createKaiSyntheticFixtureMalwareAdapter|__tests__\/support/);
});
