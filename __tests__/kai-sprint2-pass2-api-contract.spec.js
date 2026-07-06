import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import router, { __testables } from "../Backend/kai/routes/sprint2IntakeApi.js";

test("Pass 2 router has no raw upload or source-promotion route", () => {
  const routePaths = router.stack.map((layer) => layer.route?.path).filter(Boolean);
  assert.equal(routePaths.includes("/upload-url"), false);
  assert.equal(routePaths.includes("/source-promotion"), false);
  assert.equal(routePaths.includes("/admin/batches/:intakeBatchId/file-reservations"), true);
});

test("route service result preserves no signed URL success contract", () => {
  let statusCode = null;
  let body = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return payload;
    },
  };

  __testables.sendServiceResult(res, {
    ok: true,
    data: {
      metadata_only: true,
      storage_upload_enabled: false,
      signed_upload_enabled: false,
      signed_read_enabled: false,
    },
    warnings: [],
  });

  assert.equal(statusCode, 200);
  assert.equal(body.data.metadata_only, true);
  assert.equal("signed_upload_url" in body.data, false);
  assert.equal("signed_read_url" in body.data, false);
});

test("API verifier includes required Pass 2 review check names", () => {
  const verifier = readFileSync("scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js", "utf8");
  const requiredChecks = [
    "API_OR_RUNTIME_DB_TARGET_CONFIRMED_NON_PRODUCTION_OR_WRITE_GATE_ACCEPTED",
    "API_UNAUTHENTICATED_RETURNS_401",
    "API_CREATE_BATCH_IDEMPOTENT_REPLAY_RETURNS_EXISTING",
    "API_CREATE_BATCH_TENANT_MISMATCH_RETURNS_422",
    "API_FILE_RESERVATION_UNSAFE_FILENAME_RETURNS_422",
    "API_FILE_RESERVATION_NO_SIGNED_URL_IN_RESPONSE",
    "API_UPLOAD_URL_ROUTE_DISABLED_OR_NOT_PRESENT",
    "API_SOURCE_PROMOTION_ROUTE_DISABLED_OR_NOT_PRESENT",
    "API_EXPECTED_BLOCKER_SHAPE_OK_FALSE",
  ];

  for (const checkName of requiredChecks) {
    assert.match(verifier, new RegExp(checkName));
  }
});

test("SQL verifier includes forbidden core object families and remains read-only", () => {
  const verifier = readFileSync("scripts/kai-sprint2-pass2-admin-metadata-intake-verifier.sql", "utf8");
  const requiredObjects = [
    "kai.sources",
    "kai.source_versions",
    "kai.source_locators",
    "kai.evidence_items",
    "kai.claims",
    "kai.claim_evidence_links",
    "kai.claim_requirement_links",
    "kai.reports",
    "kai.report_sections",
    "kai.report_section_claims",
    "kai.exports",
    "kai.export_items",
    "kai.graph_relationships",
    "kai.prompt_runs",
    "kai.model_outputs",
  ];

  for (const objectName of requiredObjects) {
    assert.match(verifier, new RegExp(objectName.replace(".", "\\.")));
  }

  assert.doesNotMatch(verifier, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE\s+TEMP|CREATE\s+TEMPORARY)\b/i);
});
