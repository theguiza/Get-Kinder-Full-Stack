import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { KAI_SPRINT2_P0_SECURITY_EXECUTOR } from "../Backend/kai/config/kaiSprint2P0Contract.js";
import {
  createInternalSecurityAssessmentExecutor,
  executeInjectedInternalSecurityAssessment,
} from "../Backend/kai/security/internalSecurityAssessmentExecutor.js";

test("internal security executor is callable only through the explicit injected seam", async () => {
  const disabled = await executeInjectedInternalSecurityAssessment({
    extension: ".txt",
    declaredMime: "text/plain",
    bytes: Buffer.from("safe text\n", "utf8"),
  });

  assert.equal(disabled.ok, false);
  assert.equal(disabled.error.code, "internal_security_executor_not_configured");

  const invalid = await executeInjectedInternalSecurityAssessment({}, {
    internalSecurityAssessmentExecutor: {
      seamKind: "wrong",
      identity: KAI_SPRINT2_P0_SECURITY_EXECUTOR,
      async execute() {
        return { policy: "pass" };
      },
    },
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "invalid_internal_security_executor");
});

test("internal security executor validates identity and returns only the narrow result contract", async () => {
  const calls = [];
  const executor = createInternalSecurityAssessmentExecutor({
    async assessor(input) {
      calls.push(input);
      return {
        policy: "block",
        category: "csv_row_limit_exceeded",
      };
    },
  });

  assert.equal(executor.identity.actorType, "internal_service");
  assert.equal(executor.identity.serviceIdentity, "kai_file_security_executor");
  assert.equal(executor.identity.operationGroup, "file_security_assessment");

  const result = await executeInjectedInternalSecurityAssessment({ file: "synthetic" }, {
    internalSecurityAssessmentExecutor: executor,
  });

  assert.deepEqual(result, {
    ok: true,
    data: {
      result: {
        policy: "block",
        category: "csv_row_limit_exceeded",
      },
    },
  });
  assert.deepEqual(calls, [{ file: "synthetic" }]);
});

test("internal security executor sanitizes thrown and malformed assessor results", async () => {
  const thrownExecutor = createInternalSecurityAssessmentExecutor({
    async assessor() {
      throw new Error("raw dependency failure");
    },
  });
  const thrown = await executeInjectedInternalSecurityAssessment({}, {
    internalSecurityAssessmentExecutor: thrownExecutor,
  });
  assert.deepEqual(thrown.data.result, {
    status: "failed",
    category: "security_assessment_timeout",
  });

  const malformedExecutor = createInternalSecurityAssessmentExecutor({
    async assessor() {
      return { policy: "pass", extra: "not allowed" };
    },
  });
  const malformed = await executeInjectedInternalSecurityAssessment({}, {
    internalSecurityAssessmentExecutor: malformedExecutor,
  });
  assert.deepEqual(malformed.data.result, {
    status: "failed",
    category: "security_assessment_timeout",
  });
});

test("internal security executor accepts both malware failed categories in the sanitized failed envelope", async () => {
  for (const category of ["malware_scan_not_configured", "malware_scan_failed"]) {
    const executor = createInternalSecurityAssessmentExecutor({
      async assessor() {
        return { status: "failed", category };
      },
    });
    const result = await executeInjectedInternalSecurityAssessment({}, {
      internalSecurityAssessmentExecutor: executor,
    });

    assert.deepEqual(result.data.result, { status: "failed", category });
    assert.deepEqual(Object.keys(result.data.result), ["status", "category"]);
  }
});

test("internal executor remains unwired from routes, confirmUpload, production barrel, queues, and persistence", () => {
  const executorSource = readFileSync("Backend/kai/security/internalSecurityAssessmentExecutor.js", "utf8");
  const intakeServiceSource = readFileSync("Backend/kai/services/kaiIntakeService.js", "utf8");
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const barrelSource = readFileSync("Backend/kai/index.js", "utf8");

  assert.doesNotMatch(executorSource, /file_policy_status|transitionUploadLifecycle|queue|enqueue|drain|router|express|pg|sql/i);
  assert.doesNotMatch(intakeServiceSource, /executeInjectedInternalSecurityAssessment|createInternalSecurityAssessmentExecutor|assessBoundedFileSecurity/);
  assert.doesNotMatch(routeSource, /executeInjectedInternalSecurityAssessment|createInternalSecurityAssessmentExecutor|assessBoundedFileSecurity|security-assessment/);
  assert.doesNotMatch(barrelSource, /executeInjectedInternalSecurityAssessment|createInternalSecurityAssessmentExecutor|assessBoundedFileSecurity/);
});
