import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const cleanDbName = "kai_p3_04_review_completion_clean_synthetic";
const expandedDbName = "kai_p3_04_review_completion_expanded_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p3-04-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(64000 + Math.floor(Math.random() * 1000));
const user = process.env.USER || "postgres";
const sentinelUrl = "postgres://127.0.0.1:9/kai_sentinel";
const verifierPath = "scripts/kai-sprint2-p3-04-generated-content-review-completion-verifier.sql";
const verifierColumns = ["result_type", "check_name", "object_name", "status", "detail"];
const verifierHeader = verifierColumns.join("\t");
const expectedP3_04CheckNames = extractExpectedP3_04CheckNames();

function targetUrlFor(dbName) {
  return `postgresql://${user}@127.0.0.1:${port}/${dbName}`;
}

function run(command, args, options = {}) {
  const databaseName = options.dbName || cleanDbName;
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: {
      ...process.env,
      DATABASE_URL: sentinelUrl,
      PGHOST: "127.0.0.1",
      PGPORT: port,
      PGDATABASE: databaseName,
      PGUSER: user,
    },
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function psqlFile(dbName, path) {
  const result = psqlFileResult(dbName, path);
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${psql} -f ${path} failed${detail ? `\n${detail}` : ""}`);
  }
  return result.stdout;
}

function psqlFileResult(dbName, path) {
  return spawnSync(psql, [
    "-X",
    "-q",
    "-A",
    "-F", "\t",
    "-P", "footer=off",
    "-v", "ON_ERROR_STOP=1",
    "-d", dbName,
    "-f", path,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      DATABASE_URL: sentinelUrl,
      PGHOST: "127.0.0.1",
      PGPORT: port,
      PGDATABASE: dbName,
      PGUSER: user,
    },
  });
}

function psqlCommand(dbName, sql) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-c", sql], { capture: true, dbName }).stdout;
}

function psqlExec(dbName, sql) {
  return psqlCommand(dbName, sql);
}

function psqlScalar(dbName, sql) {
  return psqlCommand(dbName, `COPY (${sql}) TO STDOUT`).trim();
}

function extractExpectedP3_04CheckNames() {
  const verifierSql = readFileSync(join(repoRoot, verifierPath), "utf8");
  const expectedInsert = verifierSql.match(/INSERT INTO p3_04_expected_checks[\s\S]*?VALUES([\s\S]*?);/);
  if (!expectedInsert) throw new Error("P3-04 verifier expected-check insert was not found");
  const checkNames = [...expectedInsert[1].matchAll(/\('([^']+)'\)/g)].map((match) => match[1]);
  if (checkNames.length === 0) throw new Error("P3-04 verifier expected-check insert produced no check names");
  return checkNames;
}

function parseVerifierResultSets(output) {
  const lines = output.split(/\r?\n/).filter((line) => line.length > 0);
  const headerIndexes = lines.flatMap((line, index) => (line === verifierHeader ? [index] : []));
  return headerIndexes.map((headerIndex, ordinal) => {
    const nextHeaderIndex = headerIndexes[ordinal + 1] ?? lines.length;
    return lines.slice(headerIndex + 1, nextHeaderIndex).map((line) => {
      const values = line.split("\t");
      if (values.length !== verifierColumns.length) {
        throw new Error(`P3-04 verifier emitted malformed result row: ${line}`);
      }
      return Object.fromEntries(verifierColumns.map((column, index) => [column, values[index]]));
    });
  });
}

function assertVerifierOutput(output) {
  const resultSets = parseVerifierResultSets(output);
  if (resultSets.length !== 1) {
    throw new Error(`P3-04 verifier emitted ${resultSets.length} accepted result sets; expected exactly 1`);
  }
  const rows = resultSets[0];
  if (rows.length !== expectedP3_04CheckNames.length) {
    throw new Error(`P3-04 verifier emitted ${rows.length} rows; expected ${expectedP3_04CheckNames.length}`);
  }
  const counts = new Map();
  for (const row of rows) {
    if (row.result_type !== "CHECK") throw new Error(`P3-04 verifier emitted non-CHECK result_type: ${row.result_type}`);
    if (row.status !== "PASS") throw new Error(`P3-04 verifier emitted non-PASS status for ${row.check_name}: ${row.status}`);
    for (const column of verifierColumns) {
      if (!row[column]) throw new Error(`P3-04 verifier emitted empty ${column} for ${row.check_name || "<missing check_name>"}`);
    }
    counts.set(row.check_name, (counts.get(row.check_name) || 0) + 1);
  }
  for (const checkName of expectedP3_04CheckNames) {
    const count = counts.get(checkName) || 0;
    if (count !== 1) throw new Error(`P3-04 verifier expected check ${checkName} appeared ${count} times`);
  }
  for (const checkName of counts.keys()) {
    if (!expectedP3_04CheckNames.includes(checkName)) throw new Error(`P3-04 verifier emitted unexpected check: ${checkName}`);
  }
  return { resultSetCount: resultSets.length, rows };
}

function assertVerifierOutputRejected(output, expectedPattern) {
  try {
    assertVerifierOutput(output);
  } catch (error) {
    if (expectedPattern && !expectedPattern.test(error.message)) throw error;
    return;
  }
  throw new Error("P3-04 verifier output parser accepted malformed output");
}

function proveVerifierOutputRejections() {
  const completeRows = expectedP3_04CheckNames.map((checkName) => (
    ["CHECK", checkName, "object", "PASS", "detail"].join("\t")
  ));
  assertVerifierOutputRejected("", /0 accepted result sets/);
  assertVerifierOutputRejected(`${verifierHeader}\n`, /0 rows/);
  assertVerifierOutputRejected(`${verifierHeader}\n${completeRows.slice(1).join("\n")}\n`, /4 rows/);
  assertVerifierOutputRejected(`${verifierHeader}\nCHECK\t${expectedP3_04CheckNames[0]}\tobject\tPASS\n`, /malformed result row/);
}

function runAndAssertVerifier(dbName) {
  const result = psqlFileResult(dbName, verifierPath);
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`P3-04 verifier failed unexpectedly${detail ? `\n${detail}` : ""}`);
  }
  return assertVerifierOutput(result.stdout);
}

function runAndAssertVerifierFailure(dbName) {
  psqlCommand(dbName, `
    ALTER TABLE kai.review_queue_items
      DROP CONSTRAINT review_queue_items_p3_04_generated_content_review_contract_check
  `);
  const result = psqlFileResult(dbName, verifierPath);
  if (result.status === 0) throw new Error("P3-04 verifier succeeded against invalid synthetic state");
  const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
  if (!detail.includes("P3-04 generated-content-review-completion verifier failed")) {
    throw new Error(`P3-04 verifier did not preserve the expected fail-closed error\n${detail}`);
  }
  assertVerifierOutputRejected(result.stdout, /0 accepted result sets/);
}

async function proveRunnerOwnedTarget(dbName) {
  const targetUrl = targetUrlFor(dbName);
  const parsed = new URL(targetUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("P3-04 runner refused non-loopback target before connection");
  }
  const client = new Client({ connectionString: targetUrl, ssl: false });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT current_database() AS database_name,
             inet_server_addr()::text AS server_addr,
             inet_server_port()::text AS server_port,
             current_setting('listen_addresses') AS listen_addresses
    `);
    const row = result.rows[0];
    if (row.database_name !== dbName) throw new Error("P3-04 runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`P3-04 runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("P3-04 runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("P3-04 runner refused non-loopback listen_addresses");
  } finally {
    await client.end();
  }
}

function setupP3_04Predecessor(dbName) {
  // P14-01 hard precondition: kai.generation_runs.engagement_id FK's to
  // kai.engagements(engagement_id, organization_id), so the organization/
  // engagement foundation (shared by the existing organization-enablement
  // local-Postgres runner) must exist before the P3-01/P14-01 migrations
  // below create/extend kai.generation_runs. Mirrors the P3-01 runner's own
  // precedent byte-for-byte.
  psqlFile(dbName, "scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  // Runner-local accommodation only (never a modification of the shared
  // bootstrap SQL file itself): the P14-01 engagement-side FK targets
  // kai.engagements (engagement_id, organization_id), a composite unique
  // constraint the organization-enablement bootstrap schema does not itself
  // declare - the same runner-local accommodation the P3-01 runner applies
  // for this identical composite FK shape.
  psqlExec(
    dbName,
    "ALTER TABLE kai.engagements ADD CONSTRAINT kai_p3_04_engagements_id_org_unique UNIQUE (engagement_id, organization_id);",
  );

  psqlFile(dbName, "scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
  psqlFile(dbName, "migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql");
  psqlFile(dbName, "migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql");
  psqlFile(dbName, "migrations/kai_sprint2_p1_parser_run_and_file_profile.sql");
  psqlFile(dbName, "migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql");
  psqlFile(dbName, "migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql");
  psqlFile(dbName, "migrations/kai_sprint2_p1_06_review_queue.sql");
  psqlFile(dbName, "migrations/kai_sprint2_p1_07_intake_source_candidate.sql");
  psqlFile(dbName, "migrations/kai_sprint2_p1_08_source_promotion.sql");
  psqlFile(dbName, "migrations/kai_sprint2_p2_01_evidence_lineage.sql");
  psqlFile(dbName, "migrations/kai_sprint2_p2_03_claim_proposal.sql");
  psqlFile(dbName, "migrations/kai_sprint2_p2_04_claim_gap_followup.sql");
  psqlFile(dbName, "migrations/kai_sprint2_p2_05_conflict_review_candidate.sql");
  psqlFile(dbName, "migrations/kai_sprint2_p3_01_generated_content_drafts.sql");
  psqlFile(dbName, "migrations/kai_sprint2_p14_01_generation_run_engagement_binding.sql");
}

function captureAuditOperations(dbName) {
  const predicate = psqlScalar(dbName, `
    SELECT pg_get_expr(c.conbin, c.conrelid)
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'upload_lifecycle_audit'
       AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
  `);
  const operations = new Set();
  for (const match of predicate.matchAll(/'([^']+)'/g)) {
    const value = match[1];
    if (value.startsWith("{") && value.endsWith("}")) {
      for (const operation of value.slice(1, -1).split(",")) operations.add(operation);
    } else {
      operations.add(value);
    }
  }
  return [...operations].sort();
}

function assertOperationAccepted(dbName, operation, metadata = "{}") {
  psqlCommand(dbName, `
    BEGIN;
    INSERT INTO kai.upload_lifecycle_audit (
      organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata
    )
    VALUES (
      gen_random_uuid(), gen_random_uuid(), '${operation}', NULL, 'confirmed', 'success', '${metadata}'::jsonb
    );
    ROLLBACK;
  `);
}

function assertOperationRejected(dbName, operation) {
  const result = spawnSync(psql, [
    "-v", "ON_ERROR_STOP=1",
    "-d", dbName,
    "-c", `
      INSERT INTO kai.upload_lifecycle_audit (
        organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata
      )
      VALUES (
        gen_random_uuid(), gen_random_uuid(), '${operation}', NULL, 'confirmed', 'success', '{}'::jsonb
      );
    `,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      DATABASE_URL: sentinelUrl,
      PGHOST: "127.0.0.1",
      PGPORT: port,
      PGDATABASE: dbName,
      PGUSER: user,
    },
  });
  if (result.status === 0 || !result.stderr.includes("upload_lifecycle_audit_gate_a_operation_check")) {
    throw new Error(`operation ${operation} was not rejected by the audit operation constraint`);
  }
}

function assertConstraintValidated(dbName) {
  const validated = psqlScalar(dbName, `
    SELECT convalidated::text
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'upload_lifecycle_audit'
       AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
  `);
  if (validated !== "true") throw new Error(`P3-04 audit operation constraint is not validated in ${dbName}`);
}

function auditFingerprint(dbName) {
  return psqlScalar(dbName, `
    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'id', upload_lifecycle_audit_id,
               'organization_id', organization_id,
               'intake_file_id', intake_file_id,
               'operation', operation,
               'from_state', from_state,
               'to_state', to_state,
               'outcome', outcome,
               'metadata', metadata,
               'created_at', created_at
             )
             ORDER BY upload_lifecycle_audit_id
           ), '[]'::jsonb)::text
      FROM kai.upload_lifecycle_audit
  `);
}

function generatedContentDraftMetadata() {
  return JSON.stringify({
    metadata_only: true,
    contract: "kai_sprint2_p3_01_generated_content_draft_created",
    generation_run_id: "00000000-0000-0000-0000-000000000101",
    generated_content_draft_id: "00000000-0000-0000-0000-000000000102",
    queue_type: "generated_content_review",
    queue_status: "open",
    review_status: "needs_gk_review",
    requested_audience: "internal",
    claim_count: 1,
    block_count: 1,
    validator_keys: [],
  }).replace(/'/g, "''");
}

function generatedContentReviewMetadata() {
  return JSON.stringify({
    contract: "kai_sprint2_p3_04_generated_content_review_completed",
    organization_id: "00000000-0000-0000-0000-000000000001",
    generation_run_id: "00000000-0000-0000-0000-000000000101",
    generated_content_draft_id: "00000000-0000-0000-0000-000000000102",
    review_queue_item_id: "00000000-0000-0000-0000-000000000103",
    actor_id: "00000000-0000-0000-0000-000000000104",
    actor_type: "gk_user",
    expected_updated_at: "2026-01-01T00:00:00.000Z",
    requested_completion_timestamp: "2026-01-01T00:00:01.000Z",
    previous_queue_status: "in_progress",
    resulting_queue_status: "resolved",
    previous_review_status: "needs_gk_review",
    resulting_review_status: "resolved",
    validator_keys: [],
  }).replace(/'/g, "''");
}

function insertExistingAuditRows(dbName, operations) {
  for (const operation of operations) {
    const metadata = operation === "generated_content_draft_created" ? generatedContentDraftMetadata() : "{}";
    psqlCommand(dbName, `
      INSERT INTO kai.upload_lifecycle_audit (
        organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata
      )
      VALUES (
        gen_random_uuid(), gen_random_uuid(), '${operation}', NULL, 'confirmed', 'success', '${metadata}'::jsonb
      );
    `);
  }
}

function applyExpandedProductionLikePredecessor(dbName, extraOperations) {
  const operationSet = [...new Set([...captureAuditOperations(dbName), ...extraOperations])].sort();
  psqlCommand(dbName, `
    ALTER TABLE kai.upload_lifecycle_audit
      ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_expanded
      CHECK (operation = ANY ('{${operationSet.join(",")}}'::text[])) NOT VALID;
    ALTER TABLE kai.upload_lifecycle_audit
      VALIDATE CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_expanded;
    ALTER TABLE kai.upload_lifecycle_audit
      DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check;
    ALTER TABLE kai.upload_lifecycle_audit
      RENAME CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_expanded
      TO upload_lifecycle_audit_gate_a_operation_check;
  `);
}

function proveCleanPredecessorCase(dbName) {
  const predecessorOps = captureAuditOperations(dbName);
  insertExistingAuditRows(dbName, ["reserve_upload", "start_upload"]);
  const beforeRows = auditFingerprint(dbName);
  psqlFile(dbName, "migrations/kai_sprint2_p3_04_generated_content_review_completion.sql");
  const afterRows = auditFingerprint(dbName);
  if (beforeRows !== afterRows) throw new Error("clean predecessor audit rows were modified by P3-04");

  const afterOps = captureAuditOperations(dbName);
  for (const operation of predecessorOps) {
    if (!afterOps.includes(operation)) throw new Error(`clean predecessor operation was removed by P3-04: ${operation}`);
  }
  if (!afterOps.includes("generated_content_review_completed")) {
    throw new Error("P3-04 did not add generated_content_review_completed in clean predecessor case");
  }
  if (afterOps.includes("export_review_requested")) {
    throw new Error("P3-04 introduced later operation export_review_requested in clean predecessor case");
  }
  assertOperationAccepted(dbName, "generated_content_review_completed", generatedContentReviewMetadata());
  assertOperationRejected(dbName, "export_review_requested");
  assertConstraintValidated(dbName);
  return afterRows;
}

function proveExpandedProductionLikePredecessorCase(dbName, extraOperations) {
  const predecessorOps = captureAuditOperations(dbName);
  insertExistingAuditRows(dbName, extraOperations);
  const beforeRows = auditFingerprint(dbName);
  psqlFile(dbName, "migrations/kai_sprint2_p3_04_generated_content_review_completion.sql");
  const afterRows = auditFingerprint(dbName);
  if (beforeRows !== afterRows) throw new Error("expanded predecessor audit rows were modified by P3-04");

  const afterOps = captureAuditOperations(dbName);
  for (const operation of predecessorOps) {
    if (!afterOps.includes(operation)) throw new Error(`expanded predecessor operation was removed by P3-04: ${operation}`);
  }
  for (const operation of extraOperations) {
    if (!afterOps.includes(operation)) throw new Error(`production-like operation was removed by P3-04: ${operation}`);
    assertOperationAccepted(dbName, operation);
  }
  if (!afterOps.includes("generated_content_review_completed")) {
    throw new Error("P3-04 did not add generated_content_review_completed in expanded predecessor case");
  }
  assertOperationAccepted(dbName, "generated_content_review_completed", generatedContentReviewMetadata());
  assertConstraintValidated(dbName);
  return afterRows;
}

function proveReplayConvergence(dbName, beforeRows) {
  const beforeOps = JSON.stringify(captureAuditOperations(dbName));
  psqlFile(dbName, "migrations/kai_sprint2_p3_04_generated_content_review_completion.sql");
  const afterRows = auditFingerprint(dbName);
  const afterOps = JSON.stringify(captureAuditOperations(dbName));
  if (beforeRows !== afterRows) throw new Error("P3-04 replay mutated audit rows");
  if (beforeOps !== afterOps) throw new Error("P3-04 replay narrowed or changed audit operations");
  assertConstraintValidated(dbName);
}

let started = false;
try {
  mkdirSync(socketDir, { recursive: true });
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { capture: true });
  run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], { capture: true });
  started = true;
  for (const dbName of [cleanDbName, expandedDbName]) {
    run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { capture: true, dbName });
    await proveRunnerOwnedTarget(dbName);
    setupP3_04Predecessor(dbName);
  }

  const cleanRowsAfterP3_04 = proveCleanPredecessorCase(cleanDbName);
  proveReplayConvergence(cleanDbName, cleanRowsAfterP3_04);
  const cleanVerifierProof = runAndAssertVerifier(cleanDbName);
  psqlFile(cleanDbName, "scripts/kai-sprint2-gate-a-smoke-seed.sql");
  psqlFile(cleanDbName, "scripts/kai-sprint2-p1-04-data-dictionary-quality-smoke-seed.sql");
  psqlFile(cleanDbName, "scripts/kai-sprint2-p1-05-intake-sensitivity-profile-smoke-seed.sql");
  psqlFile(cleanDbName, "scripts/kai-sprint2-p1-06-review-queue-smoke-seed.sql");
  psqlFile(cleanDbName, "scripts/kai-sprint2-p1-07-source-candidate-smoke-seed.sql");
  psqlFile(cleanDbName, "scripts/kai-sprint2-p1-08-source-promotion-smoke-seed.sql");
  psqlFile(cleanDbName, "scripts/kai-sprint2-p2-01-evidence-lineage-smoke-seed.sql");
  psqlFile(cleanDbName, "scripts/kai-sprint2-p2-03-claim-proposal-smoke-seed.sql");

  // Real kai.organizations/kai.engagements rows the P3-04 integration
  // suite's createEvidenceSummaryDraft/createImpactNarrativeDraft calls now
  // require as the requested engagementId (P14-01 write contract), reusing
  // the exact UUID constants
  // __tests__/kai-sprint2-p3-04-generated-content-review-completion.integration.spec.js
  // hardcodes. Only cleanDbName needs these rows: it is the only database
  // the node --test invocation below targets
  // (KAI_P3_04_REVIEW_COMPLETION_DATABASE_URL points at cleanDbName only).
  psqlExec(
    cleanDbName,
    "INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ('00000000-0000-4000-8000-000000000001', 'P3-04 Smoke Org', 'p3-04-smoke-org') ON CONFLICT (organization_id) DO NOTHING;",
  );
  psqlExec(
    cleanDbName,
    "INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code) VALUES ('00000000-0000-4000-8000-000000000904', '00000000-0000-4000-8000-000000000001', 'p3-04-smoke-engagement') ON CONFLICT (engagement_id) DO NOTHING;",
  );

  const productionLikeOperations = [
    "claim_review_completed_internal_approval",
    "client_followup_completed",
    "coverage_review_decision_accepted_funder_with_limitation",
    "coverage_review_decision_accepted_internal_with_limitation",
    "evidence_review_completed",
    "sensitivity_review_decision_recorded",
  ];
  applyExpandedProductionLikePredecessor(expandedDbName, productionLikeOperations);
  const expandedRowsAfterP3_04 = proveExpandedProductionLikePredecessorCase(expandedDbName, productionLikeOperations);
  proveReplayConvergence(expandedDbName, expandedRowsAfterP3_04);
  const expandedVerifierProof = runAndAssertVerifier(expandedDbName);
  runAndAssertVerifierFailure(expandedDbName);
  proveVerifierOutputRejections();
  console.log(`P3-04 actual verifier result-set count: ${cleanVerifierProof.resultSetCount}`);
  console.log(`P3-04 actual verifier row count: ${cleanVerifierProof.rows.length}`);
  console.log(`P3-04 expanded verifier row count: ${expandedVerifierProof.rows.length}`);
  console.log("P3-04 verifier expected check set complete; duplicate expected checks: none; all statuses: PASS.");
  console.log("P3-04 verifier fail-closed case passed; empty/missing/malformed output rejected.");
  console.log("P3-04 monotonic audit constraint proof passed for clean, expanded, and replay cases.");

  const testResult = spawnSync("node", [
    "--test",
    "__tests__/kai-sprint2-p3-04-generated-content-review-completion.integration.spec.js",
    "__tests__/kai-sprint2-p3-04-generated-content-review-completion-boundary.spec.js",
    "__tests__/kai-sprint2-p3-03-export-manifest-eligibility-boundary.spec.js",
    "__tests__/kai-sprint2-p3-02-generated-draft-review-packet-boundary.spec.js",
    "__tests__/kai-sprint2-p3-01-generated-content-drafts-boundary.spec.js",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: sentinelUrl,
      DATABASE_URL_LOCAL: "",
      PGURL_LOCAL: "",
      RENDER_DATABASE_URL: "",
      PROD_DATABASE_URL: "",
      DB_HOST: "127.0.0.1",
      DB_PORT: port,
      DB_NAME: cleanDbName,
      DB_USER: user,
      DB_PASSWORD: "",
      KAI_P3_04_REVIEW_COMPLETION_DATABASE_URL: targetUrlFor(cleanDbName),
    },
  });
  if (testResult.status !== 0) throw new Error("P3-04 generated-content-review-completion tests failed");
  console.log("P3-04 generated-content-review-completion focused tests passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P3-04 generated-content-review-completion ephemeral PostgreSQL workdir removed: ${workDir}`);
}
