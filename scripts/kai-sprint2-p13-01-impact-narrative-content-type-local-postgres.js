import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_p13_01_impact_narrative_content_type_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p13-01-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(64000 + Math.floor(Math.random() * 1000));
const user = process.env.USER || "postgres";
const targetUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;
const sentinelUrl = "postgres://127.0.0.1:9/kai_sentinel";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture || options.allowFail ? ["ignore", "pipe", "pipe"] : "inherit",
    env: {
      ...process.env,
      DATABASE_URL: sentinelUrl,
      PGHOST: "127.0.0.1",
      PGPORT: port,
      PGDATABASE: dbName,
      PGUSER: user,
    },
  });
  if (!options.allowFail && result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function psqlFile(path, options = {}) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", path], { capture: true, ...options });
}

function psqlScalar(sql) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-At", "-d", dbName, "-c", sql], { capture: true }).stdout.trim();
}

function assertNoFail(output, label) {
  if (/(^|\s)FAIL(\s|$)/.test(output)) {
    throw new Error(`${label} reported FAIL\n${output}`);
  }
}

async function proveRunnerOwnedTarget() {
  const parsed = new URL(targetUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("P13-01 runner refused non-loopback target before connection");
  }
  const client = new Client({ connectionString: targetUrl, ssl: false });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT version() AS version,
             current_database() AS database_name,
             inet_server_addr()::text AS server_addr,
             inet_server_port()::text AS server_port,
             current_setting('listen_addresses') AS listen_addresses
    `);
    const row = result.rows[0];
    console.log(`P13-01 PostgreSQL version: ${row.version}`);
    if (row.database_name !== dbName) throw new Error("P13-01 runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`P13-01 runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("P13-01 runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("P13-01 runner refused non-loopback listen_addresses");
  } finally {
    await client.end();
  }
}

function constraintStates() {
  return psqlScalar(`
    SELECT string_agg(relname || ':' || conname || ':' || pg_get_constraintdef(c.oid), E'\n' ORDER BY relname, conname)
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND relname IN ('generation_runs', 'generated_content_drafts')
       AND conname IN ('generation_runs_p3_01_content_type_check', 'generated_content_drafts_p3_01_content_type_check')
  `);
}

function p13Counts() {
  return psqlScalar(`
    SELECT jsonb_build_object(
      'runs', (SELECT count(*) FROM kai.generation_runs WHERE idempotency_key LIKE 'p13-01-smoke-%'),
      'impact_runs', (SELECT count(*) FROM kai.generation_runs WHERE idempotency_key = 'p13-01-smoke-impact-narrative' AND content_type = 'impact_narrative'),
      'all_impact_runs', (SELECT count(*) FROM kai.generation_runs WHERE content_type = 'impact_narrative'),
      'drafts', (SELECT count(*) FROM kai.generated_content_drafts WHERE generation_run_id IN (SELECT generation_run_id FROM kai.generation_runs WHERE idempotency_key LIKE 'p13-01-smoke-%')),
      'impact_drafts', (SELECT count(*) FROM kai.generated_content_drafts WHERE generation_run_id = '13010000-0000-4000-8000-000000000102'::uuid AND content_type = 'impact_narrative'),
      'all_impact_drafts', (SELECT count(*) FROM kai.generated_content_drafts WHERE content_type = 'impact_narrative')
    )::text
  `);
}

function cleanupImpactNarrativeFixture() {
  run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-c", `
    DELETE FROM kai.review_queue_items
     WHERE queue_type = 'generated_content_review'
       AND target_object_id IN (
         SELECT generated_content_draft_id
           FROM kai.generated_content_drafts
          WHERE content_type = 'impact_narrative'
       );
    DELETE FROM kai.generated_content_citations
     WHERE generated_content_block_id IN (
       SELECT generated_content_block_id
         FROM kai.generated_content_blocks
        WHERE generated_content_draft_id IN (
          SELECT generated_content_draft_id
            FROM kai.generated_content_drafts
           WHERE content_type = 'impact_narrative'
        )
     );
    DELETE FROM kai.generated_content_blocks
     WHERE generated_content_draft_id IN (
       SELECT generated_content_draft_id
         FROM kai.generated_content_drafts
        WHERE content_type = 'impact_narrative'
     );
    DELETE FROM kai.generated_content_drafts
     WHERE content_type = 'impact_narrative';
    DELETE FROM kai.generation_runs
     WHERE content_type = 'impact_narrative';
  `], { capture: true });
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
  psqlFile("migrations/kai_sprint2_p2_01_evidence_lineage.sql");
  psqlFile("migrations/kai_sprint2_p2_03_claim_proposal.sql");
  psqlFile("migrations/kai_sprint2_p2_04_claim_gap_followup.sql");
  psqlFile("migrations/kai_sprint2_p2_05_conflict_review_candidate.sql");
  psqlFile("migrations/kai_sprint2_p2_10_coverage_review_decision.sql");
  psqlFile("migrations/kai_sprint2_p3_01_generated_content_drafts.sql");
  psqlFile("migrations/kai_sprint2_p13_01_impact_narrative_content_type.sql");
  console.log("P13-01 forward migration applied.");

  const verifierOutput = psqlFile("scripts/kai-sprint2-p13-01-impact-narrative-content-type-verifier.sql").stdout;
  assertNoFail(verifierOutput, "P13-01 verifier");
  console.log(verifierOutput);

  psqlFile("scripts/kai-sprint2-gate-a-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-04-data-dictionary-quality-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-05-intake-sensitivity-profile-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-06-review-queue-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-07-source-candidate-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-08-source-promotion-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p2-01-evidence-lineage-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p13-01-impact-narrative-content-type-smoke-seed.sql");
  const smokeOutput = psqlFile("scripts/kai-sprint2-p13-01-impact-narrative-content-type-smoke-verifier.sql").stdout;
  assertNoFail(smokeOutput, "P13-01 smoke verifier");
  console.log(smokeOutput);

  const failureOutput = psqlFile("scripts/kai-sprint2-p13-01-impact-narrative-content-type-failure-checks.sql").stdout;
  assertNoFail(failureOutput, "P13-01 failure checks");
  console.log(failureOutput);

  const testResult = spawnSync("node", [
    "--test",
    "__tests__/kai-sprint2-p3-01-generated-content-drafts.integration.spec.js",
    "__tests__/kai-sprint2-p3-01-generated-content-drafts-boundary.spec.js",
    "__tests__/kai-sprint2-p13-01-impact-narrative-boundary.spec.js",
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
      DB_NAME: dbName,
      DB_USER: user,
      DB_PASSWORD: "",
      KAI_P3_01_GENERATED_CONTENT_DATABASE_URL: targetUrl,
      KAI_P13_01_IMPACT_NARRATIVE_DATABASE_URL: targetUrl,
    },
  });
  if (testResult.status !== 0) throw new Error("P13-01 impact-narrative focused tests failed");

  const beforeRollbackCounts = p13Counts();
  const beforeRollbackConstraints = constraintStates();
  const incompatibleRollback = psqlFile("migrations/kai_sprint2_p13_01_impact_narrative_content_type.rollback.sql", { allowFail: true });
  if (incompatibleRollback.status === 0) {
    throw new Error("P13-01 rollback unexpectedly succeeded with synthetic impact_narrative rows present");
  }
  const afterFailedRollbackCounts = p13Counts();
  const afterFailedRollbackConstraints = constraintStates();
  if (afterFailedRollbackCounts !== beforeRollbackCounts) {
    throw new Error(`P13-01 rollback changed row counts with incompatible data: before=${beforeRollbackCounts} after=${afterFailedRollbackCounts}`);
  }
  if (afterFailedRollbackConstraints !== beforeRollbackConstraints) {
    throw new Error("P13-01 rollback left a partial target constraint transition after incompatible data failure");
  }
  console.log(`P13-01 incompatible-data rollback failed cleanly; preserved counts: ${afterFailedRollbackCounts}`);
  console.log(`P13-01 target constraints after failed rollback:\n${afterFailedRollbackConstraints}`);

  cleanupImpactNarrativeFixture();
  psqlFile("migrations/kai_sprint2_p13_01_impact_narrative_content_type.rollback.sql");
  const restoredConstraints = constraintStates();
  if (!restoredConstraints.includes("CHECK ((content_type = 'evidence_summary'::text))")) {
    throw new Error(`P13-01 rollback did not restore historical content_type contract:\n${restoredConstraints}`);
  }
  console.log(`P13-01 compatible clean rollback restored historical constraints:\n${restoredConstraints}`);
  console.log("P13-01 impact-narrative content-type package verification passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P13-01 impact-narrative ephemeral PostgreSQL workdir removed: ${workDir}`);
}
