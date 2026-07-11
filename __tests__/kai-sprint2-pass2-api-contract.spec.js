import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const apiVerifierPath = new URL("../scripts/kai-sprint2-pass2-admin-metadata-intake-api-verifier.js", import.meta.url);
const prewriteSqlPath = "scripts/kai-sprint2-pass2-admin-metadata-intake-prewrite-verifier.sql";
const postwriteSqlPath = "scripts/kai-sprint2-pass2-admin-metadata-intake-verifier.sql";
const validRequestCookieHeader = "session=secret-cookie-sentinel";
const forbiddenSecretMaterial = /secret-cookie-sentinel|secret-token-sentinel|session-value-sentinel|user-id-sentinel|email-sentinel/;

function readyResponses() {
  return {
    "GET /api/kai/sprint2/intake/auth-preflight": {
      status: 200,
      body: {
        ok: true,
        data: { authenticated: true, session_authenticated: true, feature_flag_required: false },
        blockers: [],
        warnings: [],
      },
    },
    "GET /api/kai/sprint2/intake/status": {
      status: 200,
      body: { ok: true, data: { mode: "admin_metadata_only" } },
    },
    "GET /api/kai/sprint2/intake/admin/access-check": {
      status: 200,
      body: {
        ok: true,
        data: {
          actor_mapped: true,
          membership_active: true,
          global_write_role_present: true,
          matched_write_role_family: "gk_admin_or_operator",
        },
      },
    },
    "POST /api/kai/sprint2/intake/admin/batches": [
      { status: 401, body: { ok: false } },
      { status: 422, body: { ok: false } },
      { status: 200, body: { ok: true, data: { metadata_only: true, intake_batch_id: "batch-test-id" } } },
      { status: 200, body: { ok: true, data: { metadata_only: true, intake_batch_id: "batch-test-id" } } },
    ],
    "POST /api/kai/sprint2/intake/admin/batches/batch-test-id/file-reservations": {
      status: 200,
      body: { ok: true, data: { metadata_only: true } },
    },
  };
}

function mergeResponses(overrides = {}) {
  return { ...readyResponses(), ...overrides };
}

function runVerifierWithMockFetch({ env = {}, responses = readyResponses(), throwOn = null } = {}) {
  const preload = `
const calls = [];
const responseConfig = ${JSON.stringify(responses)};
const responseIndexes = Object.create(null);
const throwOn = ${JSON.stringify(throwOn)};
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  const method = String(options.method || "GET").toUpperCase();
  const key = method + " " + parsed.pathname;
  calls.push({
    method,
    path: parsed.pathname,
    hasCookie: Boolean(options.headers?.Cookie),
    hasBearer: Boolean(options.headers?.Authorization),
  });
  if (throwOn === key) throw new Error("secret-token-sentinel");
  const configured = responseConfig[key];
  const response = Array.isArray(configured)
    ? configured[responseIndexes[key] || 0]
    : configured;
  responseIndexes[key] = (responseIndexes[key] || 0) + 1;
  const selected = response || { status: 500, body: { ok: false } };
  return new Response(JSON.stringify(selected.body), {
    status: selected.status,
    headers: { "Content-Type": "application/json" },
  });
};
process.on("beforeExit", () => {
  console.log("__FETCH_CALLS__" + JSON.stringify(calls));
});
`;
  const childEnv = {
    ...process.env,
    KAI_PASS2_BASE_URL: "https://example.test",
    KAI_PASS2_AUTH_COOKIE: validRequestCookieHeader,
    KAI_PASS2_BEARER_TOKEN: undefined,
    KAI_PASS2_PREFLIGHT_ONLY: "false",
    KAI_PASS2_DB_TARGET_CLASS: "non_production",
    KAI_PASS2_PRODUCTION_SYNTHETIC_WRITE_GATE_ACCEPTED: "false",
    KAI_PASS2_RUN_WRITE_PATH: "true",
    ...env,
  };
  for (const [key, value] of Object.entries(childEnv)) {
    if (value === undefined) delete childEnv[key];
  }
  const result = spawnSync(
    process.execPath,
    ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, apiVerifierPath.pathname],
    { cwd: new URL("..", import.meta.url), env: childEnv, encoding: "utf8" },
  );
  const calls = JSON.parse(result.stdout.match(/__FETCH_CALLS__(\[.*\])/m)?.[1] || "[]");
  const verifierOutput = result.stdout.split("__FETCH_CALLS__")[0] + result.stderr;
  return { ...result, calls, verifierOutput };
}

function postCalls(result) {
  return result.calls.filter((call) => call.method === "POST");
}

function removeSqlComments(sql) {
  return sql.replace(/--[^\r\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

function removeQuotedStringLiterals(sql) {
  return sql.replace(/'(?:''|[^'])*'/g, " ");
}

function removeDollarQuotedLiterals(sql) {
  return sql.replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, " ");
}

function sqlForLexicalScan(sql) {
  return removeDollarQuotedLiterals(removeQuotedStringLiterals(removeSqlComments(sql)));
}

function sqlFiles() {
  return [
    [prewriteSqlPath, readFileSync(prewriteSqlPath, "utf8")],
    [postwriteSqlPath, readFileSync(postwriteSqlPath, "utf8")],
  ];
}

test("failed prerequisite prevents every POST and exits nonzero", () => {
  const result = runVerifierWithMockFetch({
    responses: mergeResponses({
      "GET /api/kai/sprint2/intake/auth-preflight": {
        status: 401,
        body: { ok: false },
      },
    }),
  });

  assert.equal(result.status, 1, result.verifierOutput);
  assert.deepEqual(postCalls(result), []);
  assert.deepEqual(result.calls.map((call) => `${call.method} ${call.path}`), [
    "GET /api/kai/sprint2/intake/auth-preflight",
  ]);
});

test("failed access check prevents every later POST", () => {
  const result = runVerifierWithMockFetch({
    responses: mergeResponses({
      "GET /api/kai/sprint2/intake/admin/access-check": {
        status: 200,
        body: {
          ok: true,
          data: {
            actor_mapped: true,
            membership_active: true,
            global_write_role_present: false,
            matched_write_role_family: null,
          },
        },
      },
    }),
  });

  assert.equal(result.status, 1, result.verifierOutput);
  assert.deepEqual(postCalls(result), []);
  assert.equal(result.calls.at(-1)?.path, "/api/kai/sprint2/intake/admin/access-check");
});

test("unexpected first negative probe prevents every subsequent operation", () => {
  const responses = readyResponses();
  responses["POST /api/kai/sprint2/intake/admin/batches"][0] = { status: 200, body: { ok: true } };
  const result = runVerifierWithMockFetch({ responses });

  assert.equal(result.status, 1, result.verifierOutput);
  assert.equal(postCalls(result).length, 1);
  assert.equal(result.calls.at(-1)?.path, "/api/kai/sprint2/intake/admin/batches");
});

test("unexpected later negative probe prevents every positive POST", () => {
  const responses = readyResponses();
  responses["POST /api/kai/sprint2/intake/admin/batches"][1] = { status: 409, body: { ok: false } };
  const result = runVerifierWithMockFetch({ responses });

  assert.equal(result.status, 1, result.verifierOutput);
  assert.equal(postCalls(result).length, 2);
  assert.equal(result.calls.at(-1)?.path, "/api/kai/sprint2/intake/admin/batches");
  assert.doesNotMatch(result.verifierOutput, /API_CREATE_BATCH_RETURNS_OK/);
});

test("positive metadata POSTs occur only after prerequisites and expected negative probes", () => {
  const result = runVerifierWithMockFetch();

  assert.equal(result.status, 0, result.verifierOutput);
  assert.deepEqual(result.calls.map((call) => `${call.method} ${call.path}`), [
    "GET /api/kai/sprint2/intake/auth-preflight",
    "GET /api/kai/sprint2/intake/status",
    "GET /api/kai/sprint2/intake/admin/access-check",
    "POST /api/kai/sprint2/intake/admin/batches",
    "POST /api/kai/sprint2/intake/admin/batches",
    "POST /api/kai/sprint2/intake/admin/batches",
    "POST /api/kai/sprint2/intake/admin/batches",
    "POST /api/kai/sprint2/intake/admin/batches/batch-test-id/file-reservations",
  ]);
  assert.match(result.verifierOutput, /API_UNAUTHENTICATED_RETURNS_401[\s\S]*API_CREATE_BATCH_TENANT_MISMATCH_RETURNS_422[\s\S]*API_CREATE_BATCH_RETURNS_OK/);
});

test("write-disabled mode performs no POST", () => {
  const result = runVerifierWithMockFetch({ env: { KAI_PASS2_RUN_WRITE_PATH: "false" } });

  assert.equal(result.status, 0, result.verifierOutput);
  assert.deepEqual(postCalls(result), []);
  assert.deepEqual(result.calls.map((call) => call.path), [
    "/api/kai/sprint2/intake/auth-preflight",
    "/api/kai/sprint2/intake/status",
  ]);
});

test("an operation failure has no automatic retry and exits nonzero", () => {
  const result = runVerifierWithMockFetch({ throwOn: "GET /api/kai/sprint2/intake/status" });

  assert.equal(result.status, 1, result.verifierOutput);
  assert.equal(
    result.calls.filter((call) => call.path === "/api/kai/sprint2/intake/status").length,
    1,
  );
  assert.deepEqual(postCalls(result), []);
});

test("API verifier output suppresses secret values and raw unexpected errors", () => {
  const result = runVerifierWithMockFetch({
    responses: mergeResponses({
      "GET /api/kai/sprint2/intake/status": {
        status: 200,
        body: { ok: true, data: { mode: "admin_metadata_only", token: "secret-token-sentinel" } },
      },
    }),
  });
  const thrown = runVerifierWithMockFetch({ throwOn: "GET /api/kai/sprint2/intake/status" });

  assert.equal(result.status, 1, result.verifierOutput);
  assert.equal(thrown.status, 1, thrown.verifierOutput);
  assert.doesNotMatch(result.verifierOutput, forbiddenSecretMaterial);
  assert.doesNotMatch(thrown.verifierOutput, forbiddenSecretMaterial);
  assert.match(thrown.verifierOutput, /sensitive error detail suppressed/);
});

test("local authentication and request Cookie validation retain the accepted contract", () => {
  const invalidCases = [
    {
      name: "no authentication method",
      cookie: undefined,
      bearer: undefined,
      expectedFailure: /API_AUTH_EXACTLY_ONE_METHOD_CONFIGURED\tKAI_PASS2_AUTH_COOKIE,KAI_PASS2_BEARER_TOKEN\tFAIL/,
    },
    {
      name: "both cookie and bearer authentication",
      cookie: validRequestCookieHeader,
      bearer: "secret-token-sentinel",
      expectedFailure: /API_AUTH_EXACTLY_ONE_METHOD_CONFIGURED\tKAI_PASS2_AUTH_COOKIE,KAI_PASS2_BEARER_TOKEN\tFAIL/,
    },
    {
      name: "empty cookie value",
      cookie: "",
      bearer: undefined,
      expectedFailure: /API_AUTH_EXACTLY_ONE_METHOD_CONFIGURED\tKAI_PASS2_AUTH_COOKIE,KAI_PASS2_BEARER_TOKEN\tFAIL/,
    },
    {
      name: "malformed request Cookie syntax",
      cookie: "secret-cookie-sentinel",
      bearer: undefined,
      expectedFailure: /API_AUTH_COOKIE_REQUEST_HEADER_SYNTAX_VALID\tKAI_PASS2_AUTH_COOKIE\tFAIL/,
    },
    {
      name: "newline control character",
      cookie: "session=secret-cookie-sentinel\nother=value",
      bearer: undefined,
      expectedFailure: /API_AUTH_COOKIE_REQUEST_HEADER_SYNTAX_VALID\tKAI_PASS2_AUTH_COOKIE\tFAIL/,
    },
    {
      name: "Set-Cookie-formatted input",
      cookie: "Set-Cookie: session=secret-cookie-sentinel",
      bearer: undefined,
      expectedFailure: /API_AUTH_COOKIE_REQUEST_HEADER_SYNTAX_VALID\tKAI_PASS2_AUTH_COOKIE\tFAIL/,
    },
    {
      name: "attributes-only Cookie input",
      cookie: "Path=/; HttpOnly; SameSite=Lax",
      bearer: undefined,
      expectedFailure: /API_AUTH_COOKIE_REQUEST_HEADER_SYNTAX_VALID\tKAI_PASS2_AUTH_COOKIE\tFAIL/,
    },
    ...['session=abc"', '"abc', 'session="ab"c"'].map((cookie, index) => ({
      name: `quoted Cookie input ${index + 1}`,
      cookie,
      bearer: undefined,
      expectedFailure: /API_AUTH_COOKIE_REQUEST_HEADER_SYNTAX_VALID\tKAI_PASS2_AUTH_COOKIE\tFAIL/,
    })),
    ...[
      "session=abc; Path=/",
      "session=abc; SameSite=Lax",
      "session=abc; Domain=example.com",
      "session=abc; Max-Age=3600",
      "session=abc; Expires=Wed, 21 Oct 2015 07:28:00 GMT",
      "session=abc; HttpOnly",
      "session=abc; Secure",
    ].map((cookie, index) => ({
      name: `response-only Cookie attribute ${index + 1}`,
      cookie,
      bearer: undefined,
      expectedFailure: /API_AUTH_COOKIE_REQUEST_HEADER_SYNTAX_VALID\tKAI_PASS2_AUTH_COOKIE\tFAIL/,
    })),
  ];

  for (const invalidCase of invalidCases) {
    const result = runVerifierWithMockFetch({
      env: {
        KAI_PASS2_AUTH_COOKIE: invalidCase.cookie,
        KAI_PASS2_BEARER_TOKEN: invalidCase.bearer,
        KAI_PASS2_PREFLIGHT_ONLY: "true",
        KAI_PASS2_RUN_WRITE_PATH: "false",
      },
    });

    assert.equal(result.status, 1, `${invalidCase.name}\n${result.verifierOutput}`);
    assert.deepEqual(result.calls, [], invalidCase.name);
    assert.match(result.verifierOutput, invalidCase.expectedFailure, invalidCase.name);
    assert.doesNotMatch(result.verifierOutput, forbiddenSecretMaterial, invalidCase.name);
  }

  const validResult = runVerifierWithMockFetch({
    env: {
      KAI_PASS2_AUTH_COOKIE: "session=test-session; preference=compact",
      KAI_PASS2_BEARER_TOKEN: undefined,
      KAI_PASS2_PREFLIGHT_ONLY: "true",
      KAI_PASS2_RUN_WRITE_PATH: "false",
    },
  });

  assert.equal(validResult.status, 0, validResult.verifierOutput);
  assert.deepEqual(validResult.calls, [
    {
      method: "GET",
      path: "/api/kai/sprint2/intake/auth-preflight",
      hasCookie: true,
      hasBearer: false,
    },
  ]);
  assert.match(validResult.verifierOutput, /API_AUTH_COOKIE_ONLY_BEARER_ABSENT\tKAI_PASS2_AUTH_COOKIE,KAI_PASS2_BEARER_TOKEN\tPASS/);
  assert.match(validResult.verifierOutput, /API_AUTH_COOKIE_REQUEST_HEADER_SYNTAX_VALID\tKAI_PASS2_AUTH_COOKIE\tPASS/);
  assert.deepEqual(postCalls(validResult), []);
  assert.doesNotMatch(validResult.verifierOutput, forbiddenSecretMaterial);
});

test("preflight-only mode remains isolated with writes disabled and rejects writes enabled", () => {
  const writeDisabled = runVerifierWithMockFetch({
    env: {
      KAI_PASS2_PREFLIGHT_ONLY: "true",
      KAI_PASS2_RUN_WRITE_PATH: "false",
    },
  });

  assert.equal(writeDisabled.status, 0, writeDisabled.verifierOutput);
  assert.deepEqual(writeDisabled.calls, [
    {
      method: "GET",
      path: "/api/kai/sprint2/intake/auth-preflight",
      hasCookie: true,
      hasBearer: false,
    },
  ]);
  assert.deepEqual(postCalls(writeDisabled), []);
  assert.match(writeDisabled.verifierOutput, /API_AUTH_PREFLIGHT_COOKIE_SESSION_ACCEPTED\t\/api\/kai\/sprint2\/intake\/auth-preflight\tPASS\tHTTP 200/);
  assert.doesNotMatch(writeDisabled.verifierOutput, /\/api\/kai\/sprint2\/intake\/(?:status|admin\/access-check)/);
  assert.doesNotMatch(writeDisabled.verifierOutput, forbiddenSecretMaterial);

  const writeEnabled = runVerifierWithMockFetch({
    env: {
      KAI_PASS2_PREFLIGHT_ONLY: "true",
      KAI_PASS2_RUN_WRITE_PATH: "true",
    },
  });

  assert.equal(writeEnabled.status, 1, writeEnabled.verifierOutput);
  assert.deepEqual(writeEnabled.calls, []);
  assert.deepEqual(postCalls(writeEnabled), []);
  assert.match(writeEnabled.verifierOutput, /API_PREFLIGHT_ONLY_REQUIRES_NO_WRITE_PATH\tKAI_PASS2_PREFLIGHT_ONLY,KAI_PASS2_RUN_WRITE_PATH\tFAIL/);
  assert.doesNotMatch(writeEnabled.verifierOutput, forbiddenSecretMaterial);
});

test("both SQL verifier files exist with the exact result columns", () => {
  assert.equal(existsSync(prewriteSqlPath), true);
  assert.equal(existsSync(postwriteSqlPath), true);

  for (const [path, sql] of sqlFiles()) {
    assert.match(
      sql,
      /SELECT result_type,\s*check_name,\s*object_name,\s*status,\s*detail\s*FROM ordered_rows\s*ORDER BY sort_group, check_name, object_name;/,
      path,
    );
  }
});

test("SQL check names are stable and unique in each emitted source", () => {
  for (const [path, sql] of sqlFiles()) {
    const prefix = path === prewriteSqlPath ? "PREWRITE" : "POSTWRITE";
    const names = [...sql.matchAll(new RegExp(`'(${prefix}_[A-Z0-9_]+)'\\s+AS check_name`, "g"))].map((match) => match[1]);
    assert.ok(names.length >= 4, path);
    assert.equal(new Set(names).size, names.length, path);
  }
});

test("SQL final ordering is deterministic and aggregate is derived, self-excluding, and last", () => {
  for (const [path, sql] of sqlFiles()) {
    assert.match(sql, /aggregate_row AS \([\s\S]*?SELECT 1 FROM checks WHERE status <> 'PASS'[\s\S]*?\)/, path);
    assert.match(sql, /FROM observations[\s\S]*?2 AS sort_group[\s\S]*?FROM aggregate_row/, path);
    assert.match(sql, /ORDER BY sort_group, check_name, object_name;\s*$/, path);
    assert.doesNotMatch(sql.match(/aggregate_row AS \(([\s\S]*?)\),\s*ordered_rows AS/)?.[1] || "", /aggregate_row/);
  }
});

test("pre-write SQL has one SELECT-only result set and exact zero marker gates", () => {
  const sql = readFileSync(prewriteSqlPath, "utf8");
  const scanned = sqlForLexicalScan(sql);

  assert.match(sql, /^--[\s\S]*?WITH expected AS \(/);
  assert.equal((scanned.match(/;/g) || []).length, 1);
  assert.match(sql, /PREWRITE_EXACT_BATCH_MARKER_COUNT_ZERO/);
  assert.match(sql, /PREWRITE_EXACT_FILE_MARKER_COUNT_ZERO/);
  assert.match(sql, /CASE WHEN row_count = 0 THEN 'PASS' ELSE 'FAIL' END/g);
  assert.doesNotMatch(scanned, /\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i);
});

test("exact composite batch and file predicates use conjunctions and no broad OR matching", () => {
  for (const [path, sql] of sqlFiles()) {
    const batch = sql.match(/(?:batch_marker_count|exact_batch) AS \(([\s\S]*?)\),\s*(?:file_marker_count|exact_file) AS/)?.[1] || "";
    const file = sql.match(/(?:file_marker_count|exact_file) AS \(([\s\S]*?)\),\s*[a-z_]+ AS/)?.[1] || "";
    for (const predicate of [batch, file]) {
      assert.match(predicate, /organization_id\s*=\s*e\.organization_id/, path);
      assert.match(predicate, /engagement_id\s*=\s*e\.engagement_id/, path);
      assert.match(predicate, /p0_pass'\s*=\s*e\.p0_pass/, path);
      assert.match(predicate, /gate_plan'\s*=\s*e\.gate_plan/, path);
      assert.doesNotMatch(sqlForLexicalScan(predicate), /\bOR\b/i, path);
    }
    assert.doesNotMatch(sqlForLexicalScan(sql), /\bOR\b/i, path);
    assert.doesNotMatch(sqlForLexicalScan(sql), /to_jsonb\s*\(|::\s*text\s+(?:LIKE|ILIKE)/i, path);
  }
});

test("SQL output-facing literals contain no identifying shorthand or protected marker material", () => {
  const protectedOutputMaterial = /NCWS|kai-p0-pass2|pass2_admin_metadata_intake_verification|Production_Synthetic_Metadata_Write_Gate_Plan|[0-9a-f]{8}-[0-9a-f-]{27}/i;

  for (const [path, sql] of sqlFiles()) {
    const outputFacingLiterals = [...sql.matchAll(/'([^']*)'\s+AS\s+(?:object_name|detail)/gi)]
      .map((match) => match[1])
      .join("\n");
    assert.doesNotMatch(outputFacingLiterals, protectedOutputMaterial, path);
  }
});

test("post-write SQL checks singleton linkage, metadata-only state, and only relational children", () => {
  const sql = readFileSync(postwriteSqlPath, "utf8");

  assert.match(sql, /POSTWRITE_EXACT_BATCH_COUNT_ONE[\s\S]*?count\(\*\) = 1/);
  assert.match(sql, /POSTWRITE_EXACT_FILE_COUNT_ONE[\s\S]*?count\(\*\) = 1/);
  assert.match(sql, /POSTWRITE_FILE_LINKS_TO_EXACT_BATCH[\s\S]*?b\.intake_batch_id = f\.intake_batch_id/);
  assert.match(sql, /POSTWRITE_FILE_METADATA_ONLY_NO_RAW_STATE/);
  for (const child of [
    "kai.intake_parser_runs",
    "kai.intake_file_profiles",
    "kai.intake_sensitivity_profiles",
    "kai.intake_source_candidates",
    "kai.intake_promotion_decisions",
  ]) {
    const escaped = child.replace(".", "\\.");
    assert.match(sql, new RegExp(`${escaped}[\\s\\S]{0,180}JOIN exact_file`));
  }
  assert.doesNotMatch(sql, /kai\.(?:sources|source_versions|source_locators|evidence_items|claims|reports|exports|graph_relationships|prompt_runs|model_outputs)/);
  assert.doesNotMatch(sql, /first execution|identical replay|atomic recovery|concurrent unique/i);
});

test("audit observations are INFO-only and excluded from aggregate PASS", () => {
  for (const [path, sql] of sqlFiles()) {
    const observations = sql.match(/observations AS \(([\s\S]*?)\),\s*aggregate_row AS/)?.[1] || "";
    const aggregate = sql.match(/aggregate_row AS \(([\s\S]*?)\),\s*ordered_rows AS/)?.[1] || "";
    assert.match(observations, /'OBSERVATION' AS result_type/);
    assert.doesNotMatch(observations, /'CHECK' AS result_type/);
    assert.doesNotMatch(observations, /THEN 'PASS'|THEN 'FAIL'/);
    assert.match(aggregate, /FROM checks/);
    assert.doesNotMatch(aggregate, /observations|audit/i);
    assert.match(sql, /SQL_EXECUTION_FAILURE/);
    assert.match(sql, /never PASS/i);
    assert.doesNotMatch(sql, /current[-_ ]run|exactly two audit/i, path);
  }
});

test("pre-write index guards cover exact location, uniqueness, state, key order, and predicates", () => {
  const sql = readFileSync(prewriteSqlPath, "utf8");
  for (const indexName of [
    "ux_intake_batches_org_idempotency_key",
    "ux_intake_batches_org_batch_code",
    "ux_intake_files_org_checksum_default",
  ]) {
    assert.match(sql, new RegExp(indexName));
  }
  for (const contractTerm of [
    "index_schema = 'kai'",
    "table_schema = 'kai'",
    "indisunique IS TRUE",
    "indisvalid IS TRUE",
    "indisready IS TRUE",
    "indislive IS TRUE",
    "indnatts = c.indnkeyatts",
    "key_columns = r.key_columns",
    "predicate_expression IS NOT DISTINCT FROM r.predicate_expression",
  ]) {
    assert.ok(sql.includes(contractTerm), contractTerm);
  }
  assert.match(sql, /array_agg\(a\.attname ORDER BY key_position\.ordinality\)/);
  assert.match(sql, /pg_catalog\.pg_get_expr\(i\.indpred, i\.indrelid\)/);
});

test("comments and literals are removed before forbidden SQL lexical scans", () => {
  const synthetic = "-- INSERT\nSELECT 'UPDATE', $$DELETE$$;";
  const stripped = sqlForLexicalScan(synthetic);
  assert.doesNotMatch(stripped, /\b(?:INSERT|UPDATE|DELETE)\b/i);

  for (const [path, sql] of sqlFiles()) {
    const scanned = sqlForLexicalScan(sql);
    assert.doesNotMatch(scanned, /\bWITH\b[\s\S]*?\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i, `${path}: data-modifying CTE`);
    assert.doesNotMatch(scanned, /\bSELECT\b[\s\S]*?\bINTO\b/i, `${path}: SELECT INTO`);
    assert.doesNotMatch(scanned, /\bFOR\s+(?:UPDATE|NO\s+KEY\s+UPDATE|SHARE|KEY\s+SHARE)\b/i, `${path}: locking clause`);
    assert.doesNotMatch(
      scanned,
      /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|COPY|CALL|DO)\b/i,
      `${path}: DML or DDL`,
    );
  }
});

test("SQL function calls are restricted to the explicit read-only built-in allowlist", () => {
  const allowedFunctions = new Set(["array_agg", "count", "pg_get_expr", "unnest"]);
  const grammar = new Set(["as", "exists", "filter", "from", "in", "not", "over", "values", "when"]);

  for (const [path, sql] of sqlFiles()) {
    const scanned = sqlForLexicalScan(sql).replace(/\bAS\s+[a-z_][a-z0-9_]*\s*\([^)]*\)/gi, " ");
    const calls = [...scanned.matchAll(/\b((?:pg_catalog\.)?[a-z_][a-z0-9_]*)\s*\(/gi)]
      .map((match) => match[1].toLowerCase().replace(/^pg_catalog\./, ""))
      .filter((name) => !grammar.has(name));
    for (const name of calls) {
      assert.equal(allowedFunctions.has(name), true, `${path}: ${name}`);
    }
  }
});

test("static SQL guards do not claim runtime proof of non-mutation", () => {
  for (const [path, sql] of sqlFiles()) {
    assert.doesNotMatch(sql, /proves? (?:runtime )?non-mutation|guarantees? read-only/i, path);
  }
});
