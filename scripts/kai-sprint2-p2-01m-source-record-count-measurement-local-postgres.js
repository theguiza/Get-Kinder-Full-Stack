import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
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
// The last revision before the worksheet measurement identity. Its own code
// records the historical worksheet measurements on the schema as it stood.
const WORKSHEET_LEGACY_REVISION = "6f34c40";
const legacyCheckout = join(workDir, `checkout-${WORKSHEET_LEGACY_REVISION}`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
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
  // The Phase-5 ledger adds its sensitivity-decision lifecycle audit; P2-01
  // then redefines the shared upload_lifecycle_audit CHECKs from its own older
  // list. As the P3-01 handling below does, the runner keeps the union so the
  // real sensitivity-decision service can run here (the AI-permission proof).
  const operationCheckAfterB1a02 = await constraintCheckExpression("upload_lifecycle_audit", "upload_lifecycle_audit_gate_a_operation_check");
  const metadataCheckAfterB1a02 = await constraintCheckExpression("upload_lifecycle_audit", "upload_lifecycle_audit_gate_a_metadata_object_check");
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
  const operationCheckNow = await constraintCheckExpression("upload_lifecycle_audit", "upload_lifecycle_audit_gate_a_operation_check");
  const metadataCheckNow = await constraintCheckExpression("upload_lifecycle_audit", "upload_lifecycle_audit_gate_a_metadata_object_check");
  psqlExec(`ALTER TABLE kai.upload_lifecycle_audit
    DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check,
    ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check CHECK ((${operationCheckNow}) OR (${operationCheckAfterB1a02})),
    DROP CONSTRAINT upload_lifecycle_audit_gate_a_metadata_object_check,
    ADD CONSTRAINT upload_lifecycle_audit_gate_a_metadata_object_check CHECK ((${metadataCheckNow}) OR (${metadataCheckAfterB1a02}));`);
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
  // Optional: write this adjusted schema's audit CHECK definitions so they
  // can be compared with the Plan A normal migration chain.
  if (process.env.KAI_RUNNER_CATALOG_OUT) {
    const { writeFileSync } = await import("node:fs");
    const client = new Client({ connectionString: targetUrl, ssl: false });
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
          WHERE conrelid = 'kai.upload_lifecycle_audit'::regclass AND contype = 'c' ORDER BY conname`);
      writeFileSync(process.env.KAI_RUNNER_CATALOG_OUT, JSON.stringify(rows, null, 2));
    } finally {
      await client.end();
    }
  }
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
  // The XLSX worksheet migrations only widen the existing method/locator
  // checks; they change no row. The combined verifier fails until the selected
  // worksheet method is admitted, then passes with both XLSX methods intact.
  const xlsxVerifier = () => run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-tA", "-F", "|", "-f",
    "scripts/kai-sprint2-p2-01m-xlsx-worksheet-method-verify-read-only.sql"], { capture: true }).stdout.trim().split("\n");
  const overall = (rows) => rows.find((row) => row.startsWith("99|OVERALL|"))?.split("|")[2];
  if (overall(xlsxVerifier()) !== "FAIL") throw new Error("P2-01M selected-worksheet verifier did not fail before its migration");
  psqlFile("migrations/kai_sprint2_p2_01m_xlsx_worksheet_record_count_method.sql");
  psqlFile("migrations/kai_sprint2_p2_01m_xlsx_worksheet_record_count_method.sql");
  if (psqlExec(legacySnapshotSql) !== legacyBefore) throw new Error("P2-01M XLSX worksheet method migration changed an existing evidence or locator row");
  if (overall(xlsxVerifier()) !== "FAIL") throw new Error("P2-01M selected-worksheet verifier passed before the selected method migration");
  psqlFile("migrations/kai_sprint2_p2_01m_xlsx_selected_worksheet_record_count_method.sql");
  psqlFile("migrations/kai_sprint2_p2_01m_xlsx_selected_worksheet_record_count_method.sql");
  if (psqlExec(legacySnapshotSql) !== legacyBefore) throw new Error("P2-01M selected-worksheet migration changed an existing evidence or locator row");
  const verified = xlsxVerifier();
  if (overall(verified) !== "PASS") throw new Error(`P2-01M selected-worksheet verifier failed after its migration:\n${verified.join("\n")}`);
  console.log(`P2-01M selected-worksheet method: applied twice; existing evidence/locator rows unchanged; read-only verifier FAIL before, PASS after:\n${verified.join("\n")}`);

  // Worksheet measurement identity. The previous revision, loaded from a
  // shared clone, records sheet_5 (37 rows), a CSV, and a one-worksheet
  // count with claims on the pre-migration schema, and is refused sheet_3.
  // The migration may write only the new worksheet_key of those rows.
  run("git", ["clone", "--quiet", "--shared", "--no-checkout", repoRoot, legacyCheckout], { capture: true });
  run("git", ["checkout", "--quiet", "--detach", WORKSHEET_LEGACY_REVISION], { cwd: legacyCheckout, capture: true });
  if (existsSync(join(legacyCheckout, "migrations", "kai_sprint2_p2_01m_worksheet_measurement_identity.sql"))) {
    throw new Error(`${WORKSHEET_LEGACY_REVISION} unexpectedly already has the worksheet measurement identity`);
  }
  symlinkSync(join(repoRoot, "node_modules"), join(legacyCheckout, "node_modules"));
  const worksheetSeed = spawnSync("node", ["--test", "__tests__/kai-sprint2-p2-01m-source-record-count-measurement.integration.spec.js"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
    env: { ...testEnv, KAI_P2_01M_PHASE: "worksheet_legacy_seed", KAI_P2_01M_LEGACY_CHECKOUT: legacyCheckout },
  });
  if (worksheetSeed.status !== 0) throw new Error("P2-01M worksheet legacy seed phase failed");
  const measurementSnapshotSql = `SELECT md5(coalesce((SELECT string_agg(row_to_json(d)::text, '|' ORDER BY d.source_measurement_definition_id) FROM (
      SELECT source_measurement_definition_id, organization_id, source_version_id, measurement_type, counted_unit, unit_label, definition_text,
             inclusion_rule, exclusion_rule, period_start, period_end, definition_fingerprint, definition_status, created_by, created_by_type, created_at
        FROM kai.source_measurement_definitions) d), '')
      || coalesce((SELECT string_agg(row_to_json(m)::text, '|' ORDER BY m.evidence_item_id) FROM (
      SELECT evidence_item_id, organization_id, source_version_id, source_measurement_definition_id, measurement_type, measured_value, unit_label,
             calculation_method, profile_canonical_sha256, total_record_count, blank_record_count, duplicate_record_count, created_at
        FROM kai.evidence_measurements) m), ''))`;
  const identityVerifier = () => run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-tA", "-F", "|", "-f",
    "scripts/kai-sprint2-p2-01m-worksheet-measurement-identity-verify-read-only.sql"], { capture: true }).stdout.trim().split("\n");
  const evidenceBefore = psqlExec(legacySnapshotSql);
  const measurementsBefore = psqlExec(measurementSnapshotSql);
  if (overall(identityVerifier()) !== "FAIL") throw new Error("worksheet measurement identity verifier did not fail before its migration");
  psqlFile("migrations/kai_sprint2_p2_01m_worksheet_measurement_identity.sql");
  psqlFile("migrations/kai_sprint2_p2_01m_worksheet_measurement_identity.sql");
  if (psqlExec(legacySnapshotSql) !== evidenceBefore) throw new Error("worksheet measurement identity migration changed an evidence, locator, or claim row");
  if (psqlExec(measurementSnapshotSql) !== measurementsBefore) throw new Error("worksheet measurement identity migration changed a historical definition or measurement column");
  const backfilled = run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-tA", "-F", "|", "-c",
    `SELECT m.calculation_method, coalesce(m.worksheet_key, '-'), coalesce(d.worksheet_key, '-'), m.measured_value
       FROM kai.evidence_measurements m JOIN kai.source_measurement_definitions d ON d.source_measurement_definition_id = m.source_measurement_definition_id
      ORDER BY 1, 2`], { capture: true }).stdout.trim();
  const expectedBackfill = [
    "p1_csv_profile_data_records_excluding_blank_v1|-|-|5",
    "p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1|sheet_5|sheet_5|37",
    "p1_xlsx_single_worksheet_data_rows_excluding_blank_v1|-|-|5",
  ].join("\n");
  if (backfilled !== expectedBackfill) throw new Error(`worksheet measurement identity backfill differs:\n${backfilled}`);
  const identityVerified = identityVerifier();
  if (overall(identityVerified) !== "PASS") throw new Error(`worksheet measurement identity verifier failed after its migration:\n${identityVerified.join("\n")}`);
  if (overall(xlsxVerifier()) !== "PASS") throw new Error("the worksheet measurement identity migration changed the verified XLSX method CHECKs");
  console.log(`P2-01M worksheet measurement identity: applied twice; previous-revision rows unchanged except their new worksheet_key:\n${backfilled}\nread-only verifier FAIL before, PASS after:\n${identityVerified.join("\n")}`);

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
      KAI_P2_01M_WORKSHEET_LEGACY_SEEDED: "1",
      KAI_P2_06_CLAIM_TRACEABILITY_DATABASE_URL: targetUrl,
    },
  });
  if (testResult.status !== 0) throw new Error("P2-01M measurement and P2-06 traceability tests failed");

  // Every rollback refuses while dependent measurements exist and changes nothing.
  const measurementRows = psqlExec("SELECT count(*) FROM kai.evidence_measurements;");
  let identityRollbackRefused = false;
  try {
    psqlFile("migrations/kai_sprint2_p2_01m_worksheet_measurement_identity.rollback.sql");
  } catch (error) {
    identityRollbackRefused = /worksheet measurement identity rollback refused: a source version has measurements for more than one worksheet/.test(String(error.message));
  }
  if (!identityRollbackRefused) throw new Error("worksheet measurement identity rollback did not refuse with two worksheets of one version measured");
  if (overall(identityVerifier()) !== "PASS") throw new Error("the refused worksheet identity rollback changed the verified schema");
  let xlsxRollbackRefused = false;
  try {
    psqlFile("migrations/kai_sprint2_p2_01m_xlsx_worksheet_record_count_method.rollback.sql");
  } catch (error) {
    xlsxRollbackRefused = /rollback refused: workbook record-count measurements exist/.test(String(error.message));
  }
  if (!xlsxRollbackRefused) throw new Error("P2-01M XLSX worksheet method rollback did not refuse with a workbook measurement present");
  let selectedRollbackRefused = false;
  try {
    psqlFile("migrations/kai_sprint2_p2_01m_xlsx_selected_worksheet_record_count_method.rollback.sql");
  } catch (error) {
    selectedRollbackRefused = /selected-worksheet method rollback refused: persisted measurements depend on the method/.test(String(error.message));
  }
  if (!selectedRollbackRefused) throw new Error("P2-01M selected-worksheet rollback did not refuse with a selected measurement present");
  if (overall(xlsxVerifier()) !== "PASS") throw new Error("the refused XLSX rollback changed the verified CHECKs");
  let rollbackRefused = false;
  try {
    psqlFile("migrations/kai_sprint2_p2_01m_source_record_count_measurement.rollback.sql");
  } catch (error) {
    rollbackRefused = /rollback refused: source record-count measurement evidence exists/.test(String(error.message));
  }
  if (!rollbackRefused) throw new Error("P2-01M rollback did not refuse with measurement evidence present");
  if (psqlExec("SELECT count(*) FROM kai.evidence_measurements;") !== measurementRows) throw new Error("refused rollback changed measurement rows");
  console.log("P2-01M, XLSX worksheet, selected-worksheet method, and worksheet identity rollbacks refused while dependent measurements exist; nothing changed.");
  console.log("P2-01M record-count measurement and P2-06 traceability tests passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(join(legacyCheckout, "node_modules"), { force: true });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P2-01M ephemeral PostgreSQL workdir removed: ${workDir}`);
}
