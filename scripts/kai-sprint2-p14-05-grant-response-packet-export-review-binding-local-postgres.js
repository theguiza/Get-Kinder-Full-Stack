import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_p14_05_grant_packet_export_review_binding_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p14-05-pg-"));
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
    throw new Error("P14-05 runner refused non-loopback target before connection");
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
    if (row.database_name !== dbName) throw new Error("P14-05 runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`P14-05 runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("P14-05 runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("P14-05 runner refused non-loopback listen_addresses");
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

  // Full real chain through P14-03 (mirroring the P14-03 runner byte-for-
  // byte) is required because P14-05 widens a constraint on the real
  // kai.review_queue_items table and its preflight requires the real
  // kai.grant_response_packet_export_candidates (P14-03) table to exist.
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlExec(
    "ALTER TABLE kai.engagements ADD CONSTRAINT kai_p14_05_engagements_id_org_unique UNIQUE (engagement_id, organization_id);",
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
  psqlFile("migrations/kai_sprint2_p2_04_claim_gap_followup.sql");
  psqlFile("migrations/kai_sprint2_p2_05_conflict_review_candidate.sql");
  psqlFile("migrations/kai_sprint2_p3_01_generated_content_drafts.sql");
  psqlFile("migrations/kai_sprint2_p14_01_generation_run_engagement_binding.sql");
  psqlFile("migrations/kai_sprint2_p3_04_generated_content_review_completion.sql");
  psqlFile("migrations/kai_sprint2_p3_05_export_review_request.sql");
  psqlFile("migrations/kai_sprint2_p3_09_export_review_start.sql");
  psqlFile("migrations/kai_sprint2_p3_13_export_review_completion.sql");
  psqlFile("migrations/kai_sprint2_p3_16_export_candidate_foundation.sql");
  psqlFile("migrations/kai_sprint2_p3_17_human_authority_decision_ledger.sql");
  psqlFile("migrations/kai_sprint2_p3_19_export_manifest_foundation.sql");
  psqlFile("migrations/kai_sprint2_p14_02_grant_response_packet_export_identity_foundation.sql");
  psqlFile("migrations/kai_sprint2_p14_03_grant_response_packet_export_candidate_foundation.sql");

  // Forward.
  psqlFile("migrations/kai_sprint2_p14_05_grant_response_packet_export_review_binding.sql");
  psqlFile("scripts/kai-sprint2-p14-05-grant-response-packet-export-review-binding-verifier.sql");

  // The verifier above leaves behind the two rows it proved are admitted
  // (a single-draft-shaped row and a packet-candidate-shaped row) - clean
  // those up before rollback, since the packet-candidate-shaped row would
  // violate the restored single-target-only P3-13 contract by construction
  // (that is the entire point of the widening this migration proves).
  psqlExec(
    "DELETE FROM kai.review_queue_items WHERE organization_id IN ('00000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-0000000000f2');",
  );

  // Rollback -> restores the exact P3-13 single-target contract.
  psqlFile("migrations/kai_sprint2_p14_05_grant_response_packet_export_review_binding.rollback.sql");
  const afterRollback = psqlExec(
    "SELECT conname FROM pg_constraint WHERE conname IN ('review_queue_items_p3_13_export_review_contract_check','review_queue_items_p14_05_export_review_contract_check') ORDER BY conname;",
  );
  if (!afterRollback.includes("review_queue_items_p3_13_export_review_contract_check")) {
    throw new Error("P14-05 rollback did not restore review_queue_items_p3_13_export_review_contract_check");
  }
  if (afterRollback.includes("review_queue_items_p14_05_export_review_contract_check")) {
    throw new Error("P14-05 rollback left the P14-05 contract check in place");
  }

  // Forward again -> proves idempotent re-application.
  psqlFile("migrations/kai_sprint2_p14_05_grant_response_packet_export_review_binding.sql");
  psqlFile("scripts/kai-sprint2-p14-05-grant-response-packet-export-review-binding-verifier.sql");
  console.log("P14-05 forward -> rollback -> forward proof against synthetic local PostgreSQL passed.");

  psqlExec(
    "INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ('00000000-0000-4000-8000-000000000001', 'P14-05 Smoke Org', 'p14-05-smoke-org') ON CONFLICT (organization_id) DO NOTHING;",
  );
  psqlExec(
    "INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ('00000000-0000-4000-8000-000000000002', 'P14-05 Smoke Other Org', 'p14-05-smoke-other-org') ON CONFLICT (organization_id) DO NOTHING;",
  );

  const testResult = spawnSync("node", [
    "--test",
    "__tests__/kai-sprint2-p14-05-grant-response-packet-export-review-binding.spec.js",
    "__tests__/kai-sprint2-p3-05-export-review-request-boundary.spec.js",
    "__tests__/kai-sprint2-p3-09-export-review-start-boundary.spec.js",
    "__tests__/kai-sprint2-p3-13-export-review-completion-boundary.spec.js",
    "__tests__/kai-grant-response-packet-export-candidate-boundary.spec.js",
    "__tests__/kai-sprint2-p14-04-grant-response-packet-export-candidate-service.spec.js",
    "__tests__/kai-sprint2-p14-04-grant-response-packet-export-candidate-route.spec.js",
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
      KAI_P14_05_GRANT_RESPONSE_PACKET_EXPORT_REVIEW_BINDING_DATABASE_URL: targetUrl,
    },
  });
  if (testResult.status !== 0) throw new Error("P14-05 grant-response-packet-export-review-binding tests failed");
  console.log("P14-05 grant-response-packet-export-review-binding focused tests passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P14-05 grant-response-packet-export-review-binding ephemeral PostgreSQL workdir removed: ${workDir}`);
}
