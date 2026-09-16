import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import {
  PACKAGE_2A_ENGAGEMENT_REQUIREMENT_SET_CONSTRAINTS,
  assertConstraintCatalogMatch,
} from "./kai-sprint2-package-2a-constraint-verifier.js";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_final_two_schema_deltas_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-final-two-deltas-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(58200 + Math.floor(Math.random() * 1000));
const user = process.env.USER || "postgres";
const targetUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;
const sentinelUrl = "postgres://127.0.0.1:9/kai_sentinel";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: {
      ...process.env,
      DATABASE_URL: sentinelUrl,
      PGHOST: "127.0.0.1",
      PGPORT: port,
      PGDATABASE: dbName,
      PGUSER: user,
    },
  });
  if (result.status !== 0) {
    const postgresLog = existsSync(logFile) ? "\npostgres.log:\n" + readTail(logFile) : "";
    const detail = [result.stdout, result.stderr, postgresLog].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function readTail(path) {
  const result = spawnSync("tail", ["-n", "80", path], { encoding: "utf8" });
  return result.stdout || result.stderr || "";
}

function psqlFile(path) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", path], { capture: true }).stdout;
}

function psqlFileResult(path) {
  return spawnSync(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", path], {
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

async function withClient(callback) {
  const client = new Client({ connectionString: targetUrl, ssl: false });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function proveRunnerOwnedTarget() {
  const parsed = new URL(targetUrl);
  assert(["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase()), "runner refused non-loopback target before connection");
  await withClient(async (client) => {
    const { rows } = await client.query(`
      SELECT current_database() AS database_name,
             inet_server_addr()::text AS server_addr,
             inet_server_port()::text AS server_port,
             current_setting('listen_addresses') AS listen_addresses,
             current_setting('server_version_num')::integer AS version_num
    `);
    const row = rows[0];
    assert(row.database_name === dbName, "runner refused non-synthetic database name");
    assert(["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr), `runner refused non-loopback server address: ${row.server_addr}`);
    assert(row.server_port === port, "runner refused unexpected PostgreSQL port");
    assert(row.listen_addresses === "127.0.0.1", "runner refused non-loopback listen_addresses");
    assert(row.version_num >= 160000 && row.version_num < 170000, "runner requires PostgreSQL 16");
  });
}

async function resetSchema(client) {
  await client.query("DROP SCHEMA IF EXISTS kai CASCADE");
  await client.query("DROP TABLE IF EXISTS public.organizations CASCADE");
  await client.query("DROP TYPE IF EXISTS public.engagement_status_enum CASCADE");
  await client.query("DROP EXTENSION IF EXISTS pgcrypto CASCADE");
}

async function establishRequirementSetOwningSchema(client) {
  await resetSchema(client);
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  await client.query(
    "ALTER TABLE kai.engagements ADD CONSTRAINT kai_package_2a_engagements_id_org_unique UNIQUE (engagement_id, organization_id)",
  );
  psqlFile("migrations/kai_sprint2_b1_1_baseline_impact_requirements.sql");
}

async function establishGateAOwningSchema(client) {
  await resetSchema(client);
  psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle_enforcement_forward_repair.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql");
}

async function seedLegacyRequirementSet(client) {
  const { rows } = await client.query(`
    WITH org AS (
      INSERT INTO kai.organizations (name) VALUES ('Synthetic Late Apply Org')
      RETURNING organization_id
    ), engagement AS (
      INSERT INTO kai.engagements (organization_id, engagement_code)
      SELECT organization_id, 'late-apply-engagement' FROM org
      RETURNING organization_id, engagement_id
    ), source AS (
      INSERT INTO kai.requirement_sources (source_type, source_code, source_name)
      VALUES ('funder', 'synthetic_funder', 'Synthetic Funder')
      RETURNING requirement_source_id
    ), version AS (
      INSERT INTO kai.requirement_framework_versions (
        requirement_source_id,
        framework_code,
        framework_name,
        version_label,
        framework_status
      )
      SELECT requirement_source_id, 'synthetic_framework', 'Synthetic Framework', 'v1', 'active'
        FROM source
      RETURNING requirement_framework_version_id
    ), requirement_set AS (
      INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name)
      SELECT requirement_framework_version_id, 'synthetic_requirements', 'Synthetic Requirements'
        FROM version
      RETURNING requirement_set_id
    )
    INSERT INTO kai.engagement_requirement_sets (
      organization_id,
      engagement_id,
      requirement_set_id,
      applicability_status,
      created_by_type
    )
    SELECT engagement.organization_id,
           engagement.engagement_id,
           requirement_set.requirement_set_id,
           'proposed',
           'system'
      FROM engagement, requirement_set
    RETURNING engagement_requirement_set_id
  `);
  return rows[0].engagement_requirement_set_id;
}

async function provePackage2ALateApply(client) {
  await establishRequirementSetOwningSchema(client);
  const legacyId = await seedLegacyRequirementSet(client);
  psqlFile("migrations/kai_sprint2_package_2a_engagement_requirement_sets_authority.sql");

  const survived = await client.query(
    `SELECT applicability_effective_state,
            reviewed_by,
            reviewed_by_role,
            reviewed_at,
            supersedes_engagement_requirement_set_id,
            target_context_identity
       FROM kai.engagement_requirement_sets
      WHERE engagement_requirement_set_id = $1`,
    [legacyId],
  );
  assert(survived.rowCount === 1, "legacy engagement_requirement_sets row did not survive Package 2A late apply");
  const row = survived.rows[0];
  assert(row.applicability_effective_state === "pending_review", "legacy row did not receive pending_review effective state");
  assert(row.reviewed_by === null && row.reviewed_by_role === null && row.reviewed_at === null, "legacy row reviewed_* fields were not all NULL");
  assert(row.supersedes_engagement_requirement_set_id === null, "legacy row supersedes_engagement_requirement_set_id was not NULL");
  assert(row.target_context_identity === null, "legacy row target_context_identity was not NULL");

  await verifyPackage2AStructure(client);
  console.log("Package 2A late-apply proof passed.");
}

async function verifyPackage2AStructure(client) {
  const expectedColumns = [
    "reviewed_by",
    "reviewed_by_role",
    "reviewed_at",
    "applicability_effective_state",
    "supersedes_engagement_requirement_set_id",
    "target_context_identity",
  ];
  const columns = await client.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'kai'
        AND table_name = 'engagement_requirement_sets'
        AND column_name = ANY($1::text[])`,
    [expectedColumns],
  );
  assert(columns.rowCount === expectedColumns.length, `Package 2A columns missing: ${expectedColumns.filter((c) => !columns.rows.some((r) => r.column_name === c)).join(", ")}`);

  const constraints = await client.query(`
    SELECT conname, contype, convalidated, pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'engagement_requirement_sets'
  `);
  for (const spec of PACKAGE_2A_ENGAGEMENT_REQUIREMENT_SET_CONSTRAINTS) {
    assertConstraintCatalogMatch(constraints.rows, spec);
  }

  const indexes = await client.query(`
    SELECT indexname
      FROM pg_indexes
     WHERE schemaname = 'kai'
       AND tablename = 'engagement_requirement_sets'
       AND indexname = ANY($1::text[])
  `, [[
    "ux_engagement_requirement_sets_package_2a_current_identity",
    "ux_engagement_requirement_sets_package_2a_single_successor",
    "ix_engagement_requirement_sets_package_2a_current_lookup",
  ]]);
  assert(indexes.rowCount === 3, "Package 2A indexes are incomplete");

  const fn = await client.query("SELECT to_regprocedure('kai.package_2a_reject_engagement_requirement_set_mutation()') IS NOT NULL AS present");
  assert(fn.rows[0].present, "Package 2A append-only function is missing");

  const trigger = await client.query(`
    SELECT 1
      FROM pg_trigger t
      JOIN pg_class r ON r.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'engagement_requirement_sets'
       AND t.tgname = 'trg_package_2a_engagement_requirement_sets_append_only'
       AND NOT t.tgisinternal
  `);
  assert(trigger.rowCount === 1, "Package 2A append-only trigger is missing");
}

async function provePackage2ARollbackPrecheck(client) {
  const safe = await package2ARollbackPrecheck(client);
  assert(safe === "SAFE_TO_ROLL_BACK", `expected SAFE_TO_ROLL_BACK, got ${safe}`);

  await client.query(`
    INSERT INTO kai.engagement_requirement_sets (
      organization_id,
      engagement_id,
      requirement_set_id,
      applicability_status,
      reviewed_by,
      reviewed_by_role,
      reviewed_at,
      applicability_effective_state,
      supersedes_engagement_requirement_set_id,
      target_context_identity,
      created_by_type
    )
    SELECT organization_id,
           engagement_id,
           requirement_set_id,
           'confirmed',
           '90000000-0000-4000-8000-000000000001'::uuid,
           'gk_operator',
           now(),
           'applicable',
           engagement_requirement_set_id,
           '{"target_funder_id":"synthetic_funder","target_framework":"synthetic_framework"}'::jsonb,
           'system'
      FROM kai.engagement_requirement_sets
     LIMIT 1
  `);
  const unsafe = await package2ARollbackPrecheck(client);
  assert(unsafe === "UNSAFE_TO_ROLL_BACK_WITH_EXISTING_DATA", `expected UNSAFE_TO_ROLL_BACK_WITH_EXISTING_DATA, got ${unsafe}`);
  console.log("Package 2A rollback-precheck proof passed.");
}

async function package2ARollbackPrecheck(client) {
  const { rows } = await client.query(`
    WITH authority_state AS (
      SELECT EXISTS (
        SELECT 1
          FROM kai.engagement_requirement_sets
         WHERE reviewed_by IS NOT NULL
            OR reviewed_by_role IS NOT NULL
            OR reviewed_at IS NOT NULL
            OR applicability_effective_state <> 'pending_review'
            OR supersedes_engagement_requirement_set_id IS NOT NULL
            OR target_context_identity IS NOT NULL
      ) AS present
    ), restored_unique_conflict AS (
      SELECT EXISTS (
        SELECT 1
          FROM kai.engagement_requirement_sets
         GROUP BY organization_id, engagement_id, requirement_set_id
        HAVING count(*) > 1
      ) AS present
    )
    SELECT CASE
             WHEN authority_state.present OR restored_unique_conflict.present
               THEN 'UNSAFE_TO_ROLL_BACK_WITH_EXISTING_DATA'
             ELSE 'SAFE_TO_ROLL_BACK'
           END AS rollback_precheck
      FROM authority_state, restored_unique_conflict
  `);
  return rows[0].rollback_precheck;
}

async function captureGateASurroundingShape(client) {
  const table = await client.query(`
    SELECT column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema = 'kai'
       AND table_name = 'upload_policy_decision_replay'
     ORDER BY ordinal_position
  `);
  const constraints = await client.query(`
    SELECT conname, contype, pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'upload_policy_decision_replay'
     ORDER BY conname
  `);
  const fn = await client.query(`
    SELECT pg_get_functiondef('kai.gate_a_p0_jsonb_metadata_only(jsonb)'::regprocedure) AS definition
  `);
  return JSON.stringify({
    table: table.rows,
    constraints: constraints.rows,
    function: fn.rows[0].definition,
  });
}

async function getReplayObjectFactsColumns(client) {
  const { rows } = await client.query(`
    SELECT a.attname AS column_name
      FROM pg_class i
      JOIN pg_namespace n ON n.oid = i.relnamespace
      JOIN pg_index ix ON ix.indexrelid = i.oid
      JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
     WHERE n.nspname = 'kai'
       AND i.relname = 'ix_upload_policy_decision_replay_gate_a_object_facts'
     ORDER BY k.ord
  `);
  return rows.map((row) => row.column_name);
}

async function proveGateARepair(client) {
  await establishGateAOwningSchema(client);
  const beforeShape = await captureGateASurroundingShape(client);
  await client.query("DROP INDEX IF EXISTS kai.ix_upload_policy_decision_replay_gate_a_object_facts");
  psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay_object_facts_index_repair.sql");
  const expectedColumns = [
    "organization_id",
    "intake_file_id",
    "object_version_id",
    "verified_checksum",
    "verified_size_bytes",
  ];
  assert(JSON.stringify(await getReplayObjectFactsColumns(client)) === JSON.stringify(expectedColumns), "Gate-A repair did not create exact ordered object-facts index columns");
  assert((await captureGateASurroundingShape(client)) === beforeShape, "Gate-A repair changed surrounding replay table/function/constraints");

  psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay_object_facts_index_repair.rollback.sql");
  assert((await getReplayObjectFactsColumns(client)).length === 0, "Gate-A repair rollback did not remove only the target index");
  assert((await captureGateASurroundingShape(client)) === beforeShape, "Gate-A rollback changed surrounding replay table/function/constraints");

  psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay_object_facts_index_repair.sql");
  assert(JSON.stringify(await getReplayObjectFactsColumns(client)) === JSON.stringify(expectedColumns), "Gate-A repair reapply did not finish converged");
  console.log("Gate-A index-only forward/rollback/reapply proof passed.");
}

async function proveCombinedVerifier(client) {
  await establishFinalTwoOwningSchema(client);
  assertCombinedVerifierPass("required indexes positive");
  console.log("Combined verifier required indexes positive proof passed.");

  await client.query(`
    CREATE INDEX ix_engagement_requirement_sets_package_2a_unrelated_regression_probe
      ON kai.engagement_requirement_sets (created_at)
  `);
  assertCombinedVerifierPass("unrelated Package 2A index regression");
  console.log("Combined verifier unrelated Package 2A index regression proof passed.");

  await establishFinalTwoOwningSchema(client);
  await client.query("DROP INDEX kai.ix_engagement_requirement_sets_package_2a_current_lookup");
  assertCombinedVerifierFail("missing required Package 2A index");
  console.log("Combined verifier missing required Package 2A index negative proof passed.");

  await establishFinalTwoOwningSchema(client);
  await client.query("DROP INDEX kai.ux_engagement_requirement_sets_package_2a_current_identity");
  await client.query(`
    CREATE INDEX ux_engagement_requirement_sets_package_2a_current_identity
      ON kai.engagement_requirement_sets (organization_id, engagement_id, requirement_set_id)
      WHERE supersedes_engagement_requirement_set_id IS NULL
  `);
  assertCombinedVerifierFail("wrong Package 2A index uniqueness");
  console.log("Combined verifier wrong Package 2A index uniqueness negative proof passed.");

  console.log("Combined final-two repaired-surfaces verifier passed.");
}

async function establishFinalTwoOwningSchema(client) {
  await establishRequirementSetOwningSchema(client);
  await seedLegacyRequirementSet(client);
  psqlFile("migrations/kai_sprint2_package_2a_engagement_requirement_sets_authority.sql");
  await verifyPackage2AStructure(client);

  psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle_enforcement_forward_repair.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql");
  await client.query("DROP INDEX IF EXISTS kai.ix_upload_policy_decision_replay_gate_a_object_facts");
  psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay_object_facts_index_repair.sql");
  const expectedColumns = [
    "organization_id",
    "intake_file_id",
    "object_version_id",
    "verified_checksum",
    "verified_size_bytes",
  ];
  assert(JSON.stringify(await getReplayObjectFactsColumns(client)) === JSON.stringify(expectedColumns), "combined verifier did not find Gate-A object-facts index converged");
}

function assertCombinedVerifierPass(label) {
  const result = psqlFileResult("artifacts/kai-production-repair-packet-c14621e/06_combined_final_two_surface_verification.sql");
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status === 0, `${label}: combined verifier expected PASS\n${output}`);
  assert(output.includes("FINAL_TWO_SURFACES_VERIFIED"), `${label}: combined verifier did not raise final success notice\n${output}`);
  assert(!/\|\s*FAIL\s*\|/.test(output), `${label}: combined verifier emitted FAIL row\n${output}`);
}

function assertCombinedVerifierFail(label) {
  const result = psqlFileResult("artifacts/kai-production-repair-packet-c14621e/06_combined_final_two_surface_verification.sql");
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status !== 0, `${label}: combined verifier expected FAIL\n${output}`);
  assert(output.includes("F_COMBINED_FINAL_TWO_SURFACE_VERIFICATION failed"), `${label}: combined verifier failed for unexpected reason\n${output}`);
}

let started = false;
try {
  mkdirSync(socketDir, { recursive: true });
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { capture: true });
  run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], { capture: true });
  started = true;
  run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { capture: true });
  await proveRunnerOwnedTarget();

  await withClient(async (client) => {
    await provePackage2ALateApply(client);
    await provePackage2ARollbackPrecheck(client);
    await proveGateARepair(client);
    await proveCombinedVerifier(client);
  });
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`Final two schema deltas ephemeral PostgreSQL workdir removed: ${workDir}`);
}
