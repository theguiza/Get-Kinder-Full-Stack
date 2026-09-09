import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_p3_02_review_packet_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p3-02-pg-"));
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
    throw new Error("P3-02 runner refused non-loopback target before connection");
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
    if (row.database_name !== dbName) throw new Error("P3-02 runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`P3-02 runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("P3-02 runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("P3-02 runner refused non-loopback listen_addresses");
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

  // P14-01 hard precondition: kai.generation_runs.engagement_id FK's to
  // kai.engagements(engagement_id, organization_id), so the organization/
  // engagement foundation (shared by the existing organization-enablement
  // local-Postgres runner) must exist before the P3-01/P14-01 migrations
  // below create/extend kai.generation_runs. Mirrors the P3-01 runner's own
  // precedent byte-for-byte.
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  // Runner-local accommodation only (never a modification of the shared
  // bootstrap SQL file itself): the P14-01 engagement-side FK targets
  // kai.engagements (engagement_id, organization_id), a composite unique
  // constraint the organization-enablement bootstrap schema does not itself
  // declare - the same runner-local accommodation the P3-01 runner applies
  // for this identical composite FK shape.
  psqlExec(
    "ALTER TABLE kai.engagements ADD CONSTRAINT kai_p3_02_engagements_id_org_unique UNIQUE (engagement_id, organization_id);",
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
  psqlFile("scripts/kai-sprint2-gate-a-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-04-data-dictionary-quality-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-05-intake-sensitivity-profile-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-06-review-queue-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-07-source-candidate-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-08-source-promotion-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p2-01-evidence-lineage-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p2-03-claim-proposal-smoke-seed.sql");

  // Real kai.organizations/kai.engagements rows the P3-02 integration suite's
  // createEvidenceSummaryDraft/createImpactNarrativeDraft calls now require
  // as the requested engagementId (P14-01 write contract), reusing the exact
  // UUID constants
  // __tests__/kai-sprint2-p3-02-generated-draft-review-packet.integration.spec.js
  // hardcodes.
  psqlExec(
    "INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ('00000000-0000-4000-8000-000000000001', 'P3-02 Smoke Org', 'p3-02-smoke-org') ON CONFLICT (organization_id) DO NOTHING;",
  );
  psqlExec(
    "INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code) VALUES ('00000000-0000-4000-8000-000000000902', '00000000-0000-4000-8000-000000000001', 'p3-02-smoke-engagement') ON CONFLICT (engagement_id) DO NOTHING;",
  );

  const testResult = spawnSync("node", [
    "--test",
    "__tests__/kai-sprint2-p3-02-generated-draft-review-packet.integration.spec.js",
    "__tests__/kai-sprint2-p3-02-generated-draft-review-packet-boundary.spec.js",
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
      KAI_P3_02_REVIEW_PACKET_DATABASE_URL: targetUrl,
    },
  });
  if (testResult.status !== 0) throw new Error("P3-02 generated-draft review packet tests failed");
  console.log("P3-02 generated-draft review packet focused tests passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P3-02 generated-draft review packet ephemeral PostgreSQL workdir removed: ${workDir}`);
}
