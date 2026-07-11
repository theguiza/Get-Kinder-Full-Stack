#!/usr/bin/env node

const PASS2_MARKER = "pass2_admin_metadata_intake_verification";
const PASS2_GATE_PLAN = "KAI_MVP_Sprint2_P0_Pass2_Production_Synthetic_Metadata_Write_Gate_Plan_v0.1.1";
const BASE_URL = process.env.KAI_PASS2_BASE_URL || "";
const AUTH_COOKIE = process.env.KAI_PASS2_AUTH_COOKIE || "";
const BEARER_TOKEN = process.env.KAI_PASS2_BEARER_TOKEN || "";
const ORGANIZATION_ID = process.env.KAI_PASS2_ORGANIZATION_ID || "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const ENGAGEMENT_ID = process.env.KAI_PASS2_ENGAGEMENT_ID || "2e426ea1-2be3-4e48-b80f-9783ddbacda0";
const DB_TARGET_CLASS = process.env.KAI_PASS2_DB_TARGET_CLASS || "unknown";
const PRODUCTION_GATE_ACCEPTED = String(process.env.KAI_PASS2_PRODUCTION_SYNTHETIC_WRITE_GATE_ACCEPTED || "false") === "true";
const RUN_WRITE_PATH = String(process.env.KAI_PASS2_RUN_WRITE_PATH || "false") === "true";
const PREFLIGHT_ONLY = String(process.env.KAI_PASS2_PREFLIGHT_ONLY || "false") === "true";
const AUTH_PREFLIGHT_ROUTE = "GET /api/kai/sprint2/intake/auth-preflight";
const PRODUCTION_GATE_ROUTES = Object.freeze([
  "GET /api/kai/sprint2/intake/status",
  "GET /api/kai/sprint2/intake/admin/access-check",
  "POST /api/kai/sprint2/intake/admin/batches",
  "POST /api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations",
]);
const API_VERIFIER_ROUTES = Object.freeze([AUTH_PREFLIGHT_ROUTE, ...PRODUCTION_GATE_ROUTES]);

const rows = [];

function add(checkName, objectName, status, detail, resultType = "CHECK") {
  rows.push({ result_type: resultType, check_name: checkName, object_name: objectName, status, detail });
}

function printRows() {
  console.log("result_type\tcheck_name\tobject_name\tstatus\tdetail");
  for (const row of rows) {
    console.log(`${row.result_type}\t${row.check_name}\t${row.object_name}\t${row.status}\t${row.detail}`);
  }
}

function writeGatePasses() {
  return DB_TARGET_CLASS === "non_production" || (DB_TARGET_CLASS === "production" && PRODUCTION_GATE_ACCEPTED);
}

function headers() {
  const result = { "Content-Type": "application/json" };
  if (AUTH_COOKIE) result.Cookie = AUTH_COOKIE;
  if (BEARER_TOKEN) result.Authorization = `Bearer ${BEARER_TOKEN}`;
  return result;
}

function isValidCookiePairName(name) {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name);
}

function isValidCookiePairValue(value) {
  if (value.startsWith('"') || value.endsWith('"')) {
    if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"') || value.slice(1, -1).includes('"')) return false;
    return /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/.test(value.slice(1, -1));
  }
  return /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/.test(value);
}

function isResponseCookieAttributeName(name) {
  return /^(?:domain|expires|httponly|max-age|path|samesite|secure)$/i.test(name);
}

function isValidRequestCookieHeaderSyntax(cookieHeader) {
  if (typeof cookieHeader !== "string" || cookieHeader.trim() === "") return false;
  if (/[\x00-\x1f\x7f]/.test(cookieHeader)) return false;
  if (/^\s*(?:cookie|set-cookie)\s*:/i.test(cookieHeader)) return false;

  const parts = cookieHeader.split(";");
  let hasRealCookiePair = false;
  for (const part of parts) {
    const segment = part.trim();
    if (!segment) return false;
    const equalsIndex = segment.indexOf("=");
    if (equalsIndex <= 0) return false;

    const name = segment.slice(0, equalsIndex);
    const value = segment.slice(equalsIndex + 1);
    if (!isValidCookiePairName(name) || !isValidCookiePairValue(value)) return false;
    if (isResponseCookieAttributeName(name)) return false;
    hasRealCookiePair = true;
  }

  return hasRealCookiePair;
}

function routeKey(path, method = "GET") {
  const routePath = path.split("?")[0].replace(
    /^\/api\/kai\/sprint2\/intake\/admin\/batches\/[^/]+\/file-reservations$/,
    "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations",
  );
  return `${method.toUpperCase()} ${routePath}`;
}

function assertAllowedProductionGateRoute(path, options = {}) {
  const key = routeKey(path, options.method || "GET");
  if (!API_VERIFIER_ROUTES.includes(key)) {
    throw new Error(`Verifier route is outside the API verifier allowlist: ${key}`);
  }
}

async function request(path, options = {}) {
  assertAllowedProductionGateRoute(path, options);
  const url = `${BASE_URL.replace(/\/$/, "")}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers(),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { response, body };
}

async function unauthenticatedRequest(path, options = {}) {
  assertAllowedProductionGateRoute(path, options);
  const url = `${BASE_URL.replace(/\/$/, "")}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { response, body };
}

function containsForbiddenResponseKeys(value) {
  const forbidden = new Set([
    "signed_upload_url",
    "signed_read_url",
    "storage_credential",
    "storage_credentials",
    "raw_storage_url",
    "req.user",
    "authorization",
    "bearer",
    "cookie",
    "email",
    "jwt",
    "name",
    "passport",
    "password",
    "role",
    "roles",
    "secret",
    "session",
    "session_id",
    "token",
    "user",
    "user_id",
    "raw_file_content",
    "parser_output",
    "claim",
    "evidence",
    "report",
    "export",
  ]);
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    for (const [key, child] of Object.entries(current)) {
      if (forbidden.has(key)) return key;
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return null;
}

async function verifyAuthPreflight() {
  const authPreflight = await request("/api/kai/sprint2/intake/auth-preflight");
  const forbiddenAuthPreflightKey = containsForbiddenResponseKeys(authPreflight.body);
  const authPreflightAccepted =
    authPreflight.response.ok &&
    authPreflight.body?.ok === true &&
    authPreflight.body?.data?.authenticated === true &&
    authPreflight.body?.data?.session_authenticated === true &&
    authPreflight.body?.data?.feature_flag_required === false &&
    Array.isArray(authPreflight.body?.blockers) &&
    authPreflight.body.blockers.length === 0 &&
    Array.isArray(authPreflight.body?.warnings) &&
    authPreflight.body.warnings.length === 0 &&
    !forbiddenAuthPreflightKey;
  add(
    "API_AUTH_PREFLIGHT_COOKIE_SESSION_ACCEPTED",
    "/api/kai/sprint2/intake/auth-preflight",
    authPreflightAccepted ? "PASS" : "FAIL",
    forbiddenAuthPreflightKey ? `Forbidden key present: ${forbiddenAuthPreflightKey}` : `HTTP ${authPreflight.response.status}`,
  );
  return authPreflightAccepted;
}

function finish(exitCode) {
  printRows();
  process.exitCode = exitCode;
}

function checksPass() {
  return !rows.some((row) => row.result_type === "CHECK" && row.status === "FAIL");
}

async function run() {
  if (!BASE_URL) {
    add("API_BASE_URL_CONFIGURED", "KAI_PASS2_BASE_URL", "FAIL", "KAI_PASS2_BASE_URL is required for API verification.");
    finish(1);
    return;
  }

  const authMethodCount = Number(Boolean(AUTH_COOKIE)) + Number(Boolean(BEARER_TOKEN));
  if (authMethodCount !== 1) {
    add(
      "API_AUTH_EXACTLY_ONE_METHOD_CONFIGURED",
      "KAI_PASS2_AUTH_COOKIE,KAI_PASS2_BEARER_TOKEN",
      "FAIL",
      authMethodCount === 0
        ? "Exactly one auth method is required; none were configured."
        : "Exactly one auth method is required; both cookie and bearer token were configured.",
    );
    finish(1);
    return;
  }
  add("API_AUTH_EXACTLY_ONE_METHOD_CONFIGURED", "auth_method", "PASS", "Exactly one auth method is configured.");

  if (!AUTH_COOKIE || BEARER_TOKEN) {
    add(
      "API_AUTH_COOKIE_ONLY_BEARER_ABSENT",
      "KAI_PASS2_AUTH_COOKIE,KAI_PASS2_BEARER_TOKEN",
      "FAIL",
      "Copied-cookie preflight requires KAI_PASS2_AUTH_COOKIE and no bearer token.",
    );
    finish(1);
    return;
  }
  add(
    "API_AUTH_COOKIE_ONLY_BEARER_ABSENT",
    "KAI_PASS2_AUTH_COOKIE,KAI_PASS2_BEARER_TOKEN",
    "PASS",
    "Copied-cookie auth is configured and bearer token is absent.",
  );

  if (!isValidRequestCookieHeaderSyntax(AUTH_COOKIE)) {
    add(
      "API_AUTH_COOKIE_REQUEST_HEADER_SYNTAX_VALID",
      "KAI_PASS2_AUTH_COOKIE",
      "FAIL",
      "KAI_PASS2_AUTH_COOKIE must be a valid request cookie header string.",
    );
    finish(1);
    return;
  }
  add(
    "API_AUTH_COOKIE_REQUEST_HEADER_SYNTAX_VALID",
    "KAI_PASS2_AUTH_COOKIE",
    "PASS",
    "KAI_PASS2_AUTH_COOKIE has valid request cookie header syntax.",
  );

  if (PREFLIGHT_ONLY && RUN_WRITE_PATH) {
    add(
      "API_PREFLIGHT_ONLY_REQUIRES_NO_WRITE_PATH",
      "KAI_PASS2_PREFLIGHT_ONLY,KAI_PASS2_RUN_WRITE_PATH",
      "FAIL",
      "Preflight-only mode requires KAI_PASS2_RUN_WRITE_PATH=false.",
    );
    finish(1);
    return;
  }

  if (PREFLIGHT_ONLY) {
    add(
      "API_PREFLIGHT_ONLY_REQUIRES_NO_WRITE_PATH",
      "KAI_PASS2_PREFLIGHT_ONLY,KAI_PASS2_RUN_WRITE_PATH",
      "PASS",
      "Preflight-only mode is enabled with write path disabled.",
    );
    const authPreflightAccepted = await verifyAuthPreflight();
    finish(authPreflightAccepted && checksPass() ? 0 : 1);
    return;
  }

  const authPreflightAccepted = await verifyAuthPreflight();

  if (!authPreflightAccepted) {
    finish(1);
    return;
  }

  const gatePass = writeGatePasses();
  add(
    "API_OR_RUNTIME_DB_TARGET_CONFIRMED_NON_PRODUCTION_OR_WRITE_GATE_ACCEPTED",
    "runtime_db_target",
    gatePass ? "PASS" : "FAIL",
    gatePass ? "Runtime target write gate passed." : "Runtime target write gate did not pass.",
  );

  if (!gatePass) {
    finish(1);
    return;
  }

  const status = await request("/api/kai/sprint2/intake/status");
  if (status.response.status === 403 && status.body?.error?.code === "feature_disabled") {
    add(
      "API_FEATURE_OFF_STATUS_RETURNS_DISABLED",
      "/api/kai/sprint2/intake/status",
      RUN_WRITE_PATH ? "FAIL" : "PASS",
      "Feature-disabled status returned the expected blocked response.",
    );
    finish(RUN_WRITE_PATH ? 1 : 0);
    return;
  }

  const statusReady = status.response.ok && status.body?.data?.mode === "admin_metadata_only";
  add(
    "API_FEATURE_ON_STATUS_RETURNS_READY_METADATA_ONLY",
    "/api/kai/sprint2/intake/status",
    statusReady ? "PASS" : "FAIL",
    `HTTP ${status.response.status}`,
  );

  const forbiddenStatusKey = containsForbiddenResponseKeys(status.body);
  add(
    "API_STATUS_RESPONSE_HAS_NO_FORBIDDEN_KEYS",
    "/api/kai/sprint2/intake/status",
    forbiddenStatusKey ? "FAIL" : "PASS",
    forbiddenStatusKey ? `Forbidden key present: ${forbiddenStatusKey}` : "No forbidden response keys.",
  );

  if (!statusReady || forbiddenStatusKey) {
    finish(1);
    return;
  }

  if (!RUN_WRITE_PATH) {
    add("API_WRITE_PATH_NOT_REQUESTED", "write_path", "INFO", "Write-disabled mode completed without POST operations.", "OBSERVATION");
    finish(0);
    return;
  }

  const access = await request(`/api/kai/sprint2/intake/admin/access-check?organization_id=${ORGANIZATION_ID}&engagement_id=${ENGAGEMENT_ID}`);
  add(
    "API_ACCESS_CHECK_MAPS_ACTOR",
    "/api/kai/sprint2/intake/admin/access-check",
    access.response.ok && access.body?.data?.actor_mapped === true ? "PASS" : "FAIL",
    `HTTP ${access.response.status}`,
  );
  add(
    "API_ACCESS_CHECK_CONFIRMS_NCWS_MEMBERSHIP",
    "/api/kai/sprint2/intake/admin/access-check",
    access.response.ok && access.body?.data?.membership_active === true ? "PASS" : "FAIL",
    `HTTP ${access.response.status}`,
  );
  add(
    "API_ACCESS_CHECK_CONFIRMS_GLOBAL_GK_WRITE_ROLE",
    "/api/kai/sprint2/intake/admin/access-check",
    access.response.ok &&
      access.body?.data?.global_write_role_present === true &&
      access.body?.data?.matched_write_role_family === "gk_admin_or_operator"
      ? "PASS"
      : "FAIL",
    `HTTP ${access.response.status}`,
  );

  if (!checksPass()) {
    finish(1);
    return;
  }

  const unauth = await unauthenticatedRequest("/api/kai/sprint2/intake/admin/batches", {
    method: "POST",
    body: JSON.stringify({
      organization_id: ORGANIZATION_ID,
      engagement_id: ENGAGEMENT_ID,
      batch_code: "NCWS-P0-PASS2-METADATA-UNAUTH",
      idempotency_key: "kai-p0-pass2-unauth",
    }),
  });
  const unauthAccepted = unauth.response.status === 401 && unauth.body?.ok === false;
  add(
    "API_UNAUTHENTICATED_RETURNS_401",
    "/api/kai/sprint2/intake/admin/batches",
    unauthAccepted ? "PASS" : "FAIL",
    `HTTP ${unauth.response.status}`,
  );
  add(
    "API_AUTH_FAILURE_BATCH_NO_ROW_PROOF_IDEMPOTENCY_KEY_DECLARED",
    "blocked_batch_probe",
    "INFO",
    "SQL verification must confirm that the blocked probe created no row.",
    "OBSERVATION",
  );

  if (!unauthAccepted) {
    finish(1);
    return;
  }

  const tenantMismatch = await request("/api/kai/sprint2/intake/admin/batches", {
    method: "POST",
    body: JSON.stringify({
      organization_id: ORGANIZATION_ID,
      engagement_id: "00000000-0000-4000-8000-000000000000",
      batch_code: "NCWS-P0-PASS2-METADATA-TENANT-MISMATCH",
      idempotency_key: "kai-p0-pass2-tenant-mismatch",
      intake_method: "manual_upload",
      batch_metadata: { p0_pass: PASS2_MARKER, gate_plan: PASS2_GATE_PLAN },
    }),
  });
  const tenantMismatchAccepted = tenantMismatch.response.status === 422 && tenantMismatch.body?.ok === false;
  add(
    "API_CREATE_BATCH_TENANT_MISMATCH_RETURNS_422",
    "/api/kai/sprint2/intake/admin/batches",
    tenantMismatchAccepted ? "PASS" : "FAIL",
    `HTTP ${tenantMismatch.response.status}`,
  );
  add(
    "API_TENANT_MISMATCH_BATCH_NO_ROW_PROOF_IDEMPOTENCY_KEY_DECLARED",
    "blocked_tenant_probe",
    "INFO",
    "SQL verification must confirm that the blocked probe created no row.",
    "OBSERVATION",
  );

  if (!tenantMismatchAccepted) {
    finish(1);
    return;
  }

  const batch = await request("/api/kai/sprint2/intake/admin/batches", {
    method: "POST",
    body: JSON.stringify({
      organization_id: ORGANIZATION_ID,
      engagement_id: ENGAGEMENT_ID,
      batch_code: "NCWS-P0-PASS2-METADATA-001",
      idempotency_key: "kai-p0-pass2-ncws-batch-001",
      intake_method: "manual_upload",
      notes: "P0 Pass 2 metadata-only admin route verification. No raw files. No parser. No source promotion.",
      batch_metadata: {
        p0_pass: PASS2_MARKER,
        gate_plan: PASS2_GATE_PLAN,
        synthetic_only: true,
        raw_upload_enabled: false,
        signed_url_enabled: false,
        parser_worker_enabled: false,
        source_promotion_enabled: false,
      },
    }),
  });
  add(
    "API_CREATE_BATCH_RETURNS_OK",
    "/api/kai/sprint2/intake/admin/batches",
    batch.response.ok && batch.body?.data?.metadata_only === true ? "PASS" : "FAIL",
    `HTTP ${batch.response.status}`,
  );

  if (!(batch.response.ok && batch.body?.data?.metadata_only === true && batch.body?.data?.intake_batch_id)) {
    finish(1);
    return;
  }

  const replay = await request("/api/kai/sprint2/intake/admin/batches", {
    method: "POST",
    body: JSON.stringify({
      organization_id: ORGANIZATION_ID,
      engagement_id: ENGAGEMENT_ID,
      batch_code: "NCWS-P0-PASS2-METADATA-001",
      idempotency_key: "kai-p0-pass2-ncws-batch-001",
      intake_method: "manual_upload",
      notes: "P0 Pass 2 metadata-only admin route verification. No raw files. No parser. No source promotion.",
      batch_metadata: {
        p0_pass: PASS2_MARKER,
        gate_plan: PASS2_GATE_PLAN,
        synthetic_only: true,
        raw_upload_enabled: false,
        signed_url_enabled: false,
        parser_worker_enabled: false,
        source_promotion_enabled: false,
      },
    }),
  });
  add(
    "API_CREATE_BATCH_IDEMPOTENT_REPLAY_RETURNS_EXISTING",
    "/api/kai/sprint2/intake/admin/batches",
    replay.response.ok && replay.body?.data?.intake_batch_id === batch.body?.data?.intake_batch_id ? "PASS" : "FAIL",
    `HTTP ${replay.response.status}`,
  );

  if (!(replay.response.ok && replay.body?.data?.intake_batch_id === batch.body?.data?.intake_batch_id)) {
    finish(1);
    return;
  }

  const intakeBatchId = batch.body?.data?.intake_batch_id;
  const file = await request(`/api/kai/sprint2/intake/admin/batches/${intakeBatchId}/file-reservations`, {
    method: "POST",
    body: JSON.stringify({
      organization_id: ORGANIZATION_ID,
      engagement_id: ENGAGEMENT_ID,
      idempotency_key: "kai-p0-pass2-ncws-file-reservation-001",
      original_filename: "NCWS P0 Pass2 metadata-only reservation.csv",
      mime_type: "text/csv",
      file_extension: ".csv",
      file_size_bytes: 0,
      reservation_metadata: {
        p0_pass: PASS2_MARKER,
        gate_plan: PASS2_GATE_PLAN,
        synthetic_only: true,
        raw_upload_enabled: false,
        signed_url_enabled: false,
        no_raw_object_created: true,
      },
    }),
  });
  const forbiddenFileKey = containsForbiddenResponseKeys(file.body);
  const fileAccepted = file.response.ok && file.body?.data?.metadata_only === true && !forbiddenFileKey;
  add(
    "API_FILE_RESERVATION_RETURNS_OK_NO_UPLOAD_URL",
    "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations",
    fileAccepted ? "PASS" : "FAIL",
    forbiddenFileKey ? `Forbidden key present: ${forbiddenFileKey}` : `HTTP ${file.response.status}`,
  );
  add(
    "API_FILE_RESERVATION_NO_SIGNED_URL_IN_RESPONSE",
    "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations",
    forbiddenFileKey ? "FAIL" : "PASS",
    forbiddenFileKey ? `Forbidden key present: ${forbiddenFileKey}` : "No forbidden response key was returned.",
  );

  if (!fileAccepted) {
    finish(1);
    return;
  }

  add(
    "API_PRODUCTION_GATE_ROUTE_ALLOWLIST_ENFORCED",
    "api_verifier_routes",
    "PASS",
    PRODUCTION_GATE_ROUTES.join(", "),
  );

  finish(checksPass() ? 0 : 1);
}

run().catch(() => {
  add("API_VERIFIER_UNEXPECTED_ERROR", "api_verifier", "FAIL", "Verifier operation failed; sensitive error detail suppressed.");
  finish(1);
});
