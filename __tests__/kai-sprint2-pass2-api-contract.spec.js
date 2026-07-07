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
    "API_AUTH_COOKIE_ONLY_BEARER_ABSENT",
    "API_AUTH_PREFLIGHT_COOKIE_SESSION_ACCEPTED",
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

test("API verifier route allowlist excludes disallowed surfaces", () => {
  const verifier = readFileSync("scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js", "utf8");
  const routeList = [
    verifier.match(/const AUTH_PREFLIGHT_ROUTE = "([^"]+)";/)?.[1] || "",
    verifier.match(/const PRODUCTION_GATE_ROUTES = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] || "",
  ].join("\n");
  const allowedRoutes = [
    "GET /api/kai/sprint2/intake/auth-preflight",
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
  assert.match(verifier, /const API_VERIFIER_ROUTES = Object\.freeze\(\[AUTH_PREFLIGHT_ROUTE, \.\.\.PRODUCTION_GATE_ROUTES\]\);/);
  assert.doesNotMatch(verifier, /request\(["']\/api\/kai\/sprint2\/intake\/(?:upload-url|source-promotion|evidence|claims|reports|exports|graph|assistant|tools|connectors|parser|profile)/);
});

test("API verifier enforces exact-one auth before first API call", () => {
  const verifier = readFileSync("scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js", "utf8");
  assert.match(verifier, /Number\(Boolean\(AUTH_COOKIE\)\) \+ Number\(Boolean\(BEARER_TOKEN\)\)/);
  assert.match(verifier, /API_AUTH_EXACTLY_ONE_METHOD_CONFIGURED/);
  assert.ok(verifier.indexOf("API_AUTH_EXACTLY_ONE_METHOD_CONFIGURED") < verifier.indexOf('request("/api/kai/sprint2/intake/auth-preflight")'));
});

test("API verifier requires cookie-only auth before auth preflight", () => {
  const verifier = readFileSync("scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js", "utf8");
  const cookieOnlyIndex = verifier.indexOf("API_AUTH_COOKIE_ONLY_BEARER_ABSENT");
  const preflightRequestIndex = verifier.indexOf('request("/api/kai/sprint2/intake/auth-preflight")');

  assert.notEqual(cookieOnlyIndex, -1);
  assert.notEqual(preflightRequestIndex, -1);
  assert.match(verifier, /if \(!AUTH_COOKIE \|\| BEARER_TOKEN\)/);
  assert.ok(cookieOnlyIndex < preflightRequestIndex);
});

test("API verifier calls auth preflight before status and fails closed", () => {
  const verifier = readFileSync("scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js", "utf8");
  const preflightRequestIndex = verifier.indexOf('request("/api/kai/sprint2/intake/auth-preflight")');
  const preflightFailClosedIndex = verifier.indexOf("if (!authPreflightAccepted)");
  const dbTargetGateIndex = verifier.indexOf("API_OR_RUNTIME_DB_TARGET_CONFIRMED_NON_PRODUCTION_OR_WRITE_GATE_ACCEPTED");
  const statusRequestIndex = verifier.indexOf('request("/api/kai/sprint2/intake/status")');

  assert.notEqual(preflightRequestIndex, -1);
  assert.notEqual(preflightFailClosedIndex, -1);
  assert.notEqual(dbTargetGateIndex, -1);
  assert.notEqual(statusRequestIndex, -1);
  assert.ok(preflightRequestIndex < preflightFailClosedIndex);
  assert.ok(preflightFailClosedIndex < dbTargetGateIndex);
  assert.ok(dbTargetGateIndex < statusRequestIndex);
  assert.match(verifier, /authPreflight\.body\?\.data\?\.session_authenticated === true/);
  assert.match(verifier, /authPreflight\.body\?\.data\?\.feature_flag_required === false/);
  assert.match(verifier, /forbiddenAuthPreflightKey/);
});

test("auth preflight verifier endpoint remains exact and status follows it", () => {
  const verifier = readFileSync("scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js", "utf8");
  const preflightRouteIndex = verifier.indexOf('const AUTH_PREFLIGHT_ROUTE = "GET /api/kai/sprint2/intake/auth-preflight";');
  const statusRouteIndex = verifier.indexOf('"GET /api/kai/sprint2/intake/status"');
  const preflightRequestIndex = verifier.indexOf('request("/api/kai/sprint2/intake/auth-preflight")');
  const statusRequestIndex = verifier.indexOf('request("/api/kai/sprint2/intake/status")');

  assert.notEqual(preflightRouteIndex, -1);
  assert.notEqual(statusRouteIndex, -1);
  assert.notEqual(preflightRequestIndex, -1);
  assert.notEqual(statusRequestIndex, -1);
  assert.ok(preflightRouteIndex < statusRouteIndex);
  assert.ok(preflightRequestIndex < statusRequestIndex);
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

test("API verifier status-only mode does not call POST routes", () => {
  const verifier = readFileSync("scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js", "utf8");
  const writePathGuard = verifier.indexOf("if (!RUN_WRITE_PATH)");
  const unauthPost = verifier.indexOf('unauthenticatedRequest("/api/kai/sprint2/intake/admin/batches"');
  const firstAuthedPost = verifier.indexOf('request("/api/kai/sprint2/intake/admin/batches",');
  const filePost = verifier.indexOf('file-reservations`, {');

  assert.notEqual(writePathGuard, -1);
  assert.notEqual(unauthPost, -1);
  assert.notEqual(firstAuthedPost, -1);
  assert.notEqual(filePost, -1);
  assert.ok(writePathGuard < unauthPost);
  assert.ok(writePathGuard < firstAuthedPost);
  assert.ok(writePathGuard < filePost);
});

test("API verifier does not log or return auth material", () => {
  const verifier = readFileSync("scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js", "utf8");
  const printRowsBody = verifier.match(/function printRows\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
  const authPreflightDetail = verifier.match(/API_AUTH_PREFLIGHT_COOKIE_SESSION_ACCEPTED[\s\S]*?`HTTP \$\{authPreflight\.response\.status\}`/)?.[0] || "";

  assert.doesNotMatch(printRowsBody, /AUTH_COOKIE|BEARER_TOKEN|Cookie|Authorization|session|req\.user/);
  assert.doesNotMatch(authPreflightDetail, /AUTH_COOKIE|BEARER_TOKEN|Cookie|Authorization|session_id|user_id|email/);
  assert.match(verifier, /"cookie"/);
  assert.match(verifier, /"token"/);
  assert.match(verifier, /"session_id"/);
  assert.match(verifier, /"user_id"/);
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
