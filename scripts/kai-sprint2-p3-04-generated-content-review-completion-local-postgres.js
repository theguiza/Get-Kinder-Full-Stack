import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", path], { capture: true, dbName }).stdout;
}

function psqlCommand(dbName, sql) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-c", sql], { capture: true, dbName }).stdout;
}

function psqlScalar(dbName, sql) {
  return psqlCommand(dbName, `COPY (${sql}) TO STDOUT`).trim();
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
  psqlFile(cleanDbName, "scripts/kai-sprint2-p3-04-generated-content-review-completion-verifier.sql");
  psqlFile(cleanDbName, "scripts/kai-sprint2-gate-a-smoke-seed.sql");
  psqlFile(cleanDbName, "scripts/kai-sprint2-p1-04-data-dictionary-quality-smoke-seed.sql");
  psqlFile(cleanDbName, "scripts/kai-sprint2-p1-05-intake-sensitivity-profile-smoke-seed.sql");
  psqlFile(cleanDbName, "scripts/kai-sprint2-p1-06-review-queue-smoke-seed.sql");
  psqlFile(cleanDbName, "scripts/kai-sprint2-p1-07-source-candidate-smoke-seed.sql");
  psqlFile(cleanDbName, "scripts/kai-sprint2-p1-08-source-promotion-smoke-seed.sql");
  psqlFile(cleanDbName, "scripts/kai-sprint2-p2-01-evidence-lineage-smoke-seed.sql");
  psqlFile(cleanDbName, "scripts/kai-sprint2-p2-03-claim-proposal-smoke-seed.sql");

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
  psqlFile(expandedDbName, "scripts/kai-sprint2-p3-04-generated-content-review-completion-verifier.sql");
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
