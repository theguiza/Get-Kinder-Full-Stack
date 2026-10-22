import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_p2_01m_record_count_measurement_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p2-01m-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(62000 + Math.floor(Math.random() * 1000));
const user = process.env.USER || "postgres";
const targetUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: {
      ...process.env,
      DATABASE_URL: "postgres://127.0.0.1:9/kai_sentinel",
      PGHOST: "127.0.0.1",
      PGPORT: port,
      PGDATABASE: dbName,
      PGUSER: user,
    },
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function psqlFile(path) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", path], { capture: true }).stdout;
}

function psqlExec(sql) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-c", sql], { capture: true }).stdout;
}

async function constraintCheckExpression(tableName, constraintName) {
  const client = new Client({ connectionString: targetUrl, ssl: false });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'kai' AND t.relname = $1 AND c.conname = $2`,
      [tableName, constraintName],
    );
    const definition = rows[0]?.definition;
    if (!definition || !definition.startsWith("CHECK ")) throw new Error(`missing CHECK ${constraintName}`);
    return definition.slice("CHECK ".length);
  } finally {
    await client.end();
  }
}

async function proveRunnerOwnedTarget() {
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
    if (row.database_name !== dbName) throw new Error("P2-01M runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`P2-01M runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("P2-01M runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("P2-01M runner refused non-loopback listen_addresses");
  } finally {
    await client.end();
  }
}

let started = false;
try {
  mkdirSync(socketDir, { recursive: true });
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { capture: true });
  run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], { capture: true });
  started = true;
  run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { capture: true });
  await proveRunnerOwnedTarget();

  psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql");
  psqlFile("migrations/kai_sprint2_p1_parser_run_and_file_profile.sql");
  psqlFile("migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql");
  psqlFile("migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql");
  psqlFile("migrations/kai_sprint2_p1_06_review_queue.sql");
  psqlFile("migrations/kai_sprint2_p1_07_intake_source_candidate.sql");
  psqlFile("migrations/kai_sprint2_p1_08_source_promotion.sql");
  psqlFile("migrations/kai_sprint2_b1a_02_phase5_allowed_use_decision_ledger.sql");
  psqlFile("migrations/kai_sprint2_p2_01_evidence_lineage.sql");
  psqlFile("migrations/kai_sprint2_p2_03_claim_proposal.sql");
  psqlFile("migrations/kai_sprint2_p2_04_claim_gap_followup.sql");
  psqlFile("migrations/kai_sprint2_p2_05_conflict_review_candidate.sql");
  psqlFile("migrations/kai_sprint2_p2_09_human_review_internal_approval.sql");
  psqlFile("migrations/kai_sprint2_p2_10_coverage_review_decision.sql");
  psqlFile("migrations/kai_sprint2_p2_11_client_followup_completion.sql");
  psqlFile("migrations/kai_sprint2_p2_12_human_review_decision_ledger.sql");
  psqlFile("migrations/kai_sprint2_p2_10_funder_coverage_authority.sql");
  psqlFile("migrations/kai_sprint2_p2_10_public_coverage_authority.sql");
  // Client Generated Drafts assembled proof (real P2-06 evaluator): the
  // generated-content schema plus the engagement binding it needs. No
  // repository migration creates kai.engagements, so this is a synthetic
  // mirror of the column list getEngagementForOrganization reads (the
  // organization-enablement bootstrap's full table depends on
  // kai.organizations, which this runner's schema does not load), created
  // after every P2-06 migration so their schema is unchanged.
  psqlExec(`CREATE TABLE kai.engagements (
    engagement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    engagement_code text NOT NULL,
    engagement_type text NOT NULL DEFAULT 'pilot_assessment',
    engagement_status text NOT NULL DEFAULT 'draft',
    project_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (organization_id, engagement_code),
    UNIQUE (engagement_id, organization_id)
  );`);
  // P3-01 redefines the shared upload_lifecycle_audit operation CHECK with
  // its own (older) operation list, which would drop the operations the
  // P2-09..P2-12/B1A migrations applied above added. Those migrations do not
  // record their order relative to P3-01, so the runner keeps the union: the
  // CHECK as it stood before P3-01 OR the one P3-01 installs (P3-04 then
  // extends it additively, as it does everywhere).
  const operationCheckBeforeP301 = await constraintCheckExpression("upload_lifecycle_audit", "upload_lifecycle_audit_gate_a_operation_check");
  psqlFile("migrations/kai_sprint2_p3_01_generated_content_drafts.sql");
  const operationCheckFromP301 = await constraintCheckExpression("upload_lifecycle_audit", "upload_lifecycle_audit_gate_a_operation_check");
  psqlExec(`ALTER TABLE kai.upload_lifecycle_audit
    DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check,
    ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check CHECK ((${operationCheckBeforeP301}) OR (${operationCheckFromP301}));`);
  psqlFile("migrations/kai_sprint2_p14_01_generation_run_engagement_binding.sql");
  psqlFile("migrations/kai_sprint2_p13_01_impact_narrative_content_type.sql");
  psqlFile("migrations/kai_sprint2_p14_14_generated_content_type_evolution.sql");
  psqlFile("migrations/kai_sprint2_p3_04_generated_content_review_completion.sql");
  psqlFile("scripts/kai-sprint2-gate-a-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-04-data-dictionary-quality-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-05-intake-sensitivity-profile-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-06-review-queue-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-07-source-candidate-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-08-source-promotion-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p2-01-evidence-lineage-smoke-seed.sql");
  // The required-audit target the P2-01M operation writes (no repository
  // migration creates kai.audit_events; this is the existing synthetic mirror).
  psqlFile("scripts/kai-sprint2-b1a-02-sensitivity-review-audit-synthetic-schema.sql");

  // Legacy compatibility: every pre-existing evidence/locator row (the P2-01
  // smoke seed's field-presence lineage) is fingerprinted before the
  // additive P2-01M migration and must be byte-identical after it.
  const legacySnapshotSql = `SELECT md5(string_agg(row_to_json(t)::text, '|' ORDER BY t::text)) FROM (
      SELECT evidence_item_id, evidence_type, data_class, statement, statement_fingerprint, source_locator_id, created_at FROM kai.evidence_items
      UNION ALL SELECT source_locator_id, locator_type, coordinates::text, locator_fingerprint, '', source_version_id, created_at FROM kai.source_locators
      UNION ALL SELECT claim_id, claim_type, claim_status, statement, statement_fingerprint, evidence_item_id, created_at FROM kai.claims
    ) t`;
  const testEnv = {
    ...process.env,
    DATABASE_URL: "postgres://127.0.0.1:9/kai_sentinel",
    DATABASE_URL_LOCAL: "",
    PGURL_LOCAL: "",
    RENDER_DATABASE_URL: "",
    PROD_DATABASE_URL: "",
    DB_HOST: "127.0.0.1",
    DB_PORT: port,
    DB_NAME: dbName,
    DB_USER: user,
    DB_PASSWORD: "",
    KAI_P2_01M_MEASUREMENT_DATABASE_URL: targetUrl,
  };
  // Pre-migration phase: field-presence evidence and a claim through the real
  // P2-01/P2-03 paths on the schema as it stands before P2-01M.
  const seedResult = spawnSync("node", ["--test", "__tests__/kai-sprint2-p2-01m-source-record-count-measurement.integration.spec.js"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
    env: { ...testEnv, KAI_P2_01M_PHASE: "legacy_seed" },
  });
  if (seedResult.status !== 0) throw new Error("P2-01M legacy seed phase failed");
  const legacyCount = run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-tAc",
    "SELECT count(*) FROM kai.evidence_items WHERE evidence_type = 'dictionary_field_presence_fact';"], { capture: true }).stdout.trim();
  const legacyBefore = psqlExec(legacySnapshotSql);
  psqlFile("migrations/kai_sprint2_p2_01m_source_record_count_measurement.sql");
  const legacyAfter = psqlExec(legacySnapshotSql);
  if (legacyBefore !== legacyAfter) throw new Error("P2-01M migration changed an existing evidence or locator row");
  if (!(Number(legacyCount) > 0)) throw new Error("P2-01M runner expected seeded legacy field-presence evidence");
  console.log(`P2-01M legacy compatibility: existing evidence/locator rows unchanged across the migration (${legacyCount} field-presence item(s)).`);
  // Re-applying the migration is a no-op (every DDL statement is idempotent).
  psqlFile("migrations/kai_sprint2_p2_01m_source_record_count_measurement.sql");
  if (psqlExec(legacySnapshotSql) !== legacyBefore) throw new Error("P2-01M migration is not idempotent");

  const testResult = spawnSync("node", [
    "--test",
    "--test-concurrency=1",
    "__tests__/kai-sprint2-p2-01m-source-record-count-measurement.integration.spec.js",
    "__tests__/kai-sprint2-p2-06-claim-traceability.integration.spec.js",
    "__tests__/kai-sprint2-p2-06-claim-traceability-boundary.spec.js",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: "postgres://127.0.0.1:9/kai_sentinel",
      DATABASE_URL_LOCAL: "",
      PGURL_LOCAL: "",
      RENDER_DATABASE_URL: "",
      PROD_DATABASE_URL: "",
      DB_HOST: "127.0.0.1",
      DB_PORT: port,
      DB_NAME: dbName,
      DB_USER: user,
      DB_PASSWORD: "",
      KAI_P2_01M_MEASUREMENT_DATABASE_URL: targetUrl,
      KAI_P2_06_CLAIM_TRACEABILITY_DATABASE_URL: targetUrl,
    },
  });
  if (testResult.status !== 0) throw new Error("P2-01M measurement and P2-06 traceability tests failed");

  // The rollback refuses while measurement evidence exists and changes nothing.
  const measurementRows = psqlExec("SELECT count(*) FROM kai.evidence_measurements;");
  let rollbackRefused = false;
  try {
    psqlFile("migrations/kai_sprint2_p2_01m_source_record_count_measurement.rollback.sql");
  } catch (error) {
    rollbackRefused = /rollback refused: source record-count measurement evidence exists/.test(String(error.message));
  }
  if (!rollbackRefused) throw new Error("P2-01M rollback did not refuse with measurement evidence present");
  if (psqlExec("SELECT count(*) FROM kai.evidence_measurements;") !== measurementRows) throw new Error("refused rollback changed measurement rows");
  console.log("P2-01M rollback refused while measurement evidence exists; nothing changed.");
  console.log("P2-01M record-count measurement and P2-06 traceability tests passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P2-01M ephemeral PostgreSQL workdir removed: ${workDir}`);
}
