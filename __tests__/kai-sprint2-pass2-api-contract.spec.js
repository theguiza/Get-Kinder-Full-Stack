import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import router, { __testables } from "../Backend/kai/routes/sprint2IntakeApi.js";

const verifierPath = new URL("../scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js", import.meta.url);

function runVerifierWithMockFetch(env = {}, responses = {}) {
  const preload = `
const calls = [];
const responses = ${JSON.stringify(responses)};
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  const method = String(options.method || "GET").toUpperCase();
  const key = method + " " + parsed.pathname;
  calls.push({ method, path: parsed.pathname, hasCookie: Boolean(options.headers?.Cookie), hasBearer: Boolean(options.headers?.Authorization) });
  const response = responses[key] || { status: 200, body: { ok: true, data: { authenticated: true, session_authenticated: true, feature_flag_required: false }, blockers: [], warnings: [] } };
  return new Response(JSON.stringify(response.body), { status: response.status, headers: { "Content-Type": "application/json" } });
};
process.on("beforeExit", () => {
  console.log("__FETCH_CALLS__" + JSON.stringify(calls));
});
`;
  const childEnv = { ...process.env, ...env };
  for (const [key, value] of Object.entries(childEnv)) {
    if (value === undefined) delete childEnv[key];
  }
  const result = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, verifierPath.pathname], {
    cwd: new URL("..", import.meta.url),
    env: childEnv,
    encoding: "utf8",
  });
  const calls = JSON.parse(result.stdout.match(/__FETCH_CALLS__(\[.*\])/m)?.[1] || "[]");
  return { ...result, output: `${result.stdout}${result.stderr}`, calls };
}

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
    "API_PREFLIGHT_ONLY_REQUIRES_NO_WRITE_PATH",
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
  const authCheckIndex = verifier.indexOf("API_AUTH_EXACTLY_ONE_METHOD_CONFIGURED");
  const preflightOnlyCallIndex = verifier.indexOf("await verifyAuthPreflight();");
  const standardCallIndex = verifier.indexOf("const authPreflightAccepted = await verifyAuthPreflight();");

  assert.match(verifier, /Number\(Boolean\(AUTH_COOKIE\)\) \+ Number\(Boolean\(BEARER_TOKEN\)\)/);
  assert.match(verifier, /API_AUTH_EXACTLY_ONE_METHOD_CONFIGURED/);
  assert.notEqual(authCheckIndex, -1);
  assert.notEqual(preflightOnlyCallIndex, -1);
  assert.notEqual(standardCallIndex, -1);
  assert.ok(authCheckIndex < preflightOnlyCallIndex);
  assert.ok(authCheckIndex < standardCallIndex);
});

test("API verifier requires cookie-only auth before auth preflight", () => {
  const verifier = readFileSync("scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js", "utf8");
  const cookieOnlyIndex = verifier.indexOf("API_AUTH_COOKIE_ONLY_BEARER_ABSENT");
  const preflightOnlyCallIndex = verifier.indexOf("await verifyAuthPreflight();");
  const standardCallIndex = verifier.indexOf("const authPreflightAccepted = await verifyAuthPreflight();");

  assert.notEqual(cookieOnlyIndex, -1);
  assert.notEqual(preflightOnlyCallIndex, -1);
  assert.notEqual(standardCallIndex, -1);
  assert.match(verifier, /if \(!AUTH_COOKIE \|\| BEARER_TOKEN\)/);
  assert.ok(cookieOnlyIndex < preflightOnlyCallIndex);
  assert.ok(cookieOnlyIndex < standardCallIndex);
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

test("API verifier preflight-only mode calls only auth preflight and exits", () => {
  const result = runVerifierWithMockFetch({
    KAI_PASS2_BASE_URL: "https://example.test",
    KAI_PASS2_AUTH_COOKIE: "secret-cookie-sentinel",
    KAI_PASS2_BEARER_TOKEN: undefined,
    KAI_PASS2_PREFLIGHT_ONLY: "true",
    KAI_PASS2_RUN_WRITE_PATH: "false",
    KAI_PASS2_DB_TARGET_CLASS: undefined,
    KAI_PASS2_PRODUCTION_SYNTHETIC_WRITE_GATE_ACCEPTED: undefined,
    KAI_PASS2_ORGANIZATION_ID: undefined,
    KAI_PASS2_ENGAGEMENT_ID: undefined,
  });

  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.calls, [
    {
      method: "GET",
      path: "/api/kai/sprint2/intake/auth-preflight",
      hasCookie: true,
      hasBearer: false,
    },
  ]);
  assert.match(result.stdout, /API_AUTH_EXACTLY_ONE_METHOD_CONFIGURED\tauth_method\tPASS/);
  assert.match(result.stdout, /API_AUTH_COOKIE_ONLY_BEARER_ABSENT\tKAI_PASS2_AUTH_COOKIE,KAI_PASS2_BEARER_TOKEN\tPASS/);
  assert.match(result.stdout, /API_PREFLIGHT_ONLY_REQUIRES_NO_WRITE_PATH\tKAI_PASS2_PREFLIGHT_ONLY,KAI_PASS2_RUN_WRITE_PATH\tPASS/);
  assert.match(result.stdout, /API_AUTH_PREFLIGHT_COOKIE_SESSION_ACCEPTED\t\/api\/kai\/sprint2\/intake\/auth-preflight\tPASS\tHTTP 200/);
  assert.doesNotMatch(result.output, /\/api\/kai\/sprint2\/intake\/status/);
  assert.doesNotMatch(result.output, /\/api\/kai\/sprint2\/intake\/admin\/access-check/);
  assert.doesNotMatch(result.output, /\/api\/kai\/sprint2\/intake\/admin\/batches/);
  assert.doesNotMatch(result.output, /API_OR_RUNTIME_DB_TARGET_CONFIRMED_NON_PRODUCTION_OR_WRITE_GATE_ACCEPTED/);
});

test("API verifier preflight-only mode preserves cookie-only and bearer-absent checks", () => {
  const result = runVerifierWithMockFetch({
    KAI_PASS2_BASE_URL: "https://example.test",
    KAI_PASS2_AUTH_COOKIE: "secret-cookie-sentinel",
    KAI_PASS2_BEARER_TOKEN: "secret-token-sentinel",
    KAI_PASS2_PREFLIGHT_ONLY: "true",
    KAI_PASS2_RUN_WRITE_PATH: "false",
    KAI_PASS2_ORGANIZATION_ID: undefined,
    KAI_PASS2_ENGAGEMENT_ID: undefined,
    KAI_PASS2_PRODUCTION_SYNTHETIC_WRITE_GATE_ACCEPTED: undefined,
  });

  assert.equal(result.status, 1, result.output);
  assert.deepEqual(result.calls, []);
  assert.match(result.stdout, /API_AUTH_EXACTLY_ONE_METHOD_CONFIGURED\tKAI_PASS2_AUTH_COOKIE,KAI_PASS2_BEARER_TOKEN\tFAIL/);
  assert.doesNotMatch(result.output, /secret-cookie-sentinel|secret-token-sentinel/);
});

test("API verifier preflight-only mode requires no write path before any API call", () => {
  const result = runVerifierWithMockFetch({
    KAI_PASS2_BASE_URL: "https://example.test",
    KAI_PASS2_AUTH_COOKIE: "secret-cookie-sentinel",
    KAI_PASS2_BEARER_TOKEN: undefined,
    KAI_PASS2_PREFLIGHT_ONLY: "true",
    KAI_PASS2_RUN_WRITE_PATH: "true",
    KAI_PASS2_ORGANIZATION_ID: undefined,
    KAI_PASS2_ENGAGEMENT_ID: undefined,
    KAI_PASS2_PRODUCTION_SYNTHETIC_WRITE_GATE_ACCEPTED: undefined,
  });

  assert.equal(result.status, 1, result.output);
  assert.deepEqual(result.calls, []);
  assert.match(result.stdout, /API_PREFLIGHT_ONLY_REQUIRES_NO_WRITE_PATH\tKAI_PASS2_PREFLIGHT_ONLY,KAI_PASS2_RUN_WRITE_PATH\tFAIL/);
  assert.doesNotMatch(result.output, /secret-cookie-sentinel/);
});

test("API verifier preflight-only mode does not log cookie, token, session, or user material", () => {
  const result = runVerifierWithMockFetch(
    {
      KAI_PASS2_BASE_URL: "https://example.test",
      KAI_PASS2_AUTH_COOKIE: "secret-cookie-sentinel",
      KAI_PASS2_BEARER_TOKEN: undefined,
      KAI_PASS2_PREFLIGHT_ONLY: "true",
      KAI_PASS2_RUN_WRITE_PATH: "false",
    },
    {
      "GET /api/kai/sprint2/intake/auth-preflight": {
        status: 200,
        body: {
          ok: true,
          data: {
            authenticated: true,
            session_authenticated: true,
            feature_flag_required: false,
          },
          blockers: [],
          warnings: [],
        },
      },
    },
  );

  assert.equal(result.status, 0, result.output);
  const verifierOutput = result.stdout.split("__FETCH_CALLS__")[0];
  assert.doesNotMatch(
    verifierOutput,
    /secret-cookie-sentinel|secret-token-sentinel|session-value-sentinel|user-id-sentinel|email-sentinel|Authorization|Cookie/,
  );
});

test("API verifier non-preflight mode still runs auth preflight, DB gate, then status before no-write exit", () => {
  const result = runVerifierWithMockFetch(
    {
      KAI_PASS2_BASE_URL: "https://example.test",
      KAI_PASS2_AUTH_COOKIE: "secret-cookie-sentinel",
      KAI_PASS2_BEARER_TOKEN: undefined,
      KAI_PASS2_PREFLIGHT_ONLY: undefined,
      KAI_PASS2_DB_TARGET_CLASS: "production",
      KAI_PASS2_PRODUCTION_SYNTHETIC_WRITE_GATE_ACCEPTED: "true",
      KAI_PASS2_RUN_WRITE_PATH: "false",
      KAI_PASS2_ORGANIZATION_ID: "a5d17c5a-c55f-43af-9b21-fe63aafe733f",
      KAI_PASS2_ENGAGEMENT_ID: "2e426ea1-2be3-4e48-b80f-9783ddbacda0",
    },
    {
      "GET /api/kai/sprint2/intake/status": {
        status: 403,
        body: { ok: false, error: { code: "feature_disabled" }, data: null },
      },
    },
  );

  assert.equal(result.status, 0, result.output);
  assert.deepEqual(
    result.calls.map((call) => `${call.method} ${call.path}`),
    ["GET /api/kai/sprint2/intake/auth-preflight", "GET /api/kai/sprint2/intake/status"],
  );
  assert.ok(
    result.stdout.indexOf("API_AUTH_PREFLIGHT_COOKIE_SESSION_ACCEPTED") <
      result.stdout.indexOf("API_OR_RUNTIME_DB_TARGET_CONFIRMED_NON_PRODUCTION_OR_WRITE_GATE_ACCEPTED"),
  );
  assert.ok(
    result.stdout.indexOf("API_OR_RUNTIME_DB_TARGET_CONFIRMED_NON_PRODUCTION_OR_WRITE_GATE_ACCEPTED") <
      result.stdout.indexOf("API_FEATURE_OFF_STATUS_RETURNS_DISABLED"),
  );
  assert.doesNotMatch(result.output, /\/api\/kai\/sprint2\/intake\/admin\/access-check/);
  assert.doesNotMatch(result.output, /POST/);
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

test("API verifier preflight-only branch is before DB, status, access-check, and POST gates", () => {
  const verifier = readFileSync("scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js", "utf8");
  const preflightOnlyIndex = verifier.indexOf("if (PREFLIGHT_ONLY)");
  const dbGateIndex = verifier.indexOf("API_OR_RUNTIME_DB_TARGET_CONFIRMED_NON_PRODUCTION_OR_WRITE_GATE_ACCEPTED");
  const statusRequestIndex = verifier.indexOf('request("/api/kai/sprint2/intake/status")');
  const accessCheckIndex = verifier.indexOf('request(`/api/kai/sprint2/intake/admin/access-check');
  const firstPostIndex = verifier.indexOf('method: "POST"');

  assert.notEqual(preflightOnlyIndex, -1);
  assert.notEqual(dbGateIndex, -1);
  assert.notEqual(statusRequestIndex, -1);
  assert.notEqual(accessCheckIndex, -1);
  assert.notEqual(firstPostIndex, -1);
  assert.ok(preflightOnlyIndex < dbGateIndex);
  assert.ok(preflightOnlyIndex < statusRequestIndex);
  assert.ok(preflightOnlyIndex < accessCheckIndex);
  assert.ok(preflightOnlyIndex < firstPostIndex);
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
