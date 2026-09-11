import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_p14_10_review_queue_target_object_type_repair_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p14-10-rqr-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(63000 + Math.floor(Math.random() * 1000));
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

function runTests(phase) {
  const testResult = spawnSync("node", [
    "--test",
    "__tests__/kai-sprint2-p14-10-review-queue-target-object-type-repair.integration.spec.js",
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
      KAI_P14_10_REVIEW_QUEUE_REPAIR_DATABASE_URL: targetUrl,
      KAI_P14_10_REVIEW_QUEUE_REPAIR_PHASE: phase,
    },
  });
  if (testResult.status !== 0) throw new Error(`P14-10 review-queue target_object_type repair ${phase}-migration tests failed`);
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
    if (row.database_name !== dbName) throw new Error("P14-10 review-queue target_object_type repair runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`P14-10 review-queue target_object_type repair runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("P14-10 review-queue target_object_type repair runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("P14-10 review-queue target_object_type repair runner refused non-loopback listen_addresses");
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

  // Build the normal current schema, exactly as the P14-09 funder-authority
  // runner does, plus the P3-04 generated-content-review-completion
  // migration (needed here because this package's proof is specifically
  // about the constraint P3-04 adds/depends on).
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
  run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-c",
    "ALTER TABLE kai.engagements ADD CONSTRAINT kai_p14_09_funder_authority_engagements_id_org_unique UNIQUE (engagement_id, organization_id);"],
    { capture: true });
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
  psqlFile("migrations/kai_sprint2_p2_09_human_review_internal_approval.sql");
  psqlFile("migrations/kai_sprint2_p3_01_generated_content_drafts.sql");
  psqlFile("migrations/kai_sprint2_p2_10_coverage_review_decision.sql");
  psqlFile("migrations/kai_sprint2_p2_11_client_followup_completion.sql");
  psqlFile("migrations/kai_sprint2_p2_09_p2_10_p2_11_forward_reconciliation.sql");
  psqlFile("migrations/kai_sprint2_p3_04_generated_content_review_completion.sql");
  psqlFile("migrations/kai_sprint2_p14_01_generation_run_engagement_binding.sql");
  psqlFile("migrations/kai_sprint2_b1a_02_phase5_allowed_use_decision_ledger.sql");
  psqlFile("migrations/kai_sprint2_p2_12_human_review_decision_ledger.sql");
  psqlFile("migrations/kai_sprint2_p2_10_funder_coverage_authority.sql");

  psqlFile("scripts/kai-sprint2-gate-a-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-04-data-dictionary-quality-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-05-intake-sensitivity-profile-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-06-review-queue-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-07-source-candidate-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-08-source-promotion-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p2-01-evidence-lineage-smoke-seed.sql");

  // The "pre" phase test itself applies the reproduction-only production-
  // drift fixture (scripts/kai-sprint2-p14-10-review-queue-target-object-type-repair-reproduce-production-drift.sql)
  // AFTER building its own funder-eligible claim, so the reproduced
  // allowlist reflects every target_object_type a real organization already
  // uses and excludes only the USER_CONFIRMED missing value,
  // 'generated_content_draft'.
  console.log("=== P14-10: PRE-MIGRATION proof (stale production-drift schema must reject the real transaction) ===");
  runTests("pre");
  console.log("P14-10 pre-migration reproduction confirmed: the real transaction is rejected under the drifted schema.");

  console.log("=== P14-10: applying repair migration ===");
  psqlFile("migrations/kai_sprint2_p14_10_review_queue_target_object_type_repair.sql");
  // Re-applying the migration must be a safe no-op against an
  // already-repaired database.
  psqlFile("migrations/kai_sprint2_p14_10_review_queue_target_object_type_repair.sql");

  console.log("=== P14-10: migration verifier ===");
  psqlFile("scripts/kai-sprint2-p14-10-review-queue-target-object-type-repair-verifier.sql");

  console.log("=== P14-10: smoke seed + smoke verifier ===");
  psqlFile("scripts/kai-sprint2-p14-10-review-queue-target-object-type-repair-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p14-10-review-queue-target-object-type-repair-smoke-verifier.sql");

  console.log("=== P14-10: failure checks (negative contracts) ===");
  psqlFile("scripts/kai-sprint2-p14-10-review-queue-target-object-type-repair-failure-checks.sql");

  console.log("=== P14-10: POST-MIGRATION proof (the same real transaction must now commit) ===");
  runTests("post");
  console.log("P14-10 post-migration repair confirmed: the real transaction now commits with the expected durable shape.");

  console.log("P14-10 review-queue target_object_type schema-repair regression passed end to end.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P14-10 review-queue target_object_type repair ephemeral PostgreSQL workdir removed: ${workDir}`);
}
