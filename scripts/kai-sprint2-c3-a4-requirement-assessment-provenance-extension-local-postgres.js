import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_c3_a4_provenance_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-c3-a4-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(59000 + Math.floor(Math.random() * 1000));
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

async function proveRunnerOwnedTarget() {
  const parsed = new URL(targetUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("C3.A4 provenance runner refused a non-loopback target before connecting");
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
    if (row.database_name !== dbName) throw new Error("C3.A4 runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`C3.A4 runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("C3.A4 runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("C3.A4 runner refused non-loopback listen_addresses");
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

  // Full dependency chain this migration sits on top of - identical to the
  // C3.A3 runner's own chain, since this package sits directly alongside
  // C3.A3 and needs the same A1.1/P1/P2 lineage plus C3.A3's own tables
  // (ra_gap_links) for the shared regression proof at the end.
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlExec(
    "ALTER TABLE kai.engagements ADD CONSTRAINT kai_c3_a4_engagements_id_org_unique UNIQUE (engagement_id, organization_id);",
  );
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
  psqlFile("migrations/kai_sprint2_a1_1_impact_outcome_context.sql");
  psqlFile("migrations/kai_sprint2_a1_2_impact_evaluation_framework_and_criteria.sql");
  psqlFile("migrations/kai_sprint2_a1_3_impact_evaluations_and_results.sql");
  psqlFile("migrations/kai_sprint2_a1_4_impact_evaluation_result_provenance_links.sql");
  psqlFile("migrations/kai_sprint2_b1_1_baseline_impact_requirements.sql");
  psqlFile("migrations/kai_sprint2_c2_1_requirement_assessment_persistence.sql");
  psqlFile("migrations/kai_sprint2_p2_04_claim_gap_followup.sql");
  psqlFile("migrations/kai_sprint2_p2_05_conflict_review_candidate.sql");
  psqlFile("migrations/kai_sprint2_p2_09_human_review_internal_approval.sql");
  psqlFile("migrations/kai_sprint2_p2_10_coverage_review_decision.sql");
  psqlFile("migrations/kai_sprint2_p2_11_client_followup_completion.sql");
  psqlFile("migrations/kai_sprint2_p2_12_human_review_decision_ledger.sql");
  psqlFile("migrations/kai_sprint2_c3_a3_requirement_assessment_decision_gap_provenance.sql");

  // C3.A4 forward migration itself.
  psqlFile("migrations/kai_sprint2_c3_a4_requirement_assessment_provenance_extension.sql");

  const commonTestEnv = {
    ...process.env,
    DATABASE_URL: "",
    DATABASE_URL_LOCAL: "",
    PGURL_LOCAL: "",
    RENDER_DATABASE_URL: "",
    PROD_DATABASE_URL: "",
    DB_HOST: "127.0.0.1",
    DB_PORT: port,
    DB_NAME: dbName,
    DB_USER: user,
    DB_PASSWORD: "",
    KAI_C3_A4_PROVENANCE_DATABASE_URL: targetUrl,
    KAI_C3_A3_PROVENANCE_DATABASE_URL: targetUrl,
    KAI_C2_1_REQUIREMENT_ASSESSMENT_DATABASE_URL: targetUrl,
  };

  const focusedResult = spawnSync("node", [
    "--test",
    "__tests__/kai-sprint2-c3-a4-requirement-assessment-provenance-extension-schema-contract.spec.js",
    "__tests__/kai-sprint2-c3-a4-requirement-assessment-provenance-extension.integration.spec.js",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
    env: commonTestEnv,
  });
  if (focusedResult.status !== 0) throw new Error("C3.A4 provenance-extension tests failed");
  console.log("C3.A4 provenance-extension local PostgreSQL proof passed.");

  // Regression: the existing C2.1 and C3.A3 suites must still pass
  // unmodified against this same, now-further-extended schema - proving the
  // three new C3.A4 tables/triggers do not disturb either package's
  // behavior. Each DB-truncating suite is run as its own `node --test`
  // invocation (never combined into one command) because Node's test
  // runner executes multiple test files concurrently by default, and these
  // suites' beforeEach hooks TRUNCATE the same shared runner-owned database
  // - running them together caused cross-suite deadlocks/FK races that have
  // nothing to do with this package's own schema.
  const c21Regression = spawnSync("node", [
    "--test",
    "__tests__/kai-sprint2-c2-1-requirement-assessment-persistence-schema-contract.spec.js",
    "__tests__/kai-sprint2-c2-1-requirement-assessment-persistence.integration.spec.js",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
    env: commonTestEnv,
  });
  if (c21Regression.status !== 0) throw new Error("C2.1 regression suite failed against the C3.A4-extended schema");
  console.log("C2.1 regression suite passed against the C3.A4-extended schema.");

  const c3a3Regression = spawnSync("node", [
    "--test",
    "__tests__/kai-sprint2-c3-a3-requirement-assessment-decision-gap-provenance-schema-contract.spec.js",
    "__tests__/kai-sprint2-c3-a3-requirement-assessment-decision-gap-provenance.integration.spec.js",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
    env: commonTestEnv,
  });
  if (c3a3Regression.status !== 0) throw new Error("C3.A3 regression suite failed against the C3.A4-extended schema");
  console.log("C3.A3 regression suite passed against the C3.A4-extended schema.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`C3.A4 provenance-extension ephemeral PostgreSQL workdir removed: ${workDir}`);
}
