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
    "API_AUTH_EXACTLY_ONE_METHOD_CONFIGURED",
    "API_ACCESS_CHECK_CONFIRMS_GLOBAL_GK_WRITE_ROLE",
    "API_UNAUTHENTICATED_RETURNS_401",
    "API_AUTH_FAILURE_BATCH_NO_ROW_PROOF_IDEMPOTENCY_KEY_DECLARED",
    "API_CREATE_BATCH_IDEMPOTENT_REPLAY_RETURNS_EXISTING",
    "API_CREATE_BATCH_TENANT_MISMATCH_RETURNS_422",
    "API_TENANT_MISMATCH_BATCH_NO_ROW_PROOF_IDEMPOTENCY_KEY_DECLARED",
    "API_FILE_RESERVATION_UNSAFE_FILENAME_RETURNS_422",
    "API_UNSAFE_FILE_NO_ROW_PROOF_IDEMPOTENCY_KEY_DECLARED",
    "API_FILE_RESERVATION_NO_SIGNED_URL_IN_RESPONSE",
    "API_FEATURE_OFF_STATUS_RETURNS_DISABLED",
    "API_PRODUCTION_GATE_ROUTE_ALLOWLIST_ENFORCED",
    "API_EXPECTED_BLOCKER_SHAPE_OK_FALSE",
  ];

  for (const checkName of requiredChecks) {
    assert.match(verifier, new RegExp(checkName));
  }
});

test("API verifier production gate route set excludes disallowed surfaces", () => {
  const verifier = readFileSync("scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js", "utf8");
  const routeList = verifier.match(/const PRODUCTION_GATE_ROUTES = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] || "";
  const allowedRoutes = [
    "GET /api/kai/sprint2/intake/status",
    "GET /api/kai/sprint2/intake/admin/access-check",
    "POST /api/kai/sprint2/intake/admin/batches",
    "POST /api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations",
  ];
  const disallowedFragments = [
    "/upload-url",
    "/source-promotion",
    "/evidence",
    "/claims",
    "/reports",
    "/exports",
    "/graph",
    "/assistant",
    "/tools",
    "/connectors",
    "/parser",
    "/profile",
    "signed",
  ];

  for (const allowedRoute of allowedRoutes) {
    assert.match(routeList, new RegExp(allowedRoute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const fragment of disallowedFragments) {
    assert.equal(routeList.includes(fragment), false);
  }
  assert.doesNotMatch(verifier, /request\(["']\/api\/kai\/sprint2\/intake\/(?:upload-url|source-promotion|evidence|claims|reports|exports|graph|assistant|tools|connectors|parser|profile)/);
});

test("API verifier enforces exact-one auth before first API call", () => {
  const verifier = readFileSync("scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js", "utf8");
  assert.match(verifier, /Number\(Boolean\(AUTH_COOKIE\)\) \+ Number\(Boolean\(BEARER_TOKEN\)\)/);
  assert.match(verifier, /API_AUTH_EXACTLY_ONE_METHOD_CONFIGURED/);
  assert.ok(verifier.indexOf("API_AUTH_EXACTLY_ONE_METHOD_CONFIGURED") < verifier.indexOf('request("/api/kai/sprint2/intake/status")'));
});

test("API verifier status-only mode exits before write-path calls", () => {
  const verifier = readFileSync("scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js", "utf8");
  const guardIndex = verifier.indexOf("if (!RUN_WRITE_PATH)");
  const firstPostIndex = verifier.indexOf('method: "POST"');
  assert.notEqual(guardIndex, -1);
  assert.notEqual(firstPostIndex, -1);
  assert.ok(guardIndex < firstPostIndex);
  assert.match(verifier, /API_FEATURE_OFF_STATUS_RETURNS_DISABLED/);
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

test("SQL verifier includes exact gate-plan and negative no-row proof checks", () => {
  const verifier = readFileSync("scripts/kai-sprint2-pass2-admin-metadata-intake-verifier.sql", "utf8");
  assert.match(verifier, /KAI_MVP_Sprint2_P0_Pass2_Production_Synthetic_Metadata_Write_Gate_Plan_v0\.1\.1/);
  assert.match(verifier, /PASS2_AUTH_FAILURE_BATCH_ROWS_ZERO/);
  assert.match(verifier, /PASS2_TENANT_MISMATCH_BATCH_ROWS_ZERO/);
  assert.match(verifier, /PASS2_UNSAFE_FILE_RESERVATION_ROWS_ZERO/);
  assert.match(verifier, /batch_metadata->>'gate_plan'/);
  assert.match(verifier, /file_metadata->>'gate_plan'/);
});
